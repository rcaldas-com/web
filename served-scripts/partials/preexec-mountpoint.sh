#!/usr/bin/env bash
# Aborta o ciclo INTEIRO do rsnapshot se um ponto de montagem esperado nao
# estiver montado. Sem esta trava, HD desconectado vira origem vazia pro
# rsync e o --delete apaga o destino inteiro -- com exit 0, sem alerta.
set -e
@@CHECKS@@
