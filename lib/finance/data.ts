import clientPromise from '../mongodb';
import { ObjectId } from 'mongodb';
import type {
  FinanceProfile,
  CreditCard,
  RecurringExpense,
  Installment,
  MonthData,
  MonthPayment,
  MonthCardInvoice,
  MonthExpenseOverride,
  InstallmentGroup,
  CardView,
} from './types';

const INSTALLMENT_ROLLOVER_CONTROL_ID = 'installment-rollover';

interface FinanceControl {
  _id: string;
  processedThrough?: string;
  lockedUntil?: Date | null;
  lockedAt?: Date;
  createdAt?: Date;
  updatedAt?: Date;
}

function yearMonth(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function addMonthsToYearMonth(value: string, months: number): string {
  const [year, month] = value.split('-').map(Number);
  return yearMonth(new Date(year, month - 1 + months, 1));
}

function diffYearMonths(from: string, to: string): number {
  const [fromYear, fromMonth] = from.split('-').map(Number);
  const [toYear, toMonth] = to.split('-').map(Number);
  return (toYear * 12 + toMonth) - (fromYear * 12 + fromMonth);
}

export async function ensureInstallmentRollover() {
  const client = await clientPromise;
  const db = client.db();
  const control = db.collection<FinanceControl>('financeControl');
  const now = new Date();
  const currentYearMonth = yearMonth(now);
  const previousYearMonth = addMonthsToYearMonth(currentYearMonth, -1);

  await control.updateOne(
    { _id: INSTALLMENT_ROLLOVER_CONTROL_ID },
    {
      $setOnInsert: {
        processedThrough: previousYearMonth,
        updatedAt: now,
        createdAt: now,
      },
    },
    { upsert: true }
  );

  const currentControl = await control.findOne({ _id: INSTALLMENT_ROLLOVER_CONTROL_ID });
  const processedThrough = currentControl?.processedThrough as string | undefined;
  if (!processedThrough) return;

  const monthsToRoll = diffYearMonths(processedThrough, currentYearMonth);
  if (monthsToRoll <= 0) return;

  const lockUntil = new Date(now.getTime() + 2 * 60 * 1000);
  const locked = await control.findOneAndUpdate(
    {
      _id: INSTALLMENT_ROLLOVER_CONTROL_ID,
      processedThrough,
      $or: [
        { lockedUntil: { $exists: false } },
        { lockedUntil: null },
        { lockedUntil: { $lt: now } },
      ],
    },
    { $set: { lockedUntil: lockUntil, lockedAt: now } },
    { returnDocument: 'after' }
  );

  if (!locked) return;

  try {
    await db.collection('financeInstallment').updateMany(
      { remainingInstallments: { $gt: 0 } },
      { $inc: { remainingInstallments: -monthsToRoll } }
    );
    await db.collection('financeInstallment').deleteMany(
      { remainingInstallments: { $lte: 0 } }
    );
    await control.updateOne(
      { _id: INSTALLMENT_ROLLOVER_CONTROL_ID },
      {
        $set: { processedThrough: currentYearMonth, updatedAt: new Date() },
        $unset: { lockedUntil: '', lockedAt: '' },
      }
    );
  } catch (error) {
    await control.updateOne(
      { _id: INSTALLMENT_ROLLOVER_CONTROL_ID },
      { $unset: { lockedUntil: '', lockedAt: '' }, $set: { updatedAt: new Date() } }
    );
    throw error;
  }
}

// ==================== Profile ====================

export async function getProfile(userId: string): Promise<FinanceProfile | null> {
  const client = await clientPromise;
  const db = client.db();
  const doc = await db.collection('financeProfile').findOne({ userId });
  if (!doc) return null;
  return { ...doc, _id: doc._id.toString() } as FinanceProfile;
}

export async function upsertProfile(userId: string, data: Omit<FinanceProfile, '_id' | 'userId' | 'createdAt' | 'updatedAt'>) {
  const client = await clientPromise;
  const db = client.db();
  const now = new Date();
  await db.collection('financeProfile').updateOne(
    { userId },
    {
      $set: { ...data, userId, updatedAt: now },
      $setOnInsert: { createdAt: now },
    },
    { upsert: true }
  );
}

// ==================== Credit Cards ====================

export async function getCards(userId: string): Promise<CreditCard[]> {
  const client = await clientPromise;
  const db = client.db();
  const docs = await db.collection('financeCard').find({ userId }).toArray();
  return docs.map(d => ({ ...d, _id: d._id.toString() })) as CreditCard[];
}

export async function upsertCard(userId: string, card: { _id?: string; name: string; dueDay: number; invoiceTotal?: number }) {
  const client = await clientPromise;
  const db = client.db();
  if (card._id) {
    const $set: Record<string, unknown> = { name: card.name, dueDay: card.dueDay };
    if (card.invoiceTotal != null) $set.invoiceTotal = card.invoiceTotal;
    await db.collection('financeCard').updateOne(
      { _id: new ObjectId(card._id) },
      { $set }
    );
    return card._id;
  } else {
    const result = await db.collection('financeCard').insertOne({
      userId, name: card.name, dueDay: card.dueDay, invoiceTotal: card.invoiceTotal ?? 0,
    });
    return result.insertedId.toString();
  }
}

export async function deleteCard(cardId: string) {
  const client = await clientPromise;
  const db = client.db();
  await db.collection('financeCard').deleteOne({ _id: new ObjectId(cardId) });
  await db.collection('financeInstallment').deleteMany({ cardId });
}

export async function updateCardInvoice(cardId: string, invoiceTotal: number) {
  const client = await clientPromise;
  const db = client.db();
  await db.collection('financeCard').updateOne(
    { _id: new ObjectId(cardId) },
    { $set: { invoiceTotal } }
  );
}

// ==================== Recurring Expenses ====================

export async function getExpenses(userId: string): Promise<RecurringExpense[]> {
  const client = await clientPromise;
  const db = client.db();
  const docs = await db.collection('financeExpense').find({ userId }).sort({ order: 1 }).toArray();
  return docs.map(d => ({ ...d, _id: d._id.toString() })) as RecurringExpense[];
}

export async function saveExpenses(userId: string, expenses: (Omit<RecurringExpense, '_id' | 'userId'> & { _id?: string })[]) {
  const client = await clientPromise;
  const db = client.db();
  const col = db.collection('financeExpense');

  const keepIds = expenses.filter(e => e._id).map(e => new ObjectId(e._id!));
  await col.deleteMany({ userId, _id: { $nin: keepIds } });

  const ops = expenses.map((e, i) => {
    const { _id, ...fields } = e;
    if (_id) {
      return col.updateOne(
        { _id: new ObjectId(_id), userId },
        { $set: { ...fields, userId, order: i } }
      );
    } else {
      return col.insertOne({ ...fields, userId, order: i });
    }
  });
  await Promise.all(ops);
}

// ==================== Installments ====================

export async function getInstallments(userId: string): Promise<Installment[]> {
  await ensureInstallmentRollover();
  const client = await clientPromise;
  const db = client.db();
  const docs = await db.collection('financeInstallment')
    .find({ userId, remainingInstallments: { $gt: 0 } })
    .sort({ remainingInstallments: -1 })
    .toArray();
  return docs.map(d => ({ ...d, _id: d._id.toString(), cardId: d.cardId.toString() })) as Installment[];
}

export async function addInstallment(userId: string, data: Omit<Installment, '_id' | 'userId' | 'createdAt'>) {
  const client = await clientPromise;
  const db = client.db();
  await db.collection('financeInstallment').insertOne({
    ...data, userId, createdAt: new Date(),
  });
}

export async function saveInstallments(userId: string, installments: (Omit<Installment, '_id' | 'userId' | 'createdAt'> & { _id?: string })[]) {
  const client = await clientPromise;
  const db = client.db();
  const col = db.collection('financeInstallment');

  const keepIds = installments.filter(i => i._id).map(i => new ObjectId(i._id!));
  await col.deleteMany({ userId, _id: { $nin: keepIds } });

  const ops = installments.map(inst => {
    const { _id, ...fields } = inst;
    if (_id) {
      return col.updateOne(
        { _id: new ObjectId(_id), userId },
        { $set: { ...fields, userId } }
      );
    }
    return col.insertOne({ ...fields, userId, createdAt: new Date() });
  });
  await Promise.all(ops);
}

export async function deleteInstallment(installmentId: string) {
  const client = await clientPromise;
  const db = client.db();
  await db.collection('financeInstallment').deleteOne({ _id: new ObjectId(installmentId) });
}

export async function updateInstallment(
  installmentId: string,
  data: { monthlyValue?: number; remainingInstallments?: number; description?: string }
) {
  const client = await clientPromise;
  const db = client.db();
  const $set: Record<string, unknown> = {};
  if (data.monthlyValue !== undefined) $set.monthlyValue = data.monthlyValue;
  if (data.remainingInstallments !== undefined) $set.remainingInstallments = data.remainingInstallments;
  if (data.description !== undefined) $set.description = data.description;
  await db.collection('financeInstallment').updateOne(
    { _id: new ObjectId(installmentId) },
    { $set }
  );
}

export async function rollOverMonth(userId: string) {
  const client = await clientPromise;
  const db = client.db();
  // Decrement all active installments, remove finished ones
  await db.collection('financeInstallment').updateMany(
    { userId, remainingInstallments: { $gt: 0 } },
    { $inc: { remainingInstallments: -1 } }
  );
  await db.collection('financeInstallment').deleteMany(
    { userId, remainingInstallments: { $lte: 0 } }
  );
}

// ==================== Month Data ====================

export async function getMonthData(userId: string, yearMonth: string): Promise<MonthData | null> {
  const client = await clientPromise;
  const db = client.db();
  const doc = await db.collection('financeMonth').findOne({ userId, yearMonth });
  if (!doc) return null;
  return { ...doc, _id: doc._id.toString() } as MonthData;
}

export async function upsertMonthData(userId: string, yearMonth: string, data: Partial<MonthData>) {
  const client = await clientPromise;
  const db = client.db();
  await db.collection('financeMonth').updateOne(
    { userId, yearMonth },
    { $set: { ...data, userId, yearMonth } },
    { upsert: true }
  );
}

export async function toggleExpensePayment(
  userId: string,
  yearMonth: string,
  expenseId: string,
  expenseName: string,
  amountPaid: number,
) {
  const client = await clientPromise;
  const db = client.db();
  const doc = await db.collection('financeMonth').findOne({ userId, yearMonth });
  const payments: MonthPayment[] = doc?.payments || [];

  const idx = payments.findIndex(p => p.expenseId === expenseId);
  if (idx >= 0) {
    // Already paid → remove (toggle off)
    payments.splice(idx, 1);
  } else {
    // Mark as paid
    payments.push({ expenseId, expenseName, amountPaid, paidAt: new Date() });
  }

  await db.collection('financeMonth').updateOne(
    { userId, yearMonth },
    { $set: { payments, userId, yearMonth } },
    { upsert: true }
  );
}

// ==================== Month Expense Overrides ====================

export async function updateMonthExpenseValue(
  userId: string,
  yearMonth: string,
  expenseId: string,
  value: number,
) {
  const client = await clientPromise;
  const db = client.db();
  const doc = await db.collection('financeMonth').findOne({ userId, yearMonth });
  const overrides: MonthExpenseOverride[] = doc?.expenseOverrides || [];

  const idx = overrides.findIndex(o => o.expenseId === expenseId);
  if (idx >= 0) {
    overrides[idx].value = value;
  } else {
    overrides.push({ expenseId, value });
  }

  await db.collection('financeMonth').updateOne(
    { userId, yearMonth },
    { $set: { expenseOverrides: overrides, userId, yearMonth } },
    { upsert: true }
  );
}

/**
 * Get the effective value for an expense in a given month.
 * Checks current month for override, then most recent prior month with override, then default.
 */
export async function getExpenseOverrides(
  userId: string,
  yearMonth: string,
): Promise<Map<string, number>> {
  const client = await clientPromise;
  const db = client.db();

  // Find the current month and all prior months that have overrides for any expense
  const docs = await db.collection('financeMonth')
    .find({
      userId,
      yearMonth: { $lte: yearMonth },
      'expenseOverrides.0': { $exists: true },
    })
    .sort({ yearMonth: -1 })
    .toArray();

  // Build map: for each expense, use the most recent override <= yearMonth
  const overrideMap = new Map<string, number>();
  for (const doc of docs) {
    for (const override of (doc.expenseOverrides || []) as MonthExpenseOverride[]) {
      if (!overrideMap.has(override.expenseId)) {
        overrideMap.set(override.expenseId, override.value);
      }
    }
  }

  return overrideMap;
}

// ==================== Month Card Invoices ====================

export async function getOrInitMonthCardInvoices(
  userId: string,
  yearMonth: string,
  cards: CreditCard[],
  installments: Installment[],
  monthOffset: number,
): Promise<MonthCardInvoice[]> {
  const monthData = await getMonthData(userId, yearMonth);

  if (monthData?.cardInvoices?.length) {
    return monthData.cardInvoices;
  }

  // Initialize: current month uses card's invoiceTotal, future months use installments sum
  return cards.map(card => {
    const cardInsts = installments.filter(i => i.cardId === card._id);
    const activeInsts = cardInsts.filter(i => i.remainingInstallments > monthOffset);
    const installmentsTotal = activeInsts.reduce((sum, i) => sum + i.monthlyValue, 0);

    return {
      cardId: card._id!,
      cardName: card.name,
      invoiceTotal: monthOffset === 0 ? card.invoiceTotal : installmentsTotal,
      paid: false,
    };
  });
}

export async function updateMonthCardInvoice(
  userId: string,
  yearMonth: string,
  cardId: string,
  invoiceTotal: number,
) {
  const client = await clientPromise;
  const db = client.db();
  const doc = await db.collection('financeMonth').findOne({ userId, yearMonth });
  const invoices: MonthCardInvoice[] = doc?.cardInvoices || [];

  const idx = invoices.findIndex(ci => ci.cardId === cardId);
  if (idx >= 0) {
    invoices[idx].invoiceTotal = invoiceTotal;
  } else {
    invoices.push({ cardId, cardName: '', invoiceTotal, paid: false });
  }

  await db.collection('financeMonth').updateOne(
    { userId, yearMonth },
    { $set: { cardInvoices: invoices, userId, yearMonth } },
    { upsert: true }
  );
}

export async function toggleMonthCardInvoicePaid(
  userId: string,
  yearMonth: string,
  cardId: string,
  cardName: string,
  invoiceTotal: number,
) {
  const client = await clientPromise;
  const db = client.db();
  const doc = await db.collection('financeMonth').findOne({ userId, yearMonth });
  const invoices: MonthCardInvoice[] = doc?.cardInvoices || [];

  const idx = invoices.findIndex(ci => ci.cardId === cardId);
  if (idx >= 0) {
    invoices[idx].paid = !invoices[idx].paid;
  } else {
    invoices.push({ cardId, cardName, invoiceTotal, paid: true });
  }

  await db.collection('financeMonth').updateOne(
    { userId, yearMonth },
    { $set: { cardInvoices: invoices, userId, yearMonth } },
    { upsert: true }
  );
}

// ==================== Computed Views ====================

export function groupInstallments(installments: Installment[], cards: CreditCard[], monthOffset = 0): InstallmentGroup[] {
  const cardMap = new Map(cards.map(c => [c._id!, c.name]));
  const groups = new Map<number, InstallmentGroup>();

  for (const inst of installments) {
    const remaining = inst.remainingInstallments - monthOffset;
    if (remaining <= 0) continue;
    if (!groups.has(remaining)) {
      groups.set(remaining, { remaining, total: 0, items: [] });
    }
    const group = groups.get(remaining)!;
    group.total += inst.monthlyValue;
    group.items.push({
      _id: inst._id!,
      description: inst.description,
      monthlyValue: inst.monthlyValue,
      cardName: cardMap.get(inst.cardId) || 'N/A',
    });
  }

  return Array.from(groups.values()).sort((a, b) => b.remaining - a.remaining);
}

export function buildCardViews(
  cards: CreditCard[],
  installments: Installment[],
  monthInvoices?: MonthCardInvoice[],
  monthOffset = 0,
): CardView[] {
  const invoiceMap = new Map((monthInvoices || []).map(ci => [ci.cardId, ci]));

  return cards.map(card => {
    const cardInstallments = installments
      .filter(i => i.cardId === card._id && i.remainingInstallments > monthOffset);
    const installmentsTotal = cardInstallments.reduce((sum, i) => sum + i.monthlyValue, 0);
    const monthInvoice = invoiceMap.get(card._id!);
    const invoiceTotal = monthInvoice ? monthInvoice.invoiceTotal : card.invoiceTotal;
    const paid = monthInvoice ? monthInvoice.paid : false;

    return {
      _id: card._id!,
      name: card.name,
      dueDay: card.dueDay,
      invoiceTotal,
      installmentsTotal,
      extras: invoiceTotal - installmentsTotal,
      paid,
      items: cardInstallments.map(i => ({
        _id: i._id!,
        description: i.description,
        remaining: i.remainingInstallments - monthOffset,
        monthlyValue: i.monthlyValue,
      })).sort((a, b) => b.remaining - a.remaining),
    };
  });
}

export function calculateMonthBalance(
  profile: FinanceProfile,
  expenses: RecurringExpense[],
  installmentGroups: InstallmentGroup[],
  daysInMonth: number,
  expenseOverrides?: Map<string, number>,
) {
  const totalSalary = profile.salary.payment + profile.salary.advance;
  const vr = profile.foodVoucher;

  // Calcular despesas recorrentes
  const calcExpenseValue = (e: RecurringExpense) => {
    const baseValue = expenseOverrides?.get(e._id!) ?? e.value;
    if (e.proportional === 'daily') return baseValue * daysInMonth;
    if (e.proportional === 'weekly') return baseValue * (daysInMonth / 7);
    return baseValue;
  };

  const cardExpensesTotal = expenses
    .filter(e => e.category === 'card')
    .reduce((sum, e) => sum + calcExpenseValue(e), 0);

  const cashExpensesTotal = expenses
    .filter(e => e.category === 'cash')
    .reduce((sum, e) => sum + calcExpenseValue(e), 0);

  const installmentsTotal = installmentGroups.reduce((sum, g) => sum + g.total, 0);

  // Saldo Mês = salário + VR - todas despesas
  const monthBalance = totalSalary + vr - cardExpensesTotal - cashExpensesTotal - installmentsTotal;

  return {
    totalSalary,
    vr,
    cardExpensesTotal,
    cashExpensesTotal,
    installmentsTotal,
    monthBalance,
  };
}

export function calculateTotalBalance(
  profile: FinanceProfile,
  cashExpensesTotal: number,
  installmentsTotal: number,
  invoiceExtras: number,
  dayOfMonth: number,
) {
  const bankTotal = profile.banks.reduce((sum, b) => sum + b.balance, 0);
  const vr = profile.foodVoucher;

  // Lógica dinâmica baseada no dia do mês:
  // Antes do dia do pagamento: saldo banco + pagamento pendente + VR - custos a vista - extras cartão
  // Após pagamento, antes adiantamento: saldo banco + VR - custos a vista - extras cartão
  // Após adiantamento: saldo banco - adiantamento + VR - custos a vista - extras cartão

  let total: number;
  if (dayOfMonth < profile.salary.paymentDay) {
    // Antes de receber pagamento: inclui pagamento pendente
    total = bankTotal + profile.salary.payment + vr - cashExpensesTotal - installmentsTotal - invoiceExtras;
  } else if (dayOfMonth < profile.salary.advanceDay) {
    // Recebeu pagamento, antes do adiantamento
    total = bankTotal + vr - cashExpensesTotal - installmentsTotal - invoiceExtras;
  } else {
    // Recebeu adiantamento: subtrai pois é do próximo mês
    total = bankTotal - profile.salary.advance + vr - cashExpensesTotal - installmentsTotal - invoiceExtras;
  }

  return { bankTotal, total };
}

export function calculateProjections(
  monthBalance: number,
  installmentGroups: InstallmentGroup[],
): { label: string; value: number }[] {
  const projections: { label: string; value: number }[] = [];

  // Ordenar grupos por remaining (menor primeiro) para projeções
  const sorted = [...installmentGroups].sort((a, b) => a.remaining - b.remaining);

  let accumulated = 0;
  for (let i = 1; i <= 6; i++) {
    // Parcelas que terminam neste mês (remaining === i ou menos)
    const finishing = sorted
      .filter(g => g.remaining <= i)
      .reduce((sum, g) => sum + g.total, 0);
    accumulated = finishing;
    projections.push({
      label: `M+${i}`,
      value: monthBalance + accumulated,
    });
  }

  return projections;
}

// ==================== Expense Types (legacy) ====================

export async function fetchExpenseTypes(): Promise<{ _id: string; name: string }[]> {
  try {
    const client = await clientPromise;
    const db = client.db();
    const expenseTypes = await db.collection('ExpenseTypes')
      .find({}).project({ name: 1 }).toArray();
    return expenseTypes.map(expenseType => ({
      _id: expenseType._id.toString(),
      name: expenseType.name as string,
    }));
  } catch (error) {
    console.error('Failed to fetch expense types:', error);
    throw new Error('Failed to fetch expense types');
  }
}

