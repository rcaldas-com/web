const SCRIPT = `#!/usr/bin/env bash
set -euo pipefail

# Remove o zxnet antigo (cron, tunel reverso aberto, symlink, estado local)
# de um host ja provisionado. Script avulso, separado do /init, porque essa
# limpeza so faz sentido enquanto ainda existem hosts nao migrados -- depois
# que o ultimo for embora isso vira codigo morto, entao nao faz sentido
# pendurar no /init pra sempre.

USER="${'$'}{SYNC_USER:-rcaldas}"
HOME_USER="${'$'}{SYNC_HOME_USER:-/var/$USER}"
BIN_DIR="${'$'}{SYNC_BIN_DIR:-/usr/local/bin}"

[ "$(id -u)" = 0 ] || { echo "Precisa rodar como root."; exit 1; }

echo "Matando tunel reverso do zxnet (se houver)..."
pkill -f 'zxnet@us.rcaldas.com' &> /dev/null || true

echo "Removendo cron do zxnet..."
grep -rl 'zxnet' /etc/cron.d/ 2>/dev/null | xargs -r rm -f

echo "Removendo symlink e estado local..."
rm -f "$BIN_DIR"/zxnet
rm -f "$HOME_USER"/.zxnet.log "$HOME_USER"/.last_ipv6 "$HOME_USER"/.cf_record_id "$HOME_USER"/.cf_ddns

echo "Pronto -- zxnet removido deste host."
`;

export async function GET() {
  return new Response(SCRIPT, {
    headers: {
      'content-type': 'text/x-shellscript; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}
