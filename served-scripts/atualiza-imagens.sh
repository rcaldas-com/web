#!/usr/bin/env bash
# atualiza-imagens -- atualiza as imagens PUBLICAS dos containers deste host
# (nginx, redis, mongo, mailu, grafana...). Servido pelo Monitor em
# /atualiza-imagens; e' o MESMO codigo que o agente roda nos jobs
# image-check/image-apply e que o ~/live/bin/atualiza-imagens chama na mao.
#
# Uso:
#   atualiza-imagens                    so' verifica: baixa e mostra o que mudaria
#   atualiza-imagens --aplicar          recria o que mudou, confirmando por projeto
#   atualiza-imagens --aplicar --sim    idem, sem perguntar
#   atualiza-imagens --projeto mailu    so' esse projeto (pode repetir a opcao)
#   atualiza-imagens --json [--bases ref1,ref2]
#                                       verifica SEM baixar nada (compara o digest
#                                       remoto) e imprime JSON -- e' o que o
#                                       agente usa na verificacao periodica
#
# Descobre sozinho todos os projetos compose que o Docker conhece (`docker
# compose ls`), inclusive os que estao fora dos repos (Mailu, static,
# mongodb...). Nenhuma lista pra manter.
#
# O que NAO e' com esta rotina:
#   - registry.rcaldas.com/*: imagens nossas, quem atualiza e' a pipeline do
#     Monitor (build no push, promocao, reconciliacao). Puladas aqui -- a
#     BASE delas (FROM) e' o que --bases verifica.
#   - tag fixa (ex.: grafana:13.2.0): baixar de novo nunca muda nada. Atualizar
#     e' trocar a tag no compose, de proposito. A rotina so' avisa.
#
# Baixar nao mexe em container rodando -- por isso o modo padrao e' seguro de
# rodar a qualquer hora. Com --aplicar, cada servico que mudou e' recriado com
# `up -d --no-deps`: so' ele, sem reiniciar os vizinhos do compose.

set -uo pipefail

APLICAR=0; SIM=0; JSON=0; BASES=""; FILTRO=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --aplicar) APLICAR=1 ;;
    --sim) SIM=1 ;;
    --projeto) shift; FILTRO+=("${1:-}") ;;
    --json) JSON=1 ;;
    --bases) shift; BASES="${1:-}" ;;
    -h|--help) echo "uso: atualiza-imagens [--aplicar [--sim]] [--projeto X]... | --json [--bases r1,r2]"; exit 0 ;;
    *) echo "opcao desconhecida: $1 (veja --help)" >&2; exit 2 ;;
  esac
  shift
done

for cmd in docker jq; do
  command -v "$cmd" >/dev/null || { echo "falta '$cmd' neste host" >&2; exit 1; }
done

if [[ -t 1 ]]; then
  B=$'\e[1m'; VERDE=$'\e[32m'; AMAR=$'\e[33m'; VERM=$'\e[31m'; CINZA=$'\e[90m'; N=$'\e[0m'
else
  B=''; VERDE=''; AMAR=''; VERM=''; CINZA=''; N=''
fi

# Versao legivel da imagem: as oficiais publicam <NOME>_VERSION no ambiente
# (NGINX_VERSION, REDIS_VERSION, MONGO_VERSION, NODE_VERSION...) ou o label
# OCI de versao. Sem nenhum dos dois, fica a data de criacao.
versao() {
  local ref="$1" v
  v=$(docker image inspect "$ref" --format '{{range .Config.Env}}{{println .}}{{end}}' 2>/dev/null \
      | grep -E '^[A-Z]+_VERSION=' | grep -vE '^(GOSU|PYTHON_PIP|PIP|YARN|JSYAML)_VERSION=' | head -1 | cut -d= -f2)
  [[ -z "$v" ]] && v=$(docker image inspect "$ref" --format '{{index .Config.Labels "org.opencontainers.image.version"}}' 2>/dev/null)
  [[ -z "$v" || "$v" == "<no value>" ]] && v="criada $(docker image inspect "$ref" --format '{{.Created}}' 2>/dev/null | cut -c1-10)"
  printf '%s' "$v"
}

# x.y.z no fim da tag = fixa (13.2.0, 8.10.1-alpine). latest, alpine, 8.0,
# 2024.06 = flutuantes: o mesmo nome aponta pra imagem nova quando sai patch.
tag_fixa() {
  local tag="${1##*:}"
  [[ "$1" == *:* ]] || return 1
  [[ "$tag" =~ ^v?[0-9]+\.[0-9]+\.[0-9]+ ]]
}

# Digest remoto da tag SEM baixar a imagem (so' o indice do manifesto). O
# timeout evita que um registry lento segure o job do agente; falha vira
# "desconhecido", nunca "em dia".
digest_remoto() {
  timeout 30 docker buildx imagetools inspect "$1" --format '{{json .Manifest}}' 2>/dev/null \
    | jq -r '.digest // empty' 2>/dev/null
}

