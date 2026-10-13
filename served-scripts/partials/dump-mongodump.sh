#!/usr/bin/env bash
# Dump do Mongo de producao. Chamado pelo rsnapshot como backup_script:
# ele prepara um cwd temporario, roda isto, e versiona o que for escrito
# aqui com hardlink -- e' o que da' retencao por nivel igual a dos hosts.
#
# Duas bases no MESMO servidor Mongo (rcaldas e bndes), uma autenticacao
# por base: cada uma tem usuario/authSource proprio (least privilege -- o
# usuario bndes nao ve o banco rcaldas e vice-versa), entao um --uri so
# nao dumpa as duas. mongodump sem --db dumpa TODO banco que o usuario
# autenticado consegue ver -- e' por isso que a segunda chamada abaixo
# basta, sem precisar nomear o banco.
set -uo pipefail

# Credencial lida do .env do host de producao NA HORA, pela mesma chave e
# ssh_config que o rsnapshot ja usa. Uma fonte da verdade so': trocar de
# provedor la' passa a valer aqui sem sincronizar nada.
env_prod=$(ssh -F /etc/rsnapshot/ssh_config us-bkp "cat /var/rcaldas/rcaldas/.env" 2>/dev/null)
[[ -n "$env_prod" ]] || { echo "dump-mongo: sem acesso ao .env de producao" >&2; exit 1; }

# A URI de producao e' mongodb+srv apontando pro nome com registro SRV,
# que NAO resolve fora do us. Reescreve pro endereco direto, que o runner
# alcanca (conferido: us.rcaldas.com:8417 aberto do bag).
uri=$(printf '%s' "$env_prod" | grep '^MONGO_URI=' | head -1 | cut -d= -f2- | tr -d '"' \
  | sed -e 's|^mongodb+srv://|mongodb://|' -e 's|@[^/]*/[^?]*|@us.rcaldas.com:8417/|')
[[ -n "$uri" ]] || { echo "dump-mongo: MONGO_URI ausente no .env de producao" >&2; exit 1; }

# Sem --gzip de proposito: dado comprimido muda inteiro a cada byte
# alterado, o que destroi tanto o hardlink do rsnapshot quanto a
# deduplicacao do restic. O restic ja comprime por conta propria.
#
# --entrypoint mongodump e' obrigatorio, nao estilo: a imagem oficial do
# mongo tem um docker-entrypoint.sh (CMD padrao "mongod") que TROCA de
# usuario internamente pro uid do mongodb antes de exec no comando --
# mesmo passando --user root, mesmo o comando sendo mongodump e nao mongod.
# Sem bypassar esse entrypoint, o mongodump roda como um uid sem permissao
# de escrever no bind mount, e falha com "mkdir /dump/rcaldas: permission
# denied" -- confirmado isolando cada camada (touch e mkdir manual dentro
# do container funcionam com --user root; o MESMO mongodump, chamado via
# CMD do entrypoint padrao, nao). --entrypoint pula o docker-entrypoint.sh
# inteiro e chama o binario direto, como o processo root que o docker run
# realmente criou.
docker run --rm --network host --entrypoint mongodump -v "$PWD:/dump" mongo:7 \
  --uri="$uri" --out=/dump --quiet
rc_rcaldas=$?

# Base da stack bndes -- OPCIONAL de proposito. Pode ainda nao existir no
# `us` (bootstrap em andamento, ver README do bndes_dev): nesse caso so
# avisa e segue. Nunca pode fazer o dump do rcaldas, que ja esta em
# producao, aparecer como falho por causa de uma stack que nem existe
# ainda neste host.
env_bndes=$(ssh -F /etc/rsnapshot/ssh_config us-bkp "cat /var/rcaldas/bndes/.env.bolo" 2>/dev/null)
if [[ -n "$env_bndes" ]]; then
  uri_bndes=$(printf '%s' "$env_bndes" | grep '^MONGO_URI=' | head -1 | cut -d= -f2- | tr -d '"' \
    | sed -e 's|^mongodb+srv://|mongodb://|' -e 's|@[^/]*/[^?]*|@us.rcaldas.com:8417/|')
  if [[ -n "$uri_bndes" ]]; then
    if ! docker run --rm --network host --entrypoint mongodump -v "$PWD:/dump" mongo:7 \
      --uri="$uri_bndes" --out=/dump --quiet; then
      echo "dump-mongo: banco bndes falhou -- rcaldas ja foi dumpado, seguindo" >&2
    fi
  else
    echo "dump-mongo: MONGO_URI ausente em .env.bolo -- pulando banco bndes" >&2
  fi
else
  echo "dump-mongo: /var/rcaldas/bndes/.env.bolo ainda nao existe no us -- pulando banco bndes (normal antes do bootstrap dessa stack)" >&2
fi

exit "$rc_rcaldas"
