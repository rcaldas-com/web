import { cache } from 'react';
import clientPromise from '../mongodb';
import { ObjectId } from 'mongodb';
import { addMonthsToYearMonth, getFinanceToday, yearMonthIndex } from './date';
import { recordChange, diffFields, type JournalChange } from './journal';
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

function diffYearMonths(from: string, to: string): number {
  return yearMonthIndex(to) - yearMonthIndex(from);
}

export async function ensureInstallmentRollover() {
  const client = await clientPromise;
  const db = client.db();
  const control = db.collection<FinanceControl>('financeControl');
  const now = new Date();
  const currentYearMonth = getFinanceToday(now).yearMonth;
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
  const before = await db.collection('financeProfile').findOne({ userId });
  await db.collection('financeProfile').updateOne(
    { userId },
    {
      $set: { ...data, userId, updatedAt: now },
      $setOnInsert: { createdAt: now },
    },
    { upsert: true }
  );

  // Journal: salário, VR e saldo de cada banco (por nome).
  const beforeSalary = (before?.salary ?? {}) as Record<string, unknown>;
  const changes: JournalChange[] = [
    ...diffFields(beforeSalary, data.salary as unknown as Record<string, unknown>, [
      { field: 'payment', label: 'Pagamento', kind: 'money' },
      { field: 'advance', label: 'Adiantamento', kind: 'money' },
      { field: 'paymentDay', label: 'Dia do pagamento', kind: 'number' },
      { field: 'advanceDay', label: 'Dia do adiantamento', kind: 'number' },
    ]),
    ...diffFields(before ?? null, data as unknown as Record<string, unknown>, [
      { field: 'foodVoucher', label: 'Vale (VR/VA)', kind: 'money' },
      { field: 'foodVoucherMonthly', label: 'Vale mensal cheio', kind: 'money' },
    ]),
  ];
  const beforeBanks = new Map(
    ((before?.banks ?? []) as { name: string; balance: number }[]).map((b) => [b.name, b.balance]),
  );
  const afterBanks = new Map((data.banks ?? []).map((b) => [b.name, b.balance]));
  for (const [name, balance] of afterBanks) {
    const prev = beforeBanks.get(name);
    if (prev === undefined) {
      changes.push({ field: `bank:${name}`, label: `Banco ${name}`, before: null, after: balance, kind: 'money' });
    } else if (Math.round(prev * 100) !== Math.round(balance * 100)) {
      changes.push({ field: `bank:${name}`, label: `Banco ${name}`, before: prev, after: balance, kind: 'money' });
    }
  }
  for (const [name, balance] of beforeBanks) {
    if (!afterBanks.has(name)) {
      changes.push({ field: `bank:${name}`, label: `Banco ${name} (removido)`, before: balance, after: null, kind: 'money' });
    }
  }

  await recordChange({
    userId,
    entity: 'profile',
    entityLabel: 'Perfil',
    scope: 'perfil',
    action: before ? 'update' : 'create',
    changes,
    source: 'user',
  });
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export async function adjustBankBalance(userId: string, bankName: string, delta: number) {
  const client = await clientPromise;
  const db = client.db();
  // Read-modify-write to avoid floating-point accumulation from $inc
  const profile = await db.collection('financeProfile').findOne({ userId });
  const bank = (profile?.banks as { name: string; balance: number }[] | undefined)?.find(b => b.name === bankName);
  const oldBalance = bank?.balance ?? 0;
  const newBalance = round2(oldBalance + round2(delta));
  await db.collection('financeProfile').updateOne(
    { userId, 'banks.name': bankName },
    { $set: { 'banks.$.balance': newBalance } }
  );

  // Derivado: ajuste automático de saldo ao pagar/estornar. Registrado à parte
  // do 'user' pra não confundir com edição manual do saldo.
  await recordChange({
    userId,
    entity: 'profile',
    entityLabel: 'Perfil',
    scope: 'saldo',
    action: 'update',
    changes: [{ field: `bank:${bankName}`, label: `Banco ${bankName}`, before: oldBalance, after: newBalance, kind: 'money' }],
    source: 'derived',
  });
}

// ==================== Credit Cards ====================

export async function getCards(userId: string): Promise<CreditCard[]> {
  const client = await clientPromise;
  const db = client.db();
  const docs = await db.collection('financeCard').find({ userId }).toArray();
  return docs
    .map((d, index) => ({ ...d, _id: d._id.toString(), sortOrder: d.sortOrder ?? index }))
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)) as CreditCard[];
}

