import { cookies } from 'next/headers';
import { getCards, getInstallments } from '@/lib/finance/data';
import InstallmentsForm from './InstallmentsForm';

export default async function InstallmentsSetupPage() {
  const cookieStore = await cookies();
  const userId = cookieStore.get('userId')!.value;
  const cards = await getCards(userId);
  const installments = await getInstallments(userId);

  return (
    <>
      <div className="flex items-center gap-2 text-sm text-zinc-500 mb-4">
        <span>1. Perfil</span>
        <span>→</span><span>2. Cartões</span>
        <span>→</span><span>3. Despesas</span>
        <span>→</span><span className="font-semibold text-zinc-900">4. Parcelas</span>
      </div>
      <InstallmentsForm cards={cards} installments={installments} />
    </>
  );
}
