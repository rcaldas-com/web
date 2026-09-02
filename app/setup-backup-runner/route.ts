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

# "hora" roda a cada 4h, "dia" 1x/dia -- MESMO script, dois cron jobs
# separados, sem exclusao mutua nenhuma antes disso. "dia" termina o loop
# do rsnapshot rapido (so promove por mv, nao re-sincroniza) mas ai chama
# o restic, que le /tank/bkp/*/hora.0 e pode levar dezenas de minutos com
# volume grande. Se o proximo "hora" cair nesse meio tempo, ele faz rsync
# de verdade (com --delete) NO MESMO hora.0 que o restic esta lendo --
# corrida real, nao falha aleatoria: foi exatamente isso que derrubou o
# restic (arquivo listado pelo restic, apagado pelo rsync antes dele ler
# de fato). flock serializa as duas execucoes do mesmo script -- "hora"
# so espera terminar o "dia" em vez de rodar por cima.
exec 200>/var/run/rcaldas-backup.lock
flock -w 3600 200 || { echo "[$(date '+%Y-%m-%d %H:%M:%S')] outra execucao de rcaldas-backup ja em andamento ha mais de 1h -- desistindo" | tee -a "$LOG" >/dev/null; exit 1; }

# Duas saidas de proposito. O arquivo continua sendo o registro completo
# (restic e' verboso e nao ha por que empurrar tudo pro coletor); o logger
# manda a MESMA linha pro journal, que ja vai pro Loki -- e' o que permite
# o email de incidente trazer o trecho de log junto, em vez de mandar
# alguem abrir SSH pra descobrir por que o backup falhou.
log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG" | logger -t rcaldas-backup; }

resultados=""
# O id carrega o alvo E o intervalo. Os dois importam: o id vira a chave do
# incidente no Monitor, e "hora"/"dia"/"mes" sao execucoes independentes que
# falham por motivos diferentes. Com a chave so' no alvo, o "dia" passando
# as 03:30 FECHAVA o incidente que o "hora" tinha aberto as 00:00 -- email
# de "resolvido" pra uma falha que continuava de pe, e reabertura as 04:00.
# Era esse o par alerta/resolvido que aparecia toda hora.
add_resultado() {
  [[ -n "$resultados" ]] && resultados="$resultados,"
  resultados="$resultados{\\"id\\":\\"backup-$1-$INTERVALO\\",\\"type\\":\\"alarm\\",\\"status\\":\\"$2\\",\\"message\\":\\"$3\\",\\"logFilter\\":\\"$4\\"}"
}

