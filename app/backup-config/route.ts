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

  for (const inc of entry.includes) {
    linhas.push(`backup${t}${BACKUP_USER}@${entry.sshHost}:${inc.path}${t}./`);
    for (const ex of inc.excludes ?? []) {
      linhas.push(`exclude${t}${ex}`);
    }
  }

  return linhas.join('\n') + '\n';
}

export async function GET(request: Request) {
  const runner = new URL(request.url).searchParams.get('runner') || 'bag';
  const plano = await getBackupPlan(runner);

  const partes = plano.map((entry, i) => {
    const delim = `BKPCONF_${i}_EOF`;
    return [
      `echo "  ${entry.host} (porta ${entry.sshPort})"`,
      `cat <<'${delim}' > /etc/rsnapshot/${entry.host}.conf`,
      rsnapshotConfig(entry),
      delim,
    ].join('\n');
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
