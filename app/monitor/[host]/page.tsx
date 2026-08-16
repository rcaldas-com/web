import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAdmin } from '@/lib/auth';
import { getMonitorHost } from '@/lib/monitor';
import {
  toggleDdnsAction,
  disableTunnelAction,
  openTunnelAction,
  setTunnelPortAction,
  setMonitoringConfigAction,
  setBackupConfigAction,
  deleteHostAction,
} from '@/lib/actions/monitor';
import AutoRefresh from '@/app/finance/AutoRefresh';
import ConfirmSubmit from '@/app/monitor/ConfirmSubmit';

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

function field(label: string, value: React.ReactNode) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{label}</div>
      <div className="mt-1 text-sm text-zinc-900 dark:text-zinc-100">{value ?? '-'}</div>
    </div>
  );
}

export default async function MonitorHostPage({ params }: { params: Promise<{ host: string }> }) {
  await requireAdmin();
  const { host: hostParam } = await params;
  const host = await getMonitorHost(hostParam);
  if (!host) notFound();

  return (
    <main className="min-h-screen bg-zinc-100 dark:bg-zinc-950">
      <AutoRefresh pollMs={10_000} />
      <div className="mx-auto max-w-3xl p-6">
        <div className="mb-6 flex items-center gap-3">
          <Link href="/monitor" className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
            &larr; Monitor
          </Link>
        </div>

        <div className="mb-6 flex items-center gap-3">
          <h1 className="text-2xl font-bold text-zinc-950 dark:text-zinc-50">{host.name}</h1>
          <span className={`rounded-full px-2 py-1 text-xs ${statusClass(host.status)}`}>{host.status}</span>
          {host.capabilities?.includes('tunnel-legacy') && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700 dark:bg-amber-950 dark:text-amber-300">
              legado
            </span>
          )}
        </div>

        <section className="mb-6 grid grid-cols-2 gap-4 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900 sm:grid-cols-3">
          {field('Ultimo heartbeat', formatDate(host.lastSeen))}
          {field('Criado em', formatDate(host.createdAt))}
          {field('IP', host.network?.publicIp || host.network?.ipv4 || host.lastIp)}
          {field('IPv6', host.network?.ipv6)}
          {field('Versao do agente', host.version)}
          {field('Capacidades', host.capabilities?.join(', '))}
          {field('Carga', host.system?.load1)}
          {field(
            'CPU',
            host.system?.cpuPct != null
              ? `${host.system.cpuPct}%${host.system.cpuCount ? ` de ${host.system.cpuCount * 100}%` : ''}`
              : undefined
          )}
          {field('Top CPU', host.system?.topCpu)}
          {field('Memoria', host.system?.memoryPct != null ? `${host.system.memoryPct}%` : undefined)}
          {field('Disco /', host.system?.diskRootPct != null ? `${host.system.diskRootPct}%` : undefined)}
          {field('Disco /var', host.system?.diskVarPct != null ? `${host.system.diskVarPct}%` : undefined)}
          {field('Disco /var/log', host.system?.diskVarLogPct != null ? `${host.system.diskVarLogPct}%` : undefined)}
          {field('Uptime', host.system?.uptime != null ? `${Math.floor(host.system.uptime / 3600)}h` : undefined)}
        </section>

        <section className="mb-6 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="mb-3 font-semibold text-zinc-950 dark:text-zinc-50">Acesso</h2>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <form action={toggleDdnsAction} className="flex items-center gap-2">
              <input type="hidden" name="host" value={host.name} />
              <input type="hidden" name="enabled" value={host.ddnsEnabled ? 'false' : 'true'} />
              <span className="text-zinc-500 dark:text-zinc-400">DDNS</span>
              <button
                type="submit"
                className={`rounded-full px-2 py-1 text-xs ${host.ddnsEnabled ? statusClass('ok') : 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400'}`}
              >
                {host.ddnsEnabled ? 'ativo' : 'inativo'}
              </button>
            </form>

            <form action={host.tunnelEnabled ? disableTunnelAction : openTunnelAction} className="flex items-center gap-2">
              <input type="hidden" name="host" value={host.name} />
              <span className="text-zinc-500 dark:text-zinc-400">Tunel</span>
              <button
                type="submit"
                className={`rounded-full px-2 py-1 text-xs ${host.tunnelEnabled ? statusClass('ok') : 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400'}`}
              >
                {host.tunnelEnabled ? `ativo:${host.tunnelPort}` : 'inativo'}
              </button>
            </form>

            <form action={setTunnelPortAction} className="flex items-center gap-2">
              <input type="hidden" name="host" value={host.name} />
              <span className="text-zinc-500 dark:text-zinc-400">Porta manual</span>
              <input
                type="number"
                name="port"
                placeholder="auto"
                min={1025}
                max={65535}
                defaultValue={host.tunnelPort ?? ''}
                className="w-20 rounded border border-zinc-200 bg-white px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-950"
              />
              <button
                type="submit"
                className="rounded-full bg-zinc-100 px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
              >
                salvar
              </button>
            </form>
          </div>
        </section>

        <section className="mb-6 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="mb-1 font-semibold text-zinc-950 dark:text-zinc-50">O que monitorar</h2>
          <p className="mb-3 text-xs text-zinc-500 dark:text-zinc-400">
            Passou do limite num heartbeat, abre incidente sozinho; volta abaixo, resolve sozinho. Vazio = desativado.
          </p>
          <form action={setMonitoringConfigAction} className="flex flex-wrap items-end gap-4 text-sm">
            <input type="hidden" name="host" value={host.name} />
            <label className="flex flex-col gap-1">
              <span className="text-xs text-zinc-500 dark:text-zinc-400">Alerta de disco acima de (%)</span>
              <input
                type="number"
                name="diskThresholdPct"
                min={1}
                max={100}
                placeholder="desativado"
                defaultValue={host.monitoring?.diskThresholdPct ?? ''}
                className="w-32 rounded border border-zinc-200 bg-white px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-950"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-zinc-500 dark:text-zinc-400">Alerta de memoria acima de (%)</span>
              <input
                type="number"
                name="memoryThresholdPct"
                min={1}
                max={100}
                placeholder="desativado"
                defaultValue={host.monitoring?.memoryThresholdPct ?? ''}
                className="w-32 rounded border border-zinc-200 bg-white px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-950"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-zinc-500 dark:text-zinc-400">
                Alerta de CPU acima de (%){host.system?.cpuCount ? ` — max ${host.system.cpuCount * 100}%` : ''}
              </span>
              <input
                type="number"
                name="cpuThresholdPct"
                min={1}
                max={6400}
                placeholder="desativado"
                defaultValue={host.monitoring?.cpuThresholdPct ?? ''}
                className="w-32 rounded border border-zinc-200 bg-white px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-950"
              />
            </label>
            <button
              type="submit"
              className="rounded-full bg-zinc-900 px-3 py-1 text-xs text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
            >
              salvar
            </button>
          </form>
        </section>

        <section className="mb-6 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="mb-1 font-semibold text-zinc-950 dark:text-zinc-50">Backup</h2>
          <p className="mb-3 text-xs text-zinc-500 dark:text-zinc-400">
            O runner puxa via SSH (usando o túnel quando o host está atrás de NAT). Depois de
            salvar, atualize as configs no runner com{' '}
            <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">curl -fsSL .../backup-config | sudo bash</code>.
          </p>
          <form action={setBackupConfigAction} className="flex flex-col gap-4 text-sm">
            <input type="hidden" name="host" value={host.name} />

            <label className="flex items-center gap-2">
              <input type="checkbox" name="enabled" defaultChecked={host.backup?.enabled} />
              <span className="text-xs text-zinc-500 dark:text-zinc-400">Fazer backup deste host</span>
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-xs text-zinc-500 dark:text-zinc-400">
                Diretórios — um por linha. Para ignorar algo, acrescente <code>!caminho</code> na mesma linha.
              </span>
              <textarea
                name="includes"
                rows={6}
                placeholder={'/etc/\n/var/rcaldas/live\n/var/mongodb !/var/mongodb/db !/var/mongodb/logs'}
                defaultValue={(host.backup?.includes ?? [])
                  .map((i) => [i.path, ...(i.excludes ?? []).map((e) => `!${e}`)].join(' '))
                  .join('\n')}
                className="w-full rounded border border-zinc-200 bg-white px-2 py-1 font-mono text-xs dark:border-zinc-700 dark:bg-zinc-950"
              />
            </label>

            <div className="flex flex-wrap items-end gap-3">
              <span className="text-xs text-zinc-500 dark:text-zinc-400">Manter cópias:</span>
              {(
                [
                  ['retHora', 'de hora', host.backup?.retention?.hora ?? 6],
                  ['retDia', 'diárias', host.backup?.retention?.dia ?? 7],
                  ['retSemana', 'semanais', host.backup?.retention?.semana ?? 4],
                  ['retMes', 'mensais', host.backup?.retention?.mes ?? 3],
                ] as const
              ).map(([name, label, valor]) => (
                <label key={name} className="flex flex-col gap-1">
                  <span className="text-xs text-zinc-500 dark:text-zinc-400">{label}</span>
                  <input
                    type="number"
                    name={name}
                    min={0}
                    defaultValue={valor}
                    className="w-16 rounded border border-zinc-200 bg-white px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-950"
                  />
                </label>
              ))}
            </div>
            <button
              type="submit"
              className="w-fit rounded-full bg-zinc-900 px-3 py-1 text-xs text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
            >
              salvar
            </button>
          </form>
        </section>

        <section className="rounded-lg border border-red-200 bg-white p-4 dark:border-red-900 dark:bg-zinc-900">
          <h2 className="mb-3 font-semibold text-zinc-950 dark:text-zinc-50">Zona de risco</h2>
          <p className="mb-3 text-xs text-zinc-500 dark:text-zinc-400">
            O host volta sozinho no proximo heartbeat, mas sem a configuracao: porta do tunel,
            limites de alerta, DDNS e backup precisam ser refeitos.
          </p>
          <form action={deleteHostAction}>
            <input type="hidden" name="host" value={host.name} />
            <ConfirmSubmit
              message={`Apagar "${host.name}"?\n\nPerde porta do tunel, limites de alerta, DDNS e historico. O host reaparece, mas desconfigurado.`}
              className="rounded-full bg-red-100 px-3 py-1 text-xs text-red-700 hover:bg-red-200 dark:bg-red-950 dark:text-red-300 dark:hover:bg-red-900"
            >
              apagar host
            </ConfirmSubmit>
          </form>
        </section>
      </div>
    </main>
  );
}
