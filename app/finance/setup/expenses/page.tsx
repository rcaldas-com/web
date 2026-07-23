import { getSessionUserId } from '@/lib/auth';
import { getExpenses } from '@/lib/finance/data';
import ExpensesForm from './ExpensesForm';

export default async function ExpensesSetupPage() {
  const userId = await getSessionUserId();
  const expenses = userId ? await getExpenses(userId) : [];

  return (
    <>
      <div className="flex items-center gap-2 text-sm text-zinc-500 mb-4">
        <span>1. Perfil</span>
        <span>→</span><span>2. Cartões</span>
        <span>→</span><span className="font-semibold text-zinc-900">3. Despesas</span>
        <span>→</span><span>4. Parcelas</span>
      </div>
      <ExpensesForm expenses={expenses} isGuest={!userId} />
    </>
  );
}
