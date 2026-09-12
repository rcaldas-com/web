#!/usr/bin/env bash
# Espelho do S3 de producao. Chamado pelo rsnapshot como backup_script.
set -uo pipefail

env_prod=$(ssh -F /etc/rsnapshot/ssh_config us-bkp "cat /var/rcaldas/rcaldas/.env" 2>/dev/null)
[[ -n "$env_prod" ]] || { echo "dump-s3: sem acesso ao .env de producao" >&2; exit 1; }
le() { printf '%s' "$env_prod" | grep "^$1=" | head -1 | cut -d= -f2- | tr -d '"'; }

# rclone e nao minio/mc: a imagem do mc deixou de ser publica ("pull access
# denied", enquanto alpine puxa normal). Config por variavel de ambiente
# nao grava segredo em disco nem passa em linha de comando, onde apareceria
# no ps de qualquer usuario.
RCLONE_CONFIG_PROD_TYPE=s3
RCLONE_CONFIG_PROD_PROVIDER=Other
RCLONE_CONFIG_PROD_ENDPOINT=$(le S3_HOST)
RCLONE_CONFIG_PROD_ACCESS_KEY_ID=$(le S3_KEY)
RCLONE_CONFIG_PROD_SECRET_ACCESS_KEY=$(le S3_SECRET)
export RCLONE_CONFIG_PROD_TYPE RCLONE_CONFIG_PROD_PROVIDER RCLONE_CONFIG_PROD_ENDPOINT
export RCLONE_CONFIG_PROD_ACCESS_KEY_ID RCLONE_CONFIG_PROD_SECRET_ACCESS_KEY

[[ -n "$RCLONE_CONFIG_PROD_ENDPOINT" && -n "$RCLONE_CONFIG_PROD_ACCESS_KEY_ID" ]] \
  || { echo "dump-s3: credenciais S3 ausentes no .env de producao" >&2; exit 1; }

# O destino e' o cwd que o rsnapshot preparou. "sync" e' espelho fiel: o
# que sumir na origem some aqui -- e o historico de quem foi apagado fica
# nos niveis anteriores do proprio rsnapshot, que e' justamente o ponto.
rclone sync prod: "$PWD" --fast-list
