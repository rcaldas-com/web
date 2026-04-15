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
    // Simplified future projection
    const curMonthData = getLocalMonthData(currentYearMonth);
    const curPaidIds = new Set((curMonthData?.payments || []).map(p => p.expenseId));
    const curCardInvoices = initMonthCardInvoices(cards, installments, 0);
    const curCardViews = buildCardViews(cards, installments, curCardInvoices, 0);
    const curDays = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const curPropDays = curDays - now.getDate() + 1;

    const calcVal = (e: typeof expenses[0], d: number) =>
      e.proportional === 'daily' ? e.value * d : e.proportional === 'weekly' ? e.value * (d / 7) : e.value;

    const curUnpaidCash = expenses.filter(e => e.category === 'cash' && !curPaidIds.has(e._id!))
      .reduce((s, e) => s + calcVal(e, curPropDays), 0);
    const curUnpaidInvoices = curCardViews.filter(c => !c.paid)
      .reduce((s, c) => s + c.invoiceTotal, 0);
    const curAvailable = bankTotal - curUnpaidCash - curUnpaidInvoices;
    const curUnpaidCard = expenses.filter(e => e.category === 'card' && !curPaidIds.has(e._id!))
      .reduce((s, e) => s + calcVal(e, curPropDays), 0);

    const { payment, advance, advanceDay } = profile.salary;
    const salaryForNextMonth = now.getDate() >= advanceDay ? payment : (payment + advance);
    const futureCashTotal = cashExpenses.reduce((s, e) => s + e.value, 0);
    const futureInvoicesTotal = cardViews.reduce((s, c) => s + c.invoiceTotal, 0);

    availableBalance = curAvailable + salaryForNextMonth + profile.foodVoucher
      - futureCashTotal - futureInvoicesTotal - curUnpaidCard;

    if (monthOffset > 1) {
      const fullSalary = payment + advance;
      const allCardExp = expenses.filter(e => e.category === 'card')
        .reduce((s, e) => s + calcVal(e, daysInMonth), 0);
      for (let i = 2; i <= monthOffset; i++) {
        availableBalance += fullSalary + profile.foodVoucher - futureCashTotal - allCardExp;
      }
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
