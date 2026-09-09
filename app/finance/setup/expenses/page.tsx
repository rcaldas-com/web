import { getSessionUserId } from '@/lib/auth';
import { getExpenses } from '@/lib/finance/data';
import ExpensesForm from './ExpensesForm';

export default async function ExpensesSetupPage() {
  const userId = await getSessionUserId();
  const expenses = userId ? await getExpenses(userId) : [];

  return (
    <>
      <ExpensesForm expenses={expenses} isGuest={!userId} />
    </>
  );
}
