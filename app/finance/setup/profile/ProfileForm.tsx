'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { saveProfileAndContinue, saveProfileAndFinish } from '@/lib/finance/actions';
import { saveLocalProfile, saveDraft, loadDraft, clearDraft } from '@/lib/finance/local-storage';
import { evalExpression } from '@/lib/finance/eval-expression';
import type { FinanceProfile, BankAccount } from '@/lib/finance/types';

const DRAFT_ID = 'profile';

export default function ProfileForm({ profile, isGuest }: { profile: FinanceProfile | null; isGuest?: boolean }) {
  const router = useRouter();
  const draft = isGuest ? loadDraft<{ banks: BankAccount[]; values: Record<string, string> }>(DRAFT_ID) : null;

  const [banks, setBanks] = useState<BankAccount[]>(
    draft?.banks || (profile?.banks?.length ? profile.banks : [{ name: '', balance: 0 }])
  );

  // Debounced auto-save for guest
  const formRef = useRef<HTMLFormElement>(null);
  const saveTimeout = useRef<ReturnType<typeof setTimeout>>(undefined);

  const autoSave = useCallback(() => {
    if (!isGuest || !formRef.current) return;
    clearTimeout(saveTimeout.current);
    saveTimeout.current = setTimeout(() => {
      const fd = new FormData(formRef.current!);
      const values: Record<string, string> = {};
      for (const [k, v] of fd.entries()) values[k] = v as string;
      saveDraft(DRAFT_ID, { banks, values });
    }, 2000);
  }, [isGuest, banks]);

  useEffect(() => () => clearTimeout(saveTimeout.current), []);

  const handleGuestSubmit = (dest: 'continue' | 'finish') => {
    if (!formRef.current) return;
    const fd = new FormData(formRef.current);
    const payment = evalExpression(fd.get('payment') as string);
    const advance = evalExpression(fd.get('advance') as string);
    const paymentDay = parseInt(fd.get('paymentDay') as string) || 7;
    const advanceDay = parseInt(fd.get('advanceDay') as string) || 15;
    const foodVoucher = evalExpression(fd.get('foodVoucher') as string);
    const bankNames = fd.getAll('bankName') as string[];
    const bankBalances = fd.getAll('bankBalance') as string[];
    const parsedBanks = bankNames
      .map((name, i) => ({ name: name.trim(), balance: evalExpression(bankBalances[i]) }))
      .filter(b => b.name);

    saveLocalProfile({
      salary: { payment, advance, paymentDay, advanceDay },
      foodVoucher,
      banks: parsedBanks,
    });
    clearDraft(DRAFT_ID);
    router.push(dest === 'continue' ? '/finance/setup/cards' : '/finance');
  };

  const addBank = () => setBanks([...banks, { name: '', balance: 0 }]);
  const removeBank = (i: number) => setBanks(banks.filter((_, idx) => idx !== i));

  return (
    <form ref={formRef} action={isGuest ? undefined : saveProfileAndContinue} onChange={autoSave}
      onSubmit={isGuest ? (e) => { e.preventDefault(); handleGuestSubmit('continue'); } : undefined}
      className="space-y-6">
      <div className="bg-white rounded-lg border p-6 space-y-4">
        <h2 className="text-lg font-semibold">Salário</h2>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-zinc-700">Pagamento (R$)</label>
            <input
              type="text" inputMode="decimal" name="payment"
              defaultValue={profile?.salary?.payment || ''}
              className="mt-1 block w-full rounded-md border-zinc-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
              placeholder="2500.00"
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
              type="text" inputMode="decimal" name="advance"
              defaultValue={profile?.salary?.advance || ''}
              className="mt-1 block w-full rounded-md border-zinc-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
              placeholder="2500.00"
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
            type="text" inputMode="decimal" name="foodVoucher"
            defaultValue={profile?.foodVoucher || ''}
            className="mt-1 block w-full rounded-md border-zinc-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
            placeholder="1300.00"
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
                placeholder="BB, ITAU..."
              />
            </div>
            <div className="flex-1">
              <label className="block text-sm font-medium text-zinc-700">Saldo (R$)</label>
              <input
                type="text" inputMode="decimal" name="bankBalance"
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

      <div className="flex justify-end gap-3">
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
            <button type="submit" formAction={saveProfileAndFinish}
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
    </form>
  );
}
