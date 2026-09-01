'use client';

import { useDeferredValue, useMemo, useState } from 'react';
import Link from 'next/link';
import ConfirmSubmit from '@/components/ConfirmSubmit';
import SubmitButton from '@/components/SubmitButton';

type Host = {
  _id: string;
  name: string;
  status?: string;
  lastSeen?: string;
  network?: { publicIp?: string; ipv4?: string };
  lastIp?: string;
  system?: {
    load1?: number;
    diskRootPct?: number | null;
    diskVarPct?: number | null;
    diskVarLogPct?: number | null;
  };
  capabilities?: string[];
  version?: string;
  monitoring?: { enabled?: boolean };
  ddnsEnabled?: boolean;
  tunnelEnabled?: boolean;
  tunnelPort?: number;
};

function statusClass(status?: string) {
  if (status === 'ok') return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300';
  if (status === 'down' || status === 'critical') return 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300';
  return 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300';
}

function formatDate(value?: string) {
  if (!value) return 'nunca';
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'medium',
    timeZone: 'America/Sao_Paulo',
  }).format(new Date(value));
}

// Texto pesquisavel de um host: nome, status, versao, IP e capacidades,
// tudo minusculo -- mesmo padrao do filtro de usuarios em configuracoes.
// A versao entra pra dar 'quem ainda nao atualizou' numa busca so'.
function haystack(host: Host): string {
  return `${host.name} ${host.status ?? ''} ${host.version ?? ''} ${host.network?.publicIp ?? ''} ${host.network?.ipv4 ?? ''} ${host.lastIp ?? ''} ${(host.capabilities ?? []).join(' ')}`.toLowerCase();
}

