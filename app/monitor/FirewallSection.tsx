'use client';

import { useState } from 'react';
import SubmitButton from '@/components/SubmitButton';

type Role = 'standard' | 'proxy' | 'home';

export default function FirewallSection({
  hostName,
  initialRole,
  firewallEnabled,
  ports,
  appUrl,
  action,
}: {
  hostName: string;
  initialRole: Role;
  firewallEnabled?: boolean;
  ports: number[];
  appUrl: string;
  action: (formData: FormData) => void;
}) {
  const [role, setRole] = useState<Role>(initialRole);
  const showPorts = role === 'proxy' || role === 'home';

  return (
    <section className="mb-6 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="mb-1 font-semibold text-zinc-950 dark:text-zinc-50">Firewall</h2>
      <p className="mb-3 text-xs text-zinc-500 dark:text-zinc-400">
        Papel <strong>Padrão</strong>: firewall nega tudo, exceto SSH e a frota que o Monitor já conhece. Papel{' '}
        <strong>Proxy</strong>/<strong>Home</strong>: nega tudo, exceto SSH e as portas públicas que você escolher —
        esse host precisa aceitar conexão de fora por natureza.
      </p>

      <form action={action} className="flex flex-col gap-3 text-sm">
        <input type="hidden" name="host" value={hostName} />

        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-zinc-500 dark:text-zinc-400">Papel do host</span>
            <select
              name="role"
              value={role}
              onChange={(e) => setRole(e.target.value as Role)}
              className="rounded border border-zinc-200 bg-white px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-950"
            >
              <option value="standard">Padrão</option>
              <option value="proxy">Proxy</option>
              <option value="home">Home</option>
            </select>
          </label>

          <label className="flex items-center gap-2 pb-1.5">
            <input type="checkbox" name="enabled" defaultChecked={firewallEnabled} />
            <span className="text-xs text-zinc-500 dark:text-zinc-400">Gerenciar firewall deste host</span>
          </label>
        </div>

        {showPorts && (
          <label className="flex flex-col gap-1">
            <span className="text-xs text-zinc-500 dark:text-zinc-400">
              Portas públicas — separadas por espaço ou vírgula. Vazio aqui + habilitado bloqueia tudo, exceto SSH.
            </span>
            <input
              type="text"
              name="ports"
              placeholder="80 443 25 587"
              defaultValue={ports.join(' ')}
              className="w-full rounded border border-zinc-200 bg-white px-2 py-1 font-mono text-xs dark:border-zinc-700 dark:bg-zinc-950"
            />
          </label>
        )}

        <SubmitButton className="w-fit rounded-full bg-zinc-900 px-3 py-1 text-xs text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300">
          salvar
        </SubmitButton>
      </form>

      <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
        Salvar aqui só guarda a configuração — <strong>não aplica sozinho</strong> (de propósito: firewall remoto
        merece você presente, não um job silencioso de madrugada). Depois de salvar, rode no host:
        <code className="mt-1 block rounded bg-zinc-100 px-2 py-1 font-mono text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200">
          curl -fsSL {appUrl}/firewall-config?host={hostName} | sudo bash
        </code>
        Reverte sozinho em 5 min se você não confirmar com{' '}
        <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">curl -fsSL {appUrl}/firewall-confirm | sudo bash</code>.
      </p>
    </section>
  );
}
