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
  read < /dev/tty -r -p "$prompt [$default]: " answer || true
  echo "${'$'}{answer:-$default}"
}

ask_bool() {
  local prompt="$1"
  local default="$2"
  local answer
  read < /dev/tty -r -p "$prompt [$default]: " answer || true
  answer="${'$'}{answer:-$default}"
  case "${'$'}{answer,,}" in
    s|sim|y|yes|1|true) echo "true" ;;
    *) echo "false" ;;
  esac
}

need_root "$@"

mkdir -p "$CONFIG_DIR"
chmod 700 "$CONFIG_DIR"

[[ -f "$CONFIG_FILE" ]] && source "$CONFIG_FILE"

DEFAULT_HOST="${'$'}{HOST_NAME:-$(hostname -s 2>/dev/null || hostname)}"
HOST_NAME="${'$'}(ask 'Nome do host para o monitor' "$DEFAULT_HOST")"
AGENT_TOKEN="${'$'}(ask 'Token do agente (vazio para primeiro cadastro)' "${'$'}{AGENT_TOKEN:-}")"
DEFAULT_TUNNEL="sim"
[[ "${'$'}{ENABLE_TUNNEL:-}" == "false" ]] && DEFAULT_TUNNEL="nao"
ENABLE_TUNNEL="${'$'}(ask_bool 'Habilitar tunel SSH reverso quando solicitado' "$DEFAULT_TUNNEL")"

cat > "$CONFIG_FILE" <<EOF
APP_URL=$APP_URL
HOST_NAME=$HOST_NAME
AGENT_TOKEN=$AGENT_TOKEN
ENABLE_TUNNEL=$ENABLE_TUNNEL
TUNNEL_RELAY=us.rcaldas.com
TUNNEL_RELAY_PORT=8422
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
ENABLE_TUNNEL="${'$'}{ENABLE_TUNNEL:-false}"
TUNNEL_RELAY="${'$'}{TUNNEL_RELAY:-us.rcaldas.com}"
TUNNEL_RELAY_PORT="${'$'}{TUNNEL_RELAY_PORT:-8422}"
VERSION="2.1.0"
LOG="/var/log/rcaldas-agent.log"
PENDING_RESULTS_FILE="/etc/rcaldas-agent/pending-results.json"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG" >/dev/null; }
json_escape() { printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'; }

ipv4=$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i=="src") {print $(i+1); exit}}' || true)
ipv6=$(ip -6 addr show scope global 2>/dev/null | grep '/64' | grep -v 'temporary\|deprecated' | awk '{print $2}' | cut -d/ -f1 | head -1 || true)
uptime_seconds=$(cut -d' ' -f1 /proc/uptime 2>/dev/null | cut -d. -f1 || echo 0)
load1=$(awk '{print $1}' /proc/loadavg 2>/dev/null || echo 0)
disk_root=$(df -P / 2>/dev/null | awk 'NR==2 {gsub("%", "", $5); print $5}' || echo 0)
memory_pct=$(awk '/MemTotal/ {total=$2} /MemAvailable/ {avail=$2} END {if(total>0) printf "%d", ((total-avail)*100/total); else print 0}' /proc/meminfo 2>/dev/null || echo 0)

results_payload="[]"
if [[ -s "$PENDING_RESULTS_FILE" ]]; then
  results_payload=$(cat "$PENDING_RESULTS_FILE")
  : > "$PENDING_RESULTS_FILE"
fi

payload=$(cat <<JSON
{
  "host":"$(json_escape "$HOST_NAME")",
  "token":"$(json_escape "$AGENT_TOKEN")",
  "version":"$VERSION",
  "time":"$(date -u '+%Y-%m-%dT%H:%M:%SZ')",
  "network":{"ipv4":"$(json_escape "$ipv4")","ipv6":"$(json_escape "$ipv6")"},
  "system":{"uptime":$uptime_seconds,"load1":$load1,"diskRootPct":$disk_root,"memoryPct":$memory_pct},
  "tunnel":{"enabled":$ENABLE_TUNNEL},
  "capabilities":["heartbeat","tcp_banner","tunnel"],
  "results":$results_payload
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

if [[ "$ENABLE_TUNNEL" == "true" ]]; then
  jobs_json=$(printf '%s' "$response" | grep -o '"jobs":\[[^]]*\]' || true)
  new_results=()
  while IFS= read -r job; do
    [[ -z "$job" ]] && continue
    job_id=$(printf '%s' "$job" | sed -n 's/.*"id":"\\([^"]*\\)".*/\\1/p')
    job_type=$(printf '%s' "$job" | sed -n 's/.*"type":"\\([^"]*\\)".*/\\1/p')
    port=$(printf '%s' "$job" | sed -n 's/.*"port":\\([0-9]*\\).*/\\1/p')
    [[ "$job_type" != "tunnel" || -z "$port" ]] && continue
    log "job $job_id: abrindo tunel reverso na porta $port via $TUNNEL_RELAY"
    local_ssh_port=$(ss -4tlnp 2>/dev/null | awk '/sshd/ {print $4}' | cut -d: -f2 | head -1)
    local_ssh_port="${'$'}{local_ssh_port:-22}"
    status="fail"
    if ssh -o UserKnownHostsFile=/etc/rcaldas-agent/known_hosts -o StrictHostKeyChecking=accept-new \
        -fNR "$port:127.0.0.1:$local_ssh_port" -p "$TUNNEL_RELAY_PORT" "$TUNNEL_RELAY" 2>>"$LOG"; then
      status="ok"
    fi
    new_results+=("{\\"id\\":\\"$job_id\\",\\"type\\":\\"tunnel\\",\\"status\\":\\"$status\\"}")
  done < <(printf '%s' "$jobs_json" | grep -o '{[^}]*}')
  if [[ ${'$'}{#new_results[@]} -gt 0 ]]; then
    printf '[%s]' "$(IFS=,; echo "${'$'}{new_results[*]}")" > "$PENDING_RESULTS_FILE"
  fi
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