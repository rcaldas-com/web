'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { saveCardsAndContinue, saveCardsAndFinish } from '@/lib/finance/actions';
import { saveLocalCards, saveDraft, loadDraft, clearDraft } from '@/lib/finance/local-storage';
import type { CreditCard } from '@/lib/finance/types';

const DRAFT_ID = 'cards';

interface CardRow {
  _id?: string;
  name: string;
  dueDay: number;
}

export default function CardsForm({ cards, isGuest }: { cards: CreditCard[]; isGuest?: boolean }) {
  const router = useRouter();
  const draft = isGuest ? loadDraft<{ rows: CardRow[] }>(DRAFT_ID) : null;
  const [rows, setRows] = useState<CardRow[]>(
    draft?.rows || (cards.length
      ? cards.map(c => ({ _id: c._id, name: c.name, dueDay: c.dueDay }))
      : [{ name: '', dueDay: 1 }])
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
      .map(r => ({ ...r, name: r.name.trim(), invoiceTotal: 0 }));
    saveLocalCards(validCards);
    clearDraft(DRAFT_ID);
    router.push(dest === 'continue' ? '/finance/setup/expenses' : '/finance');
  };

  const addRow = () => setRows([...rows, { name: '', dueDay: 1 }]);
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
          <div key={i} className="flex gap-3 items-end border-b pb-3 last:border-b-0">
            <input type="hidden" name="cardId" value={row._id || ''} />
            <div className="flex-1">
              <label className="block text-sm font-medium text-zinc-700">Nome</label>
              <input
                type="text" name="cardName"
                value={row.name}
                onChange={e => updateRow(i, 'name', e.target.value)}
                className="mt-1 block w-full rounded-md border-zinc-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                placeholder="BB, ITAU..."
              />
            </div>
            <div className="w-24">
              <label className="block text-sm font-medium text-zinc-700">Vencimento</label>
              <input
                type="number" name="cardDueDay" min="1" max="31"
                value={row.dueDay}
                onChange={e => updateRow(i, 'dueDay', parseInt(e.target.value) || 1)}
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
