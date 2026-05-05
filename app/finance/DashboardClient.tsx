'use client';

import { createContext, useContext, useState, useTransition } from 'react';
import Link from 'next/link';
import { togglePaid, updateMonthInvoice, toggleInvoicePaid, updateBankBalance, updateExpenseValue } from '@/lib/finance/actions';
import {
  toggleLocalExpensePayment,
  updateLocalMonthCardInvoice,
  toggleLocalCardInvoicePaid,
  updateLocalExpenseOverride,
  updateLocalBankBalance,
  updateLocalFoodVoucher,
} from '@/lib/finance/local-storage';
import { evalExpression } from '@/lib/finance/eval-expression';
import type { InstallmentGroup, CardView, BankAccount } from '@/lib/finance/types';

const BRL = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

interface FinanceActions {
  togglePaid: (id: string, name: string, value: number, ym: string) => Promise<void>;
  updateInvoice: (cardId: string, amount: number, ym: string) => Promise<void>;
  toggleInvoicePaid: (cardId: string, name: string, total: number, ym: string) => Promise<void>;
  updateBankBalance: (fd: FormData) => Promise<void>;
  updateExpenseValue: (id: string, value: number, ym: string) => Promise<void>;
}

const ActionsContext = createContext<FinanceActions>(null!);
const useActions = () => useContext(ActionsContext);

interface ExpenseItem {
  id: string;
  name: string;
  value: number;
  baseValue: number;
  dueDay?: number;
  proportional: false | 'daily' | 'weekly';
  paid: boolean;
  category: 'card' | 'cash';
}

interface Props {
  yearMonth: string;
  daysInMonth: number;
  proportionalDays: number;
  dayOfMonth: number;
  isCurrentMonth: boolean;
  prevMonth: string;
  nextMonth: string;
  profile: {
    salary: { payment: number; advance: number; paymentDay: number; advanceDay: number };
    foodVoucher: number;
    foodVoucherMonthly?: number;
    banks: BankAccount[];
  };
  cardExpenses: ExpenseItem[];
  cashExpenses: ExpenseItem[];
  installmentGroups: InstallmentGroup[];
  cardViews: CardView[];
  monthBalance: number;
  bankTotal: number;
  availableBalance: number;
  projections: { label: string; value: number }[];
  totals: {
    salary: number;
    vr: number;
    cardExpensesTotal: number;
    cashExpensesTotal: number;
    installmentsTotal: number;
  };
  isGuest?: boolean;
  onGuestAction?: () => void;
}

