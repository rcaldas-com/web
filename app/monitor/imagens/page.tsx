import Link from 'next/link';
import { requireAdminPage } from '@/lib/auth';
import { listImageChecks, listStaleApps } from '@/lib/images';
import {
  applyImagesAction,
  checkImagesNowAction,
  rebuildAppAction,
  updateAllAction,
} from '@/lib/actions/images';
import SubmitButton from '@/components/SubmitButton';
import ConfirmSubmit from '@/components/ConfirmSubmit';

function formatDate(value?: string) {
  if (!value) return 'nunca';
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'America/Sao_Paulo',
  }).format(new Date(value));
}

const BADGE: Record<string, string> = {
  ok: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
  atualizar: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  desconhecido: 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400',
  local: 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400',
  'sem-container': 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400',
};
const ROTULO: Record<string, string> = {
  ok: 'em dia',
  atualizar: 'versão nova',
  desconhecido: 'não verificável',
  local: 'imagem local',
  'sem-container': 'sem container',
};

const btn =
  'rounded-full bg-zinc-900 px-3 py-1 text-xs text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300';
const btnLeve =
  'rounded-full bg-zinc-100 px-3 py-1 text-xs text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700';

export default async function ImagensPage() {
  await requireAdminPage('/monitor/imagens');
  const [hosts, apps] = await Promise.all([listImageChecks(), listStaleApps()]);

  const hostsComNova = hosts.filter((h) => h.images.some((i) => i.status === 'atualizar'));
  const appsComBaseNova = apps.filter((a) => a.stale.length);
  const algoPendente = hostsComNova.length > 0 || appsComBaseNova.length > 0;

  return (
    <main className="min-h-screen bg-zinc-100 dark:bg-zinc-950">
      <div className="mx-auto max-w-5xl p-6">
        <div className="mb-6 flex items-center gap-3">
          <Link href="/monitor" className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
            &larr; Monitor
          </Link>
        </div>

        <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="mb-1 text-2xl font-bold text-zinc-950 dark:text-zinc-50">Atualização de imagens</h1>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              Verificado a cada 6h em cada host, sem baixar nada (compara o digest remoto). Versão nova abre incidente
              com email.
            </p>
          </div>
          {algoPendente && (
            <form action={updateAllAction}>
              <ConfirmSubmit
                message={`Atualizar tudo?\n\n${hostsComNova.length} host(s) recriam os containers com imagem nova (o banco e o Mailu podem ficar alguns segundos fora) e ${appsComBaseNova.length} app(s) são rebuildados e promovidos.`}
                className={btn}
              >
                atualizar tudo
              </ConfirmSubmit>
            </form>
          )}
        </div>

        <section className="mb-6 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="mb-1 font-semibold text-zinc-950 dark:text-zinc-50">Nossos apps — imagem base</h2>
          <p className="mb-3 text-xs text-zinc-500 dark:text-zinc-400">
            Base (FROM) do build que está em produção comparada com a versão atual da mesma tag. Rebuild usa o mesmo
            commit com tag nova (<code>&lt;sha&gt;-b&lt;data&gt;</code>) e segue a promoção normal.
          </p>
          <div className="divide-y divide-zinc-100 text-sm dark:divide-zinc-800">
            {apps.map((a) => (
              <div key={a.service} className="flex flex-wrap items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <Link href={`/monitor/servicos/${a.service}`} className="font-medium hover:underline">
                    {a.service}
                  </Link>
                  <span className="ml-2 font-mono text-xs text-zinc-500">{a.tag ?? '—'}</span>
                  <div className="text-xs text-zinc-500 dark:text-zinc-400">
                    {!a.hasBases
                      ? 'build em produção é anterior ao registro das bases — rebuild passa a registrar'
                      : a.stale.length
                        ? a.stale.map((s) => `${s.ref}: base nova`).join(' · ')
                        : 'base em dia'}
                  </div>
                </div>
                <form action={rebuildAppAction}>
                  <input type="hidden" name="service" value={a.service} />
                  <SubmitButton className={a.stale.length ? btn : btnLeve}>rebuildar</SubmitButton>
                </form>
              </div>
            ))}
          </div>
        </section>

        {hosts.map((h) => {
          const novas = h.images.filter((i) => i.status === 'atualizar');
          const projetosComNova = [...new Set(novas.map((i) => i.project))];
          return (
            <section
              key={h.host}
              className="mb-6 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
            >
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="font-semibold text-zinc-950 dark:text-zinc-50">
                    {h.host}
                    {novas.length > 0 && (
                      <span className={`ml-2 rounded-full px-2 py-0.5 text-xs ${BADGE.atualizar}`}>
                        {novas.length} com versão nova
                      </span>
                    )}
                  </h2>
                  <div className="text-xs text-zinc-500 dark:text-zinc-400">
                    verificado {formatDate(h.checkedAt)}
                    {h.pending.length > 0 && ` · na fila: ${h.pending.join(', ')}`}
                    {h.lastApply &&
                      ` · última aplicação ${formatDate(h.lastApply.at)} (${h.lastApply.status === 'done' ? 'ok' : 'FALHOU'}): ${h.lastApply.result ?? ''}`}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <form action={checkImagesNowAction}>
                    <input type="hidden" name="host" value={h.host} />
                    <SubmitButton className={btnLeve}>verificar agora</SubmitButton>
                  </form>
                  {novas.length > 0 && (
                    <form action={applyImagesAction}>
                      <input type="hidden" name="host" value={h.host} />
                      <ConfirmSubmit
                        message={`Aplicar em ${h.host}?\n\nRecria: ${novas.map((i) => `${i.project}/${i.service}`).join(', ')}.\nCada um fica alguns segundos fora.`}
                        className={btn}
                      >
                        aplicar em {h.host}
                      </ConfirmSubmit>
                    </form>
                  )}
                </div>
              </div>

              <table className="w-full text-left text-sm">
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {h.images.map((i) => (
                    <tr key={`${i.project}/${i.service}`} className="text-zinc-700 dark:text-zinc-300">
                      <td className="py-1.5 pr-3 text-xs text-zinc-500">{i.project}</td>
                      <td className="py-1.5 pr-3">{i.service}</td>
                      <td className="py-1.5 pr-3 font-mono text-xs">{i.image}</td>
                      <td className="py-1.5 pr-3">
                        <span className={`rounded-full px-2 py-0.5 text-xs ${BADGE[i.status] ?? BADGE.desconhecido}`}>
                          {ROTULO[i.status] ?? i.status}
                        </span>
                        {i.fixed && i.status === 'ok' && (
                          <span className="ml-2 text-xs text-zinc-400" title="Versão nova exige trocar a tag no compose">
                            tag fixa
                          </span>
                        )}
                      </td>
                      <td className="py-1.5 text-right">
                        {i.status === 'atualizar' && projetosComNova.length > 1 && (
                          <form action={applyImagesAction} className="inline">
                            <input type="hidden" name="host" value={h.host} />
                            <input type="hidden" name="project" value={i.project} />
                            <SubmitButton className={btnLeve}>só {i.project}</SubmitButton>
                          </form>
                        )}
                      </td>
                    </tr>
                  ))}
                  {!h.images.length && (
                    <tr>
                      <td className="py-2 text-xs text-zinc-500">Ainda não verificado.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </section>
          );
        })}
      </div>
    </main>
  );
}