# Digest com que a imagem local foi baixada, do repositorio dela (uma imagem
# pode ter varios RepoDigests se foi baixada por mais de um nome).
digest_local() {
  local ref="$1" repo="${2%:*}"
  docker image inspect "$ref" --format '{{range .RepoDigests}}{{println .}}{{end}}' 2>/dev/null \
    | grep -F "${repo}@" | head -1 | cut -d@ -f2
}

if [[ $JSON == 1 ]]; then
  linhas=$(mktemp)
  while IFS=$'\t' read -r nome arquivos; do
    [[ -r "${arquivos%%,*}" ]] || continue
    dir=$(dirname "${arquivos%%,*}")
    args=(--project-name "$nome" --project-directory "$dir")
    IFS=',' read -r -a lista <<< "$arquivos"
    for f in "${lista[@]}"; do args+=(-f "$f"); done
    docker compose "${args[@]}" config --format json 2>/dev/null \
      | jq -r '.services | to_entries[] | [.key, (.value.image // "")] | @tsv' 2>/dev/null \
      | while IFS=$'\t' read -r svc img; do
          [[ -z "$img" || "$img" == registry.rcaldas.com/* ]] && continue
          c=$(docker compose "${args[@]}" ps -a -q "$svc" 2>/dev/null | head -1)
          fixa=false; tag_fixa "$img" && fixa=true
          if [[ -z "$c" ]]; then
            printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$nome" "$svc" "$img" "$fixa" "" "" "sem-container"; continue
          fi
          id=$(docker inspect "$c" --format '{{.Image}}' 2>/dev/null)
          local_d=$(digest_local "$id" "$img"); remoto=$(digest_remoto "$img")
          if [[ -z "$local_d" ]]; then st=local
          elif [[ -z "$remoto" ]]; then st=desconhecido
          elif [[ "$local_d" != "$remoto" ]]; then st=atualizar
          else st=ok; fi
          printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$nome" "$svc" "$img" "$fixa" "$local_d" "$remoto" "$st"
        done
  done < <(docker compose ls --all --format json 2>/dev/null | jq -r '.[] | [.Name, .ConfigFiles] | @tsv') > "$linhas"

  bases=$(mktemp)
  for ref in ${BASES//,/ }; do
    printf '%s\t%s\n' "$ref" "$(digest_remoto "$ref")" >> "$bases"
  done

  # Montado por jq a partir de TSV, nunca concatenando JSON no shell.
  jq -n --arg host "$(hostname -s)" \
    --rawfile img "$linhas" --rawfile bas "$bases" '
    def linhas($s): $s | split("\n") | map(select(length > 0) | split("\t"));
    {host: $host,
     images: [linhas($img)[] | {project: .[0], service: .[1], image: .[2], fixed: (.[3] == "true"),
                                 local: .[4], remote: .[5], status: .[6]}],
     bases: [linhas($bas)[] | {ref: .[0], remote: .[1]}]}'
  rm -f "$linhas" "$bases"
  exit 0
fi

declare -a RESUMO=()
houve_falha=0

projetos=$(docker compose ls --all --format json 2>/dev/null | jq -r '.[] | [.Name, .ConfigFiles] | @tsv')
[[ -z "$projetos" ]] && { echo "nenhum projeto compose neste host"; exit 0; }

echo "${B}$(hostname -s): $( [[ $APLICAR == 1 ]] && echo 'verificar e APLICAR' || echo 'so verificar (nada sera reiniciado)')${N}"

while IFS=$'\t' read -r nome arquivos; do
  if [[ ${#FILTRO[@]} -gt 0 ]] && ! printf '%s\n' "${FILTRO[@]}" | grep -qx "$nome"; then continue; fi

  # ConfigFiles vem separado por virgula; o diretorio do primeiro e' o do
  # projeto (e' onde o compose acha o .env pra interpolar as variaveis).
  dir=$(dirname "${arquivos%%,*}")
  args=(--project-name "$nome" --project-directory "$dir")
  IFS=',' read -r -a lista <<< "$arquivos"
  for f in "${lista[@]}"; do args+=(-f "$f"); done

  echo
  echo "${B}== $nome${N} ${CINZA}($dir)${N}"
  if [[ ! -r "${lista[0]}" ]]; then
    echo "  ${AMAR}compose ${lista[0]} nao existe mais -- projeto orfao, pulando${N}"; continue
  fi

  cfg=$(docker compose "${args[@]}" config --format json 2>/dev/null) \
    || { echo "  ${VERM}compose config falhou -- pulando${N}"; houve_falha=1; continue; }

  declare -A IMG=()
  candidatos=()
  while IFS=$'\t' read -r svc img; do
    [[ -z "$img" ]] && continue
    if [[ "$img" == registry.rcaldas.com/* ]]; then
      echo "  ${CINZA}$svc: $img -- da pipeline, pulado${N}"; continue
    fi
    IMG[$svc]="$img"; candidatos+=("$svc")
  done < <(printf '%s' "$cfg" | jq -r '.services | to_entries[] | [.key, (.value.image // "")] | @tsv')

  [[ ${#candidatos[@]} -eq 0 ]] && { echo "  nada publico neste projeto"; unset IMG; continue; }

  # Versao rodando ANTES do pull: depois dele a tag ja aponta pra nova.
  declare -A ANTES_ID=() ANTES_V=() CONT=()
  for svc in "${candidatos[@]}"; do
    c=$(docker compose "${args[@]}" ps -a -q "$svc" 2>/dev/null | head -1)
    CONT[$svc]="$c"
    if [[ -n "$c" ]]; then
      ANTES_ID[$svc]=$(docker inspect "$c" --format '{{.Image}}' 2>/dev/null)
      ANTES_V[$svc]=$(versao "${ANTES_ID[$svc]}")
    fi
  done

  if ! docker compose "${args[@]}" pull --quiet --ignore-pull-failures "${candidatos[@]}" 2>/tmp/atualiza-imagens.$$; then
    echo "  ${AMAR}pull com aviso: $(tail -2 /tmp/atualiza-imagens.$$ | tr '\n' ' ')${N}"
  fi
  rm -f /tmp/atualiza-imagens.$$

  mudou=()
  for svc in "${candidatos[@]}"; do
    img="${IMG[$svc]}"
    novo_id=$(docker image inspect "$img" --format '{{.Id}}' 2>/dev/null)
    if [[ -z "${CONT[$svc]}" ]]; then
      echo "  ${CINZA}$svc: $img -- sem container${N}"
    elif [[ -z "$novo_id" ]]; then
      echo "  ${VERM}$svc: $img -- pull falhou${N}"; houve_falha=1
    elif [[ "$novo_id" != "${ANTES_ID[$svc]}" ]]; then
      echo "  ${AMAR}$svc: $img  ${ANTES_V[$svc]} -> $(versao "$img")  ATUALIZAR${N}"
      mudou+=("$svc")
    elif tag_fixa "$img"; then
      echo "  ${CINZA}$svc: $img  em dia (tag fixa: versao nova exige trocar a tag no compose)${N}"
    else
      echo "  ${VERDE}$svc: $img  ${ANTES_V[$svc]}  em dia${N}"
    fi
  done

  if [[ ${#mudou[@]} -eq 0 ]]; then
    RESUMO+=("$nome: em dia"); unset IMG ANTES_ID ANTES_V CONT; continue
  fi
  if [[ $APLICAR == 0 ]]; then
    RESUMO+=("$nome: ${#mudou[@]} pra atualizar (${mudou[*]})"); unset IMG ANTES_ID ANTES_V CONT; continue
  fi

  if [[ $SIM == 0 ]]; then
    read -r -p "  recriar ${mudou[*]} em $nome? [s/N] " resp < /dev/tty
    if [[ ! "$resp" =~ ^[sS]$ ]]; then
      RESUMO+=("$nome: adiado (${mudou[*]})"); unset IMG ANTES_ID ANTES_V CONT; continue
    fi
  fi

  if ! docker compose "${args[@]}" up -d --no-deps "${mudou[@]}" >/tmp/atualiza-imagens.$$ 2>&1; then
    echo "  ${VERM}up -d falhou: $(tail -3 /tmp/atualiza-imagens.$$ | tr '\n' ' ')${N}"
    RESUMO+=("$nome: FALHOU ao recriar (${mudou[*]})"); houve_falha=1
    rm -f /tmp/atualiza-imagens.$$; unset IMG ANTES_ID ANTES_V CONT; continue
  fi
  rm -f /tmp/atualiza-imagens.$$

  # Volta a tempo? Ate 90s por servico: running, e healthy se houver healthcheck.
  ok=(); ruim=()
  for svc in "${mudou[@]}"; do
    estado="?"
    for _ in $(seq 1 30); do
      c=$(docker compose "${args[@]}" ps -q "$svc" 2>/dev/null | head -1)
      estado=$(docker inspect "$c" --format '{{.State.Status}}{{if .State.Health}}/{{.State.Health.Status}}{{end}}' 2>/dev/null)
      [[ "$estado" == running || "$estado" == running/healthy ]] && break
      sleep 3
    done
    if [[ "$estado" == running || "$estado" == running/healthy ]]; then
      echo "  ${VERDE}$svc recriado: $estado${N}"; ok+=("$svc")
    else
      echo "  ${VERM}$svc recriado mas esta '$estado' -- veja: docker compose -p $nome logs $svc${N}"; ruim+=("$svc"); houve_falha=1
    fi
  done
  RESUMO+=("$nome: atualizado ${ok[*]:-}${ruim:+ | PROBLEMA em ${ruim[*]}}")
  unset IMG ANTES_ID ANTES_V CONT
done <<< "$projetos"

if [[ $APLICAR == 1 ]]; then
  # So imagens orfas (sem tag), que e' o que cada atualizacao deixa pra tras.
  # O us tem disco curto; acumular versoes velhas de mongo/grafana come GB.
  liberado=$(docker image prune -f 2>/dev/null | tail -1)
  echo; echo "${CINZA}limpeza: ${liberado:-nada}${N}"
fi

echo; echo "${B}Resumo $(hostname -s)${N}"
printf '  %s\n' "${RESUMO[@]}"
exit $houve_falha
