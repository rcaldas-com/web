import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import {
  getProfile,
  getCards,
  getExpenses,
  getInstallments,
  getMonthData,
  groupInstallments,
  buildCardViews,
  calculateMonthBalance,
  calculateTotalBalance,
  calculateProjections,
} from '@/lib/finance/data';
import DashboardClient from './DashboardClient';

export default async function FinancePage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const cookieStore = await cookies();
  const userId = cookieStore.get('userId')?.value;
  if (!userId) redirect('/login');

  const profile = await getProfile(userId);
  if (!profile) redirect('/finance/setup');

  const [cards, expenses, installments] = await Promise.all([
    getCards(userId),
    getExpenses(userId),
    getInstallments(userId),
  ]);

  const params = await searchParams;
  const now = new Date();
  const currentYearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  // Use month from URL or default to current
  const yearMonth = params.month && /^\d{4}-\d{2}$/.test(params.month) ? params.month : currentYearMonth;
  const [year, month] = yearMonth.split('-').map(Number);
  const daysInMonth = new Date(year, month, 0).getDate();
  const isCurrentMonth = yearMonth === currentYearMonth;
  const dayOfMonth = isCurrentMonth ? now.getDate() : daysInMonth; // last day if viewing other month

  const monthData = await getMonthData(userId, yearMonth);
  const paidExpenseIds = new Set((monthData?.payments || []).map(p => p.expenseId));

  const calcValue = (e: typeof expenses[0]) => {
    if (e.proportional === 'daily') return e.value * daysInMonth;
    if (e.proportional === 'weekly') return e.value * (daysInMonth / 7);
    return e.value;
  };

  const installmentGroups = groupInstallments(installments, cards);
  const cardViews = buildCardViews(cards, installments);

  const invoiceExtras = cardViews.reduce((sum: number, c) => sum + Math.max(0, c.extras), 0);

  const monthCalc = calculateMonthBalance(profile, expenses, installmentGroups, daysInMonth);

  // Calculate unpaid totals for dynamic balance
  const unpaidCashTotal = expenses
    .filter(e => e.category === 'cash' && !paidExpenseIds.has(e._id!))
    .reduce((sum, e) => sum + calcValue(e), 0);

  const totalCalc = calculateTotalBalance(
    profile, unpaidCashTotal, monthCalc.installmentsTotal, invoiceExtras, dayOfMonth
  );
  const projections = calculateProjections(monthCalc.monthBalance, installmentGroups);

  // Month navigation
  const prevDate = new Date(year, month - 2, 1);
  const nextDate = new Date(year, month, 1);
  const prevMonth = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}`;
  const nextMonth = `${nextDate.getFullYear()}-${String(nextDate.getMonth() + 1).padStart(2, '0')}`;

  const cardExpenses = expenses
    .filter(e => e.category === 'card')
    .map(e => ({
      id: e._id!,
      name: e.name,
      value: calcValue(e),
      proportional: e.proportional,
      dueDay: e.dueDay,
      paid: paidExpenseIds.has(e._id!),
    }));

  const cashExpenses = expenses
    .filter(e => e.category === 'cash')
    .map(e => ({
      id: e._id!,
      name: e.name,
      value: calcValue(e),
      dueDay: e.dueDay,
      proportional: e.proportional,
      paid: paidExpenseIds.has(e._id!),
    }));

  return (
    <DashboardClient
      yearMonth={yearMonth}
      daysInMonth={daysInMonth}
      dayOfMonth={dayOfMonth}
      isCurrentMonth={isCurrentMonth}
      prevMonth={prevMonth}
      nextMonth={nextMonth}
      profile={{
        salary: profile.salary,
        foodVoucher: profile.foodVoucher,
        banks: profile.banks,
      }}
      cardExpenses={cardExpenses}
      cashExpenses={cashExpenses}
      installmentGroups={installmentGroups}
      cardViews={cardViews}
      monthBalance={monthCalc.monthBalance}
      totalBalance={totalCalc.total}
      bankTotal={totalCalc.bankTotal}
      invoiceExtras={invoiceExtras}
      projections={projections}
      totals={{
        salary: monthCalc.totalSalary,
        vr: monthCalc.vr,
        cardExpensesTotal: monthCalc.cardExpensesTotal,
        cashExpensesTotal: monthCalc.cashExpensesTotal,
        installmentsTotal: monthCalc.installmentsTotal,
      }}
    />
  );
}
