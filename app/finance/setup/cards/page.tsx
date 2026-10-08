import { getSessionUserId } from '@/lib/auth';
import { getCards } from '@/lib/finance/data';
import CardsForm from './CardsForm';

export default async function CardsSetupPage() {
  const userId = await getSessionUserId();
  const cards = userId ? await getCards(userId) : [];

  return (
    <>
      {/* key pelos ids: depois de salvar um cartão novo, o form remonta com
          o _id que o servidor deu. Sem isso a linha seguia sem id e o
          próximo Salvar criava o cartão DE NOVO (duplicado). */}
      <CardsForm key={cards.map(c => c._id).join(',')} cards={cards} isGuest={!userId} />
    </>
  );
}
