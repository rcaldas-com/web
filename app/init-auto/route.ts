const APP_URL = process.env.AUTH_TRUST_HOST || 'http://localhost:8001';
const PROVISION_TOKEN = process.env.PROVISION_TOKEN || '';

// Provisionamento minimo e SEM perguntas: deixa o host alcancavel pelo
// tunel e para por ai. Existe pra quando nao da pra ficar respondendo
// prompt -- host sem tela, instalacao remota, alguem executando por voce.
// O resto (docker, desktop, smtp...) se faz depois, entrando pelo tunel.
//
// Usa o hostname do proprio sistema. Se precisar de outro, rode o /init
// completo, que pergunta.
function script() {
  return `#!/usr/bin/env bash
set -euo pipefail

USER="rcaldas"
SSH_PORT="8422"
APP_URL="${APP_URL}"

[ "$(id -u)" = 0 ] || { echo "Precisa rodar como root."; exit 1; }

HOST_NAME=$(hostname -s 2>/dev/null || hostname)

echo ":: INIT-AUTO :: $HOST_NAME"
echo "Provisionamento minimo: SSH + tunel. Sem perguntas."
echo

echo "pacotes"
export DEBIAN_FRONTEND=noninteractive
apt-get -qq update > /dev/null 2>&1 || true
for p in curl openssh-server ca-certificates; do
  dpkg -s "$p" > /dev/null 2>&1 || apt-get -qq install "$p" > /dev/null 2>&1 || \\
    echo "  AVISO: nao consegui instalar $p"
done

echo "ssh"
# Mesma porta do resto da frota, e o Match que permite forwarding -- sem
# isso o tunel reverso nao sobe.
if grep -q "^#*Port " /etc/ssh/sshd_config; then
  sed -i "s/^#*Port\\s.*$/Port $SSH_PORT/" /etc/ssh/sshd_config
else
  sed -i "1iPort $SSH_PORT" /etc/ssh/sshd_config
fi
grep -q "Match User $USER" /etc/ssh/sshd_config || \\
  printf 'Match User %s\\n\\tAllowTcpForwarding yes\\n\\tGatewayPorts yes\\n' "$USER" >> /etc/ssh/sshd_config
systemctl enable ssh > /dev/null 2>&1 || true
systemctl restart ssh > /dev/null 2>&1 || true

echo "chave do root"
mkdir -p /root/.ssh && chmod 700 /root/.ssh
if [[ ! -f /root/.ssh/id_ed25519 ]]; then
  ssh-keygen -qt ed25519 -N '' -f /root/.ssh/id_ed25519
fi
PUBKEY=$(cat /root/.ssh/id_ed25519.pub)
echo "  $PUBKEY"

# Mesmo fluxo do /init: registra e espera aprovacao por email. O tunel so
# sobe depois que voce aprovar -- host novo nao ganha acesso sozinho.
if curl -fsS -m 15 -H 'Content-Type: application/json' -X POST "${APP_URL}/api/register-tunnel-key" \\
    -d "{\\"host\\":\\"$HOST_NAME\\",\\"publicKey\\":\\"$PUBKEY\\",\\"provisionToken\\":\\"${PROVISION_TOKEN}\\"}" > /dev/null 2>&1; then
  echo "  pedido de tunel registrado -- aprove pelo email"
else
  echo "  AVISO: nao registrou o pedido -- autorize a chave acima manualmente"
fi

echo "agente"
# Pre-grava a config pro /install nao depender de resposta nenhuma: sem
# tty ele cai nos defaults, e os defaults saem daqui.
mkdir -p /etc/rcaldas-agent && chmod 700 /etc/rcaldas-agent
if [[ ! -f /etc/rcaldas-agent/config.env ]]; then
  cat > /etc/rcaldas-agent/config.env <<EOF
APP_URL=$APP_URL
HOST_NAME=$HOST_NAME
AGENT_TOKEN=
ENABLE_TUNNEL=true
TUNNEL_RELAY=us.rcaldas.com
TUNNEL_RELAY_PORT=8422
LOG_FORWARD_PORT=5514
EOF
  chmod 600 /etc/rcaldas-agent/config.env
fi

curl -fsSL "${APP_URL}/install" < /dev/null | bash

echo
echo ":: PRONTO ::"
echo "Host: $HOST_NAME"
echo "Aprove a chave pelo email; o tunel sobe em ate 60s depois disso."
echo "Dai da pra entrar e customizar o que faltar, ou rodar o /init completo."
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