export default function HostsSection({
  hosts,
  createHostAction,
  toggleDdnsAction,
  disableTunnelAction,
  openTunnelAction,
  deleteHostAction,
}: {
  hosts: Host[];
  createHostAction: (formData: FormData) => void;
  toggleDdnsAction: (formData: FormData) => void;
  disableTunnelAction: (formData: FormData) => void;
  openTunnelAction: (formData: FormData) => void;
  deleteHostAction: (formData: FormData) => void;
}) {
  const [query, setQuery] = useState('');
  // Mantem a digitacao fluida mesmo com a lista maior: o input responde na
  // hora, a filtragem usa o valor "adiado".
  const deferredQuery = useDeferredValue(query);

  const filtered = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    if (!q) return hosts;
    const terms = q.split(/\s+/);
    return hosts.filter((h) => {
      const hay = haystack(h);
      return terms.every((t) => hay.includes(t));
    });
  }, [hosts, deferredQuery]);

  return (
    <section className="mb-6 rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <div className="border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <h2 className="font-semibold text-zinc-950 dark:text-zinc-50">
          Hosts {filtered.length !== hosts.length && <span className="text-zinc-400 dark:text-zinc-500">({filtered.length} de {hosts.length})</span>}
        </h2>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 px-4 py-3 text-sm dark:border-zinc-800">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar por nome, status, IP…"
          className="w-full rounded border border-zinc-200 bg-white px-2 py-1 text-xs sm:w-64 dark:border-zinc-700 dark:bg-zinc-950"
        />
        <form action={createHostAction} className="flex flex-wrap items-center gap-3">
          <input
            type="text"
            name="host"
            placeholder="nome do host"
            required
            className="rounded border border-zinc-200 bg-white px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-950"
          />
          <label className="flex items-center gap-1 text-xs text-zinc-600 dark:text-zinc-300">
            <input type="checkbox" name="ddnsEnabled" /> DDNS
          </label>
          <label className="flex items-center gap-1 text-xs text-zinc-600 dark:text-zinc-300">
            <input type="checkbox" name="tunnelEnabled" /> Túnel
          </label>
          <SubmitButton className="rounded-full bg-zinc-900 px-3 py-1 text-xs text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300">
            novo host
          </SubmitButton>
        </form>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-zinc-50 text-xs uppercase text-zinc-500 dark:bg-zinc-950 dark:text-zinc-400">
            <tr>
              <th className="px-4 py-3">Host</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Ultimo heartbeat</th>
              <th className="px-4 py-3">IP</th>
              <th className="px-4 py-3">Agente</th>
                <th className="px-4 py-3">Carga</th>
              <th className="px-4 py-3">Disco</th>
              <th className="px-4 py-3">DDNS</th>
              <th className="px-4 py-3">Túnel</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {filtered.map((host) => (
              <tr key={host._id} className="text-zinc-700 dark:text-zinc-300">
                <td className="px-4 py-3 font-medium text-zinc-950 dark:text-zinc-50">
                  <Link href={`/monitor/${host.name}`} className="hover:underline">
                    {host.name}
                  </Link>
                  {/* Alerta desligado e o DEFAULT, entao precisa ser visivel
                      na lista: sem isto so da pra saber quem esta armado
                      abrindo host por host, e um host silencioso por
                      esquecimento fica indistinguivel de um monitorado. */}
                  {!host.monitoring?.enabled && (
                    <span
                      title="Alertas desativados: este host não gera incidente nem email"
                      className="ml-2 rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
                    >
                      sem alerta
                    </span>
                  )}
                </td>
                <td className="px-4 py-3"><span className={`rounded-full px-2 py-1 text-xs ${statusClass(host.status)}`}>{host.status}</span></td>
                <td className="px-4 py-3">{formatDate(host.lastSeen)}</td>
                <td className="px-4 py-3">{host.network?.publicIp || host.network?.ipv4 || host.lastIp || '-'}</td>
                <td className="px-4 py-3 text-xs">{host.version ?? '-'}</td>
                <td className="px-4 py-3">{host.system?.load1 ?? '-'}</td>
                <td className="px-4 py-3">
                  {host.system?.diskRootPct != null ? `${host.system.diskRootPct}%` : '-'}
                  {host.system?.diskVarPct != null && (
                    <span className="ml-1 text-xs text-zinc-500 dark:text-zinc-400">/var {host.system.diskVarPct}%</span>
                  )}
                  {host.system?.diskVarLogPct != null && (
                    <span className="ml-1 text-xs text-zinc-500 dark:text-zinc-400">/var/log {host.system.diskVarLogPct}%</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <form action={toggleDdnsAction}>
                    <input type="hidden" name="host" value={host.name} />
                    <input type="hidden" name="enabled" value={host.ddnsEnabled ? 'false' : 'true'} />
                    <SubmitButton
                      className={`rounded-full px-2 py-1 text-xs ${host.ddnsEnabled ? statusClass('ok') : 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400'}`}
                    >
                      {host.ddnsEnabled ? 'ativo' : 'inativo'}
                    </SubmitButton>
                  </form>
                </td>
                <td className="px-4 py-3">
                  <form action={host.tunnelEnabled ? disableTunnelAction : openTunnelAction}>
                    <input type="hidden" name="host" value={host.name} />
                    <SubmitButton
                      className={`rounded-full px-2 py-1 text-xs ${host.tunnelEnabled ? statusClass('ok') : 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400'}`}
                    >
                      {host.tunnelEnabled ? `ativo:${host.tunnelPort}` : 'inativo'}
                    </SubmitButton>
                  </form>
                </td>
                <td className="px-4 py-3">
                  <form action={deleteHostAction}>
                    <input type="hidden" name="host" value={host.name} />
                    <ConfirmSubmit
                      message={`Apagar "${host.name}"?\n\nO host volta sozinho no proximo heartbeat, mas SEM a configuracao: porta do tunel (pode mudar e quebrar o alias de ssh), limites de alerta (para de avisar) e DDNS.`}
                      className="rounded-full bg-red-100 px-2 py-1 text-xs text-red-700 hover:bg-red-200 dark:bg-red-950 dark:text-red-300 dark:hover:bg-red-900"
                    >
                      apagar
                    </ConfirmSubmit>
                  </form>
                </td>
              </tr>
            ))}
            {!filtered.length && (
              <tr>
                <td className="px-4 py-8 text-center text-zinc-500" colSpan={9}>
                  {hosts.length ? 'Nenhum host bate com a busca.' : 'Nenhum host registrado ainda.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
