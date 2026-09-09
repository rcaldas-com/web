import { getSessionUserId } from '@/lib/auth';
import { getCards } from '@/lib/finance/data';
import CardsForm from './CardsForm';

export default async function CardsSetupPage() {
  const userId = await getSessionUserId();
  const cards = userId ? await getCards(userId) : [];

  return (
    <>
      <CardsForm cards={cards} isGuest={!userId} />
    </>
  );
}
