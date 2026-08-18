import { getFirewallPlan, type FirewallPlan } from '@/lib/monitor';

const APP_URL = process.env.AUTH_TRUST_HOST || 'https://web.rcaldas.com';
const INCLUDE_PATH = '/etc/nftables.d/monitor-ports.conf';
const REVERT_UNIT = 'monitor-fw-revert';
const REVERT_DELAY_SEC = 300;

// So accept aqui, NUNCA policy nem drop -- e o que deixa esse arquivo
// seguro de regerar as cegas: o pior que ele pode fazer e liberar algo a
// mais, nunca fechar algo que devia estar aberto.
function includeContent(plan: FirewallPlan): string {
  const header = [
    '# Gerado pelo Monitor -- nao editar a mao, regenerado a cada',
    '# curl .../firewall-config. So accept aqui, nunca policy nem drop.',
  ];
  if (plan.role === 'standard') {
    const v4 = plan.knownHostsV4 ?? [];
    const v6 = plan.knownHostsV6 ?? [];
    const lines = [...header];
    if (v4.length) lines.push(`ip saddr { ${v4.join(', ')} } accept`);
    if (v6.length) lines.push(`ip6 saddr { ${v6.join(', ')} } accept`);
    if (!v4.length && !v6.length) lines.push('# nenhum outro host conhecido ainda -- so SSH e loopback liberados');
    return lines.join('\n');
  }
  const ports = plan.ports ?? [];
  const lines = [...header];
  if (ports.length) lines.push(`tcp dport { ${ports.join(', ')} } accept`);
  else lines.push('# nenhuma porta publica configurada ainda');
  return lines.join('\n');
}

function script(plan: FirewallPlan) {
  const include = includeContent(plan);
  return `#!/usr/bin/env bash
set -euo pipefail

[ "$(id -u)" = 0 ] || { echo "Precisa rodar como root."; exit 1; }

# UM backup so, tirado ANTES de qualquer escrita, e reusado tanto pro
# registro historico quanto pro timer de reversao. Tirar um segundo
# backup mais tarde (depois do esqueleto ja escrito) foi o bug real que
# derrubou a rede de seguranca na primeira tentativa: o "backup" usado
# pela reversao era copia do arquivo NOVO, entao reverter nao revertia
# nada -- so' copiava a config em cima dela mesma. Se nao existir arquivo
# nenhum ainda, o backup fica vazio de proposito: reverter pra "vazio" e'
# a semantica certa de "nao tinha firewall nenhum antes".
BACKUP="/etc/nftables.conf.pre-monitor-$(date +%s)"
touch "$BACKUP"
[[ -f /etc/nftables.conf ]] && cp /etc/nftables.conf "$BACKUP"

mkdir -p /etc/nftables.d
cat > "${INCLUDE_PATH}" <<'INCLUDEEOF'
${include}
INCLUDEEOF
echo "include escrito em ${INCLUDE_PATH}"

INCLUDE_LINE='include "${INCLUDE_PATH}"'

if ! grep -q "policy drop" /etc/nftables.conf 2>/dev/null; then
  echo
  echo ":: host sem firewall existente -- escrevendo esqueleto novo ::"
  cat > /etc/nftables.conf <<'SKELEOF'
#!/usr/sbin/nft -f
flush ruleset

table inet filter {
	chain input {
		type filter hook input priority filter; policy drop;

		iifname "lo" accept
		ct state established,related accept
		ct state invalid drop

		# ICMP/ICMPv6 essenciais (RFC 4890) -- sem isso o NDP quebra e o
		# IPv6 fica morto (ja vivemos essa exatamente uma vez nesta casa).
		icmp type { destination-unreachable, time-exceeded, parameter-problem, echo-request, echo-reply } accept
		icmpv6 type {
			destination-unreachable, packet-too-big,
			time-exceeded, parameter-problem,
			echo-request, echo-reply,
			nd-router-solicit, nd-router-advert,
			nd-neighbor-solicit, nd-neighbor-advert
		} accept

		tcp dport 8422 accept

		include "${INCLUDE_PATH}"
	}
	chain forward {
		# accept, nao drop: um host rodando Docker roteia o trafego dos
		# proprios containers por aqui (bridge -> internet). Docker
		# gerencia suas proprias tabelas iptables-nft (ip filter/ip nat)
		# pra isso, mas nftables avalia TODAS as chains casando o hook,
		# de qualquer tabela -- um forward:drop aqui bloqueia mesmo com
		# as regras do Docker corretas. Confirmado ao vivo: quebrou a
		# rede de todo container em bag/tp ate reverter pra accept,
		# igual o 'bag' ja fazia antes desta mudanca (nao foi acidente
		# o padrao de referencia ter policy accept aqui).
		type filter hook forward priority filter; policy accept;
	}
	chain output {
		type filter hook output priority filter; policy accept;
	}
}
SKELEOF
  echo "esqueleto escrito"
elif ! grep -qF "$INCLUDE_LINE" /etc/nftables.conf 2>/dev/null; then
  echo
  echo ":: ja existe firewall neste host, e ele NAO tem o include ainda ::"
  echo "   Nao vou editar esse arquivo na mao -- tem regra demais especifica"
  echo "   pra eu arriscar. Adicione esta linha em /etc/nftables.conf,"
  echo "   depois dos invariantes (loopback/established/ssh) e ANTES de"
  echo "   qualquer 'drop':"
  echo
  echo "     ${'$'}INCLUDE_LINE"
  echo
  echo "   Depois rode este script de novo pra aplicar com seguranca."
  exit 0
fi

echo
echo ":: validando ::"
nft -c -f /etc/nftables.conf

echo ":: agendando reversao automatica em ${REVERT_DELAY_SEC}s (cancelavel) ::"
systemctl stop ${REVERT_UNIT}.service 2>/dev/null || true
systemctl reset-failed ${REVERT_UNIT}.service 2>/dev/null || true
systemd-run --unit=${REVERT_UNIT} --on-active=${REVERT_DELAY_SEC} \\
  /bin/bash -c "cp '$BACKUP' /etc/nftables.conf; systemctl reload nftables 2>/dev/null || systemctl restart nftables 2>/dev/null; logger -t monitor-firewall 'revertido automaticamente (sem confirmacao em ${REVERT_DELAY_SEC}s)'" \\
  > /dev/null

echo ":: aplicando ::"
systemctl reload nftables || systemctl restart nftables

echo
echo "Aplicado. TESTE ACESSO NUMA SESSAO NOVA AGORA."
echo "Sem confirmar em $((${REVERT_DELAY_SEC}/60)) min, reverte sozinho."
echo "Se estiver tudo bem, confirme com:"
echo "  curl -fsSL ${APP_URL}/firewall-confirm | sudo bash"
`;
}

