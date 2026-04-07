'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import {
  upsertProfile,
  getCards,
  upsertCard,
  deleteCard as deleteCardData,
  updateCardInvoice,
  saveExpenses,
  addInstallment,
  deleteInstallment as deleteInstallmentData,
  rollOverMonth,
  toggleExpensePayment,
} from './data';
import type { RecurringExpense } from './types';

async function getUserId(): Promise<string> {
  const cookieStore = await cookies();
  const userId = cookieStore.get('userId')?.value;
  if (!userId) throw new Error('Not authenticated');
  return userId;
}

// ==================== Profile ====================

export async function saveProfile(formData: FormData) {
  const userId = await getUserId();

  const payment = parseFloat(formData.get('payment') as string) || 0;
  const advance = parseFloat(formData.get('advance') as string) || 0;
  const paymentDay = parseInt(formData.get('paymentDay') as string) || 7;
  const advanceDay = parseInt(formData.get('advanceDay') as string) || 15;
  const foodVoucher = parseFloat(formData.get('foodVoucher') as string) || 0;

  // Parse banks array from form
  const bankNames = formData.getAll('bankName') as string[];
  const bankBalances = formData.getAll('bankBalance') as string[];
  const banks = bankNames
    .map((name, i) => ({ name: name.trim(), balance: parseFloat(bankBalances[i]) || 0 }))
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

// ==================== Cards ====================

export async function saveCards(formData: FormData) {
  const userId = await getUserId();

  const cardIds = formData.getAll('cardId') as string[];
  const cardNames = formData.getAll('cardName') as string[];
  const cardDueDays = formData.getAll('cardDueDay') as string[];
  const cardInvoices = formData.getAll('cardInvoice') as string[];

  for (let i = 0; i < cardNames.length; i++) {
    const name = cardNames[i]?.trim();
    if (!name) continue;
    await upsertCard(userId, {
      _id: cardIds[i] || undefined,
      name,
      dueDay: parseInt(cardDueDays[i]) || 1,
      invoiceTotal: parseFloat(cardInvoices[i]) || 0,
    });
  }

  revalidatePath('/finance');
}

export async function saveCardsAndContinue(formData: FormData) {
  await saveCards(formData);
  redirect('/finance/setup/expenses');
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
      value: parseFloat(values[i]) || 0,
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

// ==================== Installments ====================

export async function addNewInstallment(formData: FormData) {
  const userId = await getUserId();

  const cardId = formData.get('cardId') as string;
  const description = (formData.get('description') as string)?.trim();
  const monthlyValue = parseFloat(formData.get('monthlyValue') as string) || 0;
  const remainingInstallments = parseInt(formData.get('remainingInstallments') as string) || 0;

  if (!cardId || !description || !monthlyValue || !remainingInstallments) return;

  await addInstallment(userId, {
    cardId,
    description,
    monthlyValue,
    remainingInstallments,
  });

  revalidatePath('/finance');
}

export async function removeInstallment(installmentId: string) {
  await getUserId();
  await deleteInstallmentData(installmentId);
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
    .map((name, i) => ({ name: name.trim(), balance: parseFloat(bankBalances[i]) || 0 }))
    .filter(b => b.name);

  // Get existing profile to preserve other fields
  const { getProfile } = await import('./data');
  const profile = await getProfile(userId);
  if (!profile) return;

  await upsertProfile(userId, {
    salary: profile.salary,
    foodVoucher: profile.foodVoucher,
    banks,
  });

  revalidatePath('/finance');
}
