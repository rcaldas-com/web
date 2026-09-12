#!/usr/bin/env bash
# Remove .conf (e companheiros) de host/servico que SAIU do plano atual.
#
# Ate 12/09/2026 o gerador so' escrevia o que estava habilitado e nunca
# apagava o resto -- desativar um host no Monitor parava de atualizar o
# .conf dele, mas o arquivo continuava fisicamente ali, o cron continuava
# tentando roda-lo a cada ciclo, e ele ficava referenciando um alias que
# a proxima geracao do ssh_config ja tinha removido. Foi assim que
# r64.conf sobreviveu 13 dias apontando pro alias r64-bkp muito depois de
# ele deixar de existir.
set -u

# @@ESPERADOS@@ e' a lista de basenames validos hoje, um por linha (sem
# ".conf"): nome de host do plano de arquivo + "dados-<servico>" do plano
# de dados. Qualquer outro <nome>.conf em /etc/rsnapshot/ e' orfao.
esperados="@@ESPERADOS@@"

for conf in /etc/rsnapshot/*.conf; do
  [[ -e "$conf" ]] || continue
  nome=$(basename "$conf" .conf)
  # ssh_config nao tem essa extensao dupla, mas -F seguro nunca custa nada
  [[ "$nome" == "ssh_config" ]] && continue
  if ! grep -qxF "$nome" <<<"$esperados"; then
    echo "  removendo orfao: $nome (.conf + companheiros)"
    rm -f "/etc/rsnapshot/$nome.conf" "/etc/rsnapshot/$nome.preexec.sh" "/etc/rsnapshot/$nome.sh"
  fi
done
