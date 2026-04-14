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
  InstallmentGroup,
  CardView,
} from './types';

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

export function getExpenseOverridesFromDocs(
  monthDocs: { yearMonth: string; expenseOverrides?: MonthExpenseOverride[] }[],
): Map<string, number> {
  const overrideMap = new Map<string, number>();
  // docs should be sorted desc by yearMonth — first match wins (most recent)
  for (const doc of monthDocs) {
    for (const override of (doc.expenseOverrides || [])) {
      if (!overrideMap.has(override.expenseId)) {
        overrideMap.set(override.expenseId, override.value);
      }
    }
  }
  return overrideMap;
}
