#!/usr/bin/env bash
set -euo pipefail

# Troca os dotfiles/scripts placeholder criados pelo /init pelos sincronizados
# via Syncthing. So faz sentido depois que o Syncthing ja fez pelo menos uma
# sincronizacao completa neste host (na primeira execucao do /init ainda nao
# ha nada para sincronizar). Rodar manualmente via SSH quando estiver pronto:
#   ssh <host> bash < sync-dotfiles.sh

USER="${SYNC_USER:-rcaldas}"
HOME_USER="${SYNC_HOME_USER:-/var/$USER}"
BIN_DIR="${SYNC_BIN_DIR:-/usr/local/bin}"
SYNC_BIN="$HOME_USER/live/bin"
SYNC_HOME="$HOME_USER/live/home"

[ "$(id -u)" = 0 ] || { echo "Precisa rodar como root."; exit 1; }

if [[ ! -d $SYNC_BIN && ! -d $SYNC_HOME ]]; then
  echo "Nada sincronizado ainda em $SYNC_BIN / $SYNC_HOME."
  echo "Rode de novo depois que o Syncthing terminar a primeira sincronizacao."
  exit 1
fi

if [[ -d $SYNC_BIN ]]; then
  echo "Trocando bin sincronizado..."
  for i in $(find "$SYNC_BIN" -type f); do
    rm "$BIN_DIR""${i#$SYNC_BIN}" &> /dev/null || true
    ln -sf "$i" "$BIN_DIR""${i#$SYNC_BIN}"
    chmod +x "$i"
  done
fi

if [[ -d $SYNC_HOME ]]; then
  echo "Trocando dotfiles sincronizados..."
  for i in $(find "$SYNC_HOME" -type f); do
    rm "$HOME_USER""${i#$SYNC_HOME}" &> /dev/null || true
    ln -s "$i" "$HOME_USER""${i#$SYNC_HOME}"
    chown -h "$USER": "$HOME_USER""${i#$SYNC_HOME}"
  done
  rm /root/.bashrc &> /dev/null || true
  cp "$HOME_USER/.bashrc" /root/.bashrc
  cp "$HOME_USER/.ssh/config" /root/.ssh/
fi

echo "Pronto."
