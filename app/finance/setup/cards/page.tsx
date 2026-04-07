import { cookies } from 'next/headers';
import { getCards } from '@/lib/finance/data';
import CardsForm from './CardsForm';

export default async function CardsSetupPage() {
  const cookieStore = await cookies();
  const userId = cookieStore.get('userId')!.value;
  const cards = await getCards(userId);

  return (
    <>
      <div className="flex items-center gap-2 text-sm text-zinc-500 mb-4">
        <span>1. Perfil</span>
        <span>→</span><span className="font-semibold text-zinc-900">2. Cartões</span>
        <span>→</span><span>3. Despesas</span>
        <span>→</span><span>4. Parcelas</span>
      </div>
      <CardsForm cards={cards} />
    </>
  );
}
