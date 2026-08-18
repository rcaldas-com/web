const REVERT_UNIT = 'monitor-fw-revert';

function script() {
  return `#!/usr/bin/env bash
set -euo pipefail

[ "$(id -u)" = 0 ] || { echo "Precisa rodar como root."; exit 1; }

if systemctl stop ${REVERT_UNIT}.service 2>/dev/null; then
  echo "Confirmado -- reversao automatica cancelada. O firewall novo fica valendo."
else
  echo "Nao havia reversao pendente (ja passou do prazo, ja foi confirmado antes, ou nada foi aplicado ainda)."
fi
`;
}

export async function GET() {
  return new Response(script(), {
    headers: {
      'content-type': 'text/x-shellscript; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}