export async function upsertCard(userId: string, card: { _id?: string; name: string; dueDay: number; invoiceTotal?: number; sortOrder?: number }) {
  const client = await clientPromise;
  const db = client.db();
  if (card._id) {
    const before = await db.collection('financeCard').findOne({ _id: new ObjectId(card._id) });
    const $set: Record<string, unknown> = { name: card.name, dueDay: card.dueDay };
    if (card.invoiceTotal != null) $set.invoiceTotal = card.invoiceTotal;
    if (card.sortOrder != null) $set.sortOrder = card.sortOrder;
    await db.collection('financeCard').updateOne(
      { _id: new ObjectId(card._id) },
      { $set }
    );
    await recordChange({
      userId,
      entity: 'card',
      entityId: card._id,
      entityLabel: card.name,
      scope: 'cartão',
      action: 'update',
      changes: diffFields(before, $set, [
        { field: 'name', label: 'Nome', kind: 'text' },
        { field: 'dueDay', label: 'Vencimento', kind: 'number' },
        { field: 'invoiceTotal', label: 'Fatura', kind: 'money' },
      ]),
      source: 'user',
    });
    return card._id;
  } else {
    const result = await db.collection('financeCard').insertOne({
      userId, name: card.name, dueDay: card.dueDay, invoiceTotal: card.invoiceTotal ?? 0, sortOrder: card.sortOrder ?? 0,
    });
    await recordChange({
      userId,
      entity: 'card',
      entityId: result.insertedId.toString(),
      entityLabel: card.name,
      scope: 'cartão',
      action: 'create',
      changes: [
        { field: 'name', label: 'Nome', before: null, after: card.name, kind: 'text' },
        { field: 'invoiceTotal', label: 'Fatura', before: null, after: card.invoiceTotal ?? 0, kind: 'money' },
      ],
      source: 'user',
    });
    return result.insertedId.toString();
  }
}

export async function updateCardOrder(userId: string, cardIds: string[]) {
  const client = await clientPromise;
  const db = client.db();
  const ops = cardIds.map((cardId, index) => db.collection('financeCard').updateOne(
    { _id: new ObjectId(cardId), userId },
    { $set: { sortOrder: index } }
  ));
  await Promise.all(ops);
}

export async function deleteCard(cardId: string) {
  const client = await clientPromise;
  const db = client.db();
  const before = await db.collection('financeCard').findOne({ _id: new ObjectId(cardId) });
  await db.collection('financeCard').deleteOne({ _id: new ObjectId(cardId) });
  await db.collection('financeInstallment').deleteMany({ cardId });
  if (before) {
    await recordChange({
      userId: before.userId as string,
      entity: 'card',
      entityId: cardId,
      entityLabel: (before.name as string) || 'Cartão',
      scope: 'cartão',
      action: 'delete',
      changes: [
        { field: 'name', label: 'Nome', before: before.name ?? null, after: null, kind: 'text' },
        { field: 'invoiceTotal', label: 'Fatura', before: before.invoiceTotal ?? null, after: null, kind: 'money' },
      ],
      source: 'user',
    });
  }
}

export async function updateCardInvoice(cardId: string, invoiceTotal: number) {
  const client = await clientPromise;
  const db = client.db();
  const before = await db.collection('financeCard').findOne({ _id: new ObjectId(cardId) });
  await db.collection('financeCard').updateOne(
    { _id: new ObjectId(cardId) },
    { $set: { invoiceTotal } }
  );
  if (before) {
    await recordChange({
      userId: before.userId as string,
      entity: 'card',
      entityId: cardId,
      entityLabel: (before.name as string) || 'Cartão',
      scope: 'fatura',
      action: 'update',
      changes: diffFields(before, { invoiceTotal }, [{ field: 'invoiceTotal', label: 'Fatura', kind: 'money' }]),
      source: 'user',
    });
  }
}

// ==================== Recurring Expenses ====================

export async function getExpenses(userId: string): Promise<RecurringExpense[]> {
  const client = await clientPromise;
  const db = client.db();
  const docs = await db.collection('financeExpense').find({ userId, activeUntil: { $exists: false } }).sort({ order: 1 }).toArray();
  return docs.map(d => ({ ...d, _id: d._id.toString() })) as RecurringExpense[];
}

