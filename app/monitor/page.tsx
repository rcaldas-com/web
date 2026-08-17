import Link from 'next/link';
import { HomeIcon, CircleStackIcon } from '@heroicons/react/24/outline';
import { requireAdmin } from '@/lib/auth';
import { getMonitorOverview, findBackupRunner } from '@/lib/monitor';
import {
  toggleDdnsAction,
  disableTunnelAction,
  openTunnelAction,
  createHostAction,
  deleteHostAction,
  resolveIncidentAction,
} from '@/lib/actions/monitor';
import AutoRefresh from '@/app/finance/AutoRefresh';
import ConfirmSubmit from '@/app/monitor/ConfirmSubmit';
import SubmitButton from '@/components/SubmitButton';

function formatDate(value?: string) {
  if (!value) return 'nunca';
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'medium',
    timeZone: 'America/Sao_Paulo',
  }).format(new Date(value));
}

function formatOpenSince(value?: string) {
  if (!value) return '';
  const ms = Date.now() - new Date(value).getTime();
  const horas = Math.floor(ms / 3_600_000);
  if (horas < 1) return 'aberto há menos de 1h';
  if (horas < 48) return `aberto há ${horas}h`;
  return `aberto há ${Math.floor(horas / 24)}d`;
}

function statusClass(status?: string) {
  if (status === 'ok') return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300';
  if (status === 'down' || status === 'critical') return 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300';
  return 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300';
}

const APP_URL = process.env.AUTH_TRUST_HOST || 'https://web.rcaldas.com';

