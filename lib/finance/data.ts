import clientPromise from '../mongodb';
import { ObjectId } from 'mongodb';
import type {
  FinanceProfile,
  CreditCard,
  RecurringExpense,
  Installment,
  MonthData,
  MonthPayment,
  InstallmentGroup,
  CardView,
} from './types';

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

export async function upsertCard(userId: string, card: Omit<CreditCard, '_id' | 'userId'> & { _id?: string }) {
  const client = await clientPromise;
  const db = client.db();
  if (card._id) {
    await db.collection('financeCard').updateOne(
      { _id: new ObjectId(card._id) },
      { $set: { name: card.name, dueDay: card.dueDay, invoiceTotal: card.invoiceTotal } }
    );
    return card._id;
  } else {
    const result = await db.collection('financeCard').insertOne({
      userId, name: card.name, dueDay: card.dueDay, invoiceTotal: card.invoiceTotal,
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

export async function saveExpenses(userId: string, expenses: Omit<RecurringExpense, '_id' | 'userId'>[]) {
  const client = await clientPromise;
  const db = client.db();
  await db.collection('financeExpense').deleteMany({ userId });
  if (expenses.length > 0) {
    await db.collection('financeExpense').insertMany(
      expenses.map((e, i) => ({ ...e, userId, order: i }))
    );
  }
}

// ==================== Installments ====================

export async function getInstallments(userId: string): Promise<Installment[]> {
  const client = await clientPromise;
  const db = client.db();
  const docs = await db.collection('financeInstallment')
    .find({ userId, remainingInstallments: { $gt: 0 } })
    .sort({ remainingInstallments: -1 })
    .toArray();
  return docs.map(d => ({ ...d, _id: d._id.toString() })) as Installment[];
}

export async function addInstallment(userId: string, data: Omit<Installment, '_id' | 'userId' | 'createdAt'>) {
  const client = await clientPromise;
  const db = client.db();
  await db.collection('financeInstallment').insertOne({
    ...data, userId, createdAt: new Date(),
  });
}

export async function deleteInstallment(installmentId: string) {
  const client = await clientPromise;
  const db = client.db();
  await db.collection('financeInstallment').deleteOne({ _id: new ObjectId(installmentId) });
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

// ==================== Computed Views ====================

export function groupInstallments(installments: Installment[], cards: CreditCard[]): InstallmentGroup[] {
  const cardMap = new Map(cards.map(c => [c._id!, c.name]));
  const groups = new Map<number, InstallmentGroup>();

  for (const inst of installments) {
    const remaining = inst.remainingInstallments;
    if (!groups.has(remaining)) {
      groups.set(remaining, { remaining, total: 0, items: [] });
    }
    const group = groups.get(remaining)!;
    group.total += inst.monthlyValue;
    group.items.push({
      description: inst.description,
      monthlyValue: inst.monthlyValue,
      cardName: cardMap.get(inst.cardId) || 'N/A',
    });
  }

  return Array.from(groups.values()).sort((a, b) => b.remaining - a.remaining);
}

export function buildCardViews(cards: CreditCard[], installments: Installment[]): CardView[] {
  return cards.map(card => {
    const cardInstallments = installments.filter(i => i.cardId === card._id);
    const installmentsTotal = cardInstallments.reduce((sum, i) => sum + i.monthlyValue, 0);
    return {
      _id: card._id!,
      name: card.name,
      dueDay: card.dueDay,
      invoiceTotal: card.invoiceTotal,
      installmentsTotal,
      extras: card.invoiceTotal - installmentsTotal,
      items: cardInstallments.map(i => ({
        description: i.description,
        remaining: i.remainingInstallments,
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
) {
  const totalSalary = profile.salary.payment + profile.salary.advance;
  const vr = profile.foodVoucher;

  // Calcular despesas recorrentes
  const calcExpenseValue = (e: RecurringExpense) => {
    if (e.proportional === 'daily') return e.value * daysInMonth;
    if (e.proportional === 'weekly') return e.value * (daysInMonth / 7);
    return e.value;
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

export async function fetchExpenseTypes() {
  try {
    const client = await clientPromise;
    const db = client.db();
    const expenseTypes = await db.collection('ExpenseTypes')
      .find({}).project({ name: 1 }).toArray();
    return expenseTypes.map(expenseType => ({
      ...expenseType,
      _id: expenseType._id.toString(),
    }));
  } catch (error) {
    console.error('Failed to fetch expense types:', error);
    throw new Error('Failed to fetch expense types');
  }
}

