#!/usr/bin/env bash
# Dump do Mongo de producao. Chamado pelo rsnapshot como backup_script:
# ele prepara um cwd temporario, roda isto, e versiona o que for escrito
# aqui com hardlink -- e' o que da' retencao por nivel igual a dos hosts.
#
# Uma base por stack no MESMO servidor Mongo (rcaldas e bndes), uma
# autenticacao por base: cada uma tem usuario/authSource proprio (least
# privilege -- o usuario bndes nao ve o banco rcaldas e vice-versa), entao
# um --uri so nao dumpa as duas. mongodump sem --db dumpa TODO banco que o
# usuario autenticado consegue ver -- e' por isso que nao precisa nomear o
# banco em nenhuma das chamadas.
#
# As bases sao INDEPENDENTES: falha numa nunca impede a tentativa da outra
# (nenhum `exit` no meio). O script sai com erro se QUALQUER uma falhar --
# o rsnapshot so' registra o erro (backup_script returned N) e versiona o
# que foi escrito mesmo assim, entao a base que deu certo nao se perde, e a
# falha da outra vira alarme de backup em vez de passar calada.
set -uo pipefail

falhou=0

# $1 = rotulo, $2 = .env no us de onde sai o MONGO_URI, $3 = 1 se a stack
# pode nao existir naquele host (ausencia do .env nao e' falha)
dump_base() {
  local rotulo="$1" env_path="$2" opcional="$3" env_txt uri

  # Credencial lida do .env do host de producao NA HORA, pela mesma chave e
  # ssh_config que o rsnapshot ja usa. Uma fonte da verdade so': trocar de
  # provedor la' passa a valer aqui sem sincronizar nada.
  env_txt=$(ssh -F /etc/rsnapshot/ssh_config us-bkp "cat $env_path" 2>/dev/null)
  if [[ -z "$env_txt" ]]; then
    if [[ "$opcional" == 1 ]] && ! ssh -F /etc/rsnapshot/ssh_config us-bkp "test -e $env_path" 2>/dev/null; then
      echo "dump-mongo: $rotulo: $env_path nao existe no us -- stack ausente, pulando" >&2
      return 0
    fi
    echo "dump-mongo: $rotulo: sem acesso a $env_path no us" >&2
    return 1
  fi

  # A URI de producao e' mongodb+srv apontando pro nome com registro SRV,
  # que NAO resolve fora do us. Reescreve pro endereco direto, que o runner
  # alcanca (conferido: us.rcaldas.com:8417 aberto do bag).
  uri=$(printf '%s' "$env_txt" | grep '^MONGO_URI=' | head -1 | cut -d= -f2- | tr -d '"' \
    | sed -e 's|^mongodb+srv://|mongodb://|' -e 's|@[^/]*/[^?]*|@us.rcaldas.com:8417/|')
  if [[ -z "$uri" ]]; then
    echo "dump-mongo: $rotulo: MONGO_URI ausente em $env_path" >&2
    return 1
  fi

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
  if ! docker run --rm --network host --entrypoint mongodump -v "$PWD:/dump" mongo:7 \
    --uri="$uri" --out=/dump --quiet; then
    echo "dump-mongo: $rotulo: mongodump falhou" >&2
    return 1
  fi
}

dump_base rcaldas /var/rcaldas/rcaldas/.env 0 || falhou=1
dump_base bndes /var/rcaldas/bndes/.env 1 || falhou=1

exit "$falhou"
