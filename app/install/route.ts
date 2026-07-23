const APP_URL = process.env.AUTH_TRUST_HOST || 'http://localhost:8001';

function script() {
  return `#!/usr/bin/env bash
set -euo pipefail

APP_URL="${APP_URL}"
CONFIG_DIR="/etc/rcaldas-agent"
CONFIG_FILE="$CONFIG_DIR/config.env"
AGENT_BIN="/usr/local/bin/rcaldas-agent"
CRON_FILE="/etc/cron.d/rcaldas-agent"

need_root() {
  if [[ "${'$'}EUID" -ne 0 ]]; then
    echo "Este instalador precisa de sudo/root. Tentando relancar com sudo..."
    exec sudo -E bash "$0" "$@"
  fi
}

ask() {
  local prompt="$1"
  local default="$2"
  local answer
  read -r -p "$prompt [$default]: " answer || true
  echo "${'$'}{answer:-$default}"
}

ask_bool() {
  local prompt="$1"
  local default="$2"
  local answer
  read -r -p "$prompt [$default]: " answer || true
  answer="${'$'}{answer:-$default}"
  case "${'$'}{answer,,}" in
    s|sim|y|yes|1|true) echo "true" ;;
    *) echo "false" ;;
  esac
}

need_root "$@"

mkdir -p "$CONFIG_DIR"
chmod 700 "$CONFIG_DIR"

DEFAULT_HOST="${'$'}(hostname -s 2>/dev/null || hostname)"
HOST_NAME="${'$'}(ask 'Nome do host para o monitor' "$DEFAULT_HOST")"
AGENT_TOKEN="${'$'}(ask 'Token do agente (vazio para primeiro cadastro)' "")"
ENABLE_TUNNEL="${'$'}(ask_bool 'Habilitar tunel SSH reverso quando solicitado' 'sim')"
ENABLE_DDNS="${'$'}(ask_bool 'Enviar IPv6 global no heartbeat' 'sim')"

cat > "$CONFIG_FILE" <<EOF
APP_URL=$APP_URL
HOST_NAME=$HOST_NAME
AGENT_TOKEN=$AGENT_TOKEN
ENABLE_TUNNEL=$ENABLE_TUNNEL
ENABLE_DDNS=$ENABLE_DDNS
EOF
chmod 600 "$CONFIG_FILE"

cat > "$AGENT_BIN" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

CONFIG_FILE="/etc/rcaldas-agent/config.env"
[[ -f "$CONFIG_FILE" ]] && source "$CONFIG_FILE"

APP_URL="${'$'}{APP_URL:-https://web.rcaldas.com}"
HOST_NAME="${'$'}{HOST_NAME:-$(hostname -s 2>/dev/null || hostname)}"
AGENT_TOKEN="${'$'}{AGENT_TOKEN:-}"
ENABLE_DDNS="${'$'}{ENABLE_DDNS:-true}"
VERSION="2.0.0"
LOG="/var/log/rcaldas-agent.log"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG" >/dev/null; }
json_escape() { printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'; }

ipv4=$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i=="src") {print $(i+1); exit}}' || true)
ipv6=""
if [[ "$ENABLE_DDNS" == "true" ]]; then
  ipv6=$(ip -6 addr show scope global 2>/dev/null | grep '/64' | grep -v 'temporary\|deprecated' | awk '{print $2}' | cut -d/ -f1 | head -1 || true)
fi
uptime_seconds=$(cut -d' ' -f1 /proc/uptime 2>/dev/null | cut -d. -f1 || echo 0)
load1=$(awk '{print $1}' /proc/loadavg 2>/dev/null || echo 0)
disk_root=$(df -P / 2>/dev/null | awk 'NR==2 {gsub("%", "", $5); print $5}' || echo 0)
memory_pct=$(awk '/MemTotal/ {total=$2} /MemAvailable/ {avail=$2} END {if(total>0) printf "%d", ((total-avail)*100/total); else print 0}' /proc/meminfo 2>/dev/null || echo 0)

payload=$(cat <<JSON
{
  "host":"$(json_escape "$HOST_NAME")",
  "token":"$(json_escape "$AGENT_TOKEN")",
  "version":"$VERSION",
  "time":"$(date -u '+%Y-%m-%dT%H:%M:%SZ')",
  "network":{"ipv4":"$(json_escape "$ipv4")","ipv6":"$(json_escape "$ipv6")"},
  "system":{"uptime":$uptime_seconds,"load1":$load1,"diskRootPct":$disk_root,"memoryPct":$memory_pct},
  "tunnel":{"enabled":${'$'}{ENABLE_TUNNEL:-false}},
  "capabilities":["heartbeat","tcp_banner"]
}
JSON
)

response=$(curl -fsS -m 20 -H 'Content-Type: application/json' -X POST "$APP_URL/heartbeat" -d "$payload") || {
  log "heartbeat falhou"
  exit 1
}

new_token=$(printf '%s' "$response" | sed -n 's/.*"token":"\\([^"]*\\)".*/\\1/p')
if [[ -n "$new_token" && -z "$AGENT_TOKEN" ]]; then
  sed -i "s/^AGENT_TOKEN=.*/AGENT_TOKEN=$new_token/" "$CONFIG_FILE"
  log "token do agente salvo"
fi

log "heartbeat ok: $response"
EOF
chmod 755 "$AGENT_BIN"

if command -v systemctl >/dev/null 2>&1; then
  cat > /etc/systemd/system/rcaldas-agent.service <<EOF
[Unit]
Description=RCaldas monitor agent heartbeat

[Service]
Type=oneshot
ExecStart=$AGENT_BIN
EOF
  cat > /etc/systemd/system/rcaldas-agent.timer <<EOF
[Unit]
Description=Run RCaldas monitor agent every minute

[Timer]
OnBootSec=30
OnUnitActiveSec=60
AccuracySec=10
Unit=rcaldas-agent.service

[Install]
WantedBy=timers.target
EOF
  systemctl daemon-reload
  systemctl enable --now rcaldas-agent.timer
  systemctl start rcaldas-agent.service || true
  echo "Instalado com systemd timer: rcaldas-agent.timer"
else
  echo "* * * * * root $AGENT_BIN >/dev/null 2>&1" > "$CRON_FILE"
  chmod 644 "$CRON_FILE"
  "$AGENT_BIN" || true
  echo "Instalado com cron: $CRON_FILE"
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