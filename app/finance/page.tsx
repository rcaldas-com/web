import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import {
  getProfile,
  getCards,
  getExpenses,
  getInstallments,
  getMonthData,
  getOrInitMonthCardInvoices,
  getExpenseOverrides,
} from '@/lib/finance/data';
import { groupInstallments, buildCardViews, calculateMonthBalance } from '@/lib/finance/compute';
import DashboardClient from './DashboardClient';
import FinanceGuest from './FinanceGuest';
import MigrateGuestData from './MigrateGuestData';

export default async function FinancePage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const cookieStore = await cookies();
  const userId = cookieStore.get('userId')?.value;

  if (!userId) {
    return <FinanceGuest />;
  }

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
  const dayOfMonth = isCurrentMonth ? now.getDate() : daysInMonth;

  // Month offset from current (0=current, 1=next, -1=prev)
  const currentMonthIndex = now.getFullYear() * 12 + now.getMonth();
  const viewMonthIndex = year * 12 + (month - 1);
  const monthOffset = viewMonthIndex - currentMonthIndex;

  // Proportional: remaining days for current month, full month otherwise
  const proportionalDays = isCurrentMonth ? daysInMonth - dayOfMonth + 1 : daysInMonth;

  const monthData = await getMonthData(userId, yearMonth);
  const paidExpenseIds = new Set((monthData?.payments || []).map(p => p.expenseId));

  // Month-specific expense value overrides (uses most recent override <= this month)
  const expenseOverrides = await getExpenseOverrides(userId, yearMonth);

  // Month-specific card invoices
  const monthCardInvoices = await getOrInitMonthCardInvoices(
    userId, yearMonth, cards, installments, Math.max(0, monthOffset)
  );

  // Get effective expense value (override or default)
  const getExpenseValue = (e: typeof expenses[0]) => expenseOverrides.get(e._id!) ?? e.value;

  const calcValue = (e: typeof expenses[0]) => {
    const baseValue = getExpenseValue(e);
    if (e.proportional === 'daily') return baseValue * proportionalDays;
    if (e.proportional === 'weekly') return baseValue * (proportionalDays / 7);
    return baseValue;
  };

  const offset = Math.max(0, monthOffset);
  const installmentGroups = groupInstallments(installments, cards, offset);
  const cardViews = buildCardViews(cards, installments, monthCardInvoices, offset);

  // Saldo do Mês: always uses full month (not proportional days)
  const monthCalc = calculateMonthBalance(profile, expenses, installmentGroups, daysInMonth, expenseOverrides);

  // Projections: compute each future month with its own days, overrides, and installments
  const projMonths = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(year, month + i, 1);
    return {
      idx: i + 1,
      ym: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
      days: new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate(),
    };
  });
  const projOverrides = await Promise.all(projMonths.map(m => getExpenseOverrides(userId, m.ym)));
  const projections = projMonths.map((m, i) => {
    const ig = groupInstallments(installments, cards, Math.max(0, monthOffset + m.idx));
    const calc = calculateMonthBalance(profile, expenses, ig, m.days, projOverrides[i]);
    return { label: `M+${m.idx}`, value: calc.monthBalance };
  });

  // Month navigation
  const prevDate = new Date(year, month - 2, 1);
  const nextDate = new Date(year, month, 1);
  const prevMonth = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}`;
  const nextMonth = `${nextDate.getFullYear()}-${String(nextDate.getMonth() + 1).padStart(2, '0')}`;

  const sortByDueDay = (a: { dueDay?: number }, b: { dueDay?: number }) =>
    (a.dueDay ?? 99) - (b.dueDay ?? 99);

  const cardExpenses = expenses
    .filter(e => e.category === 'card')
    .map(e => ({
      id: e._id!,
      name: e.name,
      value: calcValue(e),
      baseValue: getExpenseValue(e),
      proportional: e.proportional,
      dueDay: e.dueDay,
      paid: paidExpenseIds.has(e._id!),
      category: 'card' as const,
    }))
    .sort(sortByDueDay);

  const cashExpenses = expenses
    .filter(e => e.category === 'cash')
    .map(e => ({
      id: e._id!,
      name: e.name,
      value: calcValue(e),
      baseValue: getExpenseValue(e),
      dueDay: e.dueDay,
      proportional: e.proportional,
      paid: paidExpenseIds.has(e._id!),
      category: 'cash' as const,
    }))
    .sort(sortByDueDay);

  const bankTotal = profile.banks.reduce((sum, b) => sum + b.balance, 0) + profile.foodVoucher;

  // Compute available balance
  let availableBalance: number;

  if (monthOffset <= 0) {
    // Current/past month: bank total minus unpaid items
    const unpaidCashTotal = cashExpenses.filter(e => !e.paid).reduce((s, e) => s + e.value, 0);
    const unpaidInvoicesTotal = monthCardInvoices.filter(c => !c.paid).reduce((s, c) => s + c.invoiceTotal, 0);
    availableBalance = bankTotal - unpaidCashTotal - unpaidInvoicesTotal;

    // If advance already received (day >= advanceDay), subtract it — it belongs to next month's salary
    if (isCurrentMonth && dayOfMonth >= profile.salary.advanceDay) {
      availableBalance -= profile.salary.advance;
    }
  } else {
    // Future month: project from current month
    // Formula (spreadsheet): prevAvail + salary + VR - futureCash - futureInvoices - prevUnpaidCard

    // 1. Current month available — must match client-side hero (uses cardViews, not monthCardInvoices)
    const curMonthData = await getMonthData(userId, currentYearMonth);
    const curPaidIds = new Set((curMonthData?.payments || []).map((p: { expenseId?: string }) => p.expenseId));
    const curCardInvoices = await getOrInitMonthCardInvoices(userId, currentYearMonth, cards, installments, 0);
    // buildCardViews includes ALL cards (falls back to card.invoiceTotal for missing entries)
    const curCardViews = buildCardViews(cards, installments, curCardInvoices, 0);

    const curDays = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const curPropDays = curDays - now.getDate() + 1;
    const calcVal = (e: typeof expenses[0], d: number) =>
      e.proportional === 'daily' ? e.value * d : e.proportional === 'weekly' ? e.value * (d / 7) : e.value;

    // Current month unpaid cash (proportional remaining days)
    const curUnpaidCash = expenses.filter(e => e.category === 'cash' && !curPaidIds.has(e._id!))
      .reduce((s, e) => s + calcVal(e, curPropDays), 0);
    // Use cardViews (all 5 cards) — same as client-side DashboardClient
    const curUnpaidInvoices = curCardViews.filter(c => !c.paid)
      .reduce((s, c) => s + c.invoiceTotal, 0);

    // curAvailable uses banksOnly (without current VR) — VR will be added fresh for each future month
    const banksOnly = profile.banks.reduce((sum, b) => sum + b.balance, 0);
    let curAvailable = banksOnly - curUnpaidCash - curUnpaidInvoices;

    // If advance already received, subtract it from base (it's in the bank but belongs to next month)
    const { payment, advance, advanceDay } = profile.salary;
    if (now.getDate() >= advanceDay) {
      curAvailable -= advance;
    }

    // 2. Current month unpaid card expenses (will appear in next month but not yet in its invoice)
    const curUnpaidCard = expenses.filter(e => e.category === 'card' && !curPaidIds.has(e._id!))
      .reduce((s, e) => s + calcVal(e, curPropDays), 0);

    // 3. Salary: if advance already received (day >= advanceDay), only payment
    //    (advance is already in bankTotal); otherwise full salary
    const salaryForNextMonth = now.getDate() >= advanceDay ? payment : (payment + advance);

    // 4. Future month cash expenses (full month, all items)
    const futureCashTotal = cashExpenses.reduce((s, e) => s + e.value, 0);

    // 5. Future month invoices (from cardViews which includes all cards)
    const futureInvoicesTotal = cardViews.reduce((s, c) => s + c.invoiceTotal, 0);

    const vrMonthly = profile.foodVoucherMonthly ?? profile.foodVoucher;

    // M+1: curAvailable + salary + VR_monthly - futureCash - futureInvoices - curUnpaidCard
    availableBalance = curAvailable + salaryForNextMonth + vrMonthly
      - futureCashTotal - futureInvoicesTotal - curUnpaidCard;

    // Chain for M+2+: each additional month adds salary+VR_monthly-cash-cardExpenses
    if (monthOffset > 1) {
      const fullSalary = payment + advance;
      const allCardExp = expenses.filter(e => e.category === 'card')
        .reduce((s, e) => s + calcVal(e, daysInMonth), 0);
      for (let i = 2; i <= monthOffset; i++) {
        availableBalance += fullSalary + vrMonthly - futureCashTotal - allCardExp;
      }
    }
  }

  return (
    <>
      <MigrateGuestData />
      <DashboardClient
      yearMonth={yearMonth}
      daysInMonth={daysInMonth}
      proportionalDays={proportionalDays}
      dayOfMonth={dayOfMonth}
      isCurrentMonth={isCurrentMonth}
      prevMonth={prevMonth}
      nextMonth={nextMonth}
      profile={{
        salary: profile.salary,
        foodVoucher: profile.foodVoucher,
        foodVoucherMonthly: profile.foodVoucherMonthly,
        banks: profile.banks,
      }}
      cardExpenses={cardExpenses}
      cashExpenses={cashExpenses}
      installmentGroups={installmentGroups}
      cardViews={cardViews}
      monthBalance={monthCalc.monthBalance}
      bankTotal={bankTotal}
      availableBalance={availableBalance}
      projections={projections}
      totals={{
        salary: monthCalc.totalSalary,
        vr: monthCalc.vr,
        cardExpensesTotal: monthCalc.cardExpensesTotal,
        cashExpensesTotal: monthCalc.cashExpensesTotal,
        installmentsTotal: monthCalc.installmentsTotal,
      }}
    />
    </>
  );
}
