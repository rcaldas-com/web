/**
 * localStorage-based finance data storage for guest mode.
 * Mirrors the same data shapes as MongoDB collections.
 */
import type {
  FinanceProfile,
  CreditCard,
  RecurringExpense,
  Installment,
  MonthData,
  MonthPayment,
  MonthCardInvoice,
  MonthExpenseOverride,
} from './types';
import { getFinanceToday, addMonthsToYearMonth } from './date';

const KEYS = {
  profile: 'finance_profile',
  cards: 'finance_cards',
  expenses: 'finance_expenses',
  installments: 'finance_installments',
  months: 'finance_months', // Record<yearMonth, MonthData>
} as const;

function read<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(key, JSON.stringify(value));
}

let counter = Date.now();
function localId(): string {
  return `local_${++counter}`;
}

// ==================== Profile ====================

export function getLocalProfile(): FinanceProfile | null {
  return read<FinanceProfile | null>(KEYS.profile, null);
}

export function saveLocalProfile(data: Omit<FinanceProfile, '_id' | 'userId' | 'createdAt' | 'updatedAt'>) {
  const existing = getLocalProfile();
  const now = new Date();
  const profile: FinanceProfile = {
    ...data,
    _id: existing?._id || localId(),
    userId: 'guest',
    updatedAt: now,
    createdAt: existing?.createdAt || now,
  };
  write(KEYS.profile, profile);
  return profile;
}

// ==================== Cards ====================

export function getLocalCards(): CreditCard[] {
  return read<CreditCard[]>(KEYS.cards, [])
    .map((card, index) => ({ ...card, sortOrder: card.sortOrder ?? index }))
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
}

export function saveLocalCards(cards: Omit<CreditCard, 'userId'>[]) {
  const withIds: CreditCard[] = cards.map((c, index) => ({
    ...c,
    _id: c._id || localId(),
    userId: 'guest',
    sortOrder: c.sortOrder ?? index,
  }));
  write(KEYS.cards, withIds);
  return withIds;
}

export function updateLocalCardOrder(cardIds: string[]) {
  const order = new Map(cardIds.map((cardId, index) => [cardId, index]));
  const cards = getLocalCards().map((card, index) => ({
    ...card,
    sortOrder: order.get(card._id!) ?? index,
  }));
  write(KEYS.cards, cards);
}

export function updateLocalCardInvoice(cardId: string, invoiceTotal: number) {
  const cards = getLocalCards();
  const idx = cards.findIndex(c => c._id === cardId);
  if (idx >= 0) {
    cards[idx].invoiceTotal = invoiceTotal;
    write(KEYS.cards, cards);
  }
}

// ==================== Expenses ====================

export function getLocalExpenses(): RecurringExpense[] {
  return getAllLocalExpenses().filter(expense => !expense.activeUntil);
}

export function getAllLocalExpenses(): RecurringExpense[] {
  return read<RecurringExpense[]>(KEYS.expenses, []);
}

export function saveLocalExpenses(expenses: Omit<RecurringExpense, '_id' | 'userId'>[]) {
  const existing = getAllLocalExpenses();
  const currentYearMonth = getFinanceToday().yearMonth;
  const activeExpenses = expenses.map((e, i) => {
    const typedExpense = e as RecurringExpense;
    const prev = typedExpense._id
      ? existing.find(item => item._id === typedExpense._id)
      : existing.filter(item => !item.activeUntil)[i];
    const isNew = !typedExpense._id && !prev?._id;
    return {
      ...e,
      _id: typedExpense._id || prev?._id || localId(),
      userId: 'guest',
      order: i,
      ...(isNew ? { activeFrom: currentYearMonth } : {}),
    };
  });

  const activeIds = new Set(activeExpenses.map(expense => expense._id));
  const endedExpenses = existing
    .filter(expense => !activeIds.has(expense._id!))
    .map(expense => expense.activeUntil ? expense : { ...expense, activeUntil: currentYearMonth });

  const result: RecurringExpense[] = [...activeExpenses, ...endedExpenses];
  write(KEYS.expenses, result);
  return result;
}

// ==================== Installments ====================

export function getLocalInstallments(): Installment[] {
  return read<Installment[]>(KEYS.installments, []);
}

