import { getSessionUserId } from '@/lib/auth';
import { getCards, getInstallments } from '@/lib/finance/data';
import { activeCards } from '@/lib/finance/compute';
import CardsForm from './CardsForm';

export default async function CardsSetupPage() {
  const userId = await getSessionUserId();
  const [cards, installments] = userId
    ? await Promise.all([getCards(userId), getInstallments(userId)])
    : [[], []];
  // Removidos não voltam pra lista: reaparecer depois de remover e salvar
  // era o defeito. Eles seguem nas faturas enquanto tiverem parcela.
  const ativos = activeCards(cards);
  const installmentCounts: Record<string, number> = {};
  for (const i of installments) installmentCounts[i.cardId] = (installmentCounts[i.cardId] ?? 0) + 1;

  return (
    <>
      {/* key pelos ids: depois de salvar um cartão novo, o form remonta com
          o _id que o servidor deu. Sem isso a linha seguia sem id e o
          próximo Salvar criava o cartão DE NOVO (duplicado). */}
      <CardsForm
        key={ativos.map(c => c._id).join(',')}
        cards={ativos}
        installmentCounts={installmentCounts}
        isGuest={!userId}
      />
    </>
  );
}
