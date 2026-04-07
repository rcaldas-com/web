'use client';

import { useState, useRef, useEffect } from 'react';
import { saveExpensesAndContinue } from '@/lib/finance/actions';
import type { RecurringExpense } from '@/lib/finance/types';

interface ExpenseRow {
  name: string;
  value: number;
  category: 'card' | 'cash';
  proportional: false | 'daily' | 'weekly';
  dueDay?: number;
}

export default function ExpensesForm({ expenses }: { expenses: RecurringExpense[] }) {
  const [rows, setRows] = useState<ExpenseRow[]>(
    expenses.length
      ? expenses.map(e => ({
          name: e.name, value: e.value, category: e.category,
          proportional: e.proportional || false, dueDay: e.dueDay,
        }))
      : [{ name: '', value: 0, category: 'cash', proportional: false }]
  );

  const addRow = () => {
    setRows([...rows, { name: '', value: 0, category: 'cash', proportional: false as false }]);
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
    <form action={saveExpensesAndContinue} className="space-y-6">
      <div className="bg-white rounded-lg border p-6 space-y-4">
        <div className="flex justify-between items-center">
          <h2 className="text-lg font-semibold">Despesas Recorrentes</h2>
        </div>
        <p className="text-sm text-zinc-500">
          <strong>Cartão:</strong> débito no cartão (impacta fatura). <strong>À vista:</strong> débito direto (pix/boleto).
          <br /><strong>Proporcional:</strong> diário = valor × dias no mês | semanal = valor × (dias / 7).
        </p>
        {rows.map((row, i) => (
          <div key={i} className="border rounded-md p-3 space-y-2">
            <div className="flex gap-3">
              <div className="flex-1">
                <input
                  ref={i === rows.length - 1 ? lastNameRef : undefined}
                  type="text" name="expName"
                  value={row.name}
                  onChange={e => updateRow(i, 'name', e.target.value)}
                  className="block w-full rounded-md border-zinc-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                  placeholder="Nome da despesa"
                />
              </div>
              <div className="w-32">
                <input
                  type="number" step="0.01" name="expValue"
                  value={row.value || ''}
                  onChange={e => updateRow(i, 'value', e.target.value)}
                  className="block w-full rounded-md border-zinc-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                  placeholder="Valor"
                />
              </div>
              {rows.length > 1 && (
                <button type="button" onClick={() => removeRow(i)}
                  className="text-red-500 hover:text-red-700">
                  ✕
                </button>
              )}
            </div>
            <div className="flex gap-4 items-center text-sm">
              <select
                name="expCategory"
                value={row.category}
                onChange={e => updateRow(i, 'category', e.target.value)}
                className="rounded-md border-zinc-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
              >
                <option value="card">Cartão</option>
                <option value="cash">À vista</option>
              </select>
              <select
                name="expProportional"
                value={row.proportional || ''}
                onChange={e => updateRow(i, 'proportional', e.target.value || false)}
                className="rounded-md border-zinc-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
              >
                <option value="">Fixo</option>
                <option value="daily">Proporcional/dia</option>
                <option value="weekly">Proporcional/semana</option>
              </select>
              {!row.proportional ? (
                <div className="flex items-center gap-1">
                  <span>Dia:</span>
                  <input
                    type="number" name="expDueDay" min="1" max="31"
                    value={row.dueDay || ''}
                    onChange={e => updateRow(i, 'dueDay', e.target.value)}
                    className="w-16 rounded-md border-zinc-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                    placeholder="-"
                  />
                </div>
              ) : (
                <input type="hidden" name="expDueDay" value="" />
              )}
            </div>
          </div>
        ))}
        <button type="button" onClick={addRow}
          className="w-full py-2 text-sm text-blue-600 hover:text-blue-800 border border-dashed border-blue-300 rounded-md hover:bg-blue-50 transition">
          + Adicionar despesa
        </button>
      </div>

      <div className="flex justify-between">
        <a href="/finance/setup/cards"
          className="text-zinc-600 hover:text-zinc-800 px-4 py-2">
          ← Voltar
        </a>
        <button type="submit"
          className="bg-blue-600 text-white px-6 py-2 rounded-md hover:bg-blue-700 transition">
          Próximo →
        </button>
      </div>
    </form>
  );
}
