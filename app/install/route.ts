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
ENABLE_TUNNEL="${'$'}(ask_bool 'Habilitar tunel SSH reverso' "$DEFAULT_TUNNEL")"

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
json_escape() { printf '%s' "$1" | sed 's/\\\\/\\\\\\\\/g; s/"/\\\\"/g'; }

ipv4=$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i=="src") {print $(i+1); exit}}' || true)
ipv6=$(ip -6 addr show scope global 2>/dev/null | grep '/64' | grep -v 'temporary\|deprecated' | awk '{print $2}' | cut -d/ -f1 | head -1 || true)
uptime_seconds=$(cut -d' ' -f1 /proc/uptime 2>/dev/null | cut -d. -f1 || echo 0)
load1=$(awk '{print $1}' /proc/loadavg 2>/dev/null || echo 0)

# CPU% medio DESDE O CICLO ANTERIOR (delta de /proc/stat guardado em
# arquivo de estado), nao amostra instantanea. Janela de ~60s: o provedor
# (Linode) so alerta na media de 2 HORAS, entao aqui da pra ver o problema
# muito antes. Mesma unidade do painel deles: 100% = 1 nucleo.
CPU_STATE="/etc/rcaldas-agent/cpu.state"
cpu_count=$(nproc 2>/dev/null || echo 1)
cpu_pct=0
cpu_now=$(awk '/^cpu /{t=0; for(i=2;i<=NF;i++) t+=$i; print t, $5+$6; exit}' /proc/stat 2>/dev/null || echo "0 0")
cur_total=$(echo "$cpu_now" | cut -d' ' -f1)
cur_idle=$(echo "$cpu_now" | cut -d' ' -f2)
if [[ -s "$CPU_STATE" ]]; then
  prev_total=$(cut -d' ' -f1 "$CPU_STATE" 2>/dev/null || echo 0)
  prev_idle=$(cut -d' ' -f2 "$CPU_STATE" 2>/dev/null || echo 0)
  dt=$((cur_total - prev_total))
  di=$((cur_idle - prev_idle))
  if [[ "$dt" -gt 0 ]]; then
    cpu_pct=$(( (100 * cpu_count * (dt - di)) / dt ))
  fi
fi
printf '%s %s' "$cur_total" "$cur_idle" > "$CPU_STATE" 2>/dev/null || true

# Quem esta consumindo -- o detalhe que o alerta do provedor nao da.
top_cpu=$(ps -eo pcpu,comm --sort=-pcpu --no-headers 2>/dev/null | head -3 | awk '{printf "%s%s %s%%", (NR>1?", ":""), $2, $1}' || true)
disk_pct() { df -P "$1" 2>/dev/null | awk 'NR==2 {gsub("%", "", $5); print $5}'; }
disk_dev() { df -P "$1" 2>/dev/null | awk 'NR==2 {print $1}'; }

disk_root=$(disk_pct / || echo 0)
root_dev=$(disk_dev /)
disk_var_pct="null"
disk_varlog_pct="null"
if [[ -d /var ]]; then
  var_dev=$(disk_dev /var)
  [[ -n "$var_dev" && "$var_dev" != "$root_dev" ]] && disk_var_pct=$(disk_pct /var)
fi
if [[ -d /var/log ]]; then
  varlog_dev=$(disk_dev /var/log)
  [[ -n "$varlog_dev" && "$varlog_dev" != "$root_dev" && "$varlog_dev" != "${'$'}{var_dev:-}" ]] && disk_varlog_pct=$(disk_pct /var/log)
fi
memory_pct=$(awk '/MemTotal/ {total=$2} /MemAvailable/ {avail=$2} END {if(total>0) printf "%d", ((total-avail)*100/total); else print 0}' /proc/meminfo 2>/dev/null || echo 0)

# Rename atomico em vez de truncar: se o POST falhar, o lote ainda existe
# em .sending e volta pra fila no fim. Truncar antes de saber se o envio
# deu certo perde o lote sempre que o servidor/rede estiver fora.
results_payload="[]"
SENDING_FILE="$PENDING_RESULTS_FILE.sending"
# Sobrou .sending de uma execucao anterior que morreu no meio? Recupera.
if [[ -s "$SENDING_FILE" ]]; then
  cat "$SENDING_FILE" >> "$PENDING_RESULTS_FILE" 2>/dev/null || true
  rm -f "$SENDING_FILE"
fi
if [[ -s "$PENDING_RESULTS_FILE" ]]; then
  mv "$PENDING_RESULTS_FILE" "$SENDING_FILE"
  results_payload=$(cat "$SENDING_FILE")
fi

# Porta do tunel reverso que este agente ja tem aberto agora, se tiver --
# reportado no heartbeat, e usado abaixo pra decidir se precisa abrir,
# trocar ou derrubar, sem depender de nenhum job vindo do servidor.
active_port=$(ps -Af | grep -- '-fNR ' | grep "$TUNNEL_RELAY" | grep -v grep | sed -n 's/.*-fNR \\([0-9]*\\):.*/\\1/p' | head -1 || true)

