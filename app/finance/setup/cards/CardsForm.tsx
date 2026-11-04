'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { saveCards, saveCardsAndFinish } from '@/lib/finance/actions';
import { saveLocalCards, getLocalCards, saveDraft, loadDraft, clearDraft } from '@/lib/finance/local-storage';
import { evalExpression } from '@/lib/finance/eval-expression';
import type { CreditCard } from '@/lib/finance/types';
import { useSavedFlash } from '../useSavedFlash';
import { keepFormValues } from '../keepFormValues';
import { useFormDirty } from '../useFormDirty';
import SetupActions from '../SetupActions';
import { FIELD, FIELD_BASE, RemoveRowButton } from '../rowParts';

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

export default function CardsForm({
  cards: serverCards,
  installmentCounts = {},
  isGuest,
}: {
  cards: CreditCard[];
  // Parcelas por cartão -- só pra mensagem de confirmação ao remover.
  installmentCounts?: Record<string, number>;
  isGuest?: boolean;
}) {
  const router = useRouter();
  const [saved, flashSaved] = useSavedFlash();
  const draft = isGuest ? loadDraft<{ rows: DraftCardRow[] }>(DRAFT_ID) : null;
  // Convidado: a página não tem como ler o navegador, então lê aqui. Antes
  // a aba abria vazia pra quem já tinha cartões salvos e não tinha rascunho.
  const cards = isGuest ? getLocalCards().filter(c => !c.removedAt) : serverCards;
  const [rows, setRows] = useState<CardRow[]>(
    draft?.rows?.map(toCardRow) || (cards.length
      ? cards.map(c => toCardRow({ _id: c._id, name: c.name, dueDay: c.dueDay, invoiceTotal: c.invoiceTotal ?? 0 }))
      : [{ name: '', dueDay: '', invoiceTotal: '' }])
  );

  const formRef = useRef<HTMLFormElement>(null);
  const { dirty, check, markSaved } = useFormDirty(formRef);
  const saveTimeout = useRef<ReturnType<typeof setTimeout>>(undefined);

  const autoSave = useCallback(() => {
    if (!isGuest) return;
    clearTimeout(saveTimeout.current);
    saveTimeout.current = setTimeout(() => {
      saveDraft(DRAFT_ID, { rows });
    }, 2000);
  }, [isGuest, rows]);

  useEffect(() => () => clearTimeout(saveTimeout.current), []);

  const handleGuestSubmit = (dest: 'stay' | 'finish') => {
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
    if (dest === 'finish') { router.push('/finance'); return; }
    flashSaved();
  };

  const addRow = () => setRows([...rows, { name: '', dueDay: '', invoiceTotal: '' }]);
  const removeRow = (i: number) => {
    const row = rows[i];
    // Cartão já salvo: confirma, porque ao Salvar ele sai da lista e das
    // faturas futuras (ver isCardVisibleInMonth). Linha nova ainda não
    // existe em lugar nenhum, então some direto.
    if (row._id) {
      const nome = row.name.trim() || 'este cartão';
      const n = installmentCounts[row._id] ?? 0;
      const detalhe = n
        ? `Ele tem ${n} ${n === 1 ? 'parcela' : 'parcelas'} em andamento: elas continuam nas faturas até terminar, e o cartão some quando a última acabar.`
        : 'Ele sai da lista e das faturas dos próximos meses.';
      const ok = window.confirm(
        `Remover ${nome}?\n\n${detalhe}\n\nO histórico dos meses passados é mantido. A remoção vale quando você salvar.`,
      );
      if (!ok) return;
    }
    setRows(rows.filter((_, idx) => idx !== i));
  };
  const updateRow = (i: number, field: string, value: string | number) => {
    setRows(rows.map((r, idx) => idx === i ? { ...r, [field]: value } : r));
  };

  return (
    <form ref={formRef} action={isGuest ? undefined : async (fd) => { await saveCards(fd); markSaved(); flashSaved(); }}
      onChange={autoSave}
      onInput={check}
      onReset={keepFormValues}
      onSubmit={isGuest ? (e) => { e.preventDefault(); handleGuestSubmit('stay'); } : undefined}
      className="space-y-6">
      <div className="bg-white rounded-lg border p-6 space-y-4">
        <div className="flex justify-between items-center">
          <h2 className="text-lg font-semibold">Cartões de Crédito</h2>
          <button type="button" onClick={addRow}
            className="text-sm text-blue-600 hover:text-blue-800">
            + Adicionar
          </button>
        </div>
        {rows.length > 0 && (
          // Rótulo uma vez só, no topo da coluna -- repetir "Nome" e
          // "Vencimento" em cada cartão era a metade da altura de cada um.
          <div className="grid grid-cols-[minmax(0,1fr)_4.5rem_2.25rem] gap-2 px-[9px] text-xs text-zinc-500">
            <span>Nome</span>
            <span className="text-center">Vence dia</span>
            <span aria-hidden />
          </div>
        )}
        <div className="space-y-2">
          {rows.map((row, i) => (
            <div key={i} className="rounded-md border p-2">
              <input type="hidden" name="cardId" value={row._id || ''} />
              <div className="grid grid-cols-[minmax(0,1fr)_4.5rem_2.25rem] items-center gap-2">
                <input
                  type="text" name="cardName"
                  aria-label="Nome do cartão"
                  value={row.name}
                  onChange={e => updateRow(i, 'name', e.target.value)}
                  className={FIELD}
                  placeholder="BB, ITAU..."
                />
                <input
                  type="text" name="cardDueDay" inputMode="numeric" pattern="[0-9]*" maxLength={2}
                  aria-label="Dia de vencimento"
                  value={row.dueDay}
                  onChange={e => updateRow(i, 'dueDay', e.target.value.replace(/\D/g, ''))}
                  className={`${FIELD} text-center`}
                />
                <RemoveRowButton
                  label={`Remover ${row.name || 'cartão'}`}
                  onClick={() => removeRow(i)}
                  hidden={rows.length === 1 && !row._id}
                />
              </div>
              {/* "Fatura atual" só existe no cadastro: é o ponto de partida
                  do mês em que o cartão entra (upsertCard nunca regrava esse
                  valor depois). Mostrar o campo em cartão já salvo exibia um
                  número de meses atrás que, editado, não mudava nada. A
                  fatura de cada mês se ajusta no painel ou em Cartões. */}
              {row._id ? (
                <input type="hidden" name="cardInvoiceTotal" value="" />
              ) : (
                <label className="mt-2 flex items-center gap-2 text-xs text-zinc-500">
                  <span>Fatura já em aberto</span>
                  <input
                    type="text" name="cardInvoiceTotal" inputMode="decimal"
                    value={row.invoiceTotal}
                    onChange={e => updateRow(i, 'invoiceTotal', e.target.value)}
                    className={`${FIELD_BASE} w-28`}
                    placeholder="0,00"
                  />
                </label>
              )}
            </div>
          ))}
        </div>
      </div>

      <SetupActions
        isGuest={isGuest}
        dirty={dirty}
        saved={saved}
        finishAction={saveCardsAndFinish}
        onGuestFinish={() => handleGuestSubmit('finish')}
      />
    </form>
  );
}
