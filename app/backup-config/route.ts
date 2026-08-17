import { getBackupPlan, type BackupPlanEntry } from '@/lib/monitor';

const SNAPSHOT_ROOT = process.env.BACKUP_SNAPSHOT_ROOT || '/tank/bkp';
const BACKUP_USER = process.env.BACKUP_SSH_USER || 'rcaldas';

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
    // Porta resolvida pelo Monitor: tunel se o host esta atras de NAT,
    // 8422 direto se tem IP proprio.
    `ssh_args${t}-p ${entry.sshPort}`,
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
    linhas.push(`backup${t}${BACKUP_USER}@${entry.sshHost}:${inc.path}${t}./`);
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
      `echo "  ${entry.host} (porta ${entry.sshPort})"`,
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
