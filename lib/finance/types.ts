export interface FinanceProfile {
  _id?: string;
  userId: string;
  salary: {
    payment: number;     // Pag - dia 7 (inclui saúde/previdência)
    advance: number;     // Adiantamento - dia 15
    paymentDay: number;  // default 7
    advanceDay: number;  // default 15
  };
  foodVoucher: number;   // VR+VA fixo mensal (ex: 2300)
  banks: BankAccount[];
  createdAt: Date;
  updatedAt: Date;
}

export interface BankAccount {
  name: string;        // MP, BB, ITAU
  balance: number;
}

export interface CreditCard {
  _id?: string;
  userId: string;
  name: string;        // BB, ITAU, MP, Renner, NB
  dueDay: number;      // dia vencimento fatura
  invoiceTotal: number; // valor atual da fatura (atualizado manualmente)
}

export interface RecurringExpense {
  _id?: string;
  userId: string;
  name: string;
  value: number;             // valor fixo OU taxa diária/semanal se proportional
  category: 'card' | 'cash'; // card=impacta próximo mês, cash=impacta mês atual
  proportional: false | 'daily' | 'weekly'; // false=fixo, 'daily'=value×dias, 'weekly'=value×(dias/7)
  dueDay?: number;           // dia vencimento
  order: number;
}

export interface Installment {
  _id?: string;
  userId: string;
  cardId: string;            // referência ao CreditCard
  description: string;
  monthlyValue: number;
  remainingInstallments: number;
  createdAt: Date;
}

// Dados específicos de um mês (pagamentos feitos, ajustes)
export interface MonthData {
  _id?: string;
  userId: string;
  yearMonth: string;         // "2026-04"
  daysInMonth: number;
  payments: MonthPayment[];  // despesas pagas/zeradas no mês
  extraExpenses: ExtraExpense[]; // gastos pontuais do mês
  notes?: string;
}

export interface MonthPayment {
  expenseId?: string;        // referência à RecurringExpense (opcional)
  expenseName: string;
  amountPaid: number;
  paidAt: Date;
}

export interface ExtraExpense {
  name: string;
  value: number;
  category: 'card' | 'cash';
  paid: boolean;
}

// Parcelas agrupadas por meses restantes (para exibição tipo planilha)
export interface InstallmentGroup {
  remaining: number;         // meses restantes
  total: number;             // soma mensal do grupo
  items: {
    description: string;
    monthlyValue: number;
    cardName: string;
  }[];
}

// Visão calculada do mês (não persiste, é computada)
export interface MonthView {
  yearMonth: string;
  daysInMonth: number;
  salary: { payment: number; advance: number };
  foodVoucher: number;
  bankTotal: number;
  cardExpenses: { name: string; value: number; dueDay?: number; paid: boolean }[];
  cashExpenses: { name: string; value: number; dueDay?: number; paid: boolean }[];
  installmentGroups: InstallmentGroup[];
  cards: CardView[];
  // Totais calculados
  monthBalance: number;      // Saldo Mês
  totalBalance: number;      // Total (H2 dinâmico)
  invoiceTotal: number;      // Total faturas
  invoiceExtras: number;     // Gastos cartão além das parcelas
  projections: { label: string; value: number }[]; // M+1 a M+6
}

export interface CardView {
  _id: string;
  name: string;
  dueDay: number;
  invoiceTotal: number;
  installmentsTotal: number; // soma parcelas
  extras: number;            // fatura - parcelas
  items: {
    description: string;
    remaining: number;
    monthlyValue: number;
  }[];
}
