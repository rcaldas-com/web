'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { saveInstallmentsAndFinish } from '@/lib/finance/actions';
import {
  getLocalCards,
  getLocalInstallments,
  saveLocalInstallments,
} from '@/lib/finance/local-storage';
import { evalExpression } from '@/lib/finance/eval-expression';
import type { CreditCard, Installment } from '@/lib/finance/types';

interface InstallmentRow {
  _id?: string;
  description: string;
  cardId: string;
  monthlyValue: string;
  remainingInstallments: string;
}

const displayRemaining = (remaining: number) => String(Math.max(1, remaining - 1));

const toRow = (inst: Installment, fallbackCardId: string): InstallmentRow => ({
  _id: inst._id,
  description: inst.description,
  cardId: inst.cardId || fallbackCardId,
  monthlyValue: inst.monthlyValue ? String(inst.monthlyValue).replace('.', ',') : '',
  remainingInstallments: inst.remainingInstallments ? displayRemaining(inst.remainingInstallments) : '',
});

const blankRow = (cardId: string): InstallmentRow => ({
  description: '',
  cardId,
  monthlyValue: '',
  remainingInstallments: '',
});

export default function InstallmentsForm({
  cards: serverCards,
  installments: serverInstallments,
  isGuest,
}: {
  cards: CreditCard[];
  installments: Installment[];
  isGuest?: boolean;
}) {
  const router = useRouter();
  const guestCards = isGuest ? getLocalCards() : [];
  const cards = isGuest ? guestCards : serverCards;
  const sourceInstallments = isGuest ? getLocalInstallments() : serverInstallments;
  const defaultCardId = cards[0]?._id || '';
  const [rows, setRows] = useState<InstallmentRow[]>(
    sourceInstallments.length
      ? sourceInstallments.map(inst => toRow(inst, defaultCardId))
      : [blankRow(defaultCardId)]
  );
  const lastDescriptionRef = useRef<HTMLInputElement>(null);
  const shouldFocusNewRow = useRef(false);

  const addRow = () => {
    setRows([...rows, blankRow(defaultCardId)]);
    shouldFocusNewRow.current = true;
    setTimeout(() => {
      if (shouldFocusNewRow.current) {
        lastDescriptionRef.current?.focus();
        shouldFocusNewRow.current = false;
      }
    }, 0);
  };

  const removeRow = (index: number) => {
    setRows(rows.length > 1 ? rows.filter((_, i) => i !== index) : [blankRow(defaultCardId)]);
  };

  const updateRow = (index: number, field: keyof InstallmentRow, value: string) => {
    setRows(rows.map((row, i) => i === index ? { ...row, [field]: value } : row));
  };

  const validRows = rows
    .map(row => {
      const monthlyValue = evalExpression(row.monthlyValue);
      const remainingInstallments = parseInt(row.remainingInstallments) || 0;
      return {
        _id: row._id,
        description: row.description.trim(),
        cardId: row.cardId,
        monthlyValue,
        remainingInstallments: remainingInstallments ? remainingInstallments + 1 : 0,
      };
    })
    .filter(row => row.cardId && row.description && row.monthlyValue && row.remainingInstallments);

  const handleGuestSubmit = () => {
    saveLocalInstallments(validRows);
    router.push('/finance');
  };

  return (
    <form
      action={isGuest ? undefined : saveInstallmentsAndFinish}
      onSubmit={isGuest ? (event) => { event.preventDefault(); handleGuestSubmit(); } : undefined}
      className="space-y-6"
    >
      <div className="bg-white rounded-lg border p-6 space-y-4">
        <h2 className="text-lg font-semibold">Parcelas Atuais</h2>
        <p className="text-sm text-zinc-500">
          Cadastre as compras parceladas em andamento em cada cartão. Todas as linhas preenchidas serão salvas ao concluir.
        </p>

        {cards.length === 0 ? (
          <p className="text-zinc-400 text-sm">Nenhum cartão cadastrado. Volte para o passo 2.</p>
        ) : (
          <div className="space-y-3">
            {rows.map((row, index) => (
              <div key={index} className="rounded-md border p-3">
                <input type="hidden" name="installmentId" value={row._id || ''} />
                <div className="flex flex-wrap items-end gap-2">
                  <div className="min-w-[180px] flex-[1_1_220px]">
                    <label className="block text-xs font-medium text-zinc-600">Descrição</label>
                    <input
                      ref={index === rows.length - 1 ? lastDescriptionRef : undefined}
                      type="text"
                      name="description"
                      value={row.description}
                      onChange={event => updateRow(index, 'description', event.target.value)}
                      className="mt-1 block h-9 w-full rounded-md border-zinc-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                      placeholder="TV, Sofá..."
                    />
                  </div>
                  <div className="w-28">
                    <label className="block text-xs font-medium text-zinc-600">Cartão</label>
                    <select
                      name="cardId"
                      value={row.cardId}
                      onChange={event => updateRow(index, 'cardId', event.target.value)}
                      className="mt-1 block h-9 w-full rounded-md border-zinc-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                    >
                      {cards.map(card => (
                        <option key={card._id} value={card._id}>{card.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="w-28">
                    <label className="block text-xs font-medium text-zinc-600">Valor/mês</label>
                    <input
                      type="text"
                      inputMode="decimal"
                      name="monthlyValue"
                      value={row.monthlyValue}
                      onChange={event => updateRow(index, 'monthlyValue', event.target.value)}
                      className="mt-1 block h-9 w-full rounded-md border-zinc-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                    />
                  </div>
                  <div className="w-16">
                    <label className="block text-xs font-medium text-zinc-600">Parc.</label>
                    <input
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      maxLength={2}
                      name="remainingInstallments"
                      value={row.remainingInstallments}
                      onChange={event => updateRow(index, 'remainingInstallments', event.target.value.replace(/\D/g, ''))}
                      className="mt-1 block h-9 w-full rounded-md border-zinc-300 text-center shadow-sm focus:border-blue-500 focus:ring-blue-500"
                    />
                  </div>
                  {rows.length > 1 && (
                    <button type="button" onClick={() => removeRow(index)}
                      className="h-9 w-8 rounded-md text-red-500 hover:bg-red-50 hover:text-red-700">
                      ✕
                    </button>
                  )}
                </div>
              </div>
            ))}
            <button type="button" onClick={addRow}
              className="w-full py-2 text-sm text-blue-600 hover:text-blue-800 border border-dashed border-blue-300 rounded-md hover:bg-blue-50 transition">
              + Adicionar parcela
            </button>
          </div>
        )}
      </div>

      <div className="flex justify-between">
        <a href="/finance/setup/expenses"
          className="text-zinc-600 hover:text-zinc-800 px-4 py-2">
          ← Voltar
        </a>
        <button type="submit"
          className="bg-blue-600 text-white px-6 py-2 rounded-md hover:bg-blue-700 transition">
          Concluir ✓
        </button>
      </div>
    </form>
  );
}
