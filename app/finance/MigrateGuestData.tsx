'use client';

import { useEffect, useState, useTransition } from 'react';
import { hasLocalFinanceData, getAllLocalData, clearLocalFinanceData, getLocalCards } from '@/lib/finance/local-storage';
import { migrateGuestData } from '@/lib/finance/actions';

export default function MigrateGuestData() {
  const [show, setShow] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [done, setDone] = useState(false);

  useEffect(() => {
    setShow(hasLocalFinanceData());
  }, []);

  if (!show || done) return null;

  const handleMigrate = () => {
    const all = getAllLocalData();
    if (!all.profile) return;

    const cards = getLocalCards();

    startTransition(async () => {
      await migrateGuestData({
        profile: {
          salary: all.profile!.salary,
          foodVoucher: all.profile!.foodVoucher,
          banks: all.profile!.banks,
        },
        cards: cards.map(c => ({ name: c.name, dueDay: c.dueDay, invoiceTotal: c.invoiceTotal })),
        expenses: (all.expenses || []).map((e, i) => ({
          name: e.name,
          value: e.value,
          category: e.category,
          proportional: e.proportional || false,
          dueDay: e.dueDay,
          order: e.order ?? i,
        })),
        installments: (all.installments || []).map(inst => {
          const card = cards.find(c => c._id === inst.cardId);
          return {
            cardName: card?.name || '',
            description: inst.description,
            monthlyValue: inst.monthlyValue,
            remainingInstallments: inst.remainingInstallments,
          };
        }),
      });
      clearLocalFinanceData();
      setDone(true);
      window.location.reload();
    });
  };

  const handleDismiss = () => {
    clearLocalFinanceData();
    setShow(false);
  };

  return (
    <div className="mb-4 rounded-lg border border-blue-300 bg-blue-50 p-4">
      <p className="text-sm font-medium text-blue-900">
        Dados offline encontrados! Deseja importar para sua conta?
      </p>
      <div className="mt-2 flex gap-3">
        <button
          onClick={handleMigrate}
          disabled={isPending}
          className="rounded-md bg-blue-600 px-4 py-1.5 text-sm text-white hover:bg-blue-700 disabled:opacity-50 transition"
        >
          {isPending ? 'Importando...' : 'Importar dados'}
        </button>
        <button
          onClick={handleDismiss}
          disabled={isPending}
          className="rounded-md border px-4 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100 transition"
        >
          Descartar
        </button>
      </div>
    </div>
  );
}