export default function DashboardClient({
  yearMonth,
  // daysInMonth,
  proportionalDays,
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
  bankTotal,
  availableBalance,
  projections,
  totals,
  isGuest,
  onGuestAction,
}: Props) {
  const guestRefresh = onGuestAction || (() => {});

  const actions: FinanceActions = isGuest
    ? {
        togglePaid: async (id, name, value, ym) => { toggleLocalExpensePayment(ym, id, name, value); guestRefresh(); },
        updateInvoice: async (cardId, amount, ym) => { updateLocalMonthCardInvoice(ym, cardId, amount); guestRefresh(); },
        toggleInvoicePaid: async (cardId, name, total, ym) => { toggleLocalCardInvoicePaid(ym, cardId, name, total); guestRefresh(); },
        updateBankBalance: async (fd) => {
          const names = fd.getAll('bankName') as string[];
          const balances = fd.getAll('bankBalance') as string[];
          const vr = fd.get('foodVoucher') as string | null;
          names.forEach((n, i) => updateLocalBankBalance(n, evalExpression(balances[i])));
          if (vr) updateLocalFoodVoucher(evalExpression(vr));
          guestRefresh();
        },
        updateExpenseValue: async (id, value, ym) => { updateLocalExpenseOverride(ym, id, value); guestRefresh(); },
      }
    : {
        togglePaid: async (id, name, value, ym) => { await togglePaid(id, name, value, ym); },
        updateInvoice: async (cardId, amount, ym) => { await updateMonthInvoice(cardId, amount, ym); },
        toggleInvoicePaid: async (cardId, name, total, ym) => { await toggleInvoicePaid(cardId, name, total, ym); },
        updateBankBalance: async (fd) => { await updateBankBalance(fd); },
        updateExpenseValue: async (id, value, ym) => { await updateExpenseValue(id, value, ym); },
      };

  const [y, m] = yearMonth.split('-').map(Number);
  const monthLabel = new Date(y, m - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });

  const allExpenses = [...cardExpenses, ...cashExpenses].sort((a, b) => (a.dueDay ?? 99) - (b.dueDay ?? 99));
  const totalInvoices = cardViews.reduce((s, c) => s + c.invoiceTotal, 0);
  const unpaidInvoices = cardViews.filter(c => !c.paid).reduce((s, c) => s + c.invoiceTotal, 0);
  const unpaidCash = cashExpenses.filter(e => !e.paid).reduce((s, e) => s + e.value, 0);
  const advanceDeducted = isCurrentMonth && new Date().getDate() >= profile.salary.advanceDay
    ? profile.salary.advance : 0;

  // Current month: original formula (bank - unpaid). Future: server-computed projection.
  const effectiveBalance = availableBalance;
  const pendingSalary = isCurrentMonth && dayOfMonth < profile.salary.paymentDay
    ? profile.salary.payment
    : 0;
  const projectedAfterSalary = effectiveBalance + pendingSalary;

  return (
    <ActionsContext.Provider value={actions}>
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-4">
      {/* Guest mode banner */}
      {isGuest && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-2 text-sm text-amber-800 flex justify-between items-center">
          <span>Modo offline — dados salvos no navegador.
            <Link href="/login" className="text-blue-600 hover:underline ml-1">Faça login</Link> para sincronizar.
          </span>
        </div>
      )}
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

      {/* Hero: Saldo Disponível + Saldo Mês na mesma linha */}
      <div className="grid grid-cols-3 gap-4">
        <div className={`col-span-2 rounded-lg p-5 text-center ${effectiveBalance >= 0 ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}`}>
          <p className="text-sm text-zinc-500">Saldo Disponível</p>
          <p className={`text-3xl font-bold ${effectiveBalance >= 0 ? 'text-green-700' : 'text-red-700'}`}>
            {BRL(effectiveBalance)}
          </p>
          <p className="text-xs text-zinc-400 mt-1">
            {isCurrentMonth
              ? <>saldo {BRL(bankTotal)} − à vista {BRL(unpaidCash)} − faturas {BRL(unpaidInvoices)}{advanceDeducted > 0 && <> − adiant. {BRL(advanceDeducted)}</>}</>
              : <>projeção a partir do saldo atual</>
            }
          </p>
          {pendingSalary > 0 && (
            <div className="mt-3 rounded-md border border-zinc-200 bg-white/70 px-3 py-2 text-sm">
              <span className="text-zinc-500">Após salário previsto dia {profile.salary.paymentDay}: </span>
              <span className={`font-mono font-semibold ${projectedAfterSalary >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                {BRL(projectedAfterSalary)}
              </span>
            </div>
          )}
        </div>
        <div className={`rounded-lg p-5 text-center border ${monthBalance >= 0 ? 'bg-zinc-50 border-zinc-200' : 'bg-red-50/50 border-red-100'}`}>
          <p className="text-sm text-zinc-500">Saldo do Mês</p>
          <p className={`text-xl font-bold ${monthBalance >= 0 ? 'text-zinc-700' : 'text-red-700'}`}>
            {BRL(monthBalance)}
          </p>
          <p className="text-xs text-zinc-400 mt-1">receita − despesas</p>
        </div>
      </div>

      {/* Resumo discreto */}
      <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-zinc-500 px-1">
        <span>Desp. cartão <span className="font-mono text-zinc-700">{BRL(totals.cardExpensesTotal)}</span></span>
        <span>À vista <span className="font-mono text-zinc-700">{BRL(totals.cashExpensesTotal)}</span></span>
        <span>Parcelas <span className="font-mono text-zinc-700">{BRL(totals.installmentsTotal)}</span></span>
        <span>Faturas <span className="font-mono text-zinc-700">{BRL(totalInvoices)}</span></span>
      </div>

      {/* Saldos bancários - editáveis */}
      <BankBalancesSection banks={profile.banks} foodVoucher={profile.foodVoucher} />

      {/* Despesas do mês - todas juntas, ordenadas por vencimento */}
      <ExpenseChecklist
        title="Despesas do Mês"
        expenses={allExpenses}
        yearMonth={yearMonth}
        proportionalDays={proportionalDays}
      />

      {/* Cartões / Faturas do mês */}
      {cardViews.length > 0 && (
        <div className="bg-white rounded-lg border p-4">
          <div className="flex justify-between items-center mb-3">
            <h3 className="font-semibold text-zinc-700">
              Faturas do Mês
              <span className="text-xs text-zinc-400 font-normal ml-2">
                {cardViews.filter(c => c.paid).length}/{cardViews.filter(c => c.invoiceTotal > 0).length} pagas
              </span>
            </h3>
            <Link href="/finance/cards" className="text-sm text-blue-600 hover:underline">Ver parcelas</Link>
          </div>
          <div className="space-y-1">
            {[...cardViews].sort((a, b) => (a.paid === b.paid ? 0 : a.paid ? 1 : -1) || (a.dueDay ?? 99) - (b.dueDay ?? 99)).map(c => (
              <CardInvoiceRow key={c._id} card={c} yearMonth={yearMonth} />
            ))}
          </div>
          <div className="flex justify-between mt-3 pt-3 border-t text-sm">
            <div>
              <span className="text-zinc-500">Pagas: </span>
              <span className="font-mono text-green-600">
                {BRL(cardViews.filter(c => c.paid).reduce((s, c) => s + c.invoiceTotal, 0))}
              </span>
            </div>
            <div>
              <span className="text-zinc-500">Pendentes: </span>
              <span className="font-mono font-semibold text-zinc-800">{BRL(unpaidInvoices)}</span>
            </div>
            <div>
              <span className="text-zinc-500">Total: </span>
              <span className="font-mono">{BRL(totalInvoices)}</span>
            </div>
          </div>
        </div>
      )}

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


    </div>
    </ActionsContext.Provider>
  );
}

function BankBalancesSection({ banks, foodVoucher }: { banks: BankAccount[]; foodVoucher: number }) {
  const actions = useActions();
  const [isPending, startTransition] = useTransition();
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editVal, setEditVal] = useState('');
  const [editingVR, setEditingVR] = useState(false);
  const [vrVal, setVrVal] = useState(foodVoucher.toString());

  const saveBank = (idx: number) => {
    const formData = new FormData();
    banks.forEach((b, i) => {
      formData.append('bankName', b.name);
      formData.append('bankBalance', i === idx ? editVal : b.balance.toString());
    });
    startTransition(async () => {
      await actions.updateBankBalance(formData);
      setEditingIdx(null);
    });
  };

  const saveVR = () => {
    const formData = new FormData();
    banks.forEach(b => {
      formData.append('bankName', b.name);
      formData.append('bankBalance', b.balance.toString());
    });
    formData.append('foodVoucher', vrVal);
    startTransition(async () => {
      await actions.updateBankBalance(formData);
      setEditingVR(false);
    });
  };

  return (
    <div className={`bg-white rounded-lg border p-4 ${isPending ? 'opacity-70' : ''}`}>
      <div className="flex justify-between items-center mb-3">
        <h3 className="font-semibold text-zinc-700">Saldos</h3>
        <Link href="/finance/setup/profile" className="text-xs text-blue-600 hover:underline">Editar perfil</Link>
      </div>
      <div className="flex flex-wrap gap-4">
        {banks.map((b, i) => (
          <div key={i} className="text-center min-w-[80px]">
            <p className="text-xs text-zinc-500">{b.name}</p>
            {editingIdx === i ? (
              <span className="inline-flex items-center gap-1">
                <input
                  type="text" inputMode="decimal" value={editVal}
                  onChange={e => setEditVal(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') saveBank(i); if (e.key === 'Escape') setEditingIdx(null); }}
                  autoFocus
                  className="w-24 text-center rounded border-zinc-300 text-sm px-1 py-0.5 font-mono focus:border-blue-500 focus:ring-blue-500"
                />
                <button onClick={() => saveBank(i)} className="text-green-600 text-xs font-bold">✓</button>
              </span>
            ) : (
              <p
                className="font-mono font-semibold cursor-pointer hover:text-blue-600 transition-colors"
                onClick={() => { setEditVal(b.balance.toString()); setEditingIdx(i); }}
                title="Clique para atualizar saldo"
              >
                {BRL(b.balance)}
              </p>
            )}
          </div>
        ))}
        <div className="text-center min-w-[80px]">
          <p className="text-xs text-zinc-500">VR/VA</p>
          {editingVR ? (
            <span className="inline-flex items-center gap-1">
              <input
                type="text" inputMode="decimal" value={vrVal}
                onChange={e => setVrVal(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') saveVR(); if (e.key === 'Escape') setEditingVR(false); }}
                autoFocus
                className="w-24 text-center rounded border-zinc-300 text-sm px-1 py-0.5 font-mono focus:border-blue-500 focus:ring-blue-500"
              />
              <button onClick={() => saveVR()} className="text-green-600 text-xs font-bold">✓</button>
            </span>
          ) : (
            <p
              className="font-mono font-semibold cursor-pointer hover:text-blue-600 transition-colors"
              onClick={() => { setVrVal(foodVoucher.toString()); setEditingVR(true); }}
              title="Clique para atualizar saldo VR/VA"
            >
              {BRL(foodVoucher)}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function CardInvoiceRow({ card, yearMonth }: { card: CardView; yearMonth: string }) {
  const actions = useActions();
  const [isPending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(card.invoiceTotal.toString());

  const handleToggle = () => {
    startTransition(() => {
      actions.toggleInvoicePaid(card._id, card.name, card.invoiceTotal, yearMonth);
    });
  };

  const handleSave = () => {
    const num = evalExpression(val);
    startTransition(async () => {
      await actions.updateInvoice(card._id, num, yearMonth);
      setEditing(false);
    });
  };

  return (
    <label
      className={`flex items-center gap-3 py-2 px-2 rounded-md cursor-pointer transition
        ${card.paid ? 'bg-green-50' : 'hover:bg-zinc-50'}
        ${isPending ? 'opacity-70 pointer-events-none' : ''}`}
    >
      <input
        type="checkbox"
        checked={card.paid}
        onChange={handleToggle}
        className="h-4 w-4 rounded border-zinc-300 text-green-600 focus:ring-green-500"
      />
      <span className={`flex-1 text-sm ${card.paid ? 'line-through text-zinc-400' : 'text-zinc-800'}`}>
        {card.name}
        <span className="text-xs text-zinc-400 ml-1">dia {card.dueDay}</span>
        {card.installmentsTotal > 0 && (
          <span className="text-xs text-zinc-400 ml-1">
            (parcelas: {BRL(card.installmentsTotal)})
          </span>
        )}
      </span>
      {editing ? (
        <span className="inline-flex items-center gap-1" onClick={e => e.preventDefault()}>
          <input
            type="text"
            inputMode="decimal"
            value={val}
            onChange={e => setVal(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') setEditing(false); }}
            autoFocus
            className="w-28 text-right rounded border-zinc-300 text-sm px-1 py-0.5 font-mono focus:border-blue-500 focus:ring-blue-500"
          />
          <button onClick={handleSave} className="text-green-600 hover:text-green-800 text-xs font-bold">✓</button>
          <button onClick={() => setEditing(false)} className="text-zinc-400 hover:text-zinc-600 text-xs">✕</button>
        </span>
      ) : (
        <span
          className={`font-mono text-sm cursor-pointer hover:text-blue-600 transition-colors ${card.paid ? 'text-green-600' : 'text-zinc-700'}`}
          onClick={e => { e.preventDefault(); setVal(card.invoiceTotal.toString()); setEditing(true); }}
          title="Clique para editar fatura"
        >
          {BRL(card.invoiceTotal)}
        </span>
      )}
    </label>
  );
}

function ExpenseChecklist({
  title,
  expenses,
  yearMonth,
  proportionalDays,
}: {
  title: string;
  expenses: ExpenseItem[];
  yearMonth: string;
  proportionalDays: number;
}) {
  const actions = useActions();
  const [isPending, startTransition] = useTransition();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editVal, setEditVal] = useState('');
  const paidCount = expenses.filter(e => e.paid).length;
  const total = expenses.reduce((s, e) => s + e.value, 0);
  const paidTotal = expenses.filter(e => e.paid).reduce((s, e) => s + e.value, 0);
  const pendingTotal = total - paidTotal;

  const handleToggle = (e: ExpenseItem) => {
    startTransition(() => {
      actions.togglePaid(e.id, e.name, e.value, yearMonth);
    });
  };

  const handleSaveValue = (e: ExpenseItem) => {
    const newVal = evalExpression(editVal);
    startTransition(async () => {
      await actions.updateExpenseValue(e.id, newVal, yearMonth);
      setEditingId(null);
    });
  };

  const propLabel = (e: ExpenseItem) => {
    if (e.proportional === 'daily') return `(×${proportionalDays}d)`;
    if (e.proportional === 'weekly') return `(×${Math.round(proportionalDays / 7)}sem)`;
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
          <div
            key={e.id}
            className={`flex items-center gap-3 py-2 px-2 rounded-md transition
              ${e.paid ? 'bg-green-50' : 'hover:bg-zinc-50'}
              ${isPending ? 'opacity-70 pointer-events-none' : ''}`}
          >
            <label className="flex items-center cursor-pointer p-1">
              <input
                type="checkbox"
                checked={e.paid}
                onChange={() => handleToggle(e)}
                className="h-4 w-4 rounded border-zinc-300 text-green-600 focus:ring-green-500"
              />
            </label>
            <span className={`flex-1 text-sm ${e.paid ? 'line-through text-zinc-400' : 'text-zinc-800'}`}>
              <span className="text-xs mr-1">{e.category === 'card' ? '💳' : '💵'}</span>
              {e.name}
              {e.proportional && (
                <span className="text-xs text-zinc-400 ml-1">{propLabel(e)}</span>
              )}
              {e.dueDay && (
                <span className="text-xs text-zinc-400 ml-1">dia {e.dueDay}</span>
              )}
            </span>
            {editingId === e.id ? (
              <span className="inline-flex items-center gap-1" onClick={ev => ev.stopPropagation()}>
                <input
                  type="text"
                  inputMode="decimal"
                  value={editVal}
                  onChange={ev => setEditVal(ev.target.value)}
                  onKeyDown={ev => { if (ev.key === 'Enter') handleSaveValue(e); if (ev.key === 'Escape') setEditingId(null); }}
                  autoFocus
                  className="w-24 text-right rounded border-zinc-300 text-sm px-1 py-0.5 font-mono focus:border-blue-500 focus:ring-blue-500"
                />
                <button onClick={() => handleSaveValue(e)} className="text-green-600 text-xs font-bold">✓</button>
                <button onClick={() => setEditingId(null)} className="text-zinc-400 text-xs">✕</button>
              </span>
            ) : (
              <span
                className={`font-mono text-sm cursor-pointer hover:text-blue-600 transition-colors ${e.paid ? 'text-green-600' : 'text-zinc-700'}`}
                onClick={() => { setEditVal(e.baseValue.toString()); setEditingId(e.id); }}
                title="Clique para alterar valor deste mês"
              >
                {BRL(e.value)}
              </span>
            )}
          </div>
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