export default async function MonitorPage() {
  await requireAdmin();
  const [overview, backupRunner] = await Promise.all([getMonitorOverview(), findBackupRunner()]);

  return (
    <main className="min-h-screen bg-zinc-100 dark:bg-zinc-950">
      <AutoRefresh pollMs={10_000} />
      <div className="mx-auto max-w-6xl p-6">
        <div className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-zinc-950 dark:text-zinc-50">Monitor</h1>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">Hosts, incidentes e eventos operacionais.</p>
          </div>
        </div>

        <section className="mb-6 flex flex-wrap gap-3 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          {backupRunner ? (
            <Link
              href={`/monitor/${backupRunner}#backup-runner`}
              className="inline-flex items-center gap-2 rounded-full bg-zinc-900 px-4 py-2 text-sm text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
            >
              <CircleStackIcon className="h-4 w-4" />
              Backup ({backupRunner})
            </Link>
          ) : (
            <span
              title="Nenhum host marcado como runner ainda"
              className="inline-flex cursor-not-allowed items-center gap-2 rounded-full bg-zinc-100 px-4 py-2 text-sm text-zinc-400 dark:bg-zinc-800 dark:text-zinc-600"
            >
              <CircleStackIcon className="h-4 w-4" />
              Backup (sem runner)
            </span>
          )}
          <span
            title="Sistema Home (rede local) ainda não tem painel — ver HOME.md"
            className="inline-flex cursor-not-allowed items-center gap-2 rounded-full bg-zinc-100 px-4 py-2 text-sm text-zinc-400 dark:bg-zinc-800 dark:text-zinc-600"
          >
            <HomeIcon className="h-4 w-4" />
            Home
            <span className="rounded-full bg-zinc-200 px-1.5 py-0.5 text-[10px] uppercase dark:bg-zinc-700">em breve</span>
          </span>
        </section>

        <div className="mb-6 grid gap-6 lg:grid-cols-2">
          <section className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
            <div className="border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
              <h2 className="font-semibold text-zinc-950 dark:text-zinc-50">
                Incidentes abertos <span className="text-zinc-400 dark:text-zinc-500">({overview.incidents.length})</span>
              </h2>
            </div>
            <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {overview.incidents.map((incident) => (
                <div key={incident._id} className="p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <span className={`rounded-full px-2 py-1 text-xs ${statusClass(incident.severity)}`}>{incident.severity}</span>
                      {(incident.count ?? 1) > 1 && (
                        <span
                          className="rounded-full bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
                          title="Quantas vezes reabriu sem ser resolvido"
                        >
                          ×{incident.count}
                        </span>
                      )}
                    </div>
                    <span className="text-xs text-zinc-500" title={formatDate(incident.updatedAt)}>
                      {formatOpenSince(incident.openedAt)}
                    </span>
                  </div>
                  <div className="mt-2 font-medium text-zinc-950 dark:text-zinc-50">{incident.summary}</div>
                  <div className="mt-1 flex items-center justify-between gap-3">
                    <Link href={`/monitor/${incident.target}`} className="text-sm text-zinc-500 hover:underline dark:text-zinc-400">
                      {incident.target}
                    </Link>
                    <form action={resolveIncidentAction}>
                      <input type="hidden" name="id" value={incident._id} />
                      <SubmitButton
                        className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
                      >
                        marcar resolvido
                      </SubmitButton>
                    </form>
                  </div>
                </div>
              ))}
              {!overview.incidents.length && <div className="p-4 text-sm text-zinc-500">Nenhum incidente aberto.</div>}
            </div>
          </section>

          <section className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
            <div className="border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
              <h2 className="font-semibold text-zinc-950 dark:text-zinc-50">
                Eventos de email <span className="text-zinc-400 dark:text-zinc-500">({overview.mailEvents.length})</span>
              </h2>
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

        <section className="mb-6 rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          <div className="border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
            <h2 className="font-semibold text-zinc-950 dark:text-zinc-50">Hosts</h2>
          </div>
          <form action={createHostAction} className="flex flex-wrap items-center gap-3 border-b border-zinc-200 px-4 py-3 text-sm dark:border-zinc-800">
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
                  <th className="px-4 py-3">DDNS</th>
                  <th className="px-4 py-3">Túnel</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {overview.hosts.map((host) => (
                  <tr key={host._id} className="text-zinc-700 dark:text-zinc-300">
                    <td className="px-4 py-3 font-medium text-zinc-950 dark:text-zinc-50">
                      <Link href={`/monitor/${host.name}`} className="hover:underline">
                        {host.name}
                      </Link>
                      {host.capabilities?.includes('tunnel-legacy') && (
                        <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700 dark:bg-amber-950 dark:text-amber-300">
                          legado
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3"><span className={`rounded-full px-2 py-1 text-xs ${statusClass(host.status)}`}>{host.status}</span></td>
                    <td className="px-4 py-3">{formatDate(host.lastSeen)}</td>
                    <td className="px-4 py-3">{host.network?.publicIp || host.network?.ipv4 || host.lastIp || '-'}</td>
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
                {!overview.hosts.length && (
                  <tr><td className="px-4 py-8 text-center text-zinc-500" colSpan={9}>Nenhum host registrado ainda.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <div className="mb-6 grid gap-3 sm:grid-cols-3">
          {[
            ['Hosts', overview.counts.hosts],
            ['Online', overview.counts.online],
            ['Down', overview.counts.down],
          ].map(([label, value]) => (
            <div key={label} className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
              <div className="text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{label}</div>
              <div className="mt-2 text-2xl font-semibold text-zinc-950 dark:text-zinc-50">{value}</div>
            </div>
          ))}
        </div>

        <details className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <summary className="cursor-pointer text-sm font-semibold text-zinc-950 dark:text-zinc-50">
            Comandos
          </summary>
          <div className="mt-3 space-y-3 text-xs">
            {(
              [
                ['install', 'Só o agente: heartbeat, métricas, túnel e envio de log. Idempotente.'],
                ['init', 'Provisionamento completo do host. No fim chama o /install.'],
                ['remove-zxnet', 'Remove o sistema antigo (cron, túnel, symlink) de um host migrado.'],
                ['sync-dotfiles', 'Troca os dotfiles estáticos pelos sincronizados via Syncthing.'],
                ['setup-backup-runner', 'Transforma o host no runner de backup da frota.'],
                ['backup-config', 'Regrava as configs de backup no runner. Rode após mudar diretórios aqui.'],
              ] as const
            ).map(([rota, desc]) => (
              <div key={rota}>
                <code className="block rounded bg-zinc-100 px-2 py-1 font-mono text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200">
                  curl -fsSL {APP_URL}/{rota} | sudo bash
                </code>
                <p className="mt-1 text-zinc-500 dark:text-zinc-400">{desc}</p>
              </div>
            ))}
            <p className="border-t border-zinc-200 pt-3 text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
              O backup é <strong>puxado</strong> pelo runner: só ele roda o <code>backup-config</code>.
              Os hosts copiados não rodam nada — o agente deles autoriza a chave do runner sozinho.
            </p>
          </div>
        </details>
      </div>
    </main>
  );
}
