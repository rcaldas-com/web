import { requireAdmin } from '@/lib/auth';
import { getMonitorOverview } from '@/lib/monitor';

function formatDate(value?: string) {
  if (!value) return 'nunca';
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'medium',
    timeZone: 'America/Sao_Paulo',
  }).format(new Date(value));
}

function statusClass(status?: string) {
  if (status === 'ok') return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300';
  if (status === 'down' || status === 'critical') return 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300';
  return 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300';
}

export default async function MonitorPage() {
  await requireAdmin();
  const overview = await getMonitorOverview();

  return (
    <main className="min-h-screen bg-zinc-100 dark:bg-zinc-950">
      <div className="mx-auto max-w-6xl p-6">
        <div className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-zinc-950 dark:text-zinc-50">Monitor</h1>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">Hosts, incidentes e eventos operacionais.</p>
          </div>
          <code className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
            curl -Ls {process.env.AUTH_TRUST_HOST || 'https://web.rcaldas.com'}/install | bash
          </code>
        </div>

        <div className="mb-6 grid gap-3 sm:grid-cols-4">
          {[
            ['Hosts', overview.counts.hosts],
            ['Online', overview.counts.online],
            ['Down', overview.counts.down],
            ['Incidentes', overview.counts.incidents],
          ].map(([label, value]) => (
            <div key={label} className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
              <div className="text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{label}</div>
              <div className="mt-2 text-2xl font-semibold text-zinc-950 dark:text-zinc-50">{value}</div>
            </div>
          ))}
        </div>

        <section className="mb-6 rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          <div className="border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
            <h2 className="font-semibold text-zinc-950 dark:text-zinc-50">Hosts</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-zinc-50 text-xs uppercase text-zinc-500 dark:bg-zinc-950 dark:text-zinc-400">
                <tr>
                  <th className="px-4 py-3">Host</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Ultimo heartbeat</th>
                  <th className="px-4 py-3">IP</th>
                  <th className="px-4 py-3">Carga</th>
                  <th className="px-4 py-3">Disco</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {overview.hosts.map((host) => (
                  <tr key={host._id} className="text-zinc-700 dark:text-zinc-300">
                    <td className="px-4 py-3 font-medium text-zinc-950 dark:text-zinc-50">{host.name}</td>
                    <td className="px-4 py-3"><span className={`rounded-full px-2 py-1 text-xs ${statusClass(host.status)}`}>{host.status}</span></td>
                    <td className="px-4 py-3">{formatDate(host.lastSeen)}</td>
                    <td className="px-4 py-3">{host.network?.publicIp || host.network?.ipv4 || host.lastIp || '-'}</td>
                    <td className="px-4 py-3">{host.system?.load1 ?? '-'}</td>
                    <td className="px-4 py-3">{host.system?.diskRootPct != null ? `${host.system.diskRootPct}%` : '-'}</td>
                  </tr>
                ))}
                {!overview.hosts.length && (
                  <tr><td className="px-4 py-8 text-center text-zinc-500" colSpan={6}>Nenhum host registrado ainda.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <div className="grid gap-6 lg:grid-cols-2">
          <section className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
            <div className="border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
              <h2 className="font-semibold text-zinc-950 dark:text-zinc-50">Incidentes abertos</h2>
            </div>
            <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {overview.incidents.map((incident) => (
                <div key={incident._id} className="p-4">
                  <div className="flex items-center justify-between gap-3">
                    <span className={`rounded-full px-2 py-1 text-xs ${statusClass(incident.severity)}`}>{incident.severity}</span>
                    <span className="text-xs text-zinc-500">{formatDate(incident.updatedAt)}</span>
                  </div>
                  <div className="mt-2 font-medium text-zinc-950 dark:text-zinc-50">{incident.summary}</div>
                  <div className="text-sm text-zinc-500 dark:text-zinc-400">{incident.target}</div>
                </div>
              ))}
              {!overview.incidents.length && <div className="p-4 text-sm text-zinc-500">Nenhum incidente aberto.</div>}
            </div>
          </section>

          <section className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
            <div className="border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
              <h2 className="font-semibold text-zinc-950 dark:text-zinc-50">Eventos de email</h2>
            </div>
            <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {overview.mailEvents.map((event) => (
                <div key={event._id} className="p-4 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-medium text-zinc-950 dark:text-zinc-50">{event.event || event.status || 'email'}</span>
                    <span className="text-xs text-zinc-500">{formatDate(event.ts)}</span>
                  </div>
                  <div className="mt-1 text-zinc-500 dark:text-zinc-400">{event.from || '-'} → {event.to || event.originalTo || '-'}</div>
                  <div className="mt-1 text-zinc-600 dark:text-zinc-300">{event.message || event.status || ''}</div>
                </div>
              ))}
              {!overview.mailEvents.length && <div className="p-4 text-sm text-zinc-500">Nenhum evento de email importado ainda.</div>}
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}