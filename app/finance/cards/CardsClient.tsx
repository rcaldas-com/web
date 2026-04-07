'use client';

import Link from 'next/link';
import { useRef } from 'react';
import { addNewInstallment, removeInstallment, updateInvoice, removeCard } from '@/lib/finance/actions';
import type { CardView, CreditCard } from '@/lib/finance/types';

const BRL = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export default function CardsClient({
  cardViews,
  cards,
}: {
  cardViews: CardView[];
  cards: CreditCard[];
}) {
  const formRef = useRef<HTMLFormElement>(null);

  const handleAdd = async (formData: FormData) => {
    await addNewInstallment(formData);
    formRef.current?.reset();
  };

  const totalInvoice = cardViews.reduce((sum, c) => sum + c.invoiceTotal, 0);
  const totalInstallments = cardViews.reduce((sum, c) => sum + c.installmentsTotal, 0);
  const totalExtras = cardViews.reduce((sum, c) => sum + c.extras, 0);

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">Cartões & Parcelas</h1>
        <Link href="/finance" className="text-sm text-blue-600 hover:underline">← Dashboard</Link>
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
      {cardViews.map(card => (
        <div key={card._id} className="bg-white rounded-lg border p-4 space-y-3">
          <div className="flex justify-between items-center">
            <div>
              <h2 className="text-lg font-semibold">{card.name}</h2>
              <p className="text-xs text-zinc-400">Vencimento dia {card.dueDay}</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-zinc-500">Fatura</p>
              <p className="text-lg font-mono font-semibold">{BRL(card.invoiceTotal)}</p>
            </div>
          </div>

          {card.items.length > 0 && (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-zinc-500 border-b">
                  <th className="pb-1">Compra</th>
                  <th className="pb-1 text-right">Restantes</th>
                  <th className="pb-1 text-right">Valor/mês</th>
                  <th className="pb-1 w-8"></th>
                </tr>
              </thead>
              <tbody>
                {card.items.map((item, i) => (
                  <tr key={i} className="border-b last:border-b-0">
                    <td className="py-1">{item.description}</td>
                    <td className="py-1 text-right">{item.remaining}x</td>
                    <td className="py-1 text-right font-mono">{BRL(item.monthlyValue)}</td>
                    <td className="py-1 text-right">
                      {/* We'd need installment IDs here for deletion - simplified */}
                    </td>
                  </tr>
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
      ))}

      {/* Add new installment */}
      {cards.length > 0 && (
        <div className="bg-white rounded-lg border p-4">
          <h3 className="font-semibold text-zinc-700 mb-3">Nova Parcela</h3>
          <form ref={formRef} action={handleAdd} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-zinc-700">Cartão</label>
                <select name="cardId"
                  className="mt-1 block w-full rounded-md border-zinc-300 shadow-sm focus:border-blue-500 focus:ring-blue-500">
                  {cards.map(c => (
                    <option key={c._id} value={c._id}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-700">Descrição</label>
                <input type="text" name="description"
                  className="mt-1 block w-full rounded-md border-zinc-300 shadow-sm focus:border-blue-500 focus:ring-blue-500" />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-sm font-medium text-zinc-700">Valor/mês</label>
                <input type="number" step="0.01" name="monthlyValue"
                  className="mt-1 block w-full rounded-md border-zinc-300 shadow-sm focus:border-blue-500 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-700">Total</label>
                <input type="number" name="totalInstallments"
                  className="mt-1 block w-full rounded-md border-zinc-300 shadow-sm focus:border-blue-500 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-700">Restantes</label>
                <input type="number" name="remainingInstallments"
                  className="mt-1 block w-full rounded-md border-zinc-300 shadow-sm focus:border-blue-500 focus:ring-blue-500" />
              </div>
            </div>
            <button type="submit"
              className="bg-green-600 text-white px-4 py-1.5 rounded-md hover:bg-green-700 text-sm">
              + Adicionar
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