export async function getAllExpenses(userId: string): Promise<RecurringExpense[]> {
  const client = await clientPromise;
  const db = client.db();
  const docs = await db.collection('financeExpense').find({ userId }).sort({ order: 1 }).toArray();
  return docs.map(d => ({ ...d, _id: d._id.toString() })) as RecurringExpense[];
}

const EXPENSE_FIELD_SPECS = [
  { field: 'name', label: 'Nome', kind: 'text' as const },
  { field: 'value', label: 'Valor', kind: 'money' as const },
  { field: 'category', label: 'Categoria', kind: 'text' as const },
  { field: 'proportional', label: 'Proporcional', kind: 'text' as const },
  { field: 'dueDay', label: 'Vencimento', kind: 'number' as const },
];

export async function saveExpenses(userId: string, expenses: (Omit<RecurringExpense, '_id' | 'userId'> & { _id?: string })[]) {
  const client = await clientPromise;
  const db = client.db();
  const col = db.collection('financeExpense');

  // Snapshot das ativas antes, indexado por _id, pra diffar item a item.
  const beforeActive = await col.find({ userId, activeUntil: { $exists: false } }).toArray();
  const beforeById = new Map(beforeActive.map((d) => [d._id.toString(), d]));

  const currentYearMonth = getFinanceToday().yearMonth;
  const keepIds = expenses.filter(e => e._id).map(e => new ObjectId(e._id!));
  await col.updateMany(
    { userId, activeUntil: { $exists: false }, ...(keepIds.length ? { _id: { $nin: keepIds } } : {}) },
    { $set: { activeUntil: currentYearMonth } }
  );

  const ops = expenses.map((e, i) => {
    const { _id, ...fields } = e;
    if (_id) {
      return col.updateOne(
        { _id: new ObjectId(_id), userId },
        { $set: { ...fields, userId, order: i }, $unset: { activeUntil: '' } }
      );
    } else {
      return col.insertOne({ ...fields, userId, order: i, activeFrom: currentYearMonth });
    }
  });
  await Promise.all(ops);

  // Journal por despesa: atualizações (diff), criações e baixas (soft-delete).
  const keepIdSet = new Set(expenses.filter(e => e._id).map(e => e._id!));
  for (const e of expenses) {
    if (e._id) {
      const before = beforeById.get(e._id);
      await recordChange({
        userId,
        entity: 'expense',
        entityId: e._id,
        entityLabel: e.name,
        scope: 'despesa',
        action: 'update',
        changes: diffFields(before ?? null, e as unknown as Record<string, unknown>, EXPENSE_FIELD_SPECS),
        source: 'user',
      });
    } else {
      await recordChange({
        userId,
        entity: 'expense',
        entityLabel: e.name,
        scope: 'despesa',
        action: 'create',
        changes: [
          { field: 'name', label: 'Nome', before: null, after: e.name, kind: 'text' },
          { field: 'value', label: 'Valor', before: null, after: e.value, kind: 'money' },
        ],
        source: 'user',
      });
    }
  }
  for (const d of beforeActive) {
    if (!keepIdSet.has(d._id.toString())) {
      await recordChange({
        userId,
        entity: 'expense',
        entityId: d._id.toString(),
        entityLabel: (d.name as string) || 'Despesa',
        scope: 'baixa',
        action: 'delete',
        changes: [{ field: 'value', label: 'Valor', before: d.value ?? null, after: null, kind: 'money' }],
        source: 'user',
      });
    }
  }
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
  const result = await db.collection('financeInstallment').insertOne({
    ...data, userId, createdAt: new Date(),
  });
  await recordChange({
    userId,
    entity: 'installment',
    entityId: result.insertedId.toString(),
    entityLabel: data.description,
    scope: 'parcela',
    action: 'create',
    changes: [{ field: 'monthlyValue', label: 'Parcela', before: null, after: data.monthlyValue, kind: 'money' }],
    source: 'user',
  });
}

