'use client';

import { useState } from 'react';
import { saveCardsAndContinue, saveCardsAndFinish } from '@/lib/finance/actions';
import type { CreditCard } from '@/lib/finance/types';

interface CardRow {
  _id?: string;
  name: string;
  dueDay: number;
  invoiceTotal: number;
}

export default function CardsForm({ cards }: { cards: CreditCard[] }) {
  const [rows, setRows] = useState<CardRow[]>(
    cards.length
      ? cards.map(c => ({ _id: c._id, name: c.name, dueDay: c.dueDay, invoiceTotal: c.invoiceTotal }))
      : [{ name: '', dueDay: 1, invoiceTotal: 0 }]
  );

  const addRow = () => setRows([...rows, { name: '', dueDay: 1, invoiceTotal: 0 }]);
  const removeRow = (i: number) => setRows(rows.filter((_, idx) => idx !== i));

  return (
    <form action={saveCardsAndContinue} className="space-y-6">
      <div className="bg-white rounded-lg border p-6 space-y-4">
        <div className="flex justify-between items-center">
          <h2 className="text-lg font-semibold">Cartões de Crédito</h2>
          <button type="button" onClick={addRow}
            className="text-sm text-blue-600 hover:text-blue-800">
            + Adicionar
          </button>
        </div>
        {rows.map((row, i) => (
          <div key={i} className="flex gap-3 items-end border-b pb-3 last:border-b-0">
            <input type="hidden" name="cardId" value={row._id || ''} />
            <div className="flex-1">
              <label className="block text-sm font-medium text-zinc-700">Nome</label>
              <input
                type="text" name="cardName"
                defaultValue={row.name}
                className="mt-1 block w-full rounded-md border-zinc-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                placeholder="BB, ITAU, MP..."
              />
            </div>
            <div className="w-24">
              <label className="block text-sm font-medium text-zinc-700">Vencimento</label>
              <input
                type="number" name="cardDueDay" min="1" max="31"
                defaultValue={row.dueDay}
                className="mt-1 block w-full rounded-md border-zinc-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
              />
            </div>
            <div className="w-36">
              <label className="block text-sm font-medium text-zinc-700">Fatura (R$)</label>
              <input
                type="text" inputMode="decimal" name="cardInvoice"
                defaultValue={row.invoiceTotal}
                className="mt-1 block w-full rounded-md border-zinc-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
              />
            </div>
            {rows.length > 1 && (
              <button type="button" onClick={() => removeRow(i)}
                className="text-red-500 hover:text-red-700 pb-2">
                ✕
              </button>
            )}
          </div>
        ))}
      </div>

      <div className="flex justify-between">
        <a href="/finance/setup/profile"
          className="text-zinc-600 hover:text-zinc-800 px-4 py-2">
          ← Voltar
        </a>
        <div className="flex gap-3">
          <button type="submit" formAction={saveCardsAndFinish}
            className="text-zinc-600 hover:text-zinc-800 px-4 py-2 border rounded-md hover:bg-zinc-50 transition">
            Concluir ✓
          </button>
          <button type="submit"
            className="bg-blue-600 text-white px-6 py-2 rounded-md hover:bg-blue-700 transition">
            Próximo →
          </button>
        </div>
      </div>
    </form>
  );
}
