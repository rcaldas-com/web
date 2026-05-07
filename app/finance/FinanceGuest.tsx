'use client';

import { useState, useCallback, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  getLocalProfile,
  getLocalCards,
  getLocalExpenses,
  getLocalInstallments,
  getLocalMonthData,
  getLocalExpenseOverrides,
} from '@/lib/finance/local-storage';
import {
  groupInstallments,
  buildCardViews,
  calculateMonthBalance,
  initMonthCardInvoices,
} from '@/lib/finance/compute';
import DashboardClient from './DashboardClient';
import type { MonthCardInvoice } from '@/lib/finance/types';

function GuestRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/finance/setup/profile');
  }, [router]);
  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <p className="text-zinc-500">Carregando...</p>
    </div>
  );
}

export default function FinanceGuest() {
  const searchParams = useSearchParams();
  const [, setTick] = useState(0);
  const refresh = useCallback(() => setTick(t => t + 1), []);

  const now = new Date();
  const currentYearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const paramMonth = searchParams.get('month');
  const yearMonth = paramMonth && /^\d{4}-\d{2}$/.test(paramMonth) ? paramMonth : currentYearMonth;
  const [year, month] = yearMonth.split('-').map(Number);
  const daysInMonth = new Date(year, month, 0).getDate();
  const isCurrentMonth = yearMonth === currentYearMonth;
  const dayOfMonth = isCurrentMonth ? now.getDate() : daysInMonth;
  const proportionalDays = isCurrentMonth ? daysInMonth - dayOfMonth + 1 : daysInMonth;

  const currentMonthIndex = now.getFullYear() * 12 + now.getMonth();
  const viewMonthIndex = year * 12 + (month - 1);
  const monthOffset = viewMonthIndex - currentMonthIndex;
  const offset = Math.max(0, monthOffset);

  const profile = getLocalProfile();
  const cards = getLocalCards();
  const expenses = getLocalExpenses();
  const installments = getLocalInstallments();

  if (!profile) {
    return <GuestRedirect />;
  }

  const monthData = getLocalMonthData(yearMonth);
  const paidExpenseIds = new Set((monthData?.payments || []).map(p => p.expenseId));
  const expenseOverrides = getLocalExpenseOverrides(yearMonth);

  // Card invoices: use month-specific if saved, otherwise init
  const monthCardInvoices: MonthCardInvoice[] = monthData?.cardInvoices?.length
    ? monthData.cardInvoices
    : initMonthCardInvoices(cards, installments, offset);

  const getExpenseValue = (e: typeof expenses[0]) => expenseOverrides.get(e._id!) ?? e.value;
  const calcValue = (e: typeof expenses[0]) => {
    const baseValue = getExpenseValue(e);
    if (e.proportional === 'daily') return baseValue * proportionalDays;
    if (e.proportional === 'weekly') return baseValue * (proportionalDays / 7);
    return baseValue;
  };

  const installmentGroups = groupInstallments(installments, cards, offset);
  const cardViews = buildCardViews(cards, installments, monthCardInvoices, offset);
  const monthCalc = calculateMonthBalance(profile, expenses, installmentGroups, daysInMonth, expenseOverrides);

  // Projections
  const projections = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(year, month + i, 1);
    const pym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const pDays = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    const pOverrides = getLocalExpenseOverrides(pym);
    const ig = groupInstallments(installments, cards, Math.max(0, monthOffset + i + 1));
    const calc = calculateMonthBalance(profile, expenses, ig, pDays, pOverrides);
    return { label: `M+${i + 1}`, value: calc.monthBalance };
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
      proportional: e.proportional,
      dueDay: e.dueDay,
      paid: paidExpenseIds.has(e._id!),
      category: 'cash' as const,
    }))
    .sort(sortByDueDay);

  const bankTotal = profile.banks.reduce((sum, b) => sum + b.balance, 0) + profile.foodVoucher;

  // Available balance
  let availableBalance: number;
  if (monthOffset <= 0) {
    const unpaidCashTotal = cashExpenses.filter(e => !e.paid).reduce((s, e) => s + e.value, 0);
    const unpaidInvoicesTotal = monthCardInvoices.filter(c => !c.paid).reduce((s, c) => s + c.invoiceTotal, 0);
    availableBalance = bankTotal - unpaidCashTotal - unpaidInvoicesTotal;

    // If advance already received (day >= advanceDay), subtract it — it belongs to next month's salary
    if (isCurrentMonth && dayOfMonth >= profile.salary.advanceDay) {
      availableBalance -= profile.salary.advance;
    }
  } else {
    // Future months: project cash availability from current available balance.
    // Cash impact comes from invoices due in each projected month plus card expenses
    // generated in the previous month that are not yet reflected in a closed invoice.
    const curMonthData = getLocalMonthData(currentYearMonth);
    const curPaidIds = new Set((curMonthData?.payments || []).map(p => p.expenseId));
    const curCardInvoices = initMonthCardInvoices(cards, installments, 0);
    const curCardViews = buildCardViews(cards, installments, curCardInvoices, 0);
    const curDays = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const curPropDays = curDays - now.getDate() + 1;

    const calcVal = (e: typeof expenses[0], d: number, overrides?: Map<string, number>) => {
      const baseValue = overrides?.get(e._id!) ?? e.value;
      if (e.proportional === 'daily') return baseValue * d;
      if (e.proportional === 'weekly') return baseValue * (d / 7);
      return baseValue;
    };

    const curOverrides = getLocalExpenseOverrides(currentYearMonth);
    const curUnpaidCash = expenses.filter(e => e.category === 'cash' && !curPaidIds.has(e._id!))
      .reduce((s, e) => s + calcVal(e, curPropDays, curOverrides), 0);
    const curUnpaidInvoices = curCardViews.filter(c => !c.paid)
      .reduce((s, c) => s + c.invoiceTotal, 0);

    const curAdvanceDeducted = now.getDate() >= profile.salary.advanceDay ? profile.salary.advance : 0;
    const curAvailable = bankTotal - curUnpaidCash - curUnpaidInvoices - curAdvanceDeducted;

    const curUnpaidCard = expenses.filter(e => e.category === 'card' && !curPaidIds.has(e._id!))
      .reduce((s, e) => s + calcVal(e, curPropDays, curOverrides), 0);

    const { payment, advance, advanceDay } = profile.salary;
    const salaryForNextMonth = now.getDate() >= advanceDay ? payment : (payment + advance);
    const vrMonthly = profile.foodVoucherMonthly ?? profile.foodVoucher;
    const fullSalary = payment + advance;

    const yearMonthFromOffset = (offset: number) => {
      const date = new Date(now.getFullYear(), now.getMonth() + offset, 1);
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    };

    const daysForOffset = (offset: number) => {
      const date = new Date(now.getFullYear(), now.getMonth() + offset, 1);
      return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
    };

    const categoryTotalForMonth = (category: 'cash' | 'card', offset: number) => {
      const ym = yearMonthFromOffset(offset);
      const overrides = getLocalExpenseOverrides(ym);
      const monthDays = daysForOffset(offset);
      return expenses
        .filter(e => e.category === category)
        .reduce((sum, e) => sum + calcVal(e, monthDays, overrides), 0);
    };

    const invoiceTotalForMonth = (offset: number) => {
      const ym = yearMonthFromOffset(offset);
      const monthData = getLocalMonthData(ym);
      const invoices: MonthCardInvoice[] = monthData?.cardInvoices?.length
        ? monthData.cardInvoices
        : initMonthCardInvoices(cards, installments, offset);
      return buildCardViews(cards, installments, invoices, offset)
        .filter(c => !c.paid)
        .reduce((sum, c) => sum + c.invoiceTotal, 0);
    };

    availableBalance = curAvailable;
    for (let i = 1; i <= monthOffset; i++) {
      const salaryForMonth = i === 1 ? salaryForNextMonth : fullSalary;
      const cashForMonth = categoryTotalForMonth('cash', i);
      const invoicesForMonth = invoiceTotalForMonth(i);
      const cardFromPreviousMonth = i === 1 ? curUnpaidCard : categoryTotalForMonth('card', i - 1);
      availableBalance += salaryForMonth + vrMonthly - cashForMonth - invoicesForMonth - cardFromPreviousMonth;
    }
  }

  return (
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
      isGuest
      onGuestAction={refresh}
    />
  );
}