export async function saveInstallments(userId: string, installments: (Omit<Installment, '_id' | 'userId' | 'createdAt'> & { _id?: string })[]) {
  const client = await clientPromise;
  const db = client.db();
  const col = db.collection('financeInstallment');

  const beforeAll = await col.find({ userId }).toArray();
  const beforeById = new Map(beforeAll.map((d) => [d._id.toString(), d]));

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

  // Journal por parcela. remainingInstallments carrega o offset interno (+1),
  // então não diffamos ele aqui — o que interessa contra digitação errada é a
  // descrição e o valor da parcela.
  const keepIdSet = new Set(installments.filter(i => i._id).map(i => i._id!));
  for (const inst of installments) {
    if (inst._id) {
      await recordChange({
        userId,
        entity: 'installment',
        entityId: inst._id,
        entityLabel: inst.description,
        scope: 'parcela',
        action: 'update',
        changes: diffFields(beforeById.get(inst._id) ?? null, inst as unknown as Record<string, unknown>, [
          { field: 'description', label: 'Descrição', kind: 'text' },
          { field: 'monthlyValue', label: 'Parcela', kind: 'money' },
        ]),
        source: 'user',
      });
    } else {
      await recordChange({
        userId,
        entity: 'installment',
        entityLabel: inst.description,
        scope: 'parcela',
        action: 'create',
        changes: [{ field: 'monthlyValue', label: 'Parcela', before: null, after: inst.monthlyValue, kind: 'money' }],
        source: 'user',
      });
    }
  }
  for (const d of beforeAll) {
    if (!keepIdSet.has(d._id.toString())) {
      await recordChange({
        userId,
        entity: 'installment',
        entityId: d._id.toString(),
        entityLabel: (d.description as string) || 'Parcela',
        scope: 'parcela',
        action: 'delete',
        changes: [{ field: 'monthlyValue', label: 'Parcela', before: d.monthlyValue ?? null, after: null, kind: 'money' }],
        source: 'user',
      });
    }
  }
}

export async function getInstallment(installmentId: string): Promise<Installment | null> {
  const client = await clientPromise;
  const db = client.db();
  const doc = await db.collection('financeInstallment').findOne({ _id: new ObjectId(installmentId) });
  if (!doc) return null;
  return { ...doc, _id: doc._id.toString(), cardId: doc.cardId.toString() } as Installment;
}

export async function deleteInstallment(installmentId: string) {
  const client = await clientPromise;
  const db = client.db();
  const before = await db.collection('financeInstallment').findOne({ _id: new ObjectId(installmentId) });
  await db.collection('financeInstallment').deleteOne({ _id: new ObjectId(installmentId) });
  if (before) {
    await recordChange({
      userId: before.userId as string,
      entity: 'installment',
      entityId: installmentId,
      entityLabel: (before.description as string) || 'Parcela',
      scope: 'parcela',
      action: 'delete',
      changes: [{ field: 'monthlyValue', label: 'Parcela', before: before.monthlyValue ?? null, after: null, kind: 'money' }],
      source: 'user',
    });
  }
}

