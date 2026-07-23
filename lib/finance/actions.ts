'use server';

import { redirect } from 'next/navigation';
import { getSessionUserId } from '@/lib/auth';
import { revalidatePath } from 'next/cache';
import {
  upsertProfile,
  upsertCard,
  deleteCard as deleteCardData,
  updateCardInvoice,
  updateCardOrder,
  saveExpenses,
  addInstallment,
  saveInstallments,
  deleteInstallment as deleteInstallmentData,
  getInstallment,
  updateInstallment,
  rollOverMonth,
  toggleExpensePayment,
  updateMonthCardInvoice,
  toggleMonthCardInvoicePaid,
  updateMonthExpenseValue,
  updatePaymentAmount,
  getMonthData,
  adjustBankBalance,
  adjustCardExpenseInMonth,
} from './data';
import type { RecurringExpense } from './types';
import { evalExpression } from './eval-expression';
import { addMonthsToYearMonth, getFinanceToday } from './date';

async function getUserId(): Promise<string> {
  const userId = await getSessionUserId();
  if (!userId) throw new Error('Not authenticated');
  return userId;
}

// ==================== Profile ====================

export async function saveProfile(formData: FormData) {
  const userId = await getUserId();

  const payment = evalExpression(formData.get('payment') as string);
  const advance = evalExpression(formData.get('advance') as string);
  const paymentDay = parseInt(formData.get('paymentDay') as string) || 7;
  const advanceDay = parseInt(formData.get('advanceDay') as string) || 15;
  const foodVoucher = evalExpression(formData.get('foodVoucher') as string);
  const foodVoucherMonthly = evalExpression(formData.get('foodVoucherMonthly') as string) || foodVoucher;

  // Parse banks array from form
  const bankNames = formData.getAll('bankName') as string[];
  const bankBalances = formData.getAll('bankBalance') as string[];
  const banks = bankNames
    .map((name, i) => ({ name: name.trim(), balance: evalExpression(bankBalances[i]) }))
    .filter(b => b.name);

  await upsertProfile(userId, {
    salary: { payment, advance, paymentDay, advanceDay },
    foodVoucher,
    foodVoucherMonthly,
    banks,
  });

  revalidatePath('/finance');
}

export async function saveProfileAndContinue(formData: FormData) {
  await saveProfile(formData);
  redirect('/finance/setup/cards');
}

export async function saveProfileAndFinish(formData: FormData) {
  await saveProfile(formData);
  redirect('/finance');
}

// ==================== Cards ====================

export async function saveCards(formData: FormData) {
  const userId = await getUserId();

  const cardIds = formData.getAll('cardId') as string[];
  const cardNames = formData.getAll('cardName') as string[];
  const cardDueDays = formData.getAll('cardDueDay') as string[];
  const cardInvoiceTotals = formData.getAll('cardInvoiceTotal') as string[];

  for (let i = 0; i < cardNames.length; i++) {
    const name = cardNames[i]?.trim();
    if (!name) continue;
    const dueDay = Math.min(31, Math.max(1, parseInt(cardDueDays[i]) || 1));
    await upsertCard(userId, {
      _id: cardIds[i] || undefined,
      name,
      dueDay,
      invoiceTotal: evalExpression(cardInvoiceTotals[i] || '0'),
      sortOrder: i,
    });
  }

  revalidatePath('/finance');
}

export async function saveCardsAndContinue(formData: FormData) {
  await saveCards(formData);
  redirect('/finance/setup/expenses');
}

export async function saveCardsAndFinish(formData: FormData) {
  await saveCards(formData);
  redirect('/finance');
}

export async function removeCard(cardId: string) {
  await getUserId();
  await deleteCardData(cardId);
  revalidatePath('/finance');
}

export async function updateInvoice(cardId: string, amount: number) {
  await getUserId();
  await updateCardInvoice(cardId, amount);
  revalidatePath('/finance');
}

