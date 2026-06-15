'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import CardsClient from './CardsClient';
import {
  getLocalCards,
  getLocalInstallments,
  getLocalMonthData,
} from '@/lib/finance/local-storage';
import { addMonthsToYearMonth, getFinanceToday } from '@/lib/finance/date';
import { buildCardViews, initMonthCardInvoices } from '@/lib/finance/compute';
import type { CardView, CreditCard } from '@/lib/finance/types';

export default function CardsGuest() {
  const router = useRouter();
  const [state, setState] = useState<{
    cards: CreditCard[];
    cardViews: CardView[];
    nextYearMonth: string;
  } | null>(null);

  const refresh = () => {
    const cards = getLocalCards();
    const installments = getLocalInstallments();

    if (cards.length === 0) {
      router.replace('/finance/setup/cards');
      return;
    }

    const nextYearMonth = addMonthsToYearMonth(getFinanceToday().yearMonth, 1);
    const monthData = getLocalMonthData(nextYearMonth);
    const invoices = monthData?.cardInvoices?.length
      ? monthData.cardInvoices
      : initMonthCardInvoices(cards, installments, 1);

    setState({
      cards,
      cardViews: buildCardViews(cards, installments, invoices, 1),
      nextYearMonth,
    });
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!state) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <p className="text-zinc-500 dark:text-zinc-400">Carregando...</p>
      </div>
    );
  }

  return (
    <CardsClient
      cardViews={state.cardViews}
      cards={state.cards}
      nextYearMonth={state.nextYearMonth}
      isGuest
      onGuestAction={refresh}
    />
  );
}
