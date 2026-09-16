#!/usr/bin/env bash
# Dump do MySQL/MariaDB do mailu. Chamado pelo rsnapshot como backup_script.
#
# Diferente do mongodump: este banco roda no MESMO host que o compose do
# mailu (`us`) e so' aceita conexao local/docker de proposito -- foi
# exposto na internet por acidente uma vez (Docker publica porta via a
# chain DOCKER-USER, que ignora a INPUT do nftables.conf) e agora esta
# bloqueado pra fora por uma regra dedicada. Conectar daqui pra la' pela
# rede simplesmente nao funciona mais, nem com credencial certa.
#
# Por isso o dump roda LA, via ssh, e so' o resultado atravessa a rede --
# nunca uma conexao TCP direta ao MySQL saindo do runner.
set -uo pipefail

# --skip-dump-date: sem isto, mysqldump grava "-- Dump completed on ..."
# no arquivo, e ESSA LINHA SOZINHA muda a cada execucao mesmo se nenhum
# dado tiver mudado -- destroi o hardlink do rsnapshot (que so' promove
# por link quando o arquivo e' byte-identico ao nivel anterior) e a
# deduplicacao do restic. Pro banco do mailu, que muda pouco entre um
# ciclo diario e outro, isso e' a diferenca entre reaproveitar espaco e
# pagar um dump completo novo a cada dia.
if ssh -F /etc/rsnapshot/ssh_config us-bkp '
  cd /var/rcaldas/mysql &&
  docker exec mysql-mysql-1 mariadb-dump \
    --single-transaction --routines --triggers --skip-dump-date \
    -uroot -p"$(cat root_pw.txt)" mailu
' > dump-mailu.sql; then
  [[ -s dump-mailu.sql ]] || { echo "dump-mysqldump: saida vazia -- tratando como falha" >&2; exit 1; }
else
  echo "dump-mysqldump: ssh/docker exec falhou -- ver acima" >&2
  rm -f dump-mailu.sql
  exit 1
fi
