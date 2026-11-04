'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { saveInstallmentsList, saveInstallmentsAndFinish } from '@/lib/finance/actions';
import {
  getLocalCards,
  getLocalInstallments,
  saveLocalInstallments,
} from '@/lib/finance/local-storage';
import { evalExpression } from '@/lib/finance/eval-expression';
import type { CreditCard, Installment } from '@/lib/finance/types';
import { useSavedFlash } from '../useSavedFlash';
import { keepFormValues } from '../keepFormValues';
import { useFormDirty } from '../useFormDirty';
import SetupActions from '../SetupActions';
import { FIELD, LABEL, RemoveRowButton } from '../rowParts';

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
  const [saved, flashSaved] = useSavedFlash();
  const formRef = useRef<HTMLFormElement>(null);
  const { dirty, check, markSaved } = useFormDirty(formRef);
  const guestCards = isGuest ? getLocalCards() : [];
  const cards = isGuest ? guestCards : serverCards;
  const sourceInstallments = isGuest ? getLocalInstallments() : serverInstallments;
  // Cartão removido não serve pra parcela nova, mas continua como opção nas
  // linhas que já apontam pra ele: sem a opção, o <select> controlado
  // mostraria outro cartão e o Salvar moveria a parcela sem ninguém pedir.
  const ativos = cards.filter(c => !c.removedAt);
  const cardOptions = (cardId: string) => cards.filter(c => !c.removedAt || c._id === cardId);
  const defaultCardId = ativos[0]?._id || '';
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

  const handleGuestSubmit = (dest: 'stay' | 'finish') => {
    saveLocalInstallments(validRows);
    if (dest === 'finish') { router.push('/finance'); return; }
    flashSaved();
  };

  return (
    <form
      ref={formRef}
      action={isGuest ? undefined : async (fd) => { await saveInstallmentsList(fd); markSaved(); flashSaved(); }}
      onInput={check}
      onReset={keepFormValues}
      onSubmit={isGuest ? (event) => { event.preventDefault(); handleGuestSubmit('stay'); } : undefined}
      className="space-y-6"
    >
      <div className="bg-white rounded-lg border p-6 space-y-4">
        <h2 className="text-lg font-semibold">Parcelas Atuais</h2>
        <p className="text-sm text-zinc-500">
          Cadastre as compras parceladas em andamento em cada cartão. Todas as linhas preenchidas serão salvas ao concluir.
        </p>

        {ativos.length === 0 && !rows.some(r => r._id) ? (
          <p className="text-zinc-400 text-sm">Nenhum cartão cadastrado. Volte para o passo 2.</p>
        ) : (
          <div className="space-y-3">
            {rows.map((row, index) => (
              <div key={index} className="rounded-md border p-2">
                <input type="hidden" name="installmentId" value={row._id || ''} />
                {/* Duas linhas em qualquer largura: descrição + remover em
                    cima, os três campos curtos embaixo. Antes cada campo
                    empilhava em largura cheia no celular (5 linhas por
                    parcela, a lixeira sozinha numa delas). */}
                <div className="grid grid-cols-[minmax(0,1fr)_2.25rem] items-center gap-2">
                  <input
                    ref={index === rows.length - 1 ? lastDescriptionRef : undefined}
                    type="text"
                    name="description"
                    aria-label="Descrição"
                    value={row.description}
                    onChange={event => updateRow(index, 'description', event.target.value)}
                    className={FIELD}
                    placeholder="Descrição (TV, Sofá...)"
                  />
                  <RemoveRowButton
                    label={`Remover ${row.description || 'parcela'}`}
                    onClick={() => removeRow(index)}
                    hidden={rows.length === 1}
                  />
                </div>
                <div className="mt-2 grid grid-cols-[minmax(0,1fr)_6.5rem_3.5rem] gap-2">
                  <label>
                    <span className={LABEL}>Cartão</span>
                    <select
                      name="cardId"
                      value={row.cardId}
                      onChange={event => updateRow(index, 'cardId', event.target.value)}
                      className={FIELD}
                    >
                      {cardOptions(row.cardId).map(card => (
                        <option key={card._id} value={card._id}>
                          {card.name}{card.removedAt ? ' (removido)' : ''}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span className={LABEL}>Valor/mês</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      name="monthlyValue"
                      value={row.monthlyValue}
                      onChange={event => updateRow(index, 'monthlyValue', event.target.value)}
                      className={FIELD}
                    />
                  </label>
                  <label>
                    <span className={LABEL}>Parc.</span>
                    <input
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      maxLength={2}
                      name="remainingInstallments"
                      value={row.remainingInstallments}
                      onChange={event => updateRow(index, 'remainingInstallments', event.target.value.replace(/\D/g, ''))}
                      className={`${FIELD} text-center`}
                    />
                  </label>
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

      <SetupActions
        isGuest={isGuest}
        dirty={dirty}
        saved={saved}
        finishAction={saveInstallmentsAndFinish}
        onGuestFinish={() => handleGuestSubmit('finish')}
      />
    </form>
  );
}
