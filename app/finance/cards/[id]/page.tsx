import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getSessionUserId } from '@/lib/auth';
import { getCards, getInstallments, getMonthData } from '@/lib/finance/data';
import { addMonthsToYearMonth, getFinanceToday, monthLabelPtBr } from '@/lib/finance/date';

const BRL = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

function formatDay(d: Date) {
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo' }).format(
    new Date(d)
  );
}

type Entrada = {
  date: Date;
  description: string;
  amount: number;
  kind: 'parcela' | 'direto';
  detail?: string;
};

// Fatura detalhada de um cartão, pra comparar entrada a entrada com o app
// do banco -- que lista do lançamento mais novo pro mais antigo, parcelas
// incluídas. O resumo em /finance/cards só mostra "parcelas" (soma) e
// "extras" (soma); aqui é o que compõe cada uma dessas somas.
export default async function CardInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const userId = await getSessionUserId();
  // Convidado não tem essa página: o dado vive só no navegador (localStorage),
  // sem nada pra este Server Component ler.
  if (!userId) redirect('/finance/cards');

  const [cards, installments] = await Promise.all([getCards(userId), getInstallments(userId)]);
  const card = cards.find((c) => c._id === id);
  if (!card) notFound();

  // A fatura mostrada em /finance/cards é sempre a do PRÓXIMO mês (a que
  // ainda vai fechar). O que a compõe: parcelas com fôlego pra sobreviver
  // mais um mês (mesmo offset=1 que buildCardViews usa), e os pagamentos
  // feitos NESTE mês direto no cartão (paidToCard) -- é assim que eles
  // entram na fatura seguinte (ver adjustCardExpenseInMonth).
  const nextYearMonth = addMonthsToYearMonth(getFinanceToday().yearMonth, 1);
  const currentYearMonth = getFinanceToday().yearMonth;

  const monthData = await getMonthData(userId, currentYearMonth);
  const directPayments = (monthData?.payments ?? []).filter((p) => p.paidToCard === id);
  const activeInstallments = installments.filter((i) => i.cardId === id && i.remainingInstallments > 1);

  // Parcela não tem uma "data deste mês" -- é recorrente, o valor que muda
  // é quantas ainda faltam. A data de compra original (createdAt) é o que
  // o próprio banco reimprime todo mês na fatura, então intercalar por ela
  // reproduz a mesma ordem que o app do banco mostra.
  const entradas: Entrada[] = [
    ...activeInstallments.map((i) => ({
      date: i.createdAt,
      description: i.description,
      amount: i.monthlyValue,
      kind: 'parcela' as const,
      detail: `faltam ${i.remainingInstallments - 1}`,
    })),
    ...directPayments.map((p) => ({
      date: p.paidAt,
      description: p.expenseName,
      amount: p.amountPaid,
      kind: 'direto' as const,
    })),
  ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  const totalParcelas = activeInstallments.reduce((s, i) => s + i.monthlyValue, 0);
  const totalDireto = directPayments.reduce((s, p) => s + p.amountPaid, 0);

  return (
    <div className="max-w-[1100px] mx-auto bg-white min-h-screen flex flex-col border-l border-r border-zinc-200 dark:border-zinc-700 dark:bg-zinc-900">
      <div className="p-4 sm:p-6 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <Link href="/finance/cards" className="text-sm text-blue-600 hover:underline">
              ← Cartões
            </Link>
            <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
              {card.name} <span className="text-zinc-400 font-normal">· fatura {monthLabelPtBr(nextYearMonth)}</span>
            </h1>
          </div>
          <div className="text-right">
            <p className="text-xs text-zinc-500 dark:text-zinc-400">Total</p>
            <p className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">{BRL(totalParcelas + totalDireto)}</p>
          </div>
        </div>

        <p className="text-xs text-zinc-400 dark:text-zinc-500">
          Ordem do lançamento mais novo pro mais antigo, igual ao extrato do banco -- pra comparar linha a linha.
        </p>

        {entradas.length === 0 ? (
          <p className="rounded-lg border border-zinc-200 bg-white p-6 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
            Nenhum lançamento nesta fatura ainda.
          </p>
        ) : (
          <div className="overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800">
            <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {entradas.map((e, i) => (
                <li key={i} className="flex items-center justify-between gap-3 p-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="w-11 shrink-0 text-xs text-zinc-400 dark:text-zinc-500">{formatDay(e.date)}</span>
                    <div className="min-w-0">
                      <p className="truncate text-sm text-zinc-800 dark:text-zinc-100">{e.description}</p>
                      {e.kind === 'parcela' && (
                        <p className="text-xs text-zinc-400 dark:text-zinc-500">parcela · {e.detail}</p>
                      )}
                    </div>
                  </div>
                  <span className="shrink-0 font-mono text-sm text-zinc-700 dark:text-zinc-200">{BRL(e.amount)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex justify-between gap-4 rounded-lg border border-zinc-200 bg-zinc-50 p-4 text-sm dark:border-zinc-800 dark:bg-zinc-900/60">
          <div>
            <span className="text-zinc-500 dark:text-zinc-400">Parcelas: </span>
            <span className="font-mono text-zinc-800 dark:text-zinc-100">{BRL(totalParcelas)}</span>
          </div>
          <div>
            <span className="text-zinc-500 dark:text-zinc-400">Direto no cartão: </span>
            <span className="font-mono text-zinc-800 dark:text-zinc-100">{BRL(totalDireto)}</span>
          </div>
          <div>
            <span className="text-zinc-500 dark:text-zinc-400">Total: </span>
            <span className="font-mono font-semibold text-zinc-900 dark:text-zinc-50">{BRL(totalParcelas + totalDireto)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