export async function reorderCards(cardIds: string[]) {
  const userId = await getUserId();
  await updateCardOrder(userId, cardIds);
  revalidatePath('/finance');
  revalidatePath('/finance/cards');
}

// ==================== Expenses ====================

export async function saveExpensesList(formData: FormData) {
  const userId = await getUserId();

  const ids = formData.getAll('expId') as string[];
  const names = formData.getAll('expName') as string[];
  const values = formData.getAll('expValue') as string[];
  const categories = formData.getAll('expCategory') as string[];
  const proportionals = formData.getAll('expProportional') as string[];
  const dueDays = formData.getAll('expDueDay') as string[];

  const expenses: (Omit<RecurringExpense, '_id' | 'userId'> & { _id?: string })[] = names
    .map((name, i) => ({
      ...(ids[i] ? { _id: ids[i] } : {}),
      name: name.trim(),
      value: evalExpression(values[i]),
      category: (categories[i] === 'card' ? 'card' : 'cash') as 'card' | 'cash',
      proportional: (['daily', 'weekly'].includes(proportionals[i]) ? proportionals[i] : false) as false | 'daily' | 'weekly',
      dueDay: parseInt(dueDays[i]) || undefined,
      order: i,
    }))
    .filter(e => e.name);

  await saveExpenses(userId, expenses);
  revalidatePath('/finance');
}

export async function saveExpensesAndContinue(formData: FormData) {
  await saveExpensesList(formData);
  redirect('/finance/setup/installments');
}

export async function saveExpensesAndFinish(formData: FormData) {
  await saveExpensesList(formData);
  redirect('/finance');
}

// ==================== Installments ====================

async function adjustNextMonthInvoiceIfStored(userId: string, cardId: string, delta: number) {
  const nextYearMonth = addMonthsToYearMonth(getFinanceToday().yearMonth, 1);
  const monthData = await getMonthData(userId, nextYearMonth);
  if (monthData?.cardInvoices?.some(ci => ci.cardId === cardId)) {
    await adjustCardExpenseInMonth(userId, nextYearMonth, cardId, delta);
  }
}

export async function addNewInstallment(formData: FormData) {
  const userId = await getUserId();

  const cardId = formData.get('cardId') as string;
  const description = (formData.get('description') as string)?.trim();
  const monthlyValue = evalExpression(formData.get('monthlyValue') as string);
  const remainingInstallments = parseInt(formData.get('remainingInstallments') as string) || 0;

  if (!cardId || !description || !monthlyValue || !remainingInstallments) return;

  // User enters remaining from next month's perspective; store +1 for current month base
  await addInstallment(userId, {
    cardId,
    description,
    monthlyValue,
    remainingInstallments: remainingInstallments + 1,
  });

  await adjustNextMonthInvoiceIfStored(userId, cardId, monthlyValue);

  revalidatePath('/finance');
  revalidatePath('/finance/cards');
}

export async function saveInstallmentsList(formData: FormData) {
  const userId = await getUserId();

  const ids = formData.getAll('installmentId') as string[];
  const descriptions = formData.getAll('description') as string[];
  const cardIds = formData.getAll('cardId') as string[];
  const monthlyValues = formData.getAll('monthlyValue') as string[];
  const remainingValues = formData.getAll('remainingInstallments') as string[];

  const installments = descriptions
    .map((description, i) => {
      const monthlyValue = evalExpression(monthlyValues[i]);
      const remainingInstallments = parseInt(remainingValues[i]) || 0;
      return {
        _id: ids[i] || undefined,
        cardId: cardIds[i],
        description: description.trim(),
        monthlyValue,
        remainingInstallments: remainingInstallments ? remainingInstallments + 1 : 0,
      };
    })
    .filter(i => i.cardId && i.description && i.monthlyValue && i.remainingInstallments);

  await saveInstallments(userId, installments);
  revalidatePath('/finance');
}

