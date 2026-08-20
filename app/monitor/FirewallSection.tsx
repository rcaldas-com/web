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
  suggestion,
  action,
}: {
  hostName: string;
  initialRole: Role;
  ports: PortRuleLike[];
  lanPorts: PortRuleLike[];
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

      <div className="mt-4">
        <p className="mb-1 text-xs text-zinc-500 dark:text-zinc-400">Sugestão de nftables.conf pra este host:</p>
        <pre className="max-h-96 overflow-auto rounded bg-zinc-100 p-3 text-xs text-zinc-800 dark:bg-zinc-950 dark:text-zinc-200">
          {suggestion}
        </pre>
      </div>
    </section>
  );
}
