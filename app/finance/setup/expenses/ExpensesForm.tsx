'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { saveExpensesList, saveExpensesAndFinish } from '@/lib/finance/actions';
import { saveLocalExpenses, saveDraft, loadDraft, clearDraft, getLocalExpenses } from '@/lib/finance/local-storage';
import type { RecurringExpense } from '@/lib/finance/types';
import { useSavedFlash } from '../useSavedFlash';
import { keepFormValues } from '../keepFormValues';
import { useFormDirty } from '../useFormDirty';
import SetupActions from '../SetupActions';
import { FIELD, RemoveRowButton } from '../rowParts';

const DRAFT_ID = 'expenses';

interface ExpenseRow {
  id: string;
  name: string;
  value: number;
  category: 'card' | 'cash';
  proportional: false | 'daily' | 'weekly';
  dueDay?: number;
  defaultPayment?: number | string;
  mealVoucher?: boolean | null;
}

export default function ExpensesForm({ expenses, isGuest }: { expenses: RecurringExpense[]; isGuest?: boolean }) {
  const router = useRouter();
  const [saved, flashSaved] = useSavedFlash();
  const formRef = useRef<HTMLFormElement>(null);
  const { dirty, check, markSaved } = useFormDirty(formRef);
  const draft = isGuest ? loadDraft<{ rows: ExpenseRow[] }>(DRAFT_ID) : null;
  const localExpenses = isGuest && !draft ? getLocalExpenses() : [];
  const [rows, setRows] = useState<ExpenseRow[]>(
    draft?.rows || (isGuest && localExpenses.length
      ? localExpenses.map(e => ({
          id: e._id || '', name: e.name, value: e.value, category: e.category,
          proportional: e.proportional || false, dueDay: e.dueDay, defaultPayment: e.defaultPayment ?? undefined,
          mealVoucher: e.mealVoucher,
        }))
      : expenses.length
        ? expenses.map(e => ({
            id: e._id || '', name: e.name, value: e.value, category: e.category,
            proportional: e.proportional || false, dueDay: e.dueDay, defaultPayment: e.defaultPayment ?? undefined,
            mealVoucher: e.mealVoucher,
          }))
        : [{ id: '', name: '', value: 0, category: 'cash', proportional: false }])
  );

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
    const validExpenses = rows
      .filter(r => r.name.trim())
      .map((r, i) => ({
        ...(r.id ? { _id: r.id } : {}),
        name: r.name.trim(),
        value: typeof r.value === 'string' ? parseFloat(String(r.value).replace(',', '.')) || 0 : r.value,
        category: r.category,
        proportional: r.proportional,
        dueDay: r.dueDay ? Number(r.dueDay) : undefined,
        defaultPayment: Number(String(r.defaultPayment ?? '').replace(',', '.')) || undefined,
        mealVoucher: Boolean(r.mealVoucher),
        order: i,
      }));
    saveLocalExpenses(validExpenses);
    clearDraft(DRAFT_ID);
    if (dest === 'finish') { router.push('/finance'); return; }
    flashSaved();
  };

  const addRow = () => {
    setRows([...rows, { id: '', name: '', value: 0, category: 'cash' as const, proportional: false as const }]);
    focusNewRow.current = true;
  };
  const removeRow = (i: number) => setRows(rows.filter((_, idx) => idx !== i));
  const updateRow = (i: number, field: string, value: string | boolean) => {
    setRows(rows.map((r, idx) => idx === i ? { ...r, [field]: value } : r));
  };
  const lastNameRef = useRef<HTMLInputElement>(null);
  const focusNewRow = useRef(false);

  useEffect(() => {
    if (focusNewRow.current && lastNameRef.current) {
      lastNameRef.current.focus();
      focusNewRow.current = false;
    }
  });

  return (
    <form ref={formRef} action={isGuest ? undefined : async (fd) => { await saveExpensesList(fd); markSaved(); flashSaved(); }}
      onChange={autoSave}
      onInput={check}
      onReset={keepFormValues}
      onSubmit={isGuest ? (e) => { e.preventDefault(); handleGuestSubmit('stay'); } : undefined}
      className="space-y-6">
      <div className="bg-white rounded-lg border p-6 space-y-4">
        <div className="flex justify-between items-center">
          <h2 className="text-lg font-semibold">Despesas Recorrentes</h2>
        </div>
        <p className="text-sm text-zinc-500">
          <strong>Cartão:</strong> débito no cartão (impacta fatura). <strong>À vista:</strong> débito direto (pix/boleto).
          <br /><strong>Por dia / Por semana:</strong> proporcional -- valor × dias no mês, ou valor × (dias / 7).
        </p>
        {rows.map((row, i) => (
          <div key={i} className="space-y-2 rounded-md border p-2">
            <input type="hidden" name="expId" value={row.id} />
            {/* Mesmo padrão das outras abas: nome + valor + remover numa
                linha em qualquer largura (antes empilhava no celular e a
                lixeira sobrava sozinha numa linha). */}
            <div className="grid grid-cols-[minmax(0,1fr)_6.5rem_2.25rem] items-center gap-2">
              <input
                ref={i === rows.length - 1 ? lastNameRef : undefined}
                type="text" name="expName"
                aria-label="Nome da despesa"
                value={row.name}
                onChange={e => updateRow(i, 'name', e.target.value)}
                className={FIELD}
                placeholder="Nome da despesa"
              />
              <input
                type="text" inputMode="decimal" name="expValue"
                aria-label="Valor"
                value={row.value || ''}
                onChange={e => updateRow(i, 'value', e.target.value)}
                className={FIELD}
                placeholder="Valor"
              />
              <RemoveRowButton
                label={`Remover ${row.name || 'despesa'}`}
                onClick={() => removeRow(i)}
                hidden={rows.length === 1}
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <select
                name="expCategory"
                aria-label="Forma de pagamento"
                value={row.category}
                onChange={e => updateRow(i, 'category', e.target.value)}
                className={FIELD}
              >
                <option value="card">Cartão</option>
                <option value="cash">À vista</option>
              </select>
              <select
                name="expProportional"
                aria-label="Fixo ou proporcional"
                value={row.proportional || ''}
                onChange={e => updateRow(i, 'proportional', e.target.value || false)}
                className={FIELD}
              >
                <option value="">Fixo</option>
                <option value="daily">Por dia</option>
                <option value="weekly">Por semana</option>
              </select>
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-zinc-600">
              {!row.proportional ? (
                <label className="flex items-center gap-1">
                  <span>Dia</span>
                  <input
                    type="text" inputMode="numeric" pattern="[0-9]*" maxLength={2} name="expDueDay"
                    value={row.dueDay || ''}
                    onChange={e => updateRow(i, 'dueDay', e.target.value.replace(/\D/g, ''))}
                    className={`${FIELD} w-12 text-center`}
                    placeholder="-"
                  />
                </label>
              ) : (
                <input type="hidden" name="expDueDay" value="" />
              )}
              {/* Proporcional não tem pagamento (sem checkbox no painel),
                  então padrão não se aplica -- mas o hidden fica pra manter
                  o alinhamento posicional do getAll() no servidor. */}
              {!row.proportional ? (
                <label className="flex items-center gap-1" title="Valor com que o pagamento abre, no lugar do restante. Vazio = restante.">
                  <span>Padrão</span>
                  <input
                    type="text" inputMode="decimal" name="expDefaultPayment"
                    value={row.defaultPayment ?? ''}
                    onChange={e => updateRow(i, 'defaultPayment', e.target.value)}
                    className={`${FIELD} w-20`}
                    placeholder="-"
                  />
                </label>
              ) : (
                <input type="hidden" name="expDefaultPayment" value="" />
              )}
              {/* Hidden carrega o valor (checkbox desmarcado não vai no form
                  e desalinharia o getAll() posicional no servidor). */}
              <input type="hidden" name="expMealVoucher" value={row.mealVoucher ? '1' : ''} />
              <label className="flex items-center gap-1" title="Pode ser paga com VR -- limita quanto do saldo do vale conta como dinheiro">
                <input
                  type="checkbox"
                  checked={Boolean(row.mealVoucher)}
                  onChange={e => updateRow(i, 'mealVoucher', e.target.checked)}
                  className="rounded border-zinc-300"
                />
                <span>VR</span>
              </label>
            </div>
          </div>
        ))}
        <button type="button" onClick={addRow}
          className="w-full py-2 text-sm text-blue-600 hover:text-blue-800 border border-dashed border-blue-300 rounded-md hover:bg-blue-50 transition">
          + Adicionar despesa
        </button>
      </div>

      <SetupActions
        isGuest={isGuest}
        dirty={dirty}
        saved={saved}
        finishAction={saveExpensesAndFinish}
        onGuestFinish={() => handleGuestSubmit('finish')}
      />
    </form>
  );
}