for conf in /etc/rsnapshot/*.conf; do
  [[ -e "$conf" ]] || continue
  host=$(basename "$conf" .conf)
  # So' as linhas do rsnapshot DESTE .conf, mais as do proprio runner. O
  # caminho do .conf aparece em toda linha que o rsnapshot loga, entao da'
  # pra separar as tres execucoes que rodam no mesmo minuto no mesmo host.
  # O "!= COMMAND=" tira o log de auditoria do sudo, que casa "rcaldas-backup"
  # sempre que alguem inspeciona o arquivo -- ruido que nao e' do backup.
  filtro="|~ \\\`rsnapshot/$host[.]conf|rcaldas-backup\\\` != \\\`COMMAND=\\\`"
  inicio=$(date +%s)
  saida=$(rsnapshot -c "$conf" "$INTERVALO" 2>&1)
  codigo=$?
  echo "$saida" >> "$LOG"
  if [[ $codigo -eq 0 ]]; then
    dur=$(( $(date +%s) - inicio ))
    log "$host: ok em ${'$'}{dur}s"
    add_resultado "$host" "ok" "backup $INTERVALO de $host ok em ${'$'}{dur}s" "$filtro"
  elif echo "$saida" | grep -q "refusing to rotate this level"; then
    # Esperado nos primeiros dias/semanas de um backup novo: o nivel de
    # baixo (hora/dia) ainda nao acumulou historico suficiente pra
    # promover pro de cima (retain hora=6 a cada 4h = 24h pra "dia" poder
    # rodar; retain dia=7 = 7 dias pra "semana"). Se resolve sozinho com
    # o tempo, sem nenhuma acao possivel -- alertar isso so ensina a
    # ignorar alerta critico. So loga.
    log "$host: $INTERVALO ainda sem historico suficiente pra rotacionar (normal em backup novo)"
  else
    # Classifica o motivo em vez de copiar a linha crua do rsnapshot. Duas
    # razoes: a mensagem vira ASSUNTO de email, entao precisa ser estavel
    # entre ocorrencias da MESMA falha (texto cru traz path e codigo que
    # variam e quebram o agrupamento do Gmail); e o assunto precisa dizer
    # algo acionavel. "backup hora falhou -- ver /var/log/..." nao dizia
    # nem qual dos tres alvos tinha falhado.
    # preexec vem PRIMEIRO: quando ele aborta, o ciclo nao chegou a rodar,
    # entao qualquer outro sintoma no texto seria consequencia, nao causa.
    # E' tambem o unico caso aqui que costuma ter acao humana obvia --
    # destravar/montar o disco -- entao dizer isso no assunto do email
    # poupa abrir o log.
    if echo "$saida" | grep -q "cmd_preexec\|nao esta montado"; then
      motivo="disco de origem nao esta montado"
    elif echo "$saida" | grep -q "rsync returned 255"; then
      motivo="sem acesso ssh ao alvo"
    elif echo "$saida" | grep -q "only transferred partially"; then
      motivo="origem indisponivel ou copiada pela metade"
    elif echo "$saida" | grep -q "No space left"; then
      motivo="sem espaco no destino"
    else
      motivo="ver $LOG"
    fi
    log "$host: FALHOU ($motivo)"
    add_resultado "$host" "fail" "backup $INTERVALO de $host falhou: $motivo" "$filtro"
  fi
done

# Offsite cifrado: so no intervalo diario, pra nao subir a cada hora.
filtro_offsite="|~ \\\`restic|rcaldas-backup\\\` != \\\`COMMAND=\\\`"
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
    # A raiz vem do arquivo que o instalador ja grava, NAO de substituicao
    # de texto no proprio script. O jeito antigo (SNAPSHOT_ROOT_PLACEHOLDER
    # + sed no fim do instalador) quebrou de forma silenciosa e cara: a
    # linha abaixo passou a citar o placeholder DUAS vezes, e o sed nao
    # tinha a flag "g" -- entao trocava so' a primeira. O teste -d ficava
    # com o caminho certo e PASSAVA, e o que ia pro array era o literal
    # "SNAPSHOT_ROOT_PLACEHOLDER/<host>/hora.0". Resultado: restic com
    # "Fatal: all source directories/files do not exist", so' no ciclo
    # diario, so' depois de uma reinstalacao do runner -- semanas depois de
    # a linha ter sido escrita.
    #
    # Ler de um arquivo nao tem esse modo de falha: se sumir, o fallback
    # aparece; se estiver errado, o -d reprova e o log diz que nao ha o que
    # enviar. Nenhum caminho leva a "enviei lixo" nem a "achei que enviei".
    raiz=$(cat "$CONF_DIR/snapshot-root" 2>/dev/null || echo /tank/bkp)
    fontes=()
    for conf in /etc/rsnapshot/*.conf; do
      [[ -e "$conf" ]] || continue
      h=$(basename "$conf" .conf)
      [[ -d "$raiz/$h/hora.0" ]] && fontes+=("$raiz/$h/hora.0")
    done

    if [[ ${'$'}{#fontes[@]} -eq 0 ]]; then
      log "restic: nada pra enviar ainda (nenhum host com hora.0)"
    elif restic backup --tag diario "${'$'}{fontes[@]}" >> "$LOG" 2>&1; then
      log "restic: enviado pro S3"
      add_resultado "offsite" "ok" "copia offsite enviada" "$filtro_offsite"
    else
      log "restic: FALHOU"
      add_resultado "offsite" "fail" "copia offsite falhou -- ver $LOG" "$filtro_offsite"
    fi
  fi
fi

# Entrega os resultados pro Monitor pela fila do agente (ele so limpa
# depois de um POST com sucesso, entao nada se perde se estiver offline).
if [[ -n "$resultados" ]] && [[ -d /etc/rcaldas-agent ]]; then
  printf '[%s]' "$resultados" > "$PENDING"
fi
RUNEOF
chmod 755 /usr/local/bin/rcaldas-backup

# Confere o que acabou de escrever, em vez de supor. O bug que motivou isto
# nao era de sintaxe -- era um marcador de substituicao que sobrou vivo --
# mas o principio vale para os dois: o instalador e' a ULTIMA chance de
# pegar o erro antes de ele virar um cron que falha as 3 da manha.
if ! bash -n /usr/local/bin/rcaldas-backup 2>/dev/null; then
  echo "  ERRO: o runner gerado nao e' bash valido -- nao vou ativar o cron"
  bash -n /usr/local/bin/rcaldas-backup
  exit 1
fi
# Ignora linha de comentario de proposito: o historico do bug esta
# documentado no proprio runner e cita o marcador pelo nome.
sobrou=$(grep -n "_PLACEHOLDER" /usr/local/bin/rcaldas-backup | grep -vE "^[0-9]+: *#" || true)
if [[ -n "$sobrou" ]]; then
  echo "  ERRO: sobrou marcador de substituicao em codigo ativo do runner:"
  printf '%s\n' "$sobrou"
  exit 1
fi
echo "  runner verificado (sintaxe ok, sem marcador pendente)"

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
