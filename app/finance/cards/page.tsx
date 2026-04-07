import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getProfile, getCards, getInstallments, buildCardViews } from '@/lib/finance/data';
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

  const cardViews = buildCardViews(cards, installments);

  return <CardsClient cardViews={cardViews} cards={cards} />;
}