export async function saveInstallmentsAndFinish(formData: FormData) {
  await saveInstallmentsList(formData);
  redirect('/finance');
}

export async function removeInstallment(installmentId: string) {
  const userId = await getUserId();
  const installment = await getInstallment(installmentId);
  await deleteInstallmentData(installmentId);
  if (installment) {
    await adjustNextMonthInvoiceIfStored(userId, installment.cardId, -installment.monthlyValue);
  }
  revalidatePath('/finance');
  revalidatePath('/finance/cards');
}

export async function editInstallment(
  installmentId: string,
  data: { monthlyValue?: number; remainingInstallments?: number; description?: string }
) {
  const userId = await getUserId();
  if (data.monthlyValue !== undefined) {
    const installment = await getInstallment(installmentId);
    if (installment && installment.monthlyValue !== data.monthlyValue) {
      await adjustNextMonthInvoiceIfStored(userId, installment.cardId, data.monthlyValue - installment.monthlyValue);
    }
  }
  // User edits from next month's perspective; store +1 for current month base
  const toSave = data.remainingInstallments != null
    ? { ...data, remainingInstallments: data.remainingInstallments + 1 }
    : data;
  await updateInstallment(installmentId, toSave);
  revalidatePath('/finance');
  revalidatePath('/finance/cards');
}

export async function finishSetup() {
  redirect('/finance');
}

// ==================== Month Operations ====================

export async function doRollOver() {
  const userId = await getUserId();
  await rollOverMonth(userId);
  revalidatePath('/finance');
}

export async function togglePaid(
  expenseId: string, expenseName: string, amountPaid: number, yearMonth: string,
  paidFromBank?: string, paidToCard?: string,
) {
  const userId = await getUserId();
  const removed = await toggleExpensePayment(userId, yearMonth, expenseId, expenseName, amountPaid, paidFromBank, paidToCard);

  const nextMonth = addMonthsToYearMonth(yearMonth, 1);
  if (removed) {
    // Toggled OFF — reverse adjustments
    if (removed.paidFromBank) await adjustBankBalance(userId, removed.paidFromBank, removed.amountPaid);
    if (removed.paidToCard) await adjustCardExpenseInMonth(userId, nextMonth, removed.paidToCard, -removed.amountPaid);
  } else {
    // Toggled ON — apply adjustments
    if (paidFromBank) await adjustBankBalance(userId, paidFromBank, -amountPaid);
    if (paidToCard) await adjustCardExpenseInMonth(userId, nextMonth, paidToCard, amountPaid);
  }

  revalidatePath('/finance');
}

export async function updateBankBalance(formData: FormData) {
  const userId = await getUserId();
  const bankNames = formData.getAll('bankName') as string[];
  const bankBalances = formData.getAll('bankBalance') as string[];
  const banks = bankNames
    .map((name, i) => ({ name: name.trim(), balance: evalExpression(bankBalances[i]) }))
    .filter(b => b.name);

  // Get existing profile to preserve other fields
  const { getProfile } = await import('./data');
  const profile = await getProfile(userId);
  if (!profile) return;

  const foodVoucherStr = formData.get('foodVoucher') as string | null;
  const foodVoucher = foodVoucherStr != null ? evalExpression(foodVoucherStr) : profile.foodVoucher;

  await upsertProfile(userId, {
    salary: profile.salary,
    foodVoucher,
    foodVoucherMonthly: profile.foodVoucherMonthly ?? profile.foodVoucher,
    banks,
  });

  revalidatePath('/finance');
}

// ==================== Month Card Invoices ====================

export async function updateMonthInvoice(cardId: string, invoiceTotal: number, yearMonth: string) {
  const userId = await getUserId();
  // Store (entered - existingAdj) as base so adjustments always applied on top:
  // display = base + adj = (entered - existingAdj) + existingAdj = entered
  // future adj Z: display = entered + Z
  const monthData = await getMonthData(userId, yearMonth);
  const existingAdj = monthData?.cardExpenseAdjustments?.find(a => a.cardId === cardId)?.amount ?? 0;
  await updateMonthCardInvoice(userId, yearMonth, cardId, invoiceTotal - existingAdj);
  revalidatePath('/finance');
  revalidatePath('/finance/cards');
}

