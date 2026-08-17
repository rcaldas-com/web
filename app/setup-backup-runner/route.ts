const APP_URL = process.env.AUTH_TRUST_HOST || 'http://localhost:8001';
const S3_HOST = process.env.BACKUP_S3_HOST || '';
const S3_KEY = process.env.BACKUP_S3_KEY || '';
const S3_SECRET = process.env.BACKUP_S3_SECRET || '';
const S3_BUCKET = process.env.BACKUP_S3_BUCKET || 'rcaldas-backup';
const S3_REGION = process.env.BACKUP_S3_REGION || 'us-east-1';
const SNAPSHOT_ROOT = process.env.BACKUP_SNAPSHOT_ROOT || '/tank/bkp';

function script() {
  return `#!/usr/bin/env bash
set -euo pipefail

# Transforma este host no runner de backup da frota: ele puxa os outros
# via SSH (usando os tuneis quando estao atras de NAT), guarda historico
# local com rsnapshot e manda uma copia cifrada pro S3 com restic.
#
# Idempotente -- pode rodar de novo pra atualizar. Trocar de runner e
# rodar isto no host novo e reprovisionar os demais (ver CLAUDE.md).

[ "$(id -u)" = 0 ] || { echo "Precisa rodar como root."; exit 1; }

CONF_DIR="/etc/rcaldas-backup"
SNAPSHOT_ROOT="${SNAPSHOT_ROOT}"
RUNNER_KEY="/root/.ssh/backup-runner"

echo ":: SETUP DO RUNNER DE BACKUP ::"

echo "pacotes"
if ! command -v rsnapshot >/dev/null 2>&1; then
  DEBIAN_FRONTEND=noninteractive apt-get -qq update > /dev/null
  DEBIAN_FRONTEND=noninteractive apt-get -qq install rsnapshot > /dev/null
fi
if ! command -v restic >/dev/null 2>&1; then
  DEBIAN_FRONTEND=noninteractive apt-get -qq install restic > /dev/null || \\
    echo "  AVISO: restic nao instalado -- copia offsite nao vai funcionar"
fi

echo "chave do runner"
mkdir -p /root/.ssh && chmod 700 /root/.ssh
if [[ ! -f "$RUNNER_KEY" ]]; then
  ssh-keygen -qt ed25519 -N '' -f "$RUNNER_KEY" -C "backup-runner@$(hostname -s)"
  echo "  chave criada"
else
  echo "  chave ja existe"
fi

echo
echo "  >>> PUBLIQUE esta chave publica para que o /init a autorize nos hosts:"
echo "      salve em /var/rcaldas/live/home/.ssh/backup-runner.pub no servidor"
echo
cat "$RUNNER_KEY.pub"
echo

echo "segredos"
mkdir -p "$CONF_DIR" && chmod 700 "$CONF_DIR"
# Senha do repositorio restic: fica SO aqui. Nunca vai pro Monitor nem
# pro Mongo -- se o servidor for comprometido, os backups seguem cifrados.
if [[ ! -f "$CONF_DIR/restic-pass" ]]; then
  head -c 32 /dev/urandom | base64 > "$CONF_DIR/restic-pass"
  chmod 600 "$CONF_DIR/restic-pass"
  echo "  senha do restic gerada -- GUARDE UMA COPIA FORA DAQUI:"
  echo "    sem ela os backups no S3 sao irrecuperaveis"
  echo "    $CONF_DIR/restic-pass"
else
  echo "  senha do restic ja existe (preservada)"
fi

cat > "$CONF_DIR/s3.env" <<EOF
AWS_ACCESS_KEY_ID=${S3_KEY}
AWS_SECRET_ACCESS_KEY=${S3_SECRET}
RESTIC_REPOSITORY=s3:${S3_HOST}/${S3_BUCKET}
# Sem isso, o CreateBucket do primeiro 'restic init' falha na Wasabi com
# "NoSuchEntity" mesmo com a chave certa -- o endpoint generico aceita
# leitura mas rejeita criacao sem a regiao explicita. Descoberto rodando
# de verdade contra a conta, nao esta documentado com destaque pela Wasabi.
AWS_DEFAULT_REGION=${S3_REGION}
EOF
chmod 600 "$CONF_DIR/s3.env"

echo "bucket"
# Cria o bucket se ainda nao existir -- restic tambem tenta isso sozinho
# no primeiro 'restic init' (ver script de execucao abaixo), mas fazer
# aqui da erro imediato e legivel em vez de silencioso dentro do cron.
if command -v aws >/dev/null 2>&1; then
  set -a; . "$CONF_DIR/s3.env"; set +a
  if ! aws --endpoint-url "${S3_HOST}" s3api head-bucket --bucket "${S3_BUCKET}" >/dev/null 2>&1; then
    aws --endpoint-url "${S3_HOST}" --region "${S3_REGION}" s3 mb "s3://${S3_BUCKET}" >/dev/null 2>&1 \\
      && echo "  bucket ${S3_BUCKET} criado" \\
      || echo "  AVISO: nao consegui criar o bucket -- confira as credenciais/permissoes"
  else
    echo "  bucket ${S3_BUCKET} ja existe"
  fi
else
  echo "  aws-cli ausente -- pulando (restic tenta criar sozinho no primeiro backup)"
fi

# O agente le isto pra reportar quanto o disco de backup esta cheio.
echo "$SNAPSHOT_ROOT" > "$CONF_DIR/snapshot-root"

echo "configs dos hosts"
curl -fsSL "${APP_URL}/backup-config?runner=$(hostname -s)" | bash

echo "script de execucao"
cat > /usr/local/bin/rcaldas-backup <<'RUNEOF'
#!/usr/bin/env bash
# Roda um intervalo do rsnapshot em todos os hosts configurados e depois
# manda o snapshot mais recente pro S3. Reporta o resultado pro Monitor
# pela fila que o agente ja drena no heartbeat.
set -uo pipefail

INTERVALO="${'$'}{1:-hora}"
CONF_DIR="/etc/rcaldas-backup"
PENDING="/etc/rcaldas-agent/pending-results.json"
LOG="/var/log/rcaldas-backup.log"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG" >/dev/null; }

resultados=""
add_resultado() {
  [[ -n "$resultados" ]] && resultados="$resultados,"
  resultados="$resultados{\\"id\\":\\"backup-$1\\",\\"type\\":\\"alarm\\",\\"status\\":\\"$2\\",\\"message\\":\\"$3\\"}"
}

for conf in /etc/rsnapshot/*.conf; do
  [[ -e "$conf" ]] || continue
  host=$(basename "$conf" .conf)
  inicio=$(date +%s)
  saida=$(rsnapshot -c "$conf" "$INTERVALO" 2>&1)
  codigo=$?
  echo "$saida" >> "$LOG"
  if [[ $codigo -eq 0 ]]; then
    dur=$(( $(date +%s) - inicio ))
    log "$host: ok em ${'$'}{dur}s"
    add_resultado "$host" "ok" "backup $INTERVALO ok em ${'$'}{dur}s"
  elif echo "$saida" | grep -q "refusing to rotate this level"; then
    # Esperado nos primeiros dias/semanas de um backup novo: o nivel de
    # baixo (hora/dia) ainda nao acumulou historico suficiente pra
    # promover pro de cima (retain hora=6 a cada 4h = 24h pra "dia" poder
    # rodar; retain dia=7 = 7 dias pra "semana"). Se resolve sozinho com
    # o tempo, sem nenhuma acao possivel -- alertar isso so ensina a
    # ignorar alerta critico. So loga.
    log "$host: $INTERVALO ainda sem historico suficiente pra rotacionar (normal em backup novo)"
  else
    log "$host: FALHOU"
    add_resultado "$host" "fail" "backup $INTERVALO falhou -- ver $LOG"
  fi
done

# Offsite cifrado: so no intervalo diario, pra nao subir a cada hora.
if [[ "$INTERVALO" == "dia" ]] && command -v restic >/dev/null 2>&1; then
  if [[ -f "$CONF_DIR/s3.env" && -f "$CONF_DIR/restic-pass" ]]; then
    set -a; . "$CONF_DIR/s3.env"; set +a
    export RESTIC_PASSWORD_FILE="$CONF_DIR/restic-pass"
    restic snapshots >/dev/null 2>&1 || restic init >> "$LOG" 2>&1 || true

    # Fontes vem de /etc/rsnapshot/*.conf -- a MESMA lista usada no loop
    # do rsnapshot acima -- nunca de um glob solto em SNAPSHOT_ROOT. Um
    # glob pega qualquer diretorio que exista ali, inclusive host que ja
    # foi desativado no Monitor e cujo .conf sumiu mas a arvore antiga de
    # snapshots ficou pra tras -- foi exatamente isso que mandou 22GB de
    # dados desativados pro S3 numa execucao manual de teste.
    fontes=()
    for conf in /etc/rsnapshot/*.conf; do
      [[ -e "$conf" ]] || continue
      h=$(basename "$conf" .conf)
      [[ -d "SNAPSHOT_ROOT_PLACEHOLDER/$h/hora.0" ]] && fontes+=("SNAPSHOT_ROOT_PLACEHOLDER/$h/hora.0")
    done

    if [[ ${'$'}{#fontes[@]} -eq 0 ]]; then
      log "restic: nada pra enviar ainda (nenhum host com hora.0)"
    elif restic backup --tag diario "${'$'}{fontes[@]}" >> "$LOG" 2>&1; then
      log "restic: enviado pro S3"
      add_resultado "offsite" "ok" "copia offsite enviada"
    else
      log "restic: FALHOU"
      add_resultado "offsite" "fail" "copia offsite falhou -- ver $LOG"
    fi
  fi
fi

# Entrega os resultados pro Monitor pela fila do agente (ele so limpa
# depois de um POST com sucesso, entao nada se perde se estiver offline).
if [[ -n "$resultados" ]] && [[ -d /etc/rcaldas-agent ]]; then
  printf '[%s]' "$resultados" > "$PENDING"
fi
RUNEOF
sed -i "s|SNAPSHOT_ROOT_PLACEHOLDER|$SNAPSHOT_ROOT|" /usr/local/bin/rcaldas-backup
chmod 755 /usr/local/bin/rcaldas-backup

echo "cron"
cat > /etc/cron.d/rcaldas-backup <<'EOF'
0 */4 * * *   root  /usr/local/bin/rcaldas-backup hora
30 3  * * *   root  /usr/local/bin/rcaldas-backup dia
0  3  * * 1   root  /usr/local/bin/rcaldas-backup semana
30 2  1 * *   root  /usr/local/bin/rcaldas-backup mes
EOF
chmod 644 /etc/cron.d/rcaldas-backup

cat > /etc/logrotate.d/rcaldas-backup <<'EOF'
/var/log/rcaldas-backup.log {
	weekly
	rotate 4
	missingok
	notifempty
	compress
	delaycompress
}
EOF

echo
echo "Pronto. Antes do primeiro backup de verdade:"
echo "  1. publique a chave publica acima (o /init autoriza nos hosts)"
echo "  2. reprovisione os hosts, ou adicione a chave a mao no authorized_keys deles"
echo "  3. teste sem copiar nada: rsnapshot -c /etc/rsnapshot/<host>.conf -t hora"
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
