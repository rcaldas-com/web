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
# NAO da pra usar 'pkill -f zxnet@us.rcaldas.com': o agente NOVO conecta no
# relay com esse mesmo usuario, entao o padrao casa com os dois e o script
# derrubaria o tunel em uso. Como so o novo passa por /etc/rcaldas-agent,
# a distincao certa e essa -- e por exclusao, que continua valendo mesmo
# sem saber a forma exata do comando antigo.
for pid in $(pgrep -f 'zxnet@us.rcaldas.com' 2>/dev/null || true); do
  if [ "$pid" = "$$" ]; then continue; fi
  cmd=$(ps -p "$pid" -o args= 2>/dev/null || true)
  case "$cmd" in
    *rcaldas-agent*) echo "  preservando tunel do agente atual (pid $pid)" ;;
    *) kill "$pid" 2>/dev/null && echo "  tunel legado encerrado (pid $pid)" || true ;;
  esac
done

echo "Removendo cron do zxnet..."
# O '|| true' nao e enfeite: 'grep -rl' sai com 1 quando nao acha nada e,
# com pipefail, isso derrubava o script INTEIRO aqui -- antes de remover
# symlink e estado. Como o efeito era so a saida terminar mais cedo, num
# 'curl | bash' parecia ter rodado ate o fim. Todo host sem cron em
# /etc/cron.d ficou pela metade.
grep -rl 'zxnet' /etc/cron.d/ 2>/dev/null | xargs -r rm -f || true
# O agendamento nem sempre esta em /etc/cron.d -- versoes mais antigas do
# zxnet instalavam no crontab do root.
if crontab -l 2>/dev/null | grep -q zxnet; then
  crontab -l 2>/dev/null | grep -v zxnet | crontab -
  echo "  removido do crontab do root"
fi

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