export function addLocalInstallment(data: Omit<Installment, '_id' | 'userId' | 'createdAt'>) {
  const installments = getLocalInstallments();
  installments.push({
    ...data,
    _id: localId(),
    userId: 'guest',
    createdAt: new Date(),
  });
  write(KEYS.installments, installments);
}

export function updateLocalInstallment(
  id: string,
  data: { monthlyValue?: number; remainingInstallments?: number; description?: string },
) {
  const installments = getLocalInstallments();
  const idx = installments.findIndex(i => i._id === id);
  if (idx < 0) return;
  installments[idx] = { ...installments[idx], ...data };
  write(KEYS.installments, installments);
}

export function saveLocalInstallments(installments: (Omit<Installment, 'userId' | 'createdAt'> & { _id?: string })[]) {
  const result = installments.map(inst => ({
    ...inst,
    _id: inst._id || localId(),
    userId: 'guest',
    createdAt: new Date(),
  }));
  write(KEYS.installments, result);
  return result;
}

export function deleteLocalInstallment(id: string) {
  const installments = getLocalInstallments().filter(i => i._id !== id);
  write(KEYS.installments, installments);
}

// ==================== Month Data ====================

function getMonths(): Record<string, MonthData> {
  return read<Record<string, MonthData>>(KEYS.months, {});
}

function setMonths(months: Record<string, MonthData>) {
  write(KEYS.months, months);
}

function ensureMonth(yearMonth: string): MonthData {
  const months = getMonths();
  if (!months[yearMonth]) {
    months[yearMonth] = {
      userId: 'guest',
      yearMonth,
      daysInMonth: 0,
      payments: [],
      cardInvoices: [],
      expenseOverrides: [],
      extraExpenses: [],
    };
    setMonths(months);
  }
  return months[yearMonth];
}

export function getLocalMonthData(yearMonth: string): MonthData | null {
  return getMonths()[yearMonth] || null;
}

function adjustLocalBankBalance(bankName: string, delta: number) {
  const profile = getLocalProfile();
  if (!profile) return;
  const idx = profile.banks.findIndex(b => b.name === bankName);
  if (idx >= 0) profile.banks[idx].balance += delta;
  write(KEYS.profile, profile);
}

function adjustLocalCardInvoice(yearMonth: string, cardId: string, delta: number) {
  const months = getMonths();
  const month = months[yearMonth] || ensureMonth(yearMonth);
  const adjustments: { cardId: string; amount: number }[] = month.cardExpenseAdjustments || [];
  const idx = adjustments.findIndex(a => a.cardId === cardId);
  if (idx >= 0) adjustments[idx].amount += delta;
  else adjustments.push({ cardId, amount: delta });
  month.cardExpenseAdjustments = adjustments.filter(a => a.amount !== 0);
  months[yearMonth] = month;
  setMonths(months);
}

export function toggleLocalExpensePayment(
  yearMonth: string,
  expenseId: string,
  expenseName: string,
  amountPaid: number,
  paidFromBank?: string,
  paidToCard?: string,
) {
  const months = getMonths();
  const month = months[yearMonth] || ensureMonth(yearMonth);
  const payments: MonthPayment[] = month.payments || [];

  const idx = payments.findIndex(p => p.expenseId === expenseId);
  if (idx >= 0) {
    const removed = payments[idx];
    payments.splice(idx, 1);
    if (removed.paidFromBank) adjustLocalBankBalance(removed.paidFromBank, removed.amountPaid);
    if (removed.paidToCard) adjustLocalCardInvoice(addMonthsToYearMonth(yearMonth, 1), removed.paidToCard, -removed.amountPaid);
  } else {
    payments.push({ expenseId, expenseName, amountPaid, paidAt: new Date(), paidFromBank, paidToCard });
    if (paidFromBank) adjustLocalBankBalance(paidFromBank, -amountPaid);
    if (paidToCard) adjustLocalCardInvoice(addMonthsToYearMonth(yearMonth, 1), paidToCard, amountPaid);
  }

  month.payments = payments;
  months[yearMonth] = month;
  setMonths(months);
}

export function updateLocalMonthCardInvoice(
  yearMonth: string,
  cardId: string,
  invoiceTotal: number,
) {
  const months = getMonths();
  const month = months[yearMonth] || ensureMonth(yearMonth);
  const invoices: MonthCardInvoice[] = month.cardInvoices || [];

  const idx = invoices.findIndex(ci => ci.cardId === cardId);
  if (idx >= 0) {
    invoices[idx].invoiceTotal = invoiceTotal;
  } else {
    invoices.push({ cardId, cardName: '', invoiceTotal, paid: false });
  }

  month.cardInvoices = invoices;
  months[yearMonth] = month;
  setMonths(months);
}

