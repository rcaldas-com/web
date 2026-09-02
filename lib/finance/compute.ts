/**
 * Pure computation functions for finance calculations.
 * No DB imports — safe to use in both server and client components.
 */
import type {
  FinanceProfile,
  CreditCard,
  RecurringExpense,
  Installment,
  MonthCardInvoice,
  MonthExpenseOverride,
  MonthPayment,
  InstallmentGroup,
  CardView,
} from './types';

export function isExpenseActiveInMonth(expense: RecurringExpense, yearMonth: string) {
  if (expense.activeFrom && expense.activeFrom > yearMonth) return false;
  return !expense.activeUntil || expense.activeUntil >= yearMonth;
}

export function filterExpensesForMonth(expenses: RecurringExpense[], yearMonth: string) {
  return expenses.filter(expense => isExpenseActiveInMonth(expense, yearMonth));
}

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

// Agrupa os pagamentos (parciais ou não) de um mês por despesa — uma despesa
// pode ter várias entradas quando paga aos poucos ao longo do mês.
export function groupPaymentsByExpense(payments?: MonthPayment[]): Map<string, MonthPayment[]> {
  const map = new Map<string, MonthPayment[]>();
  for (const p of payments ?? []) {
    if (!p.expenseId) continue;
    const arr = map.get(p.expenseId);
    if (arr) arr.push(p);
    else map.set(p.expenseId, [p]);
  }
  return map;
}

// Tolerância de arredondamento (meio centavo) pra não deixar erro de ponto
// flutuante marcar uma despesa como "quase paga" incorretamente.
const PAID_EPSILON = 0.005;

// Estado de pagamento de uma despesa no mês: soma dos pagamentos (parciais
// inclusive) contra o valor efetivo do template/override. "Paga" só quando o
// restante zera (ou fica negativo, se pagou a mais). Enquanto não paga,
// displayValue é o restante a pagar; uma vez paga, é o total efetivamente
// pago (amountPaid) — igual ao planejado no caso normal, mas maior que ele
// se estourou, pra manter visível quanto passou do previsto.
export function computeExpensePaymentState(templateValue: number, payments?: MonthPayment[]) {
  const amountPaid = Math.round((payments ?? []).reduce((sum, p) => sum + p.amountPaid, 0) * 100) / 100;
  const remaining = Math.round((templateValue - amountPaid) * 100) / 100;
  const paid = amountPaid > 0 && remaining <= PAID_EPSILON;
  return { amountPaid, remaining, paid, displayValue: paid ? amountPaid : remaining };
}

export function calculateMonthBalance(
  profile: FinanceProfile,
  expenses: RecurringExpense[],
  installmentGroups: InstallmentGroup[],
  daysInMonth: number,
  expenseOverrides?: Map<string, number>,
) {
  const totalSalary = profile.salary.payment + profile.salary.advance;
  const vr = profile.foodVoucherMonthly ?? profile.foodVoucher;

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

export function initMonthCardInvoices(
  cards: CreditCard[],
  installments: Installment[],
  monthOffset: number,
): MonthCardInvoice[] {
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