export async function GET(request: Request) {
  const hostParam = new URL(request.url).searchParams.get('host');
  if (!hostParam) {
    return new Response('echo "uso: curl .../firewall-config?host=<nome> | sudo bash"; exit 1', {
      headers: { 'content-type': 'text/x-shellscript; charset=utf-8' },
    });
  }

  const plan = await getFirewallPlan(hostParam);
  if (!plan || !plan.enabled) {
    return new Response(
      `echo "Host '${hostParam}' nao encontrado no Monitor, ou firewall nao habilitado pra ele. Nada a fazer."`,
      { headers: { 'content-type': 'text/x-shellscript; charset=utf-8' } }
    );
  }

  // Trava de seguranca no SERVIDOR, nao so na UI: papel proxy/home com
  // enabled=true e ZERO portas geraria um include que so libera SSH --
  // bloquearia tudo mais nesse host (web, mail, o que for). A UI ja evita
  // salvar assim sem querer, mas essa checagem aqui garante que nem um
  // dado antigo/editado direto no banco consiga gerar esse script.
  if (plan.role !== 'standard' && (plan.ports?.length ?? 0) === 0) {
    return new Response(
      `echo "RECUSANDO: host '${hostParam}' e role '${plan.role}' com firewall habilitado mas ZERO portas publicas configuradas."
echo "Isso bloquearia tudo, exceto SSH, num host que precisa aceitar trafego de fora."
echo "Configure as portas em /monitor/${hostParam} antes de aplicar."
exit 1`,
      { headers: { 'content-type': 'text/x-shellscript; charset=utf-8' } }
    );
  }

  return new Response(script(plan), {
    headers: {
      'content-type': 'text/x-shellscript; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}
