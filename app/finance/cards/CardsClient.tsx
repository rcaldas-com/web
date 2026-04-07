'use client';

import Link from 'next/link';
import { useRef, useState, useTransition } from 'react';
import {
  addNewInstallment,
  removeInstallment,
  editInstallment,
  updateInvoice,
} from '@/lib/finance/actions';
import type { CardView, CreditCard } from '@/lib/finance/types';

const BRL = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export default function CardsClient({
  cardViews,
  cards,
}: {
  cardViews: CardView[];
  cards: CreditCard[];
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
        <h1 className="text-2xl font-bold">Cartões & Parcelas</h1>
        <Link href="/finance" className="text-sm text-blue-600 hover:underline">
          ← Dashboard
        </Link>
      </div>

      {/* Totals */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white rounded-lg border p-3 text-center">
          <p className="text-xs text-zinc-500">Total Faturas</p>
          <p className="text-lg font-mono font-semibold">{BRL(totalInvoice)}</p>
        </div>
        <div className="bg-white rounded-lg border p-3 text-center">
          <p className="text-xs text-zinc-500">Total Parcelas</p>
          <p className="text-lg font-mono font-semibold">{BRL(totalInstallments)}</p>
        </div>
        <div className="bg-white rounded-lg border p-3 text-center">
          <p className="text-xs text-zinc-500">Extras</p>
          <p className="text-lg font-mono font-semibold">{BRL(totalExtras)}</p>
        </div>
      </div>

      {/* Per card */}
      {cardViews.map((card) => (
        <CardSection key={card._id} card={card} />
      ))}

      {/* Add new installment */}
      {cards.length > 0 && (
        <div className="bg-white rounded-lg border p-4">
          <h3 className="font-semibold text-zinc-700 mb-3">Nova Parcela</h3>
          <form ref={formRef} action={handleAdd} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-zinc-700">Descrição</label>
                <input
                  ref={descRef}
                  type="text"
                  name="description"
                  className="mt-1 block w-full rounded-md border-zinc-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-700">Cartão</label>
                <select
                  name="cardId"
                  className="mt-1 block w-full rounded-md border-zinc-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
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
                <label className="block text-sm font-medium text-zinc-700">Valor/mês</label>
                <input
                  type="number"
                  step="0.01"
                  name="monthlyValue"
                  className="mt-1 block w-full rounded-md border-zinc-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-700">Restantes</label>
                <input
                  type="number"
                  name="remainingInstallments"
                  className="mt-1 block w-full rounded-md border-zinc-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
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

function CardSection({ card }: { card: CardView }) {
  const [isPending, startTransition] = useTransition();
  const [editingInvoice, setEditingInvoice] = useState(false);
  const [invoiceVal, setInvoiceVal] = useState(card.invoiceTotal.toString());

  const handleInvoiceSave = () => {
    const val = parseFloat(invoiceVal) || 0;
    startTransition(async () => {
      await updateInvoice(card._id, val);
      setEditingInvoice(false);
    });
  };

  return (
    <div
      className={`bg-white rounded-lg border p-4 space-y-3 ${isPending ? 'opacity-70' : ''}`}
    >
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-lg font-semibold">{card.name}</h2>
          <p className="text-xs text-zinc-400">Vencimento dia {card.dueDay}</p>
        </div>
        <div className="text-right">
          <p className="text-xs text-zinc-500">Fatura</p>
          {editingInvoice ? (
            <div className="flex items-center gap-1">
              <input
                type="number"
                step="0.01"
                value={invoiceVal}
                onChange={(e) => setInvoiceVal(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleInvoiceSave();
                  if (e.key === 'Escape') setEditingInvoice(false);
                }}
                autoFocus
                className="w-32 text-right rounded-md border-zinc-300 shadow-sm text-sm font-mono focus:border-blue-500 focus:ring-blue-500"
              />
              <button
                onClick={handleInvoiceSave}
                className="text-green-600 hover:text-green-800 text-sm font-bold px-1"
              >
                ✓
              </button>
              <button
                onClick={() => setEditingInvoice(false)}
                className="text-zinc-400 hover:text-zinc-600 text-sm px-1"
              >
                ✕
              </button>
            </div>
          ) : (
            <p
              className="text-lg font-mono font-semibold cursor-pointer hover:text-blue-600 transition-colors"
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
            <tr className="text-left text-zinc-500 border-b">
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
            <tr className="font-semibold border-t">
              <td className="pt-1">Parcelas</td>
              <td></td>
              <td className="pt-1 text-right font-mono">{BRL(card.installmentsTotal)}</td>
              <td></td>
            </tr>
            <tr className="text-zinc-500">
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
    const newVal = parseFloat(value);
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
      <tr className={`border-b last:border-b-0 ${isPending ? 'opacity-50' : ''}`}>
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
            className="w-full rounded border-zinc-300 text-sm px-1 py-0.5 focus:border-blue-500 focus:ring-blue-500"
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
            className="w-16 text-right rounded border-zinc-300 text-sm px-1 py-0.5 font-mono focus:border-blue-500 focus:ring-blue-500"
          />
        </td>
        <td className="py-1 text-right">
          <input
            type="number"
            step="0.01"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSave();
              if (e.key === 'Escape') setEditing(false);
            }}
            className="w-24 text-right rounded border-zinc-300 text-sm px-1 py-0.5 font-mono focus:border-blue-500 focus:ring-blue-500"
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
            className="text-zinc-400 hover:text-zinc-600 text-xs"
          >
            ✕
          </button>
        </td>
      </tr>
    );
  }

  return (
    <tr
      className={`border-b last:border-b-0 cursor-pointer hover:bg-zinc-50 transition ${isPending ? 'opacity-50' : ''}`}
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
