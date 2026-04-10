'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import {
  upsertProfile,
  upsertCard,
  deleteCard as deleteCardData,
  updateCardInvoice,
  saveExpenses,
  addInstallment,
  deleteInstallment as deleteInstallmentData,
  updateInstallment,
  rollOverMonth,
  toggleExpensePayment,
  updateMonthCardInvoice,
  toggleMonthCardInvoicePaid,
  updateMonthExpenseValue,
} from './data';
import type { RecurringExpense } from './types';
import { evalExpression } from './eval-expression';

async function getUserId(): Promise<string> {
  const cookieStore = await cookies();
  const userId = cookieStore.get('userId')?.value;
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

  // Parse banks array from form
  const bankNames = formData.getAll('bankName') as string[];
  const bankBalances = formData.getAll('bankBalance') as string[];
  const banks = bankNames
    .map((name, i) => ({ name: name.trim(), balance: evalExpression(bankBalances[i]) }))
    .filter(b => b.name);

  await upsertProfile(userId, {
    salary: { payment, advance, paymentDay, advanceDay },
    foodVoucher,
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

  for (let i = 0; i < cardNames.length; i++) {
    const name = cardNames[i]?.trim();
    if (!name) continue;
    await upsertCard(userId, {
      _id: cardIds[i] || undefined,
      name,
      dueDay: parseInt(cardDueDays[i]) || 1,
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

// ==================== Expenses ====================

export async function saveExpensesList(formData: FormData) {
  const userId = await getUserId();

  const names = formData.getAll('expName') as string[];
  const values = formData.getAll('expValue') as string[];
  const categories = formData.getAll('expCategory') as string[];
  const proportionals = formData.getAll('expProportional') as string[];
  const dueDays = formData.getAll('expDueDay') as string[];

  const expenses: Omit<RecurringExpense, '_id' | 'userId'>[] = names
    .map((name, i) => ({
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

  revalidatePath('/finance');
}

export async function removeInstallment(installmentId: string) {
  await getUserId();
  await deleteInstallmentData(installmentId);
  revalidatePath('/finance');
}

export async function editInstallment(
  installmentId: string,
  data: { monthlyValue?: number; remainingInstallments?: number; description?: string }
) {
  await getUserId();
  // User edits from next month's perspective; store +1 for current month base
  const toSave = data.remainingInstallments != null
    ? { ...data, remainingInstallments: data.remainingInstallments + 1 }
    : data;
  await updateInstallment(installmentId, toSave);
  revalidatePath('/finance');
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

export async function togglePaid(expenseId: string, expenseName: string, amountPaid: number, yearMonth: string) {
  const userId = await getUserId();
  await toggleExpensePayment(userId, yearMonth, expenseId, expenseName, amountPaid);
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
    banks,
  });

  revalidatePath('/finance');
}

// ==================== Month Card Invoices ====================

export async function updateMonthInvoice(cardId: string, invoiceTotal: number, yearMonth: string) {
  const userId = await getUserId();
  await updateMonthCardInvoice(userId, yearMonth, cardId, invoiceTotal);
  revalidatePath('/finance');
}

export async function toggleInvoicePaid(cardId: string, cardName: string, invoiceTotal: number, yearMonth: string) {
  const userId = await getUserId();
  await toggleMonthCardInvoicePaid(userId, yearMonth, cardId, cardName, invoiceTotal);
  revalidatePath('/finance');
}

// ==================== Month Expense Overrides ====================

export async function updateExpenseValue(expenseId: string, value: number, yearMonth: string) {
  const userId = await getUserId();
  await updateMonthExpenseValue(userId, yearMonth, expenseId, value);
  revalidatePath('/finance');
}
