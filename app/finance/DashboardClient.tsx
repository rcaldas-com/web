'use client';

import { useTransition } from 'react';
import Link from 'next/link';
import { togglePaid } from '@/lib/finance/actions';
import type { InstallmentGroup, CardView, BankAccount } from '@/lib/finance/types';

const BRL = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

interface ExpenseItem {
  id: string;
  name: string;
  value: number;
  dueDay?: number;
  proportional: false | 'daily' | 'weekly';
  paid: boolean;
}

interface Props {
  yearMonth: string;
  daysInMonth: number;
  dayOfMonth: number;
  isCurrentMonth: boolean;
  prevMonth: string;
  nextMonth: string;
  profile: {
    salary: { payment: number; advance: number; paymentDay: number; advanceDay: number };
    foodVoucher: number;
    banks: BankAccount[];
  };
  cardExpenses: ExpenseItem[];
  cashExpenses: ExpenseItem[];
  installmentGroups: InstallmentGroup[];
  cardViews: CardView[];
  monthBalance: number;
  totalBalance: number;
  bankTotal: number;
  invoiceExtras: number;
  projections: { label: string; value: number }[];
  totals: {
    salary: number;
    vr: number;
    cardExpensesTotal: number;
    cashExpensesTotal: number;
    installmentsTotal: number;
  };
}

