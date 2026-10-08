import { getSessionUserId } from '@/lib/auth';
import { getExpenses } from '@/lib/finance/data';
import ExpensesForm from './ExpensesForm';

export default async function ExpensesSetupPage() {
  const userId = await getSessionUserId();
  const expenses = userId ? await getExpenses(userId) : [];

  return (
    <>
      {/* key pelos ids: mesma razão do CardsForm -- sem o _id novo, o
          próximo Salvar dava baixa na despesa recém-criada e criava outra. */}
      <ExpensesForm key={expenses.map(e => e._id).join(',')} expenses={expenses} isGuest={!userId} />
    </>
  );
}
