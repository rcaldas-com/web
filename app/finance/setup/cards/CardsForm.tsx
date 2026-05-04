'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { saveCardsAndContinue, saveCardsAndFinish } from '@/lib/finance/actions';
import { saveLocalCards, saveDraft, loadDraft, clearDraft } from '@/lib/finance/local-storage';
import { evalExpression } from '@/lib/finance/eval-expression';
import type { CreditCard } from '@/lib/finance/types';

const DRAFT_ID = 'cards';

interface CardRow {
  _id?: string;
  name: string;
  dueDay: string;
  invoiceTotal: string;
}

type DraftCardRow = Omit<CardRow, 'dueDay' | 'invoiceTotal'> & {
  dueDay?: string | number;
  invoiceTotal?: string | number;
};

const clampDueDay = (value: string) => Math.min(31, Math.max(1, parseInt(value) || 1));

const toCardRow = (card: DraftCardRow): CardRow => ({
  _id: card._id,
  name: card.name,
  dueDay: card.dueDay == null ? '' : String(card.dueDay),
  invoiceTotal: card.invoiceTotal == null ? '' : String(card.invoiceTotal),
});

export default function CardsForm({ cards, isGuest }: { cards: CreditCard[]; isGuest?: boolean }) {
  const router = useRouter();
  const draft = isGuest ? loadDraft<{ rows: DraftCardRow[] }>(DRAFT_ID) : null;
  const [rows, setRows] = useState<CardRow[]>(
    draft?.rows?.map(toCardRow) || (cards.length
      ? cards.map(c => toCardRow({ _id: c._id, name: c.name, dueDay: c.dueDay, invoiceTotal: c.invoiceTotal ?? 0 }))
      : [{ name: '', dueDay: '', invoiceTotal: '' }])
  );

  const formRef = useRef<HTMLFormElement>(null);
  const saveTimeout = useRef<ReturnType<typeof setTimeout>>(undefined);

  const autoSave = useCallback(() => {
    if (!isGuest) return;
    clearTimeout(saveTimeout.current);
    saveTimeout.current = setTimeout(() => {
      saveDraft(DRAFT_ID, { rows });
    }, 2000);
  }, [isGuest, rows]);

  useEffect(() => () => clearTimeout(saveTimeout.current), []);

  const handleGuestSubmit = (dest: 'continue' | 'finish') => {
    const validCards = rows
      .filter(r => r.name.trim())
      .map(r => ({
        ...r,
        name: r.name.trim(),
        dueDay: clampDueDay(r.dueDay),
        invoiceTotal: evalExpression(r.invoiceTotal),
      }));
    saveLocalCards(validCards);
    clearDraft(DRAFT_ID);
    router.push(dest === 'continue' ? '/finance/setup/expenses' : '/finance');
  };

  const addRow = () => setRows([...rows, { name: '', dueDay: '', invoiceTotal: '' }]);
  const removeRow = (i: number) => setRows(rows.filter((_, idx) => idx !== i));
  const updateRow = (i: number, field: string, value: string | number) => {
    setRows(rows.map((r, idx) => idx === i ? { ...r, [field]: value } : r));
  };

  return (
    <form ref={formRef} action={isGuest ? undefined : saveCardsAndContinue}
      onChange={autoSave}
      onSubmit={isGuest ? (e) => { e.preventDefault(); handleGuestSubmit('continue'); } : undefined}
      className="space-y-6">
      <div className="bg-white rounded-lg border p-6 space-y-4">
        <div className="flex justify-between items-center">
          <h2 className="text-lg font-semibold">Cartões de Crédito</h2>
          <button type="button" onClick={addRow}
            className="text-sm text-blue-600 hover:text-blue-800">
            + Adicionar
          </button>
        </div>
        {rows.map((row, i) => (
          <div key={i} className="grid grid-cols-1 gap-3 border-b pb-3 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_6rem_8rem_auto] sm:items-end">
            <input type="hidden" name="cardId" value={row._id || ''} />
            <div>
              <label className="block text-sm font-medium text-zinc-700">Nome</label>
              <input
                type="text" name="cardName"
                value={row.name}
                onChange={e => updateRow(i, 'name', e.target.value)}
                className="mt-1 block w-full rounded-md border-zinc-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                placeholder="BB, ITAU..."
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-zinc-700">Vencimento</label>
              <input
                type="text" name="cardDueDay" inputMode="numeric" pattern="[0-9]*" maxLength={2}
                value={row.dueDay}
                onChange={e => updateRow(i, 'dueDay', e.target.value.replace(/\D/g, ''))}
                className="mt-1 block w-full rounded-md border-zinc-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-zinc-700">Fatura atual</label>
              <input
                type="text" name="cardInvoiceTotal" inputMode="decimal"
                value={row.invoiceTotal}
                onChange={e => updateRow(i, 'invoiceTotal', e.target.value)}
                className="mt-1 block w-full rounded-md border-zinc-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                placeholder="0,00"
              />
            </div>
            {rows.length > 1 && (
              <button type="button" onClick={() => removeRow(i)}
                className="justify-self-start pb-2 text-red-500 hover:text-red-700 sm:justify-self-center">
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
          {isGuest ? (
            <>
              <button type="button" onClick={() => handleGuestSubmit('finish')}
                className="text-zinc-600 hover:text-zinc-800 px-4 py-2 border rounded-md hover:bg-zinc-50 transition">
                Concluir ✓
              </button>
              <button type="submit"
                className="bg-blue-600 text-white px-6 py-2 rounded-md hover:bg-blue-700 transition">
                Próximo →
              </button>
            </>
          ) : (
            <>
              <button type="submit" formAction={saveCardsAndFinish}
                className="text-zinc-600 hover:text-zinc-800 px-4 py-2 border rounded-md hover:bg-zinc-50 transition">
                Concluir ✓
              </button>
              <button type="submit"
                className="bg-blue-600 text-white px-6 py-2 rounded-md hover:bg-blue-700 transition">
                Próximo →
              </button>
            </>
          )}
        </div>
      </div>
    </form>
  );
}