export default function DashboardClient({
  yearMonth,
  daysInMonth,
  dayOfMonth,
  isCurrentMonth,
  prevMonth,
  nextMonth,
  profile,
  cardExpenses,
  cashExpenses,
  installmentGroups,
  cardViews,
  monthBalance,
  totalBalance,
  bankTotal,
  invoiceExtras,
  projections,
  totals,
}: Props) {
  const monthLabel = new Date(yearMonth + '-01').toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });

  const paidCashTotal = cashExpenses.filter(e => e.paid).reduce((s, e) => s + e.value, 0);
  const paidCardTotal = cardExpenses.filter(e => e.paid).reduce((s, e) => s + e.value, 0);

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
      {/* Header with month navigation */}
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-3">
          <Link href={`/finance?month=${prevMonth}`}
            className="text-zinc-400 hover:text-zinc-700 text-xl px-2">←</Link>
          <h1 className="text-2xl font-bold capitalize">{monthLabel}</h1>
          <Link href={`/finance?month=${nextMonth}`}
            className="text-zinc-400 hover:text-zinc-700 text-xl px-2">→</Link>
          {!isCurrentMonth && (
            <Link href="/finance" className="text-xs text-blue-600 hover:underline ml-2">Hoje</Link>
          )}
        </div>
        <div className="flex gap-2">
          <Link href="/finance/cards" className="text-sm text-blue-600 hover:underline">Cartões</Link>
          <Link href="/finance/setup/profile" className="text-sm text-zinc-500 hover:underline">Configurar</Link>
        </div>
      </div>

      {/* Total dinâmico */}
      <div className={`rounded-lg p-6 text-center ${totalBalance >= 0 ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}`}>
        <p className="text-sm text-zinc-500">{isCurrentMonth ? `Saldo Disponível (dia ${dayOfMonth})` : 'Saldo Projetado'}</p>
        <p className={`text-3xl font-bold ${totalBalance >= 0 ? 'text-green-700' : 'text-red-700'}`}>
          {BRL(totalBalance)}
        </p>
        <p className="text-xs text-zinc-400 mt-1">
          Saldo bancos: {BRL(bankTotal)}
          {paidCashTotal > 0 && <> · Pago à vista: {BRL(paidCashTotal)}</>}
        </p>
      </div>

      {/* Resumo do mês */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <SummaryCard label="Salário" value={totals.salary} />
        <SummaryCard label="VR/VA" value={totals.vr} />
        <SummaryCard label="Desp. Cartão" value={-totals.cardExpensesTotal} negative />
        <SummaryCard label="Desp. À Vista" value={-totals.cashExpensesTotal} negative />
        <SummaryCard label="Parcelas" value={-totals.installmentsTotal} negative />
        <SummaryCard
          label="Saldo Mês"
          value={monthBalance}
          highlight
        />
      </div>

      {/* Despesas do mês - checklist */}
      <ExpenseChecklist
        title="Despesas À Vista"
        expenses={cashExpenses}
        yearMonth={yearMonth}
        daysInMonth={daysInMonth}
      />

      <ExpenseChecklist
        title="Despesas Cartão"
        expenses={cardExpenses}
        yearMonth={yearMonth}
        daysInMonth={daysInMonth}
      />

      {/* Parcelas */}
      {installmentGroups.length > 0 && (
        <div className="bg-white rounded-lg border p-4">
          <h3 className="font-semibold text-zinc-700 mb-2">Parcelas</h3>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-zinc-500 border-b">
                <th className="pb-1">Grupo</th>
                <th className="pb-1">Itens</th>
                <th className="pb-1 text-right">Valor/mês</th>
              </tr>
            </thead>
            <tbody>
              {installmentGroups.map(g => (
                <tr key={g.remaining} className="border-b last:border-b-0">
                  <td className="py-1 font-medium">x{g.remaining}</td>
                  <td className="py-1 text-zinc-600">
                    {g.items.map(it => `${it.description} (${it.cardName})`).join(', ')}
                  </td>
                  <td className="py-1 text-right font-mono">{BRL(g.total)}</td>
                </tr>
              ))}
              <tr className="font-semibold">
                <td className="pt-2" colSpan={2}>Total Parcelas</td>
                <td className="pt-2 text-right font-mono">{BRL(totals.installmentsTotal)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {/* Cartões resumo */}
      {cardViews.length > 0 && (
        <div className="bg-white rounded-lg border p-4">
          <div className="flex justify-between items-center mb-2">
            <h3 className="font-semibold text-zinc-700">Cartões</h3>
            <Link href="/finance/cards" className="text-sm text-blue-600 hover:underline">Ver detalhes</Link>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-zinc-500 border-b">
                <th className="pb-1">Cartão</th>
                <th className="pb-1 text-right">Fatura</th>
                <th className="pb-1 text-right">Parcelas</th>
                <th className="pb-1 text-right">Extras</th>
              </tr>
            </thead>
            <tbody>
              {cardViews.map(c => (
                <tr key={c._id} className="border-b last:border-b-0">
                  <td className="py-1">{c.name} <span className="text-xs text-zinc-400">dia {c.dueDay}</span></td>
                  <td className="py-1 text-right font-mono">{BRL(c.invoiceTotal)}</td>
                  <td className="py-1 text-right font-mono">{BRL(c.installmentsTotal)}</td>
                  <td className="py-1 text-right font-mono">{BRL(c.extras)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Projeções */}
      {projections.length > 0 && (
        <div className="bg-white rounded-lg border p-4">
          <h3 className="font-semibold text-zinc-700 mb-2">Projeções</h3>
          <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
            {projections.map(p => (
              <div key={p.label} className={`text-center p-2 rounded ${p.value >= 0 ? 'bg-green-50' : 'bg-red-50'}`}>
                <p className="text-xs text-zinc-500">{p.label}</p>
                <p className={`font-mono text-sm font-semibold ${p.value >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                  {BRL(p.value)}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Bancos */}
      <div className="bg-white rounded-lg border p-4">
        <h3 className="font-semibold text-zinc-700 mb-2">Contas</h3>
        <div className="flex gap-4">
          {profile.banks.map((b, i) => (
            <div key={i} className="text-center">
              <p className="text-xs text-zinc-500">{b.name}</p>
              <p className="font-mono font-semibold">{BRL(b.balance)}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function SummaryCard({ label, value, negative, highlight }: {
  label: string;
  value: number;
  negative?: boolean;
  highlight?: boolean;
}) {
  const color = highlight
    ? value >= 0 ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'
    : negative ? 'text-red-600' : 'text-zinc-900';

  return (
    <div className={`rounded-lg border p-3 ${highlight ? color : 'bg-white'}`}>
      <p className="text-xs text-zinc-500">{label}</p>
      <p className={`text-lg font-mono font-semibold ${color}`}>{BRL(value)}</p>
    </div>
  );
}

function ExpenseChecklist({
  title,
  expenses,
  yearMonth,
  daysInMonth,
}: {
  title: string;
  expenses: ExpenseItem[];
  yearMonth: string;
  daysInMonth: number;
}) {
  const [isPending, startTransition] = useTransition();
  const paidCount = expenses.filter(e => e.paid).length;
  const total = expenses.reduce((s, e) => s + e.value, 0);
  const paidTotal = expenses.filter(e => e.paid).reduce((s, e) => s + e.value, 0);
  const pendingTotal = total - paidTotal;

  const handleToggle = (e: ExpenseItem) => {
    startTransition(() => {
      togglePaid(e.id, e.name, e.value, yearMonth);
    });
  };

  const propLabel = (e: ExpenseItem) => {
    if (e.proportional === 'daily') return `(×${daysInMonth}d)`;
    if (e.proportional === 'weekly') return `(×${Math.round(daysInMonth / 7)}sem)`;
    return null;
  };

  if (expenses.length === 0) return null;

  return (
    <div className="bg-white rounded-lg border p-4">
      <div className="flex justify-between items-center mb-3">
        <h3 className="font-semibold text-zinc-700">{title}</h3>
        <span className="text-xs text-zinc-400">{paidCount}/{expenses.length} pagas</span>
      </div>
      <div className="space-y-1">
        {expenses.map(e => (
          <label
            key={e.id}
            className={`flex items-center gap-3 py-2 px-2 rounded-md cursor-pointer transition
              ${e.paid ? 'bg-green-50' : 'hover:bg-zinc-50'}
              ${isPending ? 'opacity-70 pointer-events-none' : ''}`}
          >
            <input
              type="checkbox"
              checked={e.paid}
              onChange={() => handleToggle(e)}
              className="h-4 w-4 rounded border-zinc-300 text-green-600 focus:ring-green-500"
            />
            <span className={`flex-1 text-sm ${e.paid ? 'line-through text-zinc-400' : 'text-zinc-800'}`}>
              {e.name}
              {e.proportional && (
                <span className="text-xs text-zinc-400 ml-1">{propLabel(e)}</span>
              )}
              {e.dueDay && (
                <span className="text-xs text-zinc-400 ml-1">dia {e.dueDay}</span>
              )}
            </span>
            <span className={`font-mono text-sm ${e.paid ? 'text-green-600' : 'text-zinc-700'}`}>
              {BRL(e.value)}
            </span>
          </label>
        ))}
      </div>
      <div className="flex justify-between mt-3 pt-3 border-t text-sm">
        <div>
          <span className="text-zinc-500">Pago: </span>
          <span className="font-mono text-green-600">{BRL(paidTotal)}</span>
        </div>
        <div>
          <span className="text-zinc-500">Pendente: </span>
          <span className="font-mono font-semibold text-zinc-800">{BRL(pendingTotal)}</span>
        </div>
        <div>
          <span className="text-zinc-500">Total: </span>
          <span className="font-mono">{BRL(total)}</span>
        </div>
      </div>
    </div>
  );
}
