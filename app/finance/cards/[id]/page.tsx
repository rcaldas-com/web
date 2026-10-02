import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getSessionUserId } from '@/lib/auth';
import { getCards, getInstallments, getMonthData, getOrInitMonthCardInvoices } from '@/lib/finance/data';
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
export default async function CardInvoicePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ fatura?: string }>;
}) {
  const { id } = await params;
  const { fatura } = await searchParams;
  const userId = await getSessionUserId();
  // Convidado não tem essa página: o dado vive só no navegador (localStorage),
  // sem nada pra este Server Component ler.
  if (!userId) redirect('/finance/cards');

  const [cards, installments] = await Promise.all([getCards(userId), getInstallments(userId)]);
  const card = cards.find((c) => c._id === id);
  if (!card) notFound();

  // Duas faturas navegáveis:
  //   aberta  (offset 1) -- vence no mês que vem, ainda recebendo lançamento
  //   fechada (offset 0) -- vence neste mês, a que se compara com o banco
  // A fatura do mês M se compõe de: parcelas com fôlego até M (mesmo filtro
  // `remainingInstallments > offset` do buildCardViews) + pagamentos feitos
  // em M-1 direto no cartão -- é assim que eles entram na fatura seguinte
  // (ver adjustCardExpenseInMonth).
  //
  // Meses anteriores ao corrente NÃO são oferecidos: a virada do mês APAGA
  // a parcela que terminou (rollOverMonth), então setembro já perdeu as que
  // acabaram nele. Mostrar seria uma fatura incompleta com cara de certa.
  const offset = fatura === 'fechada' ? 0 : 1;
  const currentYearMonth = getFinanceToday().yearMonth;
  const invoiceYearMonth = addMonthsToYearMonth(currentYearMonth, offset);
  const paymentsYearMonth = addMonthsToYearMonth(invoiceYearMonth, -1);

  const [monthData, invoices] = await Promise.all([
    getMonthData(userId, paymentsYearMonth),
    getOrInitMonthCardInvoices(userId, invoiceYearMonth, cards, installments, offset),
  ]);
  const directPayments = (monthData?.payments ?? []).filter((p) => p.paidToCard === id);
  const activeInstallments = installments.filter((i) => i.cardId === id && i.remainingInstallments > offset);
  // O que o app tem registrado pra essa fatura (pode ter sido editado à
  // mão, ou ter ajuste que não veio de pagamento). Se não bater com a soma
  // das linhas, a diferença aparece -- é exatamente o que se procura ao
  // comparar com o banco.
  const registrada = invoices.find((inv) => inv.cardId === id);

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
      detail: `faltam ${i.remainingInstallments - offset}`,
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
  const totalLinhas = totalParcelas + totalDireto;
  const diferenca = registrada ? Math.round((registrada.invoiceTotal - totalLinhas) * 100) / 100 : 0;

  const aba = (valor: 'fechada' | 'aberta', ym: string) => {
    const ativa = (valor === 'fechada') === (offset === 0);
    return (
      <Link
        href={`/finance/cards/${id}?fatura=${valor}`}
        className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${
          ativa
            ? 'border-zinc-900 text-zinc-900 dark:border-zinc-100 dark:text-zinc-100'
            : 'border-transparent text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100'
        }`}
      >
        {valor === 'fechada' ? 'Fechada' : 'Aberta'} · vence {monthLabelPtBr(ym)}
      </Link>
    );
  };

  return (
    <div className="max-w-[1100px] mx-auto bg-white min-h-screen flex flex-col border-l border-r border-zinc-200 dark:border-zinc-700 dark:bg-zinc-900">
      <div className="p-4 sm:p-6 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <Link href="/finance/cards" className="text-sm text-blue-600 hover:underline">
              ← Cartões
            </Link>
            <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
              {card.name}{' '}
              <span className="text-zinc-400 font-normal">· fatura {monthLabelPtBr(invoiceYearMonth)}</span>
              {registrada?.paid && (
                <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 align-middle text-xs font-normal text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                  paga
                </span>
              )}
            </h1>
          </div>
          <div className="text-right">
            <p className="text-xs text-zinc-500 dark:text-zinc-400">Total</p>
            <p className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">{BRL(totalLinhas)}</p>
          </div>
        </div>

        <nav className="flex gap-2 border-b border-zinc-200 dark:border-zinc-800">
          {aba('fechada', currentYearMonth)}
          {aba('aberta', addMonthsToYearMonth(currentYearMonth, 1))}
        </nav>

        {Math.abs(diferenca) > 0.005 && (
          <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300">
            O app tem {BRL(registrada!.invoiceTotal)} registrado pra esta fatura -- {BRL(Math.abs(diferenca))}{' '}
            {diferenca > 0 ? 'a mais' : 'a menos'} que a soma das linhas abaixo. Costuma ser valor editado à mão ou
            lançamento que não passou por pagamento de despesa.
          </p>
        )}

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