export function toggleLocalCardInvoicePaid(
  yearMonth: string,
  cardId: string,
  cardName: string,
  invoiceTotal: number,
  paidFromBank?: string,
) {
  const months = getMonths();
  const month = months[yearMonth] || ensureMonth(yearMonth);
  const invoices: MonthCardInvoice[] = month.cardInvoices || [];

  const idx = invoices.findIndex(ci => ci.cardId === cardId);
  if (idx >= 0) {
    const nowPaid = !invoices[idx].paid;
    const previousBank = invoices[idx].paidFromBank;
    invoices[idx].paid = nowPaid;
    if (nowPaid) {
      invoices[idx].paidFromBank = paidFromBank;
      if (paidFromBank) adjustLocalBankBalance(paidFromBank, -invoices[idx].invoiceTotal);
    } else {
      delete invoices[idx].paidFromBank;
      if (previousBank) adjustLocalBankBalance(previousBank, invoices[idx].invoiceTotal);
    }
  } else {
    invoices.push({ cardId, cardName, invoiceTotal, paid: true, paidFromBank });
    if (paidFromBank) adjustLocalBankBalance(paidFromBank, -invoiceTotal);
  }

  month.cardInvoices = invoices;
  months[yearMonth] = month;
  setMonths(months);
}

export function updateLocalExpenseOverride(
  yearMonth: string,
  expenseId: string,
  value: number,
) {
  const months = getMonths();
  const month = months[yearMonth] || ensureMonth(yearMonth);
  const overrides: MonthExpenseOverride[] = month.expenseOverrides || [];

  const idx = overrides.findIndex(o => o.expenseId === expenseId);
  if (idx >= 0) {
    overrides[idx].value = value;
  } else {
    overrides.push({ expenseId, value });
  }

  month.expenseOverrides = overrides;
  months[yearMonth] = month;
  setMonths(months);
}

export function updateLocalBankBalance(bankName: string, balance: number) {
  const profile = getLocalProfile();
  if (!profile) return;
  const idx = profile.banks.findIndex(b => b.name === bankName);
  if (idx >= 0) {
    profile.banks[idx].balance = balance;
  }
  write(KEYS.profile, profile);
}

export function updateLocalFoodVoucher(value: number) {
  const profile = getLocalProfile();
  if (!profile) return;
  profile.foodVoucher = value;
  write(KEYS.profile, profile);
}

export function getLocalExpenseOverrides(yearMonth: string): Map<string, number> {
  const months = getMonths();
  const overrideMap = new Map<string, number>();

  // Get all months <= yearMonth sorted desc
  const sortedKeys = Object.keys(months)
    .filter(ym => ym <= yearMonth)
    .sort((a, b) => b.localeCompare(a));

  for (const ym of sortedKeys) {
    const month = months[ym];
    for (const override of (month.expenseOverrides || [])) {
      if (!overrideMap.has(override.expenseId)) {
        overrideMap.set(override.expenseId, override.value);
      }
    }
  }

  return overrideMap;
}

// ==================== Migration ====================

export function hasLocalFinanceData(): boolean {
  return getLocalProfile() !== null;
}

export function getAllLocalData() {
  return {
    profile: getLocalProfile(),
    cards: getLocalCards(),
    expenses: getAllLocalExpenses(),
    installments: getLocalInstallments(),
    months: getMonths(),
  };
}

export function clearLocalFinanceData() {
  Object.values(KEYS).forEach(key => {
    if (typeof window !== 'undefined') localStorage.removeItem(key);
  });
}

// ==================== Form Auto-Save ====================

const DRAFT_PREFIX = 'finance_draft_';

export function saveDraft(formId: string, data: unknown) {
  write(`${DRAFT_PREFIX}${formId}`, data);
}

export function loadDraft<T>(formId: string): T | null {
  return read<T | null>(`${DRAFT_PREFIX}${formId}`, null);
}

export function clearDraft(formId: string) {
  if (typeof window !== 'undefined') localStorage.removeItem(`${DRAFT_PREFIX}${formId}`);
}