payload=$(cat <<JSON
{
  "host":"$(json_escape "$HOST_NAME")",
  "token":"$(json_escape "$AGENT_TOKEN")",
  "version":"$VERSION",
  "time":"$(date -u '+%Y-%m-%dT%H:%M:%SZ')",
  "network":{"ipv4":"$(json_escape "$ipv4")","ipv6":"$(json_escape "$ipv6")"},
  "system":{"uptime":$uptime_seconds,"load1":$load1,"cpuPct":$cpu_pct,"cpuCount":$cpu_count,"topCpu":"$(json_escape "$top_cpu")","diskRootPct":$disk_root,"diskVarPct":$disk_var_pct,"diskVarLogPct":$disk_varlog_pct,"memoryPct":$memory_pct},
  "tunnel":{"enabled":$ENABLE_TUNNEL,"activeRemotePort":${'$'}{active_port:-null}},
  "capabilities":["heartbeat","tcp_banner","tunnel"],
  "results":$results_payload
}
JSON
)

response=$(curl -fsS -m 20 -H 'Content-Type: application/json' -X POST "$APP_URL/heartbeat" -d "$payload") || {
  log "heartbeat falhou"
  # Devolve o lote pra fila -- o proximo ciclo tenta de novo.
  if [[ -s "$SENDING_FILE" ]]; then
    cat "$SENDING_FILE" >> "$PENDING_RESULTS_FILE" 2>/dev/null || true
    rm -f "$SENDING_FILE"
  fi
  exit 1
}

# Entregue com sucesso: so agora o lote pode ser descartado.
rm -f "$SENDING_FILE"

new_token=$(printf '%s' "$response" | sed -n 's/.*"token":"\\([^"]*\\)".*/\\1/p')
if [[ -n "$new_token" && -z "$AGENT_TOKEN" ]]; then
  sed -i "s/^AGENT_TOKEN=.*/AGENT_TOKEN=$new_token/" "$CONFIG_FILE"
  log "token do agente salvo"
fi

# Estado do tunel e decidido pelo servidor a cada heartbeat (o que o admin
# configurou no Monitor), nao por um job avulso -- se o processo cair por
# qualquer motivo, o proximo ciclo (ate 60s) reabre sozinho, do mesmo jeito
# que o zxnet fazia com seu polling.
if [[ "$ENABLE_TUNNEL" == "true" ]]; then
  wanted_port=$(printf '%s' "$response" | sed -n 's/.*"tunnel":{"enabled":true,"port":\\([0-9]*\\).*/\\1/p')
  if [[ -n "$active_port" && "$active_port" != "$wanted_port" ]]; then
    log "derrubando tunel antigo na porta $active_port"
    pkill -f -- "-fNR $active_port:.*$TUNNEL_RELAY" &> /dev/null || true
    active_port=""
  fi
  if [[ -n "$wanted_port" && -z "$active_port" ]]; then
    log "abrindo tunel reverso na porta $wanted_port via $TUNNEL_RELAY"
    local_ssh_port=$(ss -4tlnp 2>/dev/null | awk '/sshd/ {print $4}' | cut -d: -f2 | head -1)
    local_ssh_port="${'$'}{local_ssh_port:-22}"
    ssh -i /root/.ssh/id_ed25519 -o UserKnownHostsFile=/etc/rcaldas-agent/known_hosts -o StrictHostKeyChecking=accept-new \
        -fNR "$wanted_port:127.0.0.1:$local_ssh_port" -p "$TUNNEL_RELAY_PORT" "zxnet@$TUNNEL_RELAY" 2>>"$LOG" \
        || log "falha ao abrir tunel na porta $wanted_port"
  fi
fi

log "heartbeat ok: $response"
EOF
chmod 755 "$AGENT_BIN"

# O agente escreve uma linha por minuto e nenhuma distro rotaciona esse
# arquivo sozinha -- sem isso ele cresce pra sempre em todo host.
# tee -a reabre o arquivo a cada execucao, entao rotate simples basta
# (nao precisa de copytruncate).
mkdir -p /etc/logrotate.d
cat > /etc/logrotate.d/rcaldas-agent <<'EOF'
/var/log/rcaldas-agent.log {
	weekly
	rotate 4
	missingok
	notifempty
	compress
	delaycompress
}
EOF

if command -v systemctl >/dev/null 2>&1; then
  cat > /etc/systemd/system/rcaldas-agent.service <<EOF
[Unit]
Description=RCaldas monitor agent heartbeat

[Service]
Type=oneshot
# Sem isso, systemd mata o cgroup do servico inteiro quando o oneshot
# termina -- inclusive o ssh -fNR que ja fez fork pra background, que so
# escapa do PROCESSO pai, nao do cgroup. O tunel abria e morria segundos
# depois, toda vez, silenciosamente (sem nenhum erro nos logs).
KillMode=process
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