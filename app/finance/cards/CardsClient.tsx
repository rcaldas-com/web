'use client';

import Link from 'next/link';
import { useRef, useState, useTransition } from 'react';
import {
  addNewInstallment,
  removeInstallment,
  editInstallment,
  updateMonthInvoice,
} from '@/lib/finance/actions';
import { evalExpression } from '@/lib/finance/eval-expression';
import type { CardView, CreditCard } from '@/lib/finance/types';

const BRL = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export default function CardsClient({
  cardViews,
  cards,
  nextYearMonth,
}: {
  cardViews: CardView[];
  cards: CreditCard[];
  nextYearMonth: string;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const descRef = useRef<HTMLInputElement>(null);

  const handleAdd = async (formData: FormData) => {
    await addNewInstallment(formData);
    formRef.current?.reset();
    descRef.current?.focus();
  };

  const totalInvoice = cardViews.reduce((sum, c) => sum + c.invoiceTotal, 0);
  const totalInstallments = cardViews.reduce((sum, c) => sum + c.installmentsTotal, 0);
  const totalExtras = cardViews.reduce((sum, c) => sum + c.extras, 0);

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-zinc-950 dark:text-zinc-50">Cartões & Parcelas</h1>
          <p className="text-xs text-zinc-400 dark:text-zinc-400">Referência: próximo mês</p>
        </div>
        <Link href="/finance" className="text-sm text-blue-600 hover:underline">
          ← Dashboard
        </Link>
      </div>

      {/* Totals */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white rounded-lg border p-3 text-center dark:border-zinc-700 dark:bg-zinc-800">
          <p className="text-xs text-zinc-500 dark:text-zinc-300">Total Faturas</p>
          <p className="text-lg font-mono font-semibold text-zinc-900 dark:text-zinc-50">{BRL(totalInvoice)}</p>
        </div>
        <div className="bg-white rounded-lg border p-3 text-center dark:border-zinc-700 dark:bg-zinc-800">
          <p className="text-xs text-zinc-500 dark:text-zinc-300">Total Parcelas</p>
          <p className="text-lg font-mono font-semibold text-zinc-900 dark:text-zinc-50">{BRL(totalInstallments)}</p>
        </div>
        <div className="bg-white rounded-lg border p-3 text-center dark:border-zinc-700 dark:bg-zinc-800">
          <p className="text-xs text-zinc-500 dark:text-zinc-300">Extras</p>
          <p className="text-lg font-mono font-semibold text-zinc-900 dark:text-zinc-50">{BRL(totalExtras)}</p>
        </div>
      </div>

      {/* Per card */}
      {cardViews.map((card) => (
        <CardSection key={card._id} card={card} yearMonth={nextYearMonth} />
      ))}

      {/* Add new installment */}
      {cards.length > 0 && (
        <div className="bg-white rounded-lg border p-4 dark:border-zinc-700 dark:bg-zinc-800">
          <h3 className="font-semibold text-zinc-700 mb-3 dark:text-zinc-100">Nova Parcela</h3>
          <form ref={formRef} action={handleAdd} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-200">Descrição</label>
                <input
                  ref={descRef}
                  type="text"
                  name="description"
                  className="mt-1 block w-full rounded-md border-zinc-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-200">Cartão</label>
                <select
                  name="cardId"
                  className="mt-1 block w-full rounded-md border-zinc-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100"
                >
                  {cards.map((c) => (
                    <option key={c._id} value={c._id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-200">Valor/mês</label>
                <input
                  type="text"
                  inputMode="decimal"
                  name="monthlyValue"
                  className="mt-1 block w-full rounded-md border-zinc-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-200">Restantes</label>
                <input
                  type="number"
                  name="remainingInstallments"
                  className="mt-1 block w-full rounded-md border-zinc-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100"
                />
              </div>
            </div>
            <button
              type="submit"
              className="bg-green-600 text-white px-4 py-1.5 rounded-md hover:bg-green-700 text-sm"
            >
              + Adicionar
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

function CardSection({ card, yearMonth }: { card: CardView; yearMonth: string }) {
  const [isPending, startTransition] = useTransition();
  const [editingInvoice, setEditingInvoice] = useState(false);
  const [invoiceVal, setInvoiceVal] = useState(card.invoiceTotal.toString());

  const handleInvoiceSave = () => {
    const val = evalExpression(invoiceVal);
    startTransition(async () => {
      await updateMonthInvoice(card._id, val, yearMonth);
      setEditingInvoice(false);
    });
  };

  return (
    <div
      className={`bg-white rounded-lg border p-4 space-y-3 dark:border-zinc-700 dark:bg-zinc-800 ${isPending ? 'opacity-70' : ''}`}
    >
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">{card.name}</h2>
          <p className="text-xs text-zinc-400 dark:text-zinc-400">Vencimento dia {card.dueDay}</p>
        </div>
        <div className="text-right">
          <p className="text-xs text-zinc-500 dark:text-zinc-300">Fatura</p>
          {editingInvoice ? (
            <div className="flex items-center gap-1">
              <input
                type="text"
                inputMode="decimal"
                value={invoiceVal}
                onChange={(e) => setInvoiceVal(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleInvoiceSave();
                  if (e.key === 'Escape') setEditingInvoice(false);
                }}
                autoFocus
                className="w-32 text-right rounded-md border-zinc-300 shadow-sm text-sm font-mono focus:border-blue-500 focus:ring-blue-500 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100"
              />
              <button
                onClick={handleInvoiceSave}
                className="text-green-600 hover:text-green-800 text-sm font-bold px-1"
              >
                ✓
              </button>
              <button
                onClick={() => setEditingInvoice(false)}
                className="text-zinc-400 hover:text-zinc-600 text-sm px-1 dark:hover:text-zinc-200"
              >
                ✕
              </button>
            </div>
          ) : (
            <p
              className="text-lg font-mono font-semibold text-zinc-900 cursor-pointer hover:text-blue-600 transition-colors dark:text-zinc-50 dark:hover:text-blue-400"
              onClick={() => {
                setInvoiceVal(card.invoiceTotal.toString());
                setEditingInvoice(true);
              }}
              title="Clique para editar"
            >
              {BRL(card.invoiceTotal)}
            </p>
          )}
        </div>
      </div>

      {card.items.length > 0 && (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-zinc-500 border-b dark:border-zinc-700 dark:text-zinc-300">
              <th className="pb-1">Compra</th>
              <th className="pb-1 text-right">Restantes</th>
              <th className="pb-1 text-right">Valor/mês</th>
              <th className="pb-1 w-16"></th>
            </tr>
          </thead>
          <tbody>
            {card.items.map((item) => (
              <InstallmentRow key={item._id} item={item} />
            ))}
          </tbody>
          <tfoot>
            <tr className="font-semibold border-t text-zinc-800 dark:border-zinc-700 dark:text-zinc-100">
              <td className="pt-1">Parcelas</td>
              <td></td>
              <td className="pt-1 text-right font-mono">{BRL(card.installmentsTotal)}</td>
              <td></td>
            </tr>
            <tr className="text-zinc-500 dark:text-zinc-300">
              <td>Extras (fatura - parcelas)</td>
              <td></td>
              <td className="text-right font-mono">{BRL(card.extras)}</td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      )}
    </div>
  );
}

function InstallmentRow({
  item,
}: {
  item: { _id: string; description: string; remaining: number; monthlyValue: number };
}) {
  const [isPending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [desc, setDesc] = useState(item.description);
  const [remaining, setRemaining] = useState(item.remaining.toString());
  const [value, setValue] = useState(item.monthlyValue.toString());

  const handleSave = () => {
    const updates: { monthlyValue?: number; remainingInstallments?: number; description?: string } = {};
    const newVal = evalExpression(value);
    const newRem = parseInt(remaining);
    if (desc.trim() !== item.description) updates.description = desc.trim();
    if (!isNaN(newVal) && newVal !== item.monthlyValue) updates.monthlyValue = newVal;
    if (!isNaN(newRem) && newRem !== item.remaining) updates.remainingInstallments = newRem;

    if (Object.keys(updates).length === 0) {
      setEditing(false);
      return;
    }
    startTransition(async () => {
      await editInstallment(item._id, updates);
      setEditing(false);
    });
  };

  const handleDelete = () => {
    if (!confirm(`Remover "${item.description}"?`)) return;
    startTransition(() => removeInstallment(item._id));
  };

  if (editing) {
    return (
      <tr className={`border-b last:border-b-0 dark:border-zinc-700 ${isPending ? 'opacity-50' : ''}`}>
        <td className="py-1">
          <input
            type="text"
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSave();
              if (e.key === 'Escape') setEditing(false);
            }}
            autoFocus
            className="w-full rounded border-zinc-300 text-sm px-1 py-0.5 focus:border-blue-500 focus:ring-blue-500 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100"
          />
        </td>
        <td className="py-1 text-right">
          <input
            type="number"
            value={remaining}
            onChange={(e) => setRemaining(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSave();
              if (e.key === 'Escape') setEditing(false);
            }}
            className="w-16 text-right rounded border-zinc-300 text-sm px-1 py-0.5 font-mono focus:border-blue-500 focus:ring-blue-500 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100"
          />
        </td>
        <td className="py-1 text-right">
          <input
            type="text"
            inputMode="decimal"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSave();
              if (e.key === 'Escape') setEditing(false);
            }}
            className="w-24 text-right rounded border-zinc-300 text-sm px-1 py-0.5 font-mono focus:border-blue-500 focus:ring-blue-500 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100"
          />
        </td>
        <td className="py-1 text-right flex gap-1 justify-end">
          <button
            onClick={handleSave}
            className="text-green-600 hover:text-green-800 text-xs font-bold"
          >
            ✓
          </button>
          <button
            onClick={() => setEditing(false)}
            className="text-zinc-400 hover:text-zinc-600 text-xs dark:hover:text-zinc-200"
          >
            ✕
          </button>
        </td>
      </tr>
    );
  }

  return (
    <tr
      className={`border-b last:border-b-0 cursor-pointer text-zinc-700 hover:bg-zinc-50 transition dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-700/60 ${isPending ? 'opacity-50' : ''}`}
      onClick={() => setEditing(true)}
      title="Clique para editar"
    >
      <td className="py-1">{item.description}</td>
      <td className="py-1 text-right">{item.remaining}x</td>
      <td className="py-1 text-right font-mono">{BRL(item.monthlyValue)}</td>
      <td className="py-1 text-right">
        <button
          onClick={(e) => {
            e.stopPropagation();
            handleDelete();
          }}
          className="text-red-400 hover:text-red-600 text-xs"
          title="Remover"
        >
          ✕
        </button>
      </td>
    </tr>
  );
}
