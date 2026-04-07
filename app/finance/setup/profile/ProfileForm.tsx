'use client';

import { useState } from 'react';
import { saveProfileAndContinue } from '@/lib/finance/actions';
import type { FinanceProfile, BankAccount } from '@/lib/finance/types';

export default function ProfileForm({ profile }: { profile: FinanceProfile | null }) {
  const [banks, setBanks] = useState<BankAccount[]>(
    profile?.banks?.length ? profile.banks : [{ name: '', balance: 0 }]
  );

  const addBank = () => setBanks([...banks, { name: '', balance: 0 }]);
  const removeBank = (i: number) => setBanks(banks.filter((_, idx) => idx !== i));

  return (
    <form action={saveProfileAndContinue} className="space-y-6">
      <div className="bg-white rounded-lg border p-6 space-y-4">
        <h2 className="text-lg font-semibold">Salário</h2>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-zinc-700">Pagamento (R$)</label>
            <input
              type="number" step="0.01" name="payment"
              defaultValue={profile?.salary?.payment || ''}
              className="mt-1 block w-full rounded-md border-zinc-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
              placeholder="8841.12"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-zinc-700">Dia Pagamento</label>
            <input
              type="number" name="paymentDay"
              defaultValue={profile?.salary?.paymentDay || 7}
              className="mt-1 block w-full rounded-md border-zinc-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-zinc-700">Adiantamento (R$)</label>
            <input
              type="number" step="0.01" name="advance"
              defaultValue={profile?.salary?.advance || ''}
              className="mt-1 block w-full rounded-md border-zinc-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
              placeholder="8378.08"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-zinc-700">Dia Adiantamento</label>
            <input
              type="number" name="advanceDay"
              defaultValue={profile?.salary?.advanceDay || 15}
              className="mt-1 block w-full rounded-md border-zinc-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
            />
          </div>
        </div>
      </div>

      <div className="bg-white rounded-lg border p-6 space-y-4">
        <h2 className="text-lg font-semibold">Vale Refeição/Alimentação</h2>
        <div>
          <label className="block text-sm font-medium text-zinc-700">Valor Mensal (R$)</label>
          <input
            type="number" step="0.01" name="foodVoucher"
            defaultValue={profile?.foodVoucher || ''}
            className="mt-1 block w-full rounded-md border-zinc-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
            placeholder="2300.00"
          />
        </div>
      </div>

      <div className="bg-white rounded-lg border p-6 space-y-4">
        <div className="flex justify-between items-center">
          <h2 className="text-lg font-semibold">Contas Bancárias</h2>
          <button type="button" onClick={addBank}
            className="text-sm text-blue-600 hover:text-blue-800">
            + Adicionar
          </button>
        </div>
        {banks.map((bank, i) => (
          <div key={i} className="flex gap-3 items-end">
            <div className="flex-1">
              <label className="block text-sm font-medium text-zinc-700">Banco</label>
              <input
                type="text" name="bankName"
                defaultValue={bank.name}
                className="mt-1 block w-full rounded-md border-zinc-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                placeholder="MP, BB, ITAU..."
              />
            </div>
            <div className="flex-1">
              <label className="block text-sm font-medium text-zinc-700">Saldo (R$)</label>
              <input
                type="number" step="0.01" name="bankBalance"
                defaultValue={bank.balance}
                className="mt-1 block w-full rounded-md border-zinc-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
              />
            </div>
            {banks.length > 1 && (
              <button type="button" onClick={() => removeBank(i)}
                className="text-red-500 hover:text-red-700 pb-2">
                ✕
              </button>
            )}
          </div>
        ))}
      </div>

      <div className="flex justify-end">
        <button type="submit"
          className="bg-blue-600 text-white px-6 py-2 rounded-md hover:bg-blue-700 transition">
          Próximo →
        </button>
      </div>
    </form>
  );
}
