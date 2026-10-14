import Link from 'next/link';
import { requireAdminPage } from '@/lib/auth';
import { listServices, getRepoStates } from '@/lib/services';
import { createServiceAction } from '@/lib/actions/services';
import SubmitButton from '@/components/SubmitButton';

function formatDate(value?: string) {
  if (!value) return 'nunca';
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'America/Sao_Paulo',
  }).format(new Date(value));
}

const SOURCE_LABEL: Record<string, string> = {
  build: 'nós buildamos',
  upstream: 'imagem pública',
  managed: 'sem imagem',
  external: 'externo',
};

export default async function ServicosPage() {
  await requireAdminPage('/monitor/servicos');
  const [services, repoStates] = await Promise.all([listServices(), getRepoStates()]);

  const comDeriva = services.filter((s) => s.drift);
  const foraDoAr = services.filter((s) => s.url && s.health && !s.health.ok);
  const reposSujos = repoStates.filter((r) => r.dirtyFiles.length > 0 || r.ahead > 0 || r.behind > 0);

  return (
    <main className="min-h-screen bg-zinc-100 dark:bg-zinc-950">
      <div className="mx-auto max-w-5xl p-6">
        <div className="mb-6 flex items-center gap-3">
          <Link href="/monitor" className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
            &larr; Monitor
          </Link>
        </div>

        <h1 className="mb-1 text-2xl font-bold text-zinc-950 dark:text-zinc-50">Serviços</h1>
        <p className="mb-6 text-sm text-zinc-500 dark:text-zinc-400">
          Derivado do <code>docker compose</code> dos hosts de produção, a cada 30 min. O que se edita à mão é só o que a
          máquina não tem como saber.
        </p>

        {foraDoAr.length > 0 && (
          <section className="mb-6 rounded-lg border border-red-300 bg-red-50 p-4 text-sm dark:border-red-900 dark:bg-red-950">
            <h2 className="mb-2 font-semibold text-red-900 dark:text-red-200">Fora do ar</h2>
            <ul className="space-y-1 text-red-800 dark:text-red-300">
              {foraDoAr.map((s) => (
                <li key={s.name}>
                  <strong>{s.name}</strong>: {s.health?.message ?? 'sem resposta'} desde {formatDate(s.health?.since)} —{' '}
                  <code>{s.url}</code>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Deriva primeiro: e' a informacao que muda o que voce faz agora.
            Enterrada no meio da tabela, ninguem veria. */}
        {(comDeriva.length > 0 || reposSujos.length > 0) && (
          <section className="mb-6 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm dark:border-amber-900 dark:bg-amber-950">
            <h2 className="mb-2 font-semibold text-amber-900 dark:text-amber-200">Deriva detectada</h2>
            <ul className="space-y-1 text-amber-800 dark:text-amber-300">
              {comDeriva.map((s) => (
                <li key={s.name}>
                  <strong>{s.name}</strong>: o compose declara{' '}
                  <code>{s.observed?.declaredImage}</code> mas o container roda{' '}
                  <code>{s.observed?.runningImage}</code> — falta um <code>up -d</code>.
                </li>
              ))}
              {reposSujos.map((r) => (
                <li key={r.host}>
                  <strong>{r.host}</strong>:
                  {r.dirtyFiles.length > 0 && ` alterações não commitadas (${r.dirtyFiles.join(', ')})`}
                  {r.ahead > 0 && ` ${r.ahead} commit(s) à frente do remoto`}
                  {r.behind > 0 && ` ${r.behind} commit(s) atrás do remoto`}
                </li>
              ))}
            </ul>
          </section>
        )}

        <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          <table className="w-full text-left text-sm">
            <thead className="bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500 dark:bg-zinc-950 dark:text-zinc-400">
              <tr>
                <th className="px-4 py-3">Serviço</th>
                <th className="px-4 py-3">Origem</th>
                <th className="px-4 py-3">Imagem</th>
                <th className="px-4 py-3">Estado</th>
                <th className="px-4 py-3">Saúde</th>
                <th className="px-4 py-3">Visto</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {services.map((s) => (
                <tr key={s._id} className="text-zinc-700 dark:text-zinc-300">
                  <td className="px-4 py-3 font-medium text-zinc-950 dark:text-zinc-50">
                    <Link href={`/monitor/servicos/${s.name}`} className="hover:underline">
                      {s.name}
                    </Link>
                    {s.drift && (
                      <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700 dark:bg-amber-950 dark:text-amber-300">
                        deriva
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs">{SOURCE_LABEL[s.source?.kind] ?? '-'}</td>
                  <td className="px-4 py-3 font-mono text-xs">{s.observed?.declaredImage ?? '-'}</td>
                  <td className="px-4 py-3 text-xs">{s.observed?.state ?? '-'}</td>
                  <td className="px-4 py-3 text-xs">
                    {!s.url ? (
                      <span className="text-zinc-400 dark:text-zinc-600" title="Sem URL no cadastro: não é sondado">
                        sem sonda
                      </span>
                    ) : !s.health ? (
                      <span className="text-zinc-400 dark:text-zinc-600">aguardando</span>
                    ) : s.health.ok ? (
                      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                        ok{s.health.status ? ` ${s.health.status}` : ''}
                      </span>
                    ) : (
                      <span
                        className="rounded-full bg-red-100 px-2 py-0.5 text-red-700 dark:bg-red-950 dark:text-red-300"
                        title={s.health.message}
                      >
                        fora
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs">{formatDate(s.observed?.seenAt)}</td>
                </tr>
              ))}
              {!services.length && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-sm text-zinc-500 dark:text-zinc-400">
                    Nenhum serviço inventariado ainda. Marque um host como alvo de deploy na página dele e espere o
                    próximo ciclo do agente.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <section className="mt-6 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="mb-1 font-semibold text-zinc-950 dark:text-zinc-50">Cadastrar serviço fora do compose</h2>
          <p className="mb-3 text-xs text-zinc-500 dark:text-zinc-400">
            Para o que o inventário não enxerga (processo solto no host, serviço de terceiro). Com URL, passa a ser
            sondado a cada minuto e abre incidente com email depois de duas falhas seguidas.
          </p>
          <form action={createServiceAction} className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-xs text-zinc-500 dark:text-zinc-400">Nome</span>
              <input
                name="name"
                required
                placeholder="webssh"
                className="rounded border border-zinc-200 bg-white px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-950"
              />
            </label>
            <label className="flex min-w-64 flex-1 flex-col gap-1">
              <span className="text-xs text-zinc-500 dark:text-zinc-400">URL pública</span>
              <input
                name="url"
                placeholder="https://..."
                className="rounded border border-zinc-200 bg-white px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-950"
              />
            </label>
            <SubmitButton className="rounded-full bg-zinc-900 px-3 py-1 text-xs text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300">
              cadastrar
            </SubmitButton>
          </form>
        </section>
      </div>
    </main>
  );
}
