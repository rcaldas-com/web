import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAdmin } from '@/lib/auth';
import { getService } from '@/lib/services';
import { setServiceAction } from '@/lib/actions/services';
import { triggerBuildAction, promoteBuildAction } from '@/lib/actions/builds';
import { listBuilds, hasRunningBuild } from '@/lib/builds';
import { pickBuildWorker } from '@/lib/monitor';
import { promoteConfigurado } from '@/lib/promote';
import SubmitButton from '@/components/SubmitButton';

function formatDate(value?: string) {
  if (!value) return 'nunca';
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'medium',
    timeZone: 'America/Sao_Paulo',
  }).format(new Date(value));
}

function field(label: string, value: React.ReactNode) {
  if (value == null) return null;
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{label}</div>
      <div className="mt-1 text-sm text-zinc-900 dark:text-zinc-100">{value}</div>
    </div>
  );
}

const input =
  'w-full rounded border border-zinc-200 bg-white px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-950';

export default async function ServicoPage({ params }: { params: Promise<{ name: string }> }) {
  await requireAdmin();
  const { name } = await params;
  const svc = await getService(name);
  if (!svc) notFound();

  const src = svc.source;
  const dep = svc.deployment;
  // Pipeline so existe pra quem tem artefato que alguem publica. Serviço
  // 'managed'/'external' nao tem o que promover -- e dizer isso na tela e
  // melhor que mostrar um botao morto.
  const temPipeline = src?.kind === 'build' || src?.kind === 'upstream';

  // Só busca o que a seção de builds usa, e só quando ela vai aparecer.
  const [builds, emAndamento, workerDisponivel] =
    src?.kind === 'build'
      ? await Promise.all([listBuilds(svc.name), hasRunningBuild(svc.name), pickBuildWorker().then(Boolean)])
      : [[], false, false];

  // "Em producao" e a tag DECLARADA no compose, nao a que esta rodando: e'
  // o que o git manda subir. Se as duas divergirem, a secao de deriva la
  // em cima ja avisa -- sao dois problemas diferentes.
  const tagEmProducao = svc.observed?.declaredImage?.split(':').pop();
  const promoverDisponivel = promoteConfigurado();

  return (
    <main className="min-h-screen bg-zinc-100 dark:bg-zinc-950">
      <div className="mx-auto max-w-3xl p-6">
        <div className="mb-6 flex items-center gap-3">
          <Link href="/monitor/servicos" className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
            &larr; Serviços
          </Link>
        </div>

        <div className="mb-6 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold text-zinc-950 dark:text-zinc-50">{svc.name}</h1>
          {svc.drift && (
            <span className="rounded-full bg-amber-100 px-2 py-1 text-xs text-amber-700 dark:bg-amber-950 dark:text-amber-300">
              deriva
            </span>
          )}
          {svc.url && (
            <a href={svc.url} target="_blank" rel="noreferrer" className="text-sm text-zinc-500 underline">
              {svc.url}
            </a>
          )}
        </div>

        <section className="mb-6 grid grid-cols-2 gap-4 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900 sm:grid-cols-3">
          {field('Imagem declarada', svc.observed?.declaredImage)}
          {field('Imagem rodando', svc.observed?.runningImage)}
          {field('Estado', svc.observed?.state)}
          {field('Host', dep?.kind === 'compose' || dep?.kind === 'systemd' ? dep.host : undefined)}
          {field('Projeto', dep?.kind === 'compose' ? dep.project : undefined)}
          {field('Inventariado', formatDate(svc.observed?.seenAt))}
          {field('Log', svc.logPath)}
        </section>

        {svc.drift && (
          <section className="mb-6 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
            O compose declara <code>{svc.observed?.declaredImage}</code>, mas o container está rodando{' '}
            <code>{svc.observed?.runningImage}</code>. O arquivo mudou e ninguém rodou <code>up -d</code>.
          </section>
        )}

        <section className="mb-6 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="mb-1 font-semibold text-zinc-950 dark:text-zinc-50">Cadastro</h2>
          <p className="mb-3 text-xs text-zinc-500 dark:text-zinc-400">
            Imagem, host e estado vêm do host e não se editam aqui. O que segue é o que a máquina não tem como saber.
          </p>

          <form action={setServiceAction} className="space-y-4">
            <input type="hidden" name="name" value={svc.name} />

            <label className="flex flex-col gap-1">
              <span className="text-xs text-zinc-500 dark:text-zinc-400">Quem produz o artefato</span>
              <select name="sourceKind" defaultValue={src?.kind ?? 'upstream'} className={input}>
                <option value="build">build — nós buildamos a partir de um repo nosso</option>
                <option value="upstream">upstream — imagem pública fixada</option>
                <option value="managed">managed — não tem imagem (systemd, config)</option>
                <option value="external">external — serviço de terceiro</option>
              </select>
            </label>

            {/* Todos os campos de todos os kinds ficam na tela. A action so
                lê os do kind escolhido, e sem JS a alternativa seria um
                segundo passo de formulário -- pior pra um cadastro que se
                mexe uma vez por serviço. */}
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1">
                <span className="text-xs text-zinc-500 dark:text-zinc-400">build: repo</span>
                <input name="repo" defaultValue={src?.kind === 'build' ? src.repo : ''} placeholder="web" className={input} />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-zinc-500 dark:text-zinc-400">build: ref (vazio = main)</span>
                <input name="ref" defaultValue={src?.kind === 'build' ? (src.ref ?? '') : ''} className={input} />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-zinc-500 dark:text-zinc-400">build: contexto</span>
                <input name="context" defaultValue={src?.kind === 'build' ? (src.context ?? '') : ''} className={input} />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-zinc-500 dark:text-zinc-400">upstream: imagem (sem tag)</span>
                <input name="image" defaultValue={src?.kind === 'upstream' ? src.image : ''} placeholder="mongo" className={input} />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-zinc-500 dark:text-zinc-400">managed: unit</span>
                <input name="unit" defaultValue={src?.kind === 'managed' ? (src.unit ?? '') : ''} placeholder="haproxy.service" className={input} />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-zinc-500 dark:text-zinc-400">managed: config</span>
                <input name="configPath" defaultValue={src?.kind === 'managed' ? (src.configPath ?? '') : ''} className={input} />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-zinc-500 dark:text-zinc-400">Caminho do log</span>
                <input name="logPath" defaultValue={svc.logPath ?? ''} placeholder="/var/log/remote/us/web.log" className={input} />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-zinc-500 dark:text-zinc-400">URL pública</span>
                <input name="url" defaultValue={svc.url ?? ''} placeholder="https://web.rcaldas.com" className={input} />
              </label>
            </div>

            <label className="flex w-fit items-center gap-2">
              <input
                type="checkbox"
                name="autoPromote"
                // Sem pipeline, nunca marcada -- mesmo que o banco tenha
                // true de quando o servico era 'build'. Caixa marcada e
                // desabilitada diria "ligado" sobre algo que nao se aplica
                // e que o proximo save vai desligar de qualquer forma
                // (checkbox desabilitado nao e' enviado pelo navegador).
                defaultChecked={temPipeline && (svc.autoPromote ?? false)}
                disabled={!temPipeline}
                className="h-4 w-4 rounded border-zinc-300 disabled:opacity-40 dark:border-zinc-700"
              />
              <span className={`text-sm ${temPipeline ? 'text-zinc-700 dark:text-zinc-300' : 'text-zinc-400 dark:text-zinc-600'}`}>
                Promover automaticamente {temPipeline ? '' : '(só para build/upstream)'}
              </span>
            </label>

            <SubmitButton className="rounded-full bg-zinc-900 px-3 py-1 text-xs text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300">
              salvar
            </SubmitButton>
          </form>
        </section>

        {temPipeline && src?.kind === 'build' && (
          <section className="mb-6 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <h2 className="font-semibold text-zinc-950 dark:text-zinc-50">Builds</h2>
              <form action={triggerBuildAction} className="flex items-center gap-3">
                <input type="hidden" name="service" value={svc.name} />
                <SubmitButton
                  className="rounded-full bg-zinc-900 px-3 py-1 text-xs text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
                >
                  {emAndamento ? 'build em andamento...' : 'buildar agora'}
                </SubmitButton>
              </form>
            </div>

            {!promoverDisponivel && (
              <p className="mb-3 rounded bg-amber-50 p-2 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                Promoção indisponível: falta <code>GITHUB_TOKEN</code> no <code>.env</code> do servidor. Build funciona
                normalmente — o que não dá é escrever a tag no repo. O token precisa de escrita só em{' '}
                <code>rcaldas-com/dev</code>.
              </p>
            )}

            {!workerDisponivel && (
              <p className="mb-3 rounded bg-amber-50 p-2 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                Nenhum worker disponível: marque um host como worker de build e confirme que ele está com heartbeat
                recente. O <code>us</code> não serve — é produção e não tem folga de memória.
              </p>
            )}

            <div className="divide-y divide-zinc-100 text-sm dark:divide-zinc-800">
              {builds.map((b) => (
                <div key={b._id} className="flex flex-wrap items-center justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <span
                      className={`mr-2 rounded-full px-2 py-0.5 text-xs ${
                        b.status === 'ok'
                          ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                          : b.status === 'fail'
                            ? 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300'
                            : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300'
                      }`}
                    >
                      {b.status}
                    </span>
                    <span className="font-mono text-xs text-zinc-700 dark:text-zinc-300">{b.tag ?? b.sha?.slice(0, 7) ?? '—'}</span>
                    {b.message && <span className="ml-2 text-xs text-zinc-500 dark:text-zinc-400">{b.message}</span>}
                  </div>
                  <div className="flex items-center gap-3 text-xs text-zinc-500 dark:text-zinc-400">
                    {b.status === 'ok' && b.tag && b.tag !== tagEmProducao && (
                      <form action={promoteBuildAction}>
                        <input type="hidden" name="service" value={svc.name} />
                        <input type="hidden" name="tag" value={b.tag} />
                        <SubmitButton className="rounded-full bg-zinc-900 px-2 py-1 text-xs text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300">
                          promover
                        </SubmitButton>
                      </form>
                    )}
                    {b.tag && b.tag === tagEmProducao && (
                      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                        em produção
                      </span>
                    )}
                    <span>{b.worker}</span>
                    {b.durationMs != null && <span>{Math.round(b.durationMs / 1000)}s</span>}
                    <span>{formatDate(b.startedAt)}</span>
                  </div>
                </div>
              ))}
              {!builds.length && (
                <p className="py-2 text-xs text-zinc-500 dark:text-zinc-400">Nenhum build ainda.</p>
              )}
            </div>
          </section>
        )}

        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Promover escreve a tag no <code>docker-compose.prod.yml</code> e commita — o container só muda quando o host
          reconciliar. Ver <code>CICD.md</code>.
        </p>
      </div>
    </main>
  );
}