export async function toggleInvoicePaid(cardId: string, cardName: string, invoiceTotal: number, yearMonth: string, paidFromBank?: string) {
  const userId = await getUserId();
  const { nowPaid, previousBank } = await toggleMonthCardInvoicePaid(userId, yearMonth, cardId, cardName, invoiceTotal, paidFromBank);
  if (nowPaid && paidFromBank) await adjustBankBalance(userId, paidFromBank, -invoiceTotal);
  else if (!nowPaid && previousBank) await adjustBankBalance(userId, previousBank, invoiceTotal);
  revalidatePath('/finance');
}

// ==================== Month Expense Overrides ====================

export async function updateExpenseValue(expenseId: string, value: number, yearMonth: string) {
  const userId = await getUserId();

  const monthData = await getMonthData(userId, yearMonth);
  const payment = monthData?.payments?.find(p => p.expenseId === expenseId);

  if (payment?.paidToCard) {
    const delta = Math.round((value - payment.amountPaid) * 100) / 100;
    if (delta !== 0) {
      const nextMonth = addMonthsToYearMonth(yearMonth, 1);
      await Promise.all([
        updatePaymentAmount(userId, yearMonth, expenseId, value),
        adjustCardExpenseInMonth(userId, nextMonth, payment.paidToCard, delta),
        ...(payment.paidFromBank ? [adjustBankBalance(userId, payment.paidFromBank, -delta)] : []),
      ]);
    }
  }

  await updateMonthExpenseValue(userId, yearMonth, expenseId, value);
  revalidatePath('/finance');
}

// ==================== Guest Data Migration ====================

export async function migrateGuestData(data: {
  profile: {
    salary: { payment: number; advance: number; paymentDay: number; advanceDay: number };
    foodVoucher: number;
    foodVoucherMonthly?: number;
    banks: { name: string; balance: number }[];
  };
  cards: { name: string; dueDay: number; invoiceTotal?: number }[];
  expenses: { name: string; value: number; category: 'card' | 'cash'; proportional: false | 'daily' | 'weekly'; dueDay?: number; order?: number }[];
  installments: { cardName: string; description: string; monthlyValue: number; remainingInstallments: number }[];
}) {
  const userId = await getUserId();

  // 1. Profile
  await upsertProfile(userId, {
    salary: data.profile.salary,
    foodVoucher: data.profile.foodVoucher,
    foodVoucherMonthly: data.profile.foodVoucherMonthly ?? data.profile.foodVoucher,
    banks: data.profile.banks,
  });

  // 2. Cards — upsert and build name→id map for installments
  const cardIdMap = new Map<string, string>();
  for (const card of data.cards) {
    const result = await upsertCard(userId, { name: card.name, dueDay: card.dueDay, invoiceTotal: card.invoiceTotal });
    if (result) cardIdMap.set(card.name, result.toString());
  }

  // 3. Expenses
  if (data.expenses.length > 0) {
    await saveExpenses(userId, data.expenses.map((e, i) => ({
      name: e.name,
      value: e.value,
      category: e.category,
      proportional: e.proportional,
      dueDay: e.dueDay,
      order: e.order ?? i,
    })));
  }

  // 4. Installments — map card names to real card IDs
  const { getCards } = await import('./data');
  const dbCards = await getCards(userId);
  for (const inst of data.installments) {
    const dbCard = dbCards.find(c => c.name === inst.cardName);
    if (!dbCard?._id) continue;
    await addInstallment(userId, {
      cardId: dbCard._id,
      description: inst.description,
      monthlyValue: inst.monthlyValue,
      remainingInstallments: inst.remainingInstallments,
    });
  }

  revalidatePath('/finance');
}
