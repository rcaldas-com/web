import { getBackupPlan, type BackupPlanEntry } from '@/lib/monitor';

const SNAPSHOT_ROOT = process.env.BACKUP_SNAPSHOT_ROOT || '/tank/bkp';
const BACKUP_USER = process.env.BACKUP_SSH_USER || 'rcaldas';
// Mesmo caminho que o setup-backup-runner gera. A chave dedicada existe
// justamente pra isso, mas so' passa a ser usada se for pedida na config:
// sem IdentityFile o ssh oferece as chaves padrao do root primeiro.
const RUNNER_KEY = '/root/.ssh/backup-runner';
const SSH_CONFIG = '/etc/rsnapshot/ssh_config';
// known_hosts proprio do backup. Separado do /root/.ssh/known_hosts de
// proposito: os aliases daqui apontam pro mesmo host por caminhos
// diferentes, e misturar isso com o known_hosts que a pessoa usa na mao
// so' gera confusao quando um host e' reinstalado.
const SSH_KNOWN_HOSTS = '/etc/rsnapshot/known_hosts';

// Alias por host, no mesmo espirito dos aliases do ~/.ssh/config do
// usuario -- so' que este e' gerado, entao nao envelhece sozinho.
function aliasSsh(entry: BackupPlanEntry) {
  return `${entry.host}-bkp`;
}

// Um bloco de ssh_config por host, com a ordem de tentativa embutida.
//
// O fallback vira ProxyCommand porque o ssh nao sabe tentar host:porta
// alternativos sozinho (ele so' percorre varios IPs do MESMO nome/porta).
//
// DOIS detalhes que custaram teste pra descobrir, nenhum obvio lendo doc:
//
// 1. O `sh -c` NAO e' redundante. O ssh executa o ProxyCommand com `exec`
//    na frente; sem um shell explicito o `exec` substitui o shell pelo
//    primeiro socat, e quando ele falha nao sobrou ninguem pra avaliar o
//    `||`. O fallback simplesmente nunca acontecia.
// 2. socat, e nao nc. O netcat instalado (netcat-traditional) e' SO IPv4
//    e nao resolve nome que so' tem AAAA -- que e' exatamente o caso dos
//    nomes DDNS da frota. Falha com "forward host lookup failed".
function blocoSsh(entry: BackupPlanEntry) {
  const alvos = entry.enderecos;
  const cadeia = alvos
    .map((a, i) => {
      // Timeout curto no primeiro: se o direto nao responde, o que
      // interessa e' chegar rapido na reserva, nao insistir.
      const timeout = i === alvos.length - 1 ? 8 : 3;
      // stderr do socat vai pro lixo em todos menos o ultimo: falhar no
      // primeiro e' esperado e nao e' erro que valha poluir o log.
      const silencio = i === alvos.length - 1 ? '' : ' 2>/dev/null';
      return `socat - TCP:${a.host}:${a.port},connect-timeout=${timeout}${silencio}`;
    })
    .join(' || ');

  return [
    `Host ${aliasSsh(entry)}`,
    `  User ${BACKUP_USER}`,
    `  IdentityFile ${RUNNER_KEY}`,
    '  IdentitiesOnly yes',
    `  UserKnownHostsFile ${SSH_KNOWN_HOSTS}`,
    '  StrictHostKeyChecking accept-new',
    '  BatchMode yes',
    `  ProxyCommand sh -c '${cadeia}'`,
    `  # ordem: ${alvos.map((a) => `${a.host}:${a.port}`).join(' -> ')}`,
    '',
  ].join('\n');
}

// Gera um .conf de rsnapshot por host, no mesmo formato dos .bkp escritos
// a mao hoje (mesmo rsync_long_args, mesmo --rsync-path="sudo rsync",
// mesmos intervalos). A diferenca e que o ssh_args sai daqui resolvido:
// o Monitor sabe quem esta atras de NAT e em que porta o tunel escuta.
function rsnapshotConfig(entry: BackupPlanEntry) {
  // rsnapshot exige TAB como separador -- espaco nao funciona.
  const t = '\t';
  const linhas = [
    'config_version\t1.2',
    `snapshot_root${t}${SNAPSHOT_ROOT}/${entry.host}/`,
    'cmd_cp\t\t/bin/cp',
    'cmd_rm\t\t/bin/rm',
    'cmd_rsync\t/usr/bin/rsync',
    'cmd_ssh\t\t/usr/bin/ssh',
    'cmd_logger\t/usr/bin/logger',
    'cmd_du\t\t/usr/bin/du',
    `retain${t}hora${t}${entry.retention.hora}`,
    `retain${t}dia${t}${entry.retention.dia}`,
    `retain${t}semana${t}${entry.retention.semana}`,
    `retain${t}mes${t}${entry.retention.mes}`,
    'verbose\t\t2',
    'loglevel\t3',
    'logfile\t/var/log/rsnapshot.log',
    `lockfile\t/var/run/rsnapshot-${entry.host}.pid`,
    // Endereco, porta, chave e ordem de tentativa saem todos do ssh_config
    // gerado junto -- aqui fica so' o ponteiro pra ele.
    `ssh_args${t}-F ${SSH_CONFIG}`,
    'rsync_short_args\t-a',
    'rsync_long_args\t--delete --numeric-ids --relative --delete-excluded --rsync-path="sudo /usr/bin/rsync"',
    'link_dest\t1',
    'rsync_numtries\t2',
    '',
  ];

  if (mountPoints(entry).length) {
    linhas.push(`cmd_preexec${t}/etc/rsnapshot/${entry.host}.preexec.sh`);
  }

  for (const inc of entry.includes) {
    linhas.push(`backup${t}${BACKUP_USER}@${aliasSsh(entry)}:${inc.path}${t}./`);
    for (const ex of inc.excludes ?? []) {
      linhas.push(`exclude${t}${ex}`);
    }
  }

  return linhas.join('\n') + '\n';
}

