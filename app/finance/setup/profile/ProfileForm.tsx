'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { saveProfile, saveProfileAndFinish } from '@/lib/finance/actions';
import { saveLocalProfile, saveDraft, loadDraft, clearDraft } from '@/lib/finance/local-storage';
import { evalExpression } from '@/lib/finance/eval-expression';
import { DEFAULT_FOOD_VOUCHER_COVERAGE, parseFoodVoucherCoverage } from '@/lib/finance/compute';
import type { FinanceProfile, BankAccount } from '@/lib/finance/types';
import { useSavedFlash } from '../useSavedFlash';
import { keepFormValues } from '../keepFormValues';
import { useFormDirty } from '../useFormDirty';
import SetupActions from '../SetupActions';

const DRAFT_ID = 'profile';

export default function ProfileForm({ profile, isGuest }: { profile: FinanceProfile | null; isGuest?: boolean }) {
  const router = useRouter();
  const [saved, flashSaved] = useSavedFlash();
  const draft = isGuest ? loadDraft<{ banks: BankAccount[]; values: Record<string, string> }>(DRAFT_ID) : null;

  const [banks, setBanks] = useState<BankAccount[]>(
    draft?.banks || (profile?.banks?.length ? profile.banks : [{ name: '', balance: 0 }])
  );

  // Debounced auto-save for guest
  const formRef = useRef<HTMLFormElement>(null);
  const { dirty, check, markSaved } = useFormDirty(formRef);
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

  const handleGuestSubmit = (dest: 'stay' | 'finish') => {
    if (!formRef.current) return;
    const fd = new FormData(formRef.current);
    const payment = evalExpression(fd.get('payment') as string);
    const advance = evalExpression(fd.get('advance') as string);
    const paymentDay = parseInt(fd.get('paymentDay') as string) || 7;
    const advanceDay = parseInt(fd.get('advanceDay') as string) || 15;
    const foodVoucher = evalExpression(fd.get('foodVoucher') as string);
    const foodVoucherMonthly = evalExpression(fd.get('foodVoucherMonthly') as string) || foodVoucher;
    const foodVoucherCoverage = parseFoodVoucherCoverage(fd.get('foodVoucherCoverage'));
    const bankNames = fd.getAll('bankName') as string[];
    const bankBalances = fd.getAll('bankBalance') as string[];
    const parsedBanks = bankNames
      .map((name, i) => ({ name: name.trim(), balance: evalExpression(bankBalances[i]) }))
      .filter(b => b.name);

    saveLocalProfile({
      salary: { payment, advance, paymentDay, advanceDay },
      foodVoucher,
      foodVoucherMonthly,
      foodVoucherCoverage,
      banks: parsedBanks,
    });
    clearDraft(DRAFT_ID);
    // Com abas, não existe mais "próxima etapa": Salvar fica na tela
    // (ajuste pontual); só Concluir volta pro painel.
    if (dest === 'finish') { router.push('/finance'); return; }
    flashSaved();
  };

  const addBank = () => setBanks([...banks, { name: '', balance: 0 }]);
  const removeBank = (i: number) => setBanks(banks.filter((_, idx) => idx !== i));

  return (
    <form ref={formRef} action={isGuest ? undefined : async (fd) => { await saveProfile(fd); markSaved(); flashSaved(); }} onChange={autoSave}
      onInput={check}
      onReset={keepFormValues}
      onSubmit={isGuest ? (e) => { e.preventDefault(); handleGuestSubmit('stay'); } : undefined}
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
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-zinc-700">Crédito Mensal (R$)</label>
            <input
              type="text" inputMode="decimal" name="foodVoucherMonthly"
              defaultValue={profile?.foodVoucherMonthly || profile?.foodVoucher || ''}
              className="mt-1 block w-full rounded-md border-zinc-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
              placeholder="2000.00"
            />
            <p className="text-xs text-zinc-400 mt-1">Valor cheio creditado todo mês (projeções)</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-zinc-700">Saldo Atual (R$)</label>
            <input
              type="text" inputMode="decimal" name="foodVoucher"
              defaultValue={profile?.foodVoucher || ''}
              className="mt-1 block w-full rounded-md border-zinc-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
              placeholder="1300.00"
            />
            <p className="text-xs text-zinc-400 mt-1">Saldo restante neste mês</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-zinc-700">Cobertura nas refeições (%)</label>
            <input
              type="text" inputMode="decimal" name="foodVoucherCoverage"
              defaultValue={profile?.foodVoucherCoverage ?? DEFAULT_FOOD_VOUCHER_COVERAGE}
              className="mt-1 block w-full rounded-md border-zinc-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
            />
            <p className="text-xs text-zinc-400 mt-1">
              O VR conta no saldo só até esse % do que falta das despesas marcadas &quot;VR&quot;
            </p>
          </div>
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
        {/* Mesmo padrão de linha das outras 3 abas: caixa com borda +
            grid nomeado, coluna única (empilha em largura cheia) abaixo
            de sm -- evita o botão de apagar sobrar sozinho numa linha,
            mesmo defeito já corrigido em Parcelas. */}
        {banks.map((bank, i) => (
          <div key={i} className="rounded-md border p-3">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_2rem] sm:items-end">
              <div>
                <label className="block text-sm font-medium text-zinc-700">Banco</label>
                <input
                  type="text" name="bankName"
                  defaultValue={bank.name}
                  className="mt-1 block h-9 w-full rounded-md border-zinc-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                  placeholder="BB, ITAU..."
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-700">Saldo (R$)</label>
                <input
                  type="text" inputMode="decimal" name="bankBalance"
                  defaultValue={bank.balance}
                  className="mt-1 block h-9 w-full rounded-md border-zinc-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                />
              </div>
              {banks.length > 1 && (
                <button type="button" onClick={() => removeBank(i)}
                  className="h-9 w-8 justify-self-start rounded-md text-red-500 hover:bg-red-50 hover:text-red-700 sm:justify-self-center">
                  ✕
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      <SetupActions
        isGuest={isGuest}
        dirty={dirty}
        saved={saved}
        finishAction={saveProfileAndFinish}
        onGuestFinish={() => handleGuestSubmit('finish')}
      />
    </form>
  );
}
