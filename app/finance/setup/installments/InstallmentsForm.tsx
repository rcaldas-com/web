'use client';

import { useRef } from 'react';
import { addNewInstallment, removeInstallment, finishSetup } from '@/lib/finance/actions';
import type { CreditCard, Installment } from '@/lib/finance/types';

export default function InstallmentsForm({
  cards,
  installments,
}: {
  cards: CreditCard[];
  installments: Installment[];
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const descriptionRef = useRef<HTMLInputElement>(null);

  const handleAdd = async (formData: FormData) => {
    await addNewInstallment(formData);
    formRef.current?.reset();
    setTimeout(() => descriptionRef.current?.focus(), 100);
  };

  // Group by card
  const byCard = new Map<string, Installment[]>();
  for (const inst of installments) {
    const list = byCard.get(inst.cardId) || [];
    list.push(inst);
    byCard.set(inst.cardId, list);
  }

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-lg border p-6 space-y-4">
        <h2 className="text-lg font-semibold">Parcelas Atuais</h2>
        <p className="text-sm text-zinc-500">
          Cadastre as compras parceladas em andamento em cada cartão.
        </p>

        {/* List existing installments by card */}
        {cards.map(card => {
          const items = byCard.get(card._id!) || [];
          if (items.length === 0) return null;
          return (
            <div key={card._id} className="border rounded-md p-3">
              <h3 className="font-semibold text-zinc-700 mb-2">{card.name}</h3>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-zinc-500 border-b">
                    <th className="pb-1">Descrição</th>
                    <th className="pb-1 text-right">Valor/mês</th>
                    <th className="pb-1 text-right">Restantes</th>
                    <th className="pb-1 w-10"></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map(inst => (
                    <tr key={inst._id} className="border-b last:border-b-0">
                      <td className="py-1">{inst.description}</td>
                      <td className="py-1 text-right">
                        {inst.monthlyValue.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                      </td>
                      <td className="py-1 text-right">{inst.remainingInstallments}x</td>
                      <td className="py-1 text-right">
                        <button
                          onClick={() => removeInstallment(inst._id!)}
                          className="text-red-500 hover:text-red-700 text-xs">
                          ✕
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })}

        {cards.length === 0 ? (
          <p className="text-zinc-400 text-sm">Nenhum cartão cadastrado. Volte para o passo 2.</p>
        ) : (
          <form ref={formRef} action={handleAdd} className="space-y-3 border border-dashed border-blue-300 rounded-md p-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-zinc-700">Descrição</label>
                <input ref={descriptionRef} type="text" name="description"
                  className="mt-1 block w-full rounded-md border-zinc-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                  placeholder="TV, Sofá..." />
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-700">Cartão</label>
                <select name="cardId"
                  className="mt-1 block w-full rounded-md border-zinc-300 shadow-sm focus:border-blue-500 focus:ring-blue-500">
                  {cards.map(c => (
                    <option key={c._id} value={c._id}>{c.name}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-zinc-700">Valor/mês (R$)</label>
                <input type="number" step="0.01" name="monthlyValue"
                  className="mt-1 block w-full rounded-md border-zinc-300 shadow-sm focus:border-blue-500 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-700">Parcelas restantes</label>
                <input type="number" name="remainingInstallments"
                  className="mt-1 block w-full rounded-md border-zinc-300 shadow-sm focus:border-blue-500 focus:ring-blue-500" />
              </div>
            </div>
            <button type="submit"
              className="w-full py-2 text-sm text-blue-600 hover:text-blue-800 border border-dashed border-blue-300 rounded-md hover:bg-blue-50 transition">
              + Adicionar parcela
            </button>
          </form>
        )}
      </div>

      <div className="flex justify-between">
        <a href="/finance/setup/expenses"
          className="text-zinc-600 hover:text-zinc-800 px-4 py-2">
          ← Voltar
        </a>
        <form action={finishSetup}>
          <button type="submit"
            className="bg-blue-600 text-white px-6 py-2 rounded-md hover:bg-blue-700 transition">
            Concluir ✓
          </button>
        </form>
      </div>
    </div>
  );
}
