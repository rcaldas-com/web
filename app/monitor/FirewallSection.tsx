'use client';

import { useState } from 'react';
import SubmitButton from '@/components/SubmitButton';

type Role = 'standard' | 'proxy' | 'home';
type PortRuleLike = { start: number; end?: number; proto: 'tcp' | 'udp' };

function formatPortRules(rules: PortRuleLike[]): string {
  return rules
    .map((r) => {
      const base = r.end != null && r.end !== r.start ? `${r.start}-${r.end}` : `${r.start}`;
      return r.proto === 'udp' ? `${base}/udp` : base;
    })
    .join(' ');
}

export default function FirewallSection({
  hostName,
  initialRole,
  ports,
  lanPorts,
  lanIface,
  wanIface,
  suggestion,
  action,
}: {
  hostName: string;
  initialRole: Role;
  ports: PortRuleLike[];
  lanPorts: PortRuleLike[];
  lanIface?: string;
  wanIface?: string;
  suggestion: string;
  action: (formData: FormData) => void;
}) {
  const [role, setRole] = useState<Role>(initialRole);
  const showPorts = role === 'proxy' || role === 'home';

  return (
    <section className="mb-6 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="mb-1 font-semibold text-zinc-950 dark:text-zinc-50">Firewall</h2>
      <p className="mb-3 text-xs text-zinc-500 dark:text-zinc-400">
        Isto só gera uma <strong>sugestão</strong> de conteúdo pro <code>nftables.conf</code> do host, de acordo com
        o papel — nada é aplicado remotamente. Copie o texto abaixo e adapte na mão no host, no seu tempo.
      </p>

      <form action={action} className="flex flex-col gap-3 text-sm">
        <input type="hidden" name="host" value={hostName} />

        <label className="flex flex-col gap-1">
          <span className="text-xs text-zinc-500 dark:text-zinc-400">Papel do host</span>
          <select
            name="role"
            value={role}
            onChange={(e) => setRole(e.target.value as Role)}
            className="w-fit rounded border border-zinc-200 bg-white px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-950"
          >
            <option value="standard">Padrão</option>
            <option value="proxy">Proxy</option>
            <option value="home">Home</option>
          </select>
        </label>

        {showPorts && (
          <label className="flex flex-col gap-1">
            <span className="text-xs text-zinc-500 dark:text-zinc-400">
              Portas públicas — separadas por espaço/vírgula. Aceita faixa (<code>21115-21119</code>) e protocolo
              (<code>21116/udp</code>, padrão tcp).
            </span>
            <input
              type="text"
              name="ports"
              placeholder="80 443 21115-21119 21116/udp"
              defaultValue={formatPortRules(ports)}
              className="w-full rounded border border-zinc-200 bg-white px-2 py-1 font-mono text-xs dark:border-zinc-700 dark:bg-zinc-950"
            />
          </label>
        )}

        {role === 'home' && (
          <div className="flex flex-col gap-2 rounded border border-zinc-200 p-2 dark:border-zinc-700">
            <span className="text-xs text-zinc-500 dark:text-zinc-400">
              Interfaces do roteador. Com a <strong>LAN</strong> preenchida, a sugestão passa a liberar DHCP e DNS
              nela — <strong>sem isso o <code>policy drop</code> descarta o DHCP do cliente novo em silêncio</strong>,
              sem erro no dnsmasq nem no tcpdump. Com a WAN também, sai forward e NAT.
            </span>
            <div className="flex gap-2">
              <label className="flex flex-1 flex-col gap-1">
                <span className="text-xs text-zinc-500 dark:text-zinc-400">LAN</span>
                <input
                  type="text"
                  name="lanIface"
                  placeholder="enp3s0"
                  defaultValue={lanIface || ''}
                  className="w-full rounded border border-zinc-200 bg-white px-2 py-1 font-mono text-xs dark:border-zinc-700 dark:bg-zinc-950"
                />
              </label>
              <label className="flex flex-1 flex-col gap-1">
                <span className="text-xs text-zinc-500 dark:text-zinc-400">WAN (opcional)</span>
                <input
                  type="text"
                  name="wanIface"
                  placeholder="wlan0"
                  defaultValue={wanIface || ''}
                  className="w-full rounded border border-zinc-200 bg-white px-2 py-1 font-mono text-xs dark:border-zinc-700 dark:bg-zinc-950"
                />
              </label>
            </div>
            <span className="text-xs text-zinc-400 dark:text-zinc-500">
              Escopo de DHCP, reservas por MAC e mapa de intranet não ficam aqui — são do gerenciador local do
              roteador, que é quem tem o dado fresco.
            </span>
          </div>
        )}

        <label className="flex flex-col gap-1">
          <span className="text-xs text-zinc-500 dark:text-zinc-400">
            Portas só de rede local (vale pra qualquer papel) — mesma sintaxe, liberada só pra faixas privadas
            (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16), não pro resto da internet.
          </span>
          <input
            type="text"
            name="lanPorts"
            placeholder="5900"
            defaultValue={formatPortRules(lanPorts)}
            className="w-full rounded border border-zinc-200 bg-white px-2 py-1 font-mono text-xs dark:border-zinc-700 dark:bg-zinc-950"
          />
        </label>

        <SubmitButton className="w-fit rounded-full bg-zinc-900 px-3 py-1 text-xs text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300">
          salvar
        </SubmitButton>
      </form>

      {/* Fechado por padrão: são ~110 linhas que empurrariam o resto da
          página pra fora da tela, e é conteúdo pra copiar uma vez, não pra
          consultar toda hora. <details> nativo em vez de estado no React --
          não precisa de client component só pra abrir e fechar. */}
      <details className="group mt-4">
        <summary className="flex cursor-pointer list-none items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200">
          <span className="transition-transform group-open:rotate-90" aria-hidden="true">
            ▸
          </span>
          Sugestão de nftables.conf pra este host
        </summary>
        <pre className="mt-2 max-h-96 overflow-auto rounded bg-zinc-100 p-3 text-xs text-zinc-800 dark:bg-zinc-950 dark:text-zinc-200">
          {suggestion}
        </pre>
      </details>
    </section>
  );
}
