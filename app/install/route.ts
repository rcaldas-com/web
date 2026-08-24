import { AGENT_VERSION } from '@/lib/monitor';

const APP_URL = process.env.AUTH_TRUST_HOST || 'http://localhost:8001';

function script() {
  return `#!/usr/bin/env bash
set -euo pipefail

APP_URL="${APP_URL}"
CONFIG_DIR="/etc/rcaldas-agent"
CONFIG_FILE="$CONFIG_DIR/config.env"
AGENT_BIN="/usr/local/bin/rcaldas-agent"
CRON_FILE="/etc/cron.d/rcaldas-agent"
# Precisa existir NESTE escopo (o do instalador), nao so no do agente:
# e usado tanto pra escrever o config.env quanto pro rsyslog.d abaixo.
LOG_FORWARD_PORT="5514"

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
LOG_FORWARD_PORT=$LOG_FORWARD_PORT
EOF
chmod 600 "$CONFIG_FILE"

# Encaminha o syslog local pro coletor central, por dentro do tunel SSH
# (o -L abre 127.0.0.1:$LOG_FORWARD_PORT apontando pro rsyslog do relay).
# So faz sentido se o tunel estiver ligado -- sem ele nao ha caminho.
# Debian 13 nao traz rsyslog (so journald), entao instala se faltar --
# e o rsyslog quem fala com o coletor.
if [[ "$ENABLE_TUNNEL" == "true" ]] && ! command -v rsyslogd >/dev/null 2>&1; then
  echo "instalando rsyslog (necessario pra centralizar logs)..."
  DEBIAN_FRONTEND=noninteractive apt-get -qq install rsyslog > /dev/null 2>&1 || \
    echo "  AVISO: nao consegui instalar rsyslog -- logs nao serao centralizados"
fi

if [[ "$ENABLE_TUNNEL" == "true" ]] && [[ -d /etc/rsyslog.d ]]; then
  cat > /etc/rsyslog.d/60-forward-central.conf <<EOF
# Fila EM DISCO com teto: se o coletor cair, enfileira ate 200MB e drena
# sozinho quando voltar; se estourar o teto, descarta o mais antigo em vez
# de encher o disco do host. resumeRetryCount=-1 = tenta pra sempre.
action(type="omfwd"
       target="127.0.0.1" port="$LOG_FORWARD_PORT" protocol="tcp"
       queue.type="LinkedList"
       queue.filename="fwd-central"
       queue.maxdiskspace="200m"
       queue.saveonshutdown="on"
       action.resumeRetryCount="-1")
EOF
  systemctl restart rsyslog &> /dev/null || true
fi

# Mail local -> journal -> coletor central.
#
# Um monte de coisa do sistema so' avisa por mail local pro root e nunca
# passa pelo syslog: saida de cron que falhou, apt/unattended-upgrades,
# mdadm, smartd, zed. Sem isto e' descartado em silencio -- foi exatamente
# assim que um disco com erro de I/O no host 'bag' passou 3 dias despercebido,
# com o zed configurado e apontando pro email certo.
#
# Isto NAO e' um MTA: nao entrega nada, nao tem fila, nao pode ficar preso.
# Joga no journal, que ja vai pro Loki (90 dias, pesquisavel, com grafico).
# Email como canal de alerta ja provou que falha calado nesta infra: o 'us'
# ficou com 17 mensagens presas na fila por dias sem ninguem perceber.
MAIL_SHIM="/usr/local/sbin/mail-to-journal"
mkdir -p /usr/local/sbin
cat > "$MAIL_SHIM" <<'SHIMEOF'
#!/bin/bash
# Recebe destinatarios em argv e a mensagem inteira em stdin, como o
# sendmail. argv nao e' interpretado de proposito: o que importa e' o
# conteudo, e tudo que chega aqui merece ficar registrado.
destinatarios="$*"
{
  echo "--- inicio de mail local (para: ${'$'}{destinatarios:-root}) ---"
  cat
  echo "--- fim de mail local ---"
} | /usr/bin/logger -t local-mail -p mail.err
exit 0
SHIMEOF
chmod 755 "$MAIL_SHIM"

# Guarda o sendmail real UMA vez. O teste "nao e' link" e' o que impede a
# segunda execucao do instalador de salvar o proprio shim como "original" e
# perder o binario de verdade pra sempre.
for sm in /usr/sbin/sendmail /usr/lib/sendmail; do
  if [[ -e "$sm" && ! -L "$sm" ]]; then
    cp -a "$sm" "$sm.real-mta" 2>/dev/null || true
  fi
  ln -sf "$MAIL_SHIM" "$sm" 2>/dev/null || true
done
echo "mail local -> journal (tag local-mail); sendmail real, se havia, em *.real-mta"

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
# Porta local que o -L do tunel expoe apontando pro rsyslog do relay.
LOG_FORWARD_PORT="${'$'}{LOG_FORWARD_PORT:-5514}"
# So setado em hosts com papel de router (hoje, a mao no config.env; no
# futuro, pelo instalador /router). Vazio aqui = bloco de descoberta abaixo
# nunca roda, custo zero pro resto da frota.
DHCP_LEASES_FILE="${'$'}{DHCP_LEASES_FILE:-}"
VERSION="${AGENT_VERSION}"
LOG="/var/log/rcaldas-agent.log"
PENDING_RESULTS_FILE="/etc/rcaldas-agent/pending-results.json"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG" >/dev/null; }
json_escape() { printf '%s' "$1" | sed 's/\\\\/\\\\\\\\/g; s/"/\\\\"/g' | sed -z 's/\\n/\\\\n/g; s/\\t/\\\\t/g'; }

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

# Descoberta de dispositivo (so em host com papel de router). Compara o
# lease file do dnsmasq contra os MACs ja vistos e reporta so os novos --
# vira alarme type:"alarm" (pipeline agnostico de origem, sem mudar nada no
# servidor), que upsertIncident transforma em incidente newdev:<mac>. Uma
# linha por MAC em KNOWN_MACS_FILE evita re-reportar o mesmo host a cada
# minuto -- so entra de novo a cada minuto ele, mas so soma ${'$'}{count},
# nao reenvia email.
KNOWN_MACS_FILE="/etc/rcaldas-agent/known-macs.state"
newdev_results=""
if [[ -n "$DHCP_LEASES_FILE" && -f "$DHCP_LEASES_FILE" ]]; then
  touch "$KNOWN_MACS_FILE"
  while read -r _expiry mac ip hostname _clientid; do
    [[ -z "$mac" ]] && continue
    grep -qxF "$mac" "$KNOWN_MACS_FILE" && continue
    echo "$mac" >> "$KNOWN_MACS_FILE"
    hn="${'$'}{hostname:-desconhecido}"
    [[ "$hn" == "*" ]] && hn="desconhecido"
    msg="Novo dispositivo na LAN: $mac, IP $ip, hostname $hn"
    [[ -n "$newdev_results" ]] && newdev_results="$newdev_results,"
    newdev_results="$newdev_results{\\"id\\":\\"newdev:$mac\\",\\"type\\":\\"alarm\\",\\"status\\":\\"new\\",\\"message\\":\\"$(json_escape "$msg")\\",\\"details\\":{\\"mac\\":\\"$mac\\",\\"ip\\":\\"$(json_escape "$ip")\\",\\"hostname\\":\\"$(json_escape "$hn")\\"}}"
  done < "$DHCP_LEASES_FILE"
fi
if [[ -n "$newdev_results" ]]; then
  if [[ -s "$PENDING_RESULTS_FILE" ]]; then
    existente=$(sed 's/^\[//; s/\]$//' "$PENDING_RESULTS_FILE")
    [[ -n "$existente" ]] && newdev_results="$existente,$newdev_results"
  fi
  printf '[%s]' "$newdev_results" > "$PENDING_RESULTS_FILE"
fi

# So o runner tem este arquivo (escrito pelo setup-backup-runner): uso do
# disco onde os backups sao guardados. E o numero que decide se cabe mais
# um host no plano -- sem ele, so se descobre quando enche.
backup_disk_pct="null"
if [[ -s /etc/rcaldas-backup/snapshot-root ]]; then
  bkp_root=$(cat /etc/rcaldas-backup/snapshot-root)
  [[ -d "$bkp_root" ]] && backup_disk_pct=$(disk_pct "$bkp_root")
  [[ -z "$backup_disk_pct" ]] && backup_disk_pct="null"
fi

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
  "system":{"uptime":$uptime_seconds,"load1":$load1,"cpuPct":$cpu_pct,"cpuCount":$cpu_count,"topCpu":"$(json_escape "$top_cpu")","diskRootPct":$disk_root,"diskVarPct":$disk_var_pct,"diskVarLogPct":$disk_varlog_pct,"backupDiskPct":$backup_disk_pct,"memoryPct":$memory_pct},
  "tunnel":{"enabled":$ENABLE_TUNNEL,"activeRemotePort":${'$'}{active_port:-null}},
  "capabilities":["heartbeat","tcp_banner","tunnel","service-inventory"],
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

# Chave do host que faz backup da frota, distribuida pelo servidor. Fica
# aqui, e nao so no /init, pra que TROCAR DE RUNNER nao exija reprovisionar
# host nenhum: muda o arquivo no servidor e em ate 60s todo mundo autorizou
# a chave nova sozinho.
runner_key=$(printf '%s' "$response" | sed -n 's/.*"backupRunnerKey":"\\([^"]*\\)".*/\\1/p')
if [[ -n "$runner_key" ]]; then
  bkp_home=$(getent passwd rcaldas 2>/dev/null | cut -d: -f6)
  if [[ -n "$bkp_home" && -d "$bkp_home" ]]; then
    bkp_auth="$bkp_home/.ssh/authorized_keys"
    mkdir -p "$bkp_home/.ssh" && chmod 700 "$bkp_home/.ssh"
    touch "$bkp_auth"
    if ! grep -qsF "$runner_key" "$bkp_auth"; then
      # Remove chave de runner anterior antes de gravar a nova, senao a
      # cada troca sobraria uma chave velha ainda valida no host.
      sed -i '/backup-runner@/d' "$bkp_auth" 2>/dev/null || true
      echo "$runner_key" >> "$bkp_auth"
      chown rcaldas: "$bkp_auth" 2>/dev/null || true
      chmod 600 "$bkp_auth" 2>/dev/null || true
      log "chave do runner de backup autorizada"
    fi
  fi
fi

# Reconciliacao do tunel: compara o estado desejado com o que existe de
# fato, a cada heartbeat. Se o processo cair, o ciclo seguinte (ate 60s)
# reabre sozinho -- mesma ideia do polling do zxnet.
#
# wanted_port vazio significa "nao deve haver tunel": ou o host desabilitou
# localmente, ou o admin desligou no Monitor. A comparacao abaixo fica FORA
# de qualquer if de ENABLE_TUNNEL de proposito -- com ela dentro, desligar
# o tunel nunca derrubava o que ja estava aberto, e o us acabou com um
# tunel orfao apontando pra ele mesmo.
wanted_port=""
if [[ "$ENABLE_TUNNEL" == "true" ]]; then
  wanted_port=$(printf '%s' "$response" | sed -n 's/.*"tunnel":{"enabled":true,"port":\\([0-9]*\\).*/\\1/p')
fi

if [[ -n "$active_port" && "$active_port" != "$wanted_port" ]]; then
  log "derrubando tunel na porta $active_port (desejado: ${'$'}{wanted_port:-nenhum})"
  pkill -f -- "-fNR $active_port:.*$TUNNEL_RELAY" &> /dev/null || true
  active_port=""
fi

if [[ -n "$wanted_port" && -z "$active_port" ]]; then
  log "abrindo tunel reverso na porta $wanted_port via $TUNNEL_RELAY"
  local_ssh_port=$(ss -4tlnp 2>/dev/null | awk '/sshd/ {print $4}' | cut -d: -f2 | head -1)
  local_ssh_port="${'$'}{local_ssh_port:-22}"
  # O mesmo processo ssh leva as duas direcoes: -R da acesso ao host, -L
  # leva o syslog daqui pro coletor do us. Um processo so, reaproveitando
  # o loop de reconciliacao que ja se auto-recupera -- e nenhuma porta
  # nova exposta na internet, porque tudo trafega dentro do SSH.
  ssh -i /root/.ssh/id_ed25519 -o UserKnownHostsFile=/etc/rcaldas-agent/known_hosts -o StrictHostKeyChecking=accept-new \
      -fNR "$wanted_port:127.0.0.1:$local_ssh_port" \
      -L "$LOG_FORWARD_PORT:127.0.0.1:514" \
      -p "$TUNNEL_RELAY_PORT" "zxnet@$TUNNEL_RELAY" 2>>"$LOG" \
      || log "falha ao abrir tunel na porta $wanted_port"
fi

# Jobs: o heartbeat so avisa que existe algo; o conteudo vem daqui. Cada
# tipo e uma acao conhecida do agente -- nunca comando arbitrario vindo do
# servidor. O resultado volta pela mesma fila dos results, que so e limpa
# apos POST com sucesso, entao nada se perde se o servidor cair no meio.
if printf '%s' "$response" | grep -q '"hasJobs":true'; then
  jobs=$(curl -fsS -m 20 -H 'Content-Type: application/json' -X POST "$APP_URL/agent-jobs" \
    -d "{\\"host\\":\\"$(json_escape "$HOST_NAME")\\",\\"token\\":\\"$(json_escape "$AGENT_TOKEN")\\"}" 2>/dev/null || true)
  job_results=""
  while IFS= read -r job; do
    [[ -z "$job" ]] && continue
    jid=$(printf '%s' "$job" | sed -n 's/.*"id":"\\([^"]*\\)".*/\\1/p')
    jtype=$(printf '%s' "$job" | sed -n 's/.*"type":"\\([^"]*\\)".*/\\1/p')
    [[ -z "$jid" || -z "$jtype" ]] && continue

    jstatus="fail"; jmsg="tipo desconhecido: $jtype"; info_result=""
    case "$jtype" in
      backup-config)
        log "job $jid: regerando configs de backup"
        if curl -fsSL "$APP_URL/backup-config?runner=$HOST_NAME" | bash >> "$LOG" 2>&1; then
          jstatus="ok"; jmsg="configs de backup atualizadas"
        else
          jmsg="falha ao aplicar configs de backup"
        fi
        ;;
      update-agent)
        log "job $jid: atualizando o proprio agente"
        # Roda em background e desacoplado: o /install reescreve este
        # mesmo arquivo, entao continuar executando daqui e furada.
        setsid bash -c "sleep 2; curl -fsSL '$APP_URL/install' | bash" >> "$LOG" 2>&1 &
        jstatus="ok"; jmsg="atualizacao do agente disparada"
        ;;
      host-info)
        log "job $jid: coletando informacoes do host (fastfetch)"
        # Mesmo comando filtrado que roda no fim do /init. Vai como result
        # SEPARADO (type:info, id fixo "host-info", nao o $jid do job) --
        # o texto e bem maior que o resto e o servidor trata os dois canais
        # de forma diferente (job trunca em 500 chars, info nao).
        if ! command -v fastfetch >/dev/null 2>&1; then
          jmsg="fastfetch nao instalado neste host"
        else
          info_text=$(fastfetch --logo none --pipe true -s "OS:Host:Kernel:Uptime:Packages:Shell:CPU:GPU:Memory:Swap:Disk:LocalIP:Locale" 2>&1)
          if [[ -n "$info_text" ]]; then
            jstatus="ok"; jmsg="fastfetch coletado"
            info_result=",{\\"id\\":\\"host-info\\",\\"type\\":\\"info\\",\\"status\\":\\"ok\\",\\"message\\":\\"$(json_escape "$info_text")\\"}"
          else
            jmsg="fastfetch sem saida"
          fi
        fi
        ;;
      service-inventory)
        log "job $jid: inventariando servicos do compose"
        # Tres results pequenos em vez de um JSON montado aqui. Compor um
        # objeto so exigiria jq com --slurpfile e bem mais shell dentro do
        # template literal do JS -- que e onde este arquivo ja se queimou
        # duas vezes. Cada linha abaixo e independente e trivial de checar.
        inv_dir="/var/rcaldas/rcaldas"
        inv_file="docker-compose.prod.yml"
        if [[ ! -f "$inv_dir/$inv_file" ]]; then
          jmsg="sem $inv_file em $inv_dir"
        elif ! command -v jq >/dev/null 2>&1; then
          jmsg="jq nao instalado neste host"
        else
          inv_dec=$(cd "$inv_dir" && docker compose -f "$inv_file" config --format json 2>/dev/null \\
            | jq -c '[.services | to_entries[] | {name: .key, image: (.value.image // "")}]' 2>/dev/null)
          inv_run=$(cd "$inv_dir" && docker compose -f "$inv_file" ps --all --format json 2>/dev/null \\
            | jq -sc '[.[] | {name: .Service, image: .Image, state: .State}]' 2>/dev/null)
          # Montado por jq com --argjson, nunca concatenando string: aspas
          # dentro de aspas dentro de template literal e' onde este arquivo
          # ja quebrou a frota inteira uma vez.
          # --untracked-files=no de proposito: arquivo solto no diretorio nao
          # e' deriva de deploy. Sem isso, qualquer script temporario no host
          # apareceria como alarme -- e alarme que acende por qualquer coisa
          # e' alarme que se aprende a ignorar.
          inv_dirty=$(cd "$inv_dir" && git status --porcelain --untracked-files=no 2>/dev/null | awk '{print $NF}' | jq -Rsc 'split("\\n") | map(select(. != ""))' 2>/dev/null)
          [[ -z "$inv_dirty" ]] && inv_dirty="[]"
          inv_ahead=$(cd "$inv_dir" && git rev-list --count '@{u}'..HEAD 2>/dev/null || echo 0)
          inv_behind=$(cd "$inv_dir" && git rev-list --count HEAD..'@{u}' 2>/dev/null || echo 0)
          inv_repo=$(jq -nc --argjson dirty "$inv_dirty" --arg a "$inv_ahead" --arg b "$inv_behind" \\
            '{dirty: $dirty, ahead: ($a | tonumber), behind: ($b | tonumber)}' 2>/dev/null)
          if [[ -n "$inv_dec" && -n "$inv_run" && -n "$inv_repo" ]]; then
            jstatus="ok"; jmsg="inventario coletado"
            info_result=",{\\"id\\":\\"services-declared\\",\\"type\\":\\"inventory\\",\\"status\\":\\"ok\\",\\"message\\":\\"$(json_escape "$inv_dec")\\"}"
            info_result="$info_result,{\\"id\\":\\"services-running\\",\\"type\\":\\"inventory\\",\\"status\\":\\"ok\\",\\"message\\":\\"$(json_escape "$inv_run")\\"}"
            info_result="$info_result,{\\"id\\":\\"repo-state\\",\\"type\\":\\"inventory\\",\\"status\\":\\"ok\\",\\"message\\":\\"$(json_escape "$inv_repo")\\"}"
          else
            jmsg="falha ao ler compose config/ps"
          fi
        fi
        ;;
    esac

    [[ -n "$job_results" ]] && job_results="$job_results,"
    job_results="$job_results{\\"id\\":\\"$jid\\",\\"type\\":\\"job\\",\\"status\\":\\"$jstatus\\",\\"message\\":\\"$(json_escape "$jmsg")\\"}$info_result"
  done < <(printf '%s' "$jobs" | grep -o '{[^}]*}')

  if [[ -n "$job_results" ]]; then
    if [[ -s "$PENDING_RESULTS_FILE" ]]; then
      # Ja ha lote na fila: junta em vez de sobrescrever.
      existente=$(sed 's/^\\[//; s/\\]$//' "$PENDING_RESULTS_FILE")
      [[ -n "$existente" ]] && job_results="$existente,$job_results"
    fi
    printf '[%s]' "$job_results" > "$PENDING_RESULTS_FILE"
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