export async function updateInstallment(
  installmentId: string,
  data: { monthlyValue?: number; remainingInstallments?: number; description?: string }
) {
  const client = await clientPromise;
  const db = client.db();
  const before = await db.collection('financeInstallment').findOne({ _id: new ObjectId(installmentId) });
  const $set: Record<string, unknown> = {};
  if (data.monthlyValue !== undefined) $set.monthlyValue = data.monthlyValue;
  if (data.remainingInstallments !== undefined) $set.remainingInstallments = data.remainingInstallments;
  if (data.description !== undefined) $set.description = data.description;
  await db.collection('financeInstallment').updateOne(
    { _id: new ObjectId(installmentId) },
    { $set }
  );
  if (before) {
    // remainingInstallments não é diffado (carrega o offset interno +1).
    await recordChange({
      userId: before.userId as string,
      entity: 'installment',
      entityId: installmentId,
      entityLabel: (data.description ?? before.description ?? 'Parcela') as string,
      scope: 'parcela',
      action: 'update',
      changes: diffFields(before, $set, [
        { field: 'description', label: 'Descrição', kind: 'text' },
        { field: 'monthlyValue', label: 'Parcela', kind: 'money' },
      ]),
      source: 'user',
    });
  }
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

// cache(): dedupe por (userId, yearMonth) dentro da mesma requisição/action.
// app/finance/page.tsx chama isto pro mês em exibição e, separadamente, pro
// mês atual (pra calcular o saldo disponível projetado) -- quando os dois
// coincidem (caso mais comum: usuário olhando o mês corrente), viravam duas
// idas ao Mongo pra buscar exatamente o mesmo documento. Seguro em toda
// lib/finance/actions.ts também: cada action lê o mês uma vez, muta, e
// nunca relê depois de escrever dentro da mesma chamada.
export const getMonthData = cache(async (userId: string, yearMonth: string): Promise<MonthData | null> => {
  const client = await clientPromise;
  const db = client.db();
  const doc = await db.collection('financeMonth').findOne({ userId, yearMonth });
  if (!doc) return null;
  return { ...doc, _id: doc._id.toString() } as MonthData;
});

export async function upsertMonthData(userId: string, yearMonth: string, data: Partial<MonthData>) {
  const client = await clientPromise;
  const db = client.db();
  await db.collection('financeMonth').updateOne(
    { userId, yearMonth },
    { $set: { ...data, userId, yearMonth } },
    { upsert: true }
  );
}

// Registra um pagamento (cheio ou parcial) contra uma despesa no mês — sempre
// empilha uma nova entrada em payments[], nunca substitui/remove uma
// existente. Permite múltiplas entradas por expenseId no mesmo mês (um
// pagamento parcial por vez); "paga"/"restante" são derivados somando essas
// entradas (ver computeExpensePaymentState em compute.ts), não guardados aqui.
export async function addExpensePayment(
  userId: string,
  yearMonth: string,
  expenseId: string,
  expenseName: string,
  amount: number,
  paidFromBank?: string,
  paidToCard?: string,
): Promise<void> {
  const client = await clientPromise;
  const db = client.db();
  const doc = await db.collection('financeMonth').findOne({ userId, yearMonth });
  const payments: MonthPayment[] = doc?.payments || [];

  payments.push({ expenseId, expenseName, amountPaid: amount, paidAt: new Date(), paidFromBank, paidToCard });

  await db.collection('financeMonth').updateOne(
    { userId, yearMonth },
    { $set: { payments, userId, yearMonth } },
    { upsert: true }
  );

  await recordChange({
    userId,
    entity: 'expense',
    entityId: expenseId,
    entityLabel: expenseName,
    scope: 'pagamento',
    yearMonth,
    action: 'update',
    changes: [
      { field: 'valorPago', label: 'Valor pago', before: null, after: amount, kind: 'money' },
      ...(paidFromBank ? [{ field: 'conta', label: 'Conta', before: null, after: paidFromBank, kind: 'text' as const }] : []),
      ...(paidToCard ? [{ field: 'cartao', label: 'Cartão (próx. fatura)', before: null, after: paidToCard, kind: 'text' as const }] : []),
    ],
    source: 'user',
  });
}

// Desfaz TODOS os pagamentos (parciais inclusive) de uma despesa no mês —
// remove todas as entradas daquele expenseId em payments[] e devolve as
// removidas, pra o caller reverter o débito de cada uma em banco/cartão.
export async function removeAllExpensePayments(
  userId: string,
  yearMonth: string,
  expenseId: string,
  expenseName: string,
): Promise<MonthPayment[]> {
  const client = await clientPromise;
  const db = client.db();
  const doc = await db.collection('financeMonth').findOne({ userId, yearMonth });
  const payments: MonthPayment[] = doc?.payments || [];

  const removed = payments.filter(p => p.expenseId === expenseId);
  if (removed.length === 0) return [];
  const remaining = payments.filter(p => p.expenseId !== expenseId);

  await db.collection('financeMonth').updateOne(
    { userId, yearMonth },
    { $set: { payments: remaining, userId, yearMonth } },
    { upsert: true }
  );

  const totalReverted = Math.round(removed.reduce((sum, p) => sum + p.amountPaid, 0) * 100) / 100;
  await recordChange({
    userId,
    entity: 'expense',
    entityId: expenseId,
    entityLabel: expenseName,
    scope: 'pagamento',
    yearMonth,
    action: 'update',
    changes: [
      { field: 'pago', label: 'Pago', before: true, after: false, kind: 'bool' },
      { field: 'valorPago', label: 'Valor pago (revertido)', before: totalReverted, after: 0, kind: 'money' },
    ],
    source: 'user',
  });
  return removed;
}

// ==================== Month Expense Overrides ====================

export async function updatePaymentAmount(userId: string, yearMonth: string, expenseId: string, newAmount: number) {
  const client = await clientPromise;
  const db = client.db();
  await db.collection('financeMonth').updateOne(
    { userId, yearMonth, 'payments.expenseId': expenseId },
    { $set: { 'payments.$.amountPaid': newAmount } }
  );
}

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
  // Valor efetivo anterior: override deste mês, se houver; senão o valor base
  // da despesa. É o que o usuário via antes de alterar.
  const expenseDoc = await db.collection('financeExpense').findOne({ _id: new ObjectId(expenseId) });
  const beforeValue = idx >= 0 ? overrides[idx].value : (expenseDoc?.value as number | undefined) ?? null;
  // Escopo pelo mes que esta sendo editado, nao por opcao na tela: no mes
  // corrente a edicao e' quase sempre "foi isso que veio desta vez", e num
  // mes futuro e' "o padrao mudou". Pedir pro usuario declarar a intencao
  // seria pedir o que a propria posicao no calendario ja diz.
  const scope: 'month' | 'forward' = yearMonth === getFinanceToday().yearMonth ? 'month' : 'forward';
  if (idx >= 0) {
    overrides[idx].value = value;
    overrides[idx].scope = scope;
  } else {
    overrides.push({ expenseId, value, scope });
  }

  await db.collection('financeMonth').updateOne(
    { userId, yearMonth },
    { $set: { expenseOverrides: overrides, userId, yearMonth } },
    { upsert: true }
  );

  await recordChange({
    userId,
    entity: 'expense',
    entityId: expenseId,
    entityLabel: (expenseDoc?.name as string) || 'Despesa',
    scope: 'valor-mês',
    yearMonth,
    action: 'update',
    changes: diffFields({ value: beforeValue }, { value }, [{ field: 'value', label: 'Valor no mês', kind: 'money' }]),
    source: 'user',
  });
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

  // Mais recente <= yearMonth vence -- mas override de escopo 'month' so'
  // vale no proprio mes dele. Sem isso, corrigir "a luz veio 40 a mais
  // desta vez" no mes corrente reescrevia novembro, dezembro e todos os
  // seguintes com um valor que nunca foi o padrao.
  //
  // O `has` continua sendo o que impede um mes mais antigo de sobrepor:
  // quando um 'month' de mes anterior e' pulado, o laco segue procurando o
  // proximo 'forward' mais recente, que e' o padrao correto.
  const overrideMap = new Map<string, number>();
  for (const doc of docs) {
    const doProprioMes = doc.yearMonth === yearMonth;
    for (const override of (doc.expenseOverrides || []) as MonthExpenseOverride[]) {
      if (overrideMap.has(override.expenseId)) continue;
      const soNesteMes = override.scope === 'month';
      if (soNesteMes && !doProprioMes) continue;
      overrideMap.set(override.expenseId, override.value);
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

  const adjustments = monthData?.cardExpenseAdjustments || [];
  const storedMap = new Map((monthData?.cardInvoices || []).map(ci => [ci.cardId, ci]));

  const base: MonthCardInvoice[] = cards.map(card => {
    const stored = storedMap.get(card._id!);
    const cardInsts = installments.filter(i => i.cardId === card._id);
    const activeInsts = cardInsts.filter(i => i.remainingInstallments > monthOffset);
    const installmentsTotal = activeInsts.reduce((sum, i) => sum + i.monthlyValue, 0);
    const computedTotal = monthOffset === 0 ? card.invoiceTotal : installmentsTotal;
    return {
      cardId: card._id!,
      cardName: card.name,
      invoiceTotal: stored?.invoiceTotal ?? computedTotal,
      paid: stored?.paid ?? false,
      ...(stored?.paidFromBank ? { paidFromBank: stored.paidFromBank } : {}),
    };
  });

  if (!adjustments.length) return base;

  return base.map(inv => {
    const adj = adjustments.find(a => a.cardId === inv.cardId);
    return adj ? { ...inv, invoiceTotal: inv.invoiceTotal + adj.amount } : inv;
  });
}

export async function adjustCardExpenseInMonth(userId: string, yearMonth: string, cardId: string, delta: number) {
  const client = await clientPromise;
  const db = client.db();
  const doc = await db.collection('financeMonth').findOne({ userId, yearMonth });
  const adjustments: { cardId: string; amount: number }[] = doc?.cardExpenseAdjustments || [];

  const idx = adjustments.findIndex(a => a.cardId === cardId);
  if (idx >= 0) adjustments[idx].amount = round2(adjustments[idx].amount + round2(delta));
  else adjustments.push({ cardId, amount: round2(delta) });

  await db.collection('financeMonth').updateOne(
    { userId, yearMonth },
    { $set: { cardExpenseAdjustments: adjustments.filter(a => a.amount !== 0), userId, yearMonth } },
    { upsert: true }
  );
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
    const card = await db.collection('financeCard').findOne({ _id: new ObjectId(cardId) });
    invoices.push({ cardId, cardName: (card?.name as string) || '', invoiceTotal, paid: false });
  }

  await db.collection('financeMonth').updateOne(
    { userId, yearMonth },
    { $set: { cardInvoices: invoices, userId, yearMonth } },
    { upsert: true }
  );
  // NOTA: o journaling desta operação fica na action `updateMonthInvoice`, não
  // aqui — o valor que chega neste ponto é a BASE interna (valor exibido menos
  // os ajustes), então registrar aqui gravaria um número que não é o que o
  // usuário vê. A action conhece o valor exibido e registra o antes→depois certo.
}

export async function getCardInvoiceTotalForMonth(userId: string, yearMonth: string, cardId: string): Promise<number> {
  const monthData = await getMonthData(userId, yearMonth);
  return monthData?.cardInvoices?.find(ci => ci.cardId === cardId)?.invoiceTotal ?? 0;
}

export async function toggleMonthCardInvoicePaid(
  userId: string,
  yearMonth: string,
  cardId: string,
  cardName: string,
  invoiceTotal: number,
  paidFromBank?: string,
): Promise<{ nowPaid: boolean; previousBank?: string }> {
  const client = await clientPromise;
  const db = client.db();
  const doc = await db.collection('financeMonth').findOne({ userId, yearMonth });
  const invoices: MonthCardInvoice[] = doc?.cardInvoices || [];

  const idx = invoices.findIndex(ci => ci.cardId === cardId);
  let nowPaid: boolean;
  let previousBank: string | undefined;
  if (idx >= 0) {
    nowPaid = !invoices[idx].paid;
    previousBank = invoices[idx].paidFromBank;
    invoices[idx].paid = nowPaid;
    if (nowPaid) invoices[idx].paidFromBank = paidFromBank;
    else delete invoices[idx].paidFromBank;
  } else {
    // `invoiceTotal` chega aqui como o valor EXIBIDO (base + ajustes), mas
    // este campo guarda a BASE -- getOrInitMonthCardInvoices soma os ajustes
    // por cima na hora de exibir. Gravar o exibido faz o ajuste ser contado
    // duas vezes, e a fatura DOBRA assim que a tela recarrega.
    //
    // Acontecia so' no primeiro pagamento de um mes ainda nao tocado (que e'
    // quando nao ha registro e cai neste ramo) e so' em cartao cujo valor
    // vem de ajuste, nao de parcela -- por isso passou tanto tempo sem
    // aparecer. Caso real: fatura MP de 119,69, sem parcelas, paga no mes
    // seguinte -- base 0 + ajuste 119,69 exibia certo, e depois de paga
    // virava 239,38. A baixa no banco usou o valor certo; so' o que ficou
    // gravado estava errado.
    //
    // Mesma conversao que updateMonthInvoice ja faz (entered - existingAdj).
    // O doc ja esta carregado, entao nao custa consulta nova.
    const adj = (doc?.cardExpenseAdjustments as { cardId: string; amount: number }[] | undefined)
      ?.find(a => a.cardId === cardId)?.amount ?? 0;
    nowPaid = true;
    invoices.push({ cardId, cardName, invoiceTotal: round2(invoiceTotal - adj), paid: true, paidFromBank });
  }

  await db.collection('financeMonth').updateOne(
    { userId, yearMonth },
    { $set: { cardInvoices: invoices, userId, yearMonth } },
    { upsert: true }
  );

  await recordChange({
    userId,
    entity: 'card',
    entityId: cardId,
    entityLabel: cardName,
    scope: 'fatura-paga',
    yearMonth,
    action: 'update',
    changes: [{ field: 'pago', label: 'Fatura paga', before: !nowPaid, after: nowPaid, kind: 'bool' }],
    source: 'user',
  });
  return { nowPaid, previousBank };
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

