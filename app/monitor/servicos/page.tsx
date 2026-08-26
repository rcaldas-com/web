import Link from 'next/link';
import { requireAdmin } from '@/lib/auth';
import { listServices, getRepoStates } from '@/lib/services';

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
  await requireAdmin();
  const [services, repoStates] = await Promise.all([listServices(), getRepoStates()]);

  const comDeriva = services.filter((s) => s.drift);
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
                  <td className="px-4 py-3 text-xs">{formatDate(s.observed?.seenAt)}</td>
                </tr>
              ))}
              {!services.length && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-sm text-zinc-500 dark:text-zinc-400">
                    Nenhum serviço inventariado ainda. Marque um host como alvo de deploy na página dele e espere o
                    próximo ciclo do agente.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}