function mountPoints(entry: BackupPlanEntry) {
  return [...new Set(entry.includes.map((i) => i.mountPoint).filter((m): m is string => Boolean(m)))];
}

// rsnapshot roda cmd_preexec UMA vez, antes de qualquer 'backup' da config
// inteira -- se sair != 0, ele recusa o ciclo inteiro (nao so o diretorio
// do HD). E o comportamento certo: sem essa trava, HD desconectado vira
// origem vazia pro rsync e o '--delete' do rsync_long_args apaga o destino
// inteiro, com sucesso (exit 0) -- nenhum alerta dispara pra isso.
function preexecScript(entry: BackupPlanEntry) {
  const checks = mountPoints(entry).map((mp) => {
    // Aspas simples, escapando aspas simples embutidas -- o valor vem do
    // formulario do Monitor (admin-only, mas nao custa nada nao confiar).
    const seguro = mp.replace(/'/g, `'\\''`);
    return `mountpoint -q '${seguro}' || { echo "preexec: '${seguro}' nao esta montado -- abortando backup de ${entry.host}" >&2; exit 1; }`;
  });
  return `#!/usr/bin/env bash\nset -e\n${checks.join('\n')}\n`;
}

export async function GET(request: Request) {
  const runner = new URL(request.url).searchParams.get('runner') || 'bag';
  const plano = await getBackupPlan(runner);

  const partes = plano.map((entry, i) => {
    const delim = `BKPCONF_${i}_EOF`;
    const linhas = [
      `echo "  ${entry.host} (${entry.enderecos.map((a) => `${a.host}:${a.port}`).join(' -> ')})"`,
      `cat <<'${delim}' > /etc/rsnapshot/${entry.host}.conf`,
      rsnapshotConfig(entry),
      delim,
    ];
    if (mountPoints(entry).length) {
      const preexecDelim = `BKPPRE_${i}_EOF`;
      linhas.push(
        `cat <<'${preexecDelim}' > /etc/rsnapshot/${entry.host}.preexec.sh`,
        preexecScript(entry),
        preexecDelim,
        `chmod 755 /etc/rsnapshot/${entry.host}.preexec.sh`
      );
    }
    return linhas.join('\n');
  });

  const script = `#!/usr/bin/env bash
set -euo pipefail

# Configs de backup geradas pelo Monitor para o runner "${runner}".
# Nao editar a mao: rode de novo para pegar as mudancas feitas na UI.
#   curl -fsSL ${process.env.AUTH_TRUST_HOST || 'https://web.rcaldas.com'}/backup-config | sudo bash

[ "$(id -u)" = 0 ] || { echo "Precisa rodar como root."; exit 1; }

mkdir -p /etc/rsnapshot

# socat e' o que faz o encadeamento de enderecos do ProxyCommand funcionar.
# Checado, e nao assumido: sem ele TODO backup remoto para de uma vez, e o
# erro que aparece ("proxy command failed") nao diz o que faltou.
if ! command -v socat >/dev/null 2>&1; then
  echo "  instalando socat (necessario pro fallback de endereco)"
  apt-get update -qq && apt-get install -y -qq socat
fi

echo "Escrevendo ssh_config do backup:"
cat <<'BKPSSH_EOF' > ${SSH_CONFIG}
# Gerado pelo Monitor -- nao editar a mao.
#
# Um alias por host, com a ordem de tentativa no ProxyCommand: nome DDNS
# primeiro (que em IPv6 resolve pro endereco global e, dentro de casa, e'
# entregue direto na LAN pelo Neighbor Discovery), tunel via relay depois.
${plano.map(blocoSsh).join('\n')}
BKPSSH_EOF
chmod 600 ${SSH_CONFIG}
touch ${SSH_KNOWN_HOSTS} && chmod 600 ${SSH_KNOWN_HOSTS}

echo "Escrevendo configs de backup:"
${partes.length ? partes.join('\n\n') : 'echo "  (nenhum host com backup habilitado)"'}

echo
echo "Pronto. Teste sem copiar nada com:"
echo "  rsnapshot -c /etc/rsnapshot/<host>.conf -t hora"
`;

  return new Response(script, {
    headers: {
      'content-type': 'text/x-shellscript; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}
