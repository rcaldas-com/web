import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getProfile, getCards, getInstallments, getOrInitMonthCardInvoices, buildCardViews } from '@/lib/finance/data';
import CardsClient from './CardsClient';

export default async function CardsPage() {
  const cookieStore = await cookies();
  const userId = cookieStore.get('userId')?.value;
  if (!userId) redirect('/login');

  const profile = await getProfile(userId);
  if (!profile) redirect('/finance/setup');

  const [cards, installments] = await Promise.all([
    getCards(userId),
    getInstallments(userId),
  ]);

  // Next month's yearMonth
  const now = new Date();
  const nextDate = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const nextYearMonth = `${nextDate.getFullYear()}-${String(nextDate.getMonth() + 1).padStart(2, '0')}`;

  // Load next month's invoices and show from next month's perspective
  const nextMonthInvoices = await getOrInitMonthCardInvoices(userId, nextYearMonth, cards, installments, 1);
  const cardViews = buildCardViews(cards, installments, nextMonthInvoices, 1);

  return <CardsClient cardViews={cardViews} cards={cards} nextYearMonth={nextYearMonth} />;
}
