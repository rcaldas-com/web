import { redirect } from 'next/navigation';
import { getSessionUserId } from '@/lib/auth';
import { getProfile, getCards, getInstallments, getOrInitMonthCardInvoices, buildCardViews } from '@/lib/finance/data';
import { addMonthsToYearMonth, getFinanceToday } from '@/lib/finance/date';
import CardsClient from './CardsClient';
import CardsGuest from './CardsGuest';
import AutoRefresh from '../AutoRefresh';

export default async function CardsPage() {
  const userId = await getSessionUserId();
  if (!userId) return <CardsGuest />;

  const profile = await getProfile(userId);
  if (!profile) redirect('/finance/setup');

  const [cards, installments] = await Promise.all([
    getCards(userId),
    getInstallments(userId),
  ]);

  // Next month's yearMonth
  const nextYearMonth = addMonthsToYearMonth(getFinanceToday().yearMonth, 1);

  // Load next month's invoices and show from next month's perspective
  const nextMonthInvoices = await getOrInitMonthCardInvoices(userId, nextYearMonth, cards, installments, 1);
  const cardViews = buildCardViews(cards, installments, nextMonthInvoices, 1);

  return (
    <>
      <AutoRefresh />
      <CardsClient cardViews={cardViews} cards={cards} nextYearMonth={nextYearMonth} />
    </>
  );
}
