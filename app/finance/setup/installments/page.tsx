import { getSessionUserId } from '@/lib/auth';
import { getCards, getInstallments } from '@/lib/finance/data';
import InstallmentsForm from './InstallmentsForm';

export default async function InstallmentsSetupPage() {
  const userId = await getSessionUserId();
  const cards = userId ? await getCards(userId) : [];
  const installments = userId ? await getInstallments(userId) : [];

  return (
    <>
      <InstallmentsForm cards={cards} installments={installments} isGuest={!userId} />
    </>
  );
}
