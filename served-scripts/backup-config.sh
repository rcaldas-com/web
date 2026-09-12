#!/usr/bin/env bash
set -euo pipefail

# Configs de backup geradas pelo Monitor para o runner "@@RUNNER@@".
# Nao editar a mao: rode de novo para pegar as mudancas feitas na UI.
#   curl -fsSL @@APP_URL@@/backup-config | sudo bash

[ "$(id -u)" = 0 ] || { echo "Precisa rodar como root."; exit 1; }

mkdir -p /etc/rsnapshot

# socat e' o que faz o encadeamento de enderecos do ProxyCommand funcionar.
# Checado, e nao assumido: sem ele TODO backup remoto para de uma vez, e o
# erro que aparece ("proxy command failed") nao diz o que faltou.
if ! command -v socat >/dev/null 2>&1; then
  echo "  instalando socat (necessario pro fallback de endereco)"
  apt-get update -qq && apt-get install -y -qq socat
fi

echo "Escrevendo ssh_config do backup:"
cat <<'BKPSSH_EOF' > @@SSH_CONFIG@@
# Gerado pelo Monitor -- nao editar a mao.
#
# Um alias por host, com a ordem de tentativa no ProxyCommand: nome DDNS
# primeiro (que em IPv6 resolve pro endereco global e, dentro de casa, e'
# entregue direto na LAN pelo Neighbor Discovery), tunel via relay depois.
@@BLOCOS_SSH@@
BKPSSH_EOF
chmod 600 @@SSH_CONFIG@@
touch @@SSH_KNOWN_HOSTS@@ && chmod 600 @@SSH_KNOWN_HOSTS@@

echo "Escrevendo configs de backup:"
@@PARTES_HOSTS@@

# Backup de DADOS: um .conf de rsnapshot por servico, com o dump como
# backup_script. Mesmo mecanismo dos hosts, entao a retencao configurada
# na tela do servico vale de verdade (niveis + hardlink).
echo "Escrevendo backup de dados por servico:"
@@PARTES_DADOS@@

# Retencao do OFFSITE: uma politica so' pro repositorio inteiro. Nao e'
# escolha -- o "restic forget" opera sobre SNAPSHOTS, e cada snapshot
# carrega todas as fontes juntas. Ver RETENCAO_OFFSITE em lib/services.ts.
mkdir -p /etc/rcaldas-backup
cat <<'BKPRET_EOF' > /etc/rcaldas-backup/retencao.conf
--keep-daily @@RET_DIA@@ --keep-weekly @@RET_SEMANA@@ --keep-monthly @@RET_MES@@
BKPRET_EOF
chmod 600 /etc/rcaldas-backup/retencao.conf
echo "  retencao offsite (global): @@RET_DIA@@d/@@RET_SEMANA@@s/@@RET_MES@@m"

echo
echo "Pronto. Teste sem copiar nada com:"
echo "  rsnapshot -c /etc/rsnapshot/<host>.conf -t hora"
