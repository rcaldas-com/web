import Link from 'next/link';
import { getSessionUserId } from '@/lib/auth';
import { getJournal, type JournalChange, type JournalEntity, type JournalSource } from '@/lib/finance/journal';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 100;

const money = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const ENTITY_LABEL: Record<JournalEntity, string> = {
  profile: 'Perfil',
  card: 'Cartão',
  expense: 'Despesa',
  installment: 'Parcela',
  month: 'Mês',
};

const ACTION_LABEL: Record<'create' | 'update' | 'delete', string> = {
  create: 'Criou',
  update: 'Alterou',
  delete: 'Removeu',
};

const SOURCE_LABEL: Partial<Record<JournalSource, string>> = {
  derived: 'automático',
  rollover: 'rollover',
  migration: 'importação',
};

function formatValue(value: unknown, kind: JournalChange['kind']): string {
  if (value === null || value === undefined || value === '') return '—';
  if (kind === 'money' && typeof value === 'number') return money(value);
  if (kind === 'bool') return value ? 'Sim' : 'Não';
  return String(value);
}

function formatDateTime(d: Date): string {
  return new Date(d).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo',
  });
}

function dayKey(d: Date): string {
  return new Date(d).toLocaleDateString('pt-BR', {
    weekday: 'long', day: '2-digit', month: 'long', year: 'numeric', timeZone: 'America/Sao_Paulo',
  });
}

const ENTITY_FILTERS: { value: JournalEntity | 'all'; label: string }[] = [
  { value: 'all', label: 'Tudo' },
  { value: 'card', label: 'Cartões' },
  { value: 'expense', label: 'Despesas' },
  { value: 'installment', label: 'Parcelas' },
  { value: 'profile', label: 'Perfil' },
];

export default async function FinanceHistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ entity?: string; auto?: string; page?: string }>;
}) {
  const userId = await getSessionUserId();
  if (!userId) {
    return (
      <main className="mx-auto w-full max-w-3xl px-5 py-10">
        <p className="text-zinc-500 dark:text-zinc-400">
          Faça <Link href="/login" className="text-blue-600 hover:underline">login</Link> para ver o histórico.
        </p>
      </main>
    );
  }

  const params = await searchParams;
  const entity = ENTITY_FILTERS.some((f) => f.value === params.entity)
    ? (params.entity as JournalEntity | 'all')
    : 'all';
  const showAuto = params.auto === '1';
  const page = Math.max(0, parseInt(params.page ?? '0') || 0);

  const entries = await getJournal(userId, {
    entity: entity === 'all' ? undefined : entity,
    source: showAuto ? undefined : 'user',
    limit: PAGE_SIZE + 1,
    skip: page * PAGE_SIZE,
  });
  const hasMore = entries.length > PAGE_SIZE;
  const shown = entries.slice(0, PAGE_SIZE);

  // Agrupa por dia pra leitura.
  const groups: { day: string; items: typeof shown }[] = [];
  for (const e of shown) {
    const day = dayKey(e.at);
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.items.push(e);
    else groups.push({ day, items: [e] });
  }

  const qs = (over: Record<string, string | number | undefined>) => {
    const sp = new URLSearchParams();
    const merged = { entity: entity === 'all' ? undefined : entity, auto: showAuto ? '1' : undefined, page: page || undefined, ...over };
    for (const [k, v] of Object.entries(merged)) if (v !== undefined && v !== '') sp.set(k, String(v));
    const s = sp.toString();
    return s ? `?${s}` : '';
  };

  return (
    <main className="mx-auto w-full max-w-3xl px-5 py-8 space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-zinc-950 dark:text-zinc-50">Histórico</h1>
        <Link href="/finance" className="text-sm text-blue-600 hover:underline">← Voltar</Link>
      </div>
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        Registro de alterações — valor anterior e novo de cada mudança em despesas, cartões, parcelas e perfil.
      </p>

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-2">
        {ENTITY_FILTERS.map((f) => (
          <Link
            key={f.value}
            href={`/finance/history${qs({ entity: f.value === 'all' ? undefined : f.value, page: undefined })}`}
            className={`rounded-full px-3 py-1 text-sm transition ${
              entity === f.value
                ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-950'
                : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700'
            }`}
          >
            {f.label}
          </Link>
        ))}
        <Link
          href={`/finance/history${qs({ auto: showAuto ? undefined : '1', page: undefined })}`}
          className={`ml-auto rounded-full px-3 py-1 text-sm transition ${
            showAuto
              ? 'bg-blue-600 text-white'
              : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700'
          }`}
        >
          {showAuto ? 'Ocultar automáticos' : 'Mostrar automáticos'}
        </Link>
      </div>

      {shown.length === 0 ? (
        <p className="rounded-lg border border-zinc-200 bg-white p-6 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
          Nenhuma alteração registrada ainda.
        </p>
      ) : (
        <div className="space-y-5">
          {groups.map((g) => (
            <section key={g.day}>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
                {g.day}
              </h2>
              <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
                <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {g.items.map((e) => (
                    <li key={e._id} className="p-4">
                      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                        <span className="text-sm font-medium text-zinc-800 dark:text-zinc-100">
                          {ACTION_LABEL[e.action]} · {ENTITY_LABEL[e.entity]}
                          {e.entityLabel ? `: ${e.entityLabel}` : ''}
                        </span>
                        {e.yearMonth && (
                          <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                            {e.yearMonth}
                          </span>
                        )}
                        {SOURCE_LABEL[e.source] && (
                          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-700 dark:bg-amber-950 dark:text-amber-300">
                            {SOURCE_LABEL[e.source]}
                          </span>
                        )}
                        {e.actorUserId && e.actorUserId !== e.userId && (
                          <span className="rounded bg-purple-100 px-1.5 py-0.5 text-xs text-purple-700 dark:bg-purple-950 dark:text-purple-300">
                            via admin
                          </span>
                        )}
                        <span className="ml-auto text-xs text-zinc-400 dark:text-zinc-500">{formatDateTime(e.at)}</span>
                      </div>

                      <div className="mt-1.5 space-y-1">
                        {e.changes.map((c, i) => (
                          <div key={i} className="text-sm text-zinc-600 dark:text-zinc-300">
                            <span className="text-zinc-400 dark:text-zinc-500">{c.label}:</span>{' '}
                            <span className="text-zinc-500 line-through decoration-zinc-300 dark:decoration-zinc-600">
                              {formatValue(c.before, c.kind)}
                            </span>
                            <span className="mx-1 text-zinc-400">→</span>
                            <span className="font-medium text-zinc-800 dark:text-zinc-100">
                              {formatValue(c.after, c.kind)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          ))}
        </div>
      )}

      {/* Paginação */}
      {(page > 0 || hasMore) && (
        <div className="flex items-center justify-between pt-2">
          {page > 0 ? (
            <Link href={`/finance/history${qs({ page: page - 1 || undefined })}`} className="text-sm text-blue-600 hover:underline">
              ← Mais recentes
            </Link>
          ) : <span />}
          {hasMore ? (
            <Link href={`/finance/history${qs({ page: page + 1 })}`} className="text-sm text-blue-600 hover:underline">
              Mais antigas →
            </Link>
          ) : <span />}
        </div>
      )}
    </main>
  );
}
