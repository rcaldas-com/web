// Habitar - Motor de cálculo: Alugar vs Comprar

export type AmortizationSystem = 'SAC' | 'PRICE';

export interface HabitarInput {
  // Imóvel
  propertyValue: number;         // Valor do imóvel
  downPayment: number;           // Entrada (valor)
  annualInterestRate: number;    // Taxa de juros efetiva ao ano (%)
  loanTermMonths: number;        // Prazo do financiamento (meses)
  amortizationSystem: AmortizationSystem;

  // Custos de aquisição
  itbiRate: number;              // ITBI (%) sobre valor do imóvel
  registryFees: number;          // Custos de cartório / registro (R$)
  brokerageBuyRate: number;      // Corretagem compra (%) - geralmente já inclusa

  // Custos mensais do proprietário
  iptuMonthly: number;           // IPTU mensal
  condoMonthly: number;          // Condomínio mensal
  maintenanceRate: number;       // Manutenção (% ao ano sobre valor do imóvel)
  homeInsuranceMonthly: number;  // Seguro habitacional mensal (além do incluso no financiamento)

  // Aluguel
  rentValue: number;             // Valor do aluguel mensal
  annualRentIncrease: number;    // Reajuste anual do aluguel (%)

  // Investimentos
  investmentReturnRate: number;  // Rendimento anual dos investimentos (%)

  // Amortização extra
  monthlyExtraAmortization: number; // Amortização extra mensal
  annualExtraAmortization: number;  // Amortização extra anual (ex: 13o, FGTS)

  // Valorização
  annualPropertyAppreciation: number; // Valorização do imóvel (% ao ano)

  // Correção monetária do saldo devedor
  annualMonetaryCorrection: number;   // Correção monetária (% ao ano, ex: TR, IPCA)

  // Horizonte de análise
  analysisMonths: number;        // Período de análise em meses

  // Opção: incluir entrada como capital inicial do investimento
  includeDownPaymentInInvestment: boolean;
}

export interface MonthlyInstallment {
  month: number;
  payment: number;          // Prestação total (amortização + juros)
  interest: number;         // Juros do mês
  amortization: number;     // Amortização do mês
  balance: number;          // Saldo devedor após pagar
  extraAmortization: number;
  balanceAfterExtra: number;
  monetaryCorrection: number;
}

export interface BuyScenario {
  schedule: MonthlyInstallment[];
  totalPaid: number;
  totalInterest: number;
  totalAmortization: number;
  totalExtraAmortization: number;
  acquisitionCosts: number;
  totalOwnershipCosts: number;      // IPTU + condo + manutenção + seguro
  propertyValueAtEnd: number;
  equityAtEnd: number;              // Patrimônio líquido (valor imóvel - saldo devedor)
  totalCostOfOwnership: number;     // Tudo que gastou
  totalCashOutflow: number;         // Desembolso total no período
  netAfterCashOutflow: number;      // Patrimônio - desembolso
  effectiveMonthsToPayOff: number;  // Meses até quitar
  netWorthAtEnd: number;            // Patrimônio final
}

export interface RentScenario {
  totalRentPaid: number;
  initialInvestedCapital: number;
  totalInvestedContributions: number;
  totalCashOutflow: number;      // Aluguel + aportes + capital inicial
  netAfterCashOutflow: number;   // Patrimônio - desembolso
  investmentBalance: number;  // Saldo acumulado dos investimentos
  monthlyPassiveIncome: number; // Renda passiva mensal no fim do período
  monthsUntilRentCovered: number | null; // Meses até rendimento cobrir aluguel
  netWorthAtEnd: number;
  rentSchedule: { month: number; rent: number; invested: number; balance: number }[];
}

export interface HabitarResult {
  buy: BuyScenario;
  rent: RentScenario;
  verdict: 'BUY' | 'RENT' | 'EQUIVALENT';
  advantage: number;          // Diferença em R$ a favor do vencedor
  verdictCashFlow: 'BUY' | 'RENT' | 'EQUIVALENT';
  advantageCashFlow: number;  // Diferença em R$ na visão patrimônio - desembolso
  breakEvenMonth: number | null;
}

function annualToMonthlyRate(annualRate: number): number {
  return Math.pow(1 + annualRate / 100, 1 / 12) - 1;
}

export function calculateSACSchedule(
  financedAmount: number,
  monthlyRate: number,
  totalMonths: number,
  monthlyExtraAmort: number,
  annualExtraAmort: number,
  monthlyMonetaryCorrection: number,
): MonthlyInstallment[] {
  const schedule: MonthlyInstallment[] = [];
  let balance = financedAmount;
  const fixedAmortization = financedAmount / totalMonths;

  for (let month = 1; month <= totalMonths && balance > 0.01; month++) {
    // Correção monetária aplicada ao saldo antes do cálculo
    const correction = balance * monthlyMonetaryCorrection;
    balance += correction;

    const interest = balance * monthlyRate;
    const amortization = Math.min(fixedAmortization, balance);
    const payment = amortization + interest;
    balance -= amortization;

    // Amortização extra
    let extra = monthlyExtraAmort;
    if (month % 12 === 0) {
      extra += annualExtraAmort;
    }
    extra = Math.min(extra, balance);
    balance -= extra;

    schedule.push({
      month,
      payment,
      interest,
      amortization,
      balance: balance + extra, // saldo antes da extra
      extraAmortization: extra,
      balanceAfterExtra: Math.max(balance, 0),
      monetaryCorrection: correction,
    });

    if (balance <= 0.01) break;
  }

  return schedule;
}

export function calculatePRICESchedule(
  financedAmount: number,
  monthlyRate: number,
  totalMonths: number,
  monthlyExtraAmort: number,
  annualExtraAmort: number,
  monthlyMonetaryCorrection: number,
): MonthlyInstallment[] {
  const schedule: MonthlyInstallment[] = [];
  let balance = financedAmount;

  // Prestação fixa (Price)
  const fixedPayment =
    financedAmount * (monthlyRate * Math.pow(1 + monthlyRate, totalMonths)) /
    (Math.pow(1 + monthlyRate, totalMonths) - 1);

  for (let month = 1; month <= totalMonths && balance > 0.01; month++) {
    const correction = balance * monthlyMonetaryCorrection;
    balance += correction;

    const interest = balance * monthlyRate;
    const amortization = Math.min(fixedPayment - interest, balance);
    const payment = Math.min(fixedPayment, balance + interest);
    balance -= amortization;

    let extra = monthlyExtraAmort;
    if (month % 12 === 0) {
      extra += annualExtraAmort;
    }
    extra = Math.min(extra, balance);
    balance -= extra;

    schedule.push({
      month,
      payment,
      interest,
      amortization,
      balance: balance + extra,
      extraAmortization: extra,
      balanceAfterExtra: Math.max(balance, 0),
      monetaryCorrection: correction,
    });

    if (balance <= 0.01) break;
  }

  return schedule;
}

export function calculateBuyScenario(input: HabitarInput): BuyScenario {
  const financedAmount = input.propertyValue - input.downPayment;
  const monthlyRate = annualToMonthlyRate(input.annualInterestRate);
  const monthlyMonetaryCorrection = annualToMonthlyRate(input.annualMonetaryCorrection);

  const schedule = input.amortizationSystem === 'SAC'
    ? calculateSACSchedule(
        financedAmount, monthlyRate, input.loanTermMonths,
        input.monthlyExtraAmortization, input.annualExtraAmortization,
        monthlyMonetaryCorrection,
      )
    : calculatePRICESchedule(
        financedAmount, monthlyRate, input.loanTermMonths,
        input.monthlyExtraAmortization, input.annualExtraAmortization,
        monthlyMonetaryCorrection,
      );

  const totalPaid = schedule.reduce((sum, m) => sum + m.payment, 0);
  const totalInterest = schedule.reduce((sum, m) => sum + m.interest, 0);
  const totalAmortization = schedule.reduce((sum, m) => sum + m.amortization, 0);
  const totalExtraAmortization = schedule.reduce((sum, m) => sum + m.extraAmortization, 0);

  // Custos de aquisição
  const itbi = input.propertyValue * (input.itbiRate / 100);
  const acquisitionCosts = input.downPayment + itbi + input.registryFees;

  // Custos de propriedade durante o período de análise
  const monthsAnalysis = Math.min(input.analysisMonths, schedule.length);
  const monthlyMaintenance = input.propertyValue * (input.maintenanceRate / 100) / 12;
  const totalOwnershipCosts = monthsAnalysis * (
    input.iptuMonthly + input.condoMonthly + monthlyMaintenance + input.homeInsuranceMonthly
  );

  // Valor do imóvel no final
  const monthlyAppreciation = annualToMonthlyRate(input.annualPropertyAppreciation);
  const propertyValueAtEnd = input.propertyValue * Math.pow(1 + monthlyAppreciation, input.analysisMonths);

  // Saldo devedor no mês da análise
  const scheduleAtAnalysis = schedule.find(m => m.month === monthsAnalysis);
  const remainingBalance = scheduleAtAnalysis?.balanceAfterExtra ?? 0;

  const equityAtEnd = propertyValueAtEnd - remainingBalance;

  const effectiveMonthsToPayOff = schedule.length;

  // Custo total = entrada + aquisição + prestações pagas + custos de propriedade
  const paymentsInPeriod = schedule
    .filter(m => m.month <= monthsAnalysis)
    .reduce((sum, m) => sum + m.payment + m.extraAmortization, 0);

  const totalCostOfOwnership = acquisitionCosts + paymentsInPeriod + totalOwnershipCosts;

  // Patrimônio final = valor do imóvel - saldo devedor
  const netWorthAtEnd = equityAtEnd;
  const totalCashOutflow = totalCostOfOwnership;
  const netAfterCashOutflow = netWorthAtEnd - totalCashOutflow;

  return {
    schedule,
    totalPaid,
    totalInterest,
    totalAmortization,
    totalExtraAmortization,
    acquisitionCosts,
    totalOwnershipCosts,
    propertyValueAtEnd,
    equityAtEnd,
    totalCostOfOwnership,
    totalCashOutflow,
    netAfterCashOutflow,
    effectiveMonthsToPayOff,
    netWorthAtEnd,
  };
}

export function calculateRentScenario(input: HabitarInput, buyMonthlyPayments: number[]): RentScenario {
  const monthlyInvestRate = annualToMonthlyRate(input.investmentReturnRate);

  // Capital inicial: se a entrada não vier de FGTS, pode ser investida
  const itbi = input.propertyValue * (input.itbiRate / 100);
  const initialInvestedCapital = input.includeDownPaymentInInvestment
    ? input.downPayment + itbi + input.registryFees
    : 0;
  let investmentBalance = initialInvestedCapital;

  let rent = input.rentValue;
  let totalRentPaid = 0;
  let totalInvestedContributions = 0;
  let monthsUntilRentCovered: number | null = null;
  const rentSchedule: RentScenario['rentSchedule'] = [];

  const monthlyMaintenance = input.propertyValue * (input.maintenanceRate / 100) / 12;

  for (let month = 1; month <= input.analysisMonths; month++) {
    // Reajuste anual do aluguel
    if (month > 1 && (month - 1) % 12 === 0) {
      rent = rent * (1 + input.annualRentIncrease / 100);
    }

    totalRentPaid += rent;

    // O que o comprador gasta neste mês (prestação + amort extra + IPTU + condo + manutenção + seguro)
    const buyPayment = (buyMonthlyPayments[month - 1] ?? 0)
      + input.iptuMonthly
      + input.condoMonthly
      + monthlyMaintenance
      + input.homeInsuranceMonthly;

    // Orçamento igual: quem aluga investe a diferença entre o custo de comprar e o aluguel
    const savings = buyPayment - rent;
    const invested = Math.max(savings, 0);
    totalInvestedContributions += invested;

    // Rendimento do mês
    investmentBalance = investmentBalance * (1 + monthlyInvestRate) + invested;

    // Verifica se rendimento mensal cobre o aluguel
    const monthlyPassiveIncome = investmentBalance * monthlyInvestRate;
    if (monthsUntilRentCovered === null && monthlyPassiveIncome >= rent) {
      monthsUntilRentCovered = month;
    }

    rentSchedule.push({ month, rent, invested, balance: investmentBalance });
  }

  const monthlyPassiveIncome = investmentBalance * monthlyInvestRate;
  const totalCashOutflow = totalRentPaid + totalInvestedContributions + initialInvestedCapital;
  const netAfterCashOutflow = investmentBalance - totalCashOutflow;

  return {
    totalRentPaid,
    initialInvestedCapital,
    totalInvestedContributions,
    totalCashOutflow,
    netAfterCashOutflow,
    investmentBalance,
    monthlyPassiveIncome,
    monthsUntilRentCovered,
    netWorthAtEnd: investmentBalance,
    rentSchedule,
  };
}

export function calculateHabitar(input: HabitarInput): HabitarResult {
  const buy = calculateBuyScenario(input);

  // Monta array de pagamentos mensais do comprador para comparar
  const buyMonthlyPayments = Array.from({ length: input.analysisMonths }, (_, i) => {
    const monthData = buy.schedule.find(m => m.month === i + 1);
    return (monthData?.payment ?? 0) + (monthData?.extraAmortization ?? 0);
  });

  const rent = calculateRentScenario(input, buyMonthlyPayments);

  const diff = buy.netWorthAtEnd - rent.netWorthAtEnd;
  let verdict: 'BUY' | 'RENT' | 'EQUIVALENT';
  if (Math.abs(diff) < 1000) {
    verdict = 'EQUIVALENT';
  } else if (diff > 0) {
    verdict = 'BUY';
  } else {
    verdict = 'RENT';
  }

  const diffCashFlow = buy.netAfterCashOutflow - rent.netAfterCashOutflow;
  let verdictCashFlow: 'BUY' | 'RENT' | 'EQUIVALENT';
  if (Math.abs(diffCashFlow) < 1000) {
    verdictCashFlow = 'EQUIVALENT';
  } else if (diffCashFlow > 0) {
    verdictCashFlow = 'BUY';
  } else {
    verdictCashFlow = 'RENT';
  }

  // Break-even: mês em que patrimônio de comprar supera alugar
  let breakEvenMonth: number | null = null;
  const monthlyAppreciation = annualToMonthlyRate(input.annualPropertyAppreciation);

  for (let m = 1; m <= input.analysisMonths; m++) {
    const scheduleItem = buy.schedule.find(s => s.month === m);
    const balance = scheduleItem?.balanceAfterExtra ?? 0;
    const propValue = input.propertyValue * Math.pow(1 + monthlyAppreciation, m);
    const buyWealth = propValue - balance;

    const rentItem = rent.rentSchedule.find(r => r.month === m);
    const rentWealth = rentItem?.balance ?? 0;

    if (buyWealth > rentWealth && breakEvenMonth === null) {
      breakEvenMonth = m;
    }
  }

  return {
    buy,
    rent,
    verdict,
    advantage: Math.abs(diff),
    verdictCashFlow,
    advantageCashFlow: Math.abs(diffCashFlow),
    breakEvenMonth,
  };
}

// --- Solvers de equilíbrio (bisection) ---

export interface EquilibriumResult {
  maxRent: number | null;           // Aluguel máximo onde alugar empata com comprar
  maxInterestRate: number | null;   // Taxa máxima onde comprar ainda vale a pena
  minDownPayment: number | null;    // Entrada mínima onde comprar ainda vale a pena
}

function getAdvantage(input: HabitarInput): number {
  const r = calculateHabitar(input);
  // Positivo = comprar melhor, negativo = alugar melhor
  return r.buy.netWorthAtEnd - r.rent.netWorthAtEnd;
}

function bisect(
  fn: (x: number) => number,
  lo: number,
  hi: number,
  tolerance: number = 100,
  maxIter: number = 60,
): number | null {
  let fLo = fn(lo);
  let fHi = fn(hi);
  // Precisamos que o sinal mude no intervalo
  if (fLo * fHi > 0) return null;
  for (let i = 0; i < maxIter; i++) {
    const mid = (lo + hi) / 2;
    const fMid = fn(mid);
    if (Math.abs(fMid) < tolerance || (hi - lo) < 1) return mid;
    if (fLo * fMid < 0) {
      hi = mid;
      fHi = fMid;
    } else {
      lo = mid;
      fLo = fMid;
    }
  }
  return (lo + hi) / 2;
}

export function calculateEquilibrium(input: HabitarInput): EquilibriumResult {
  // 1. Aluguel máximo: varia rentValue até advantage = 0
  // Aluguel alto → locatário investe pouco → comprar vence (advantage > 0)
  // Aluguel baixo → locatário investe mais → alugar vence (advantage < 0)
  const maxRent = bisect(
    (rent) => getAdvantage({ ...input, rentValue: rent }),
    0,
    input.propertyValue * 0.02, // limite: 2% do valor do imóvel como teto
    100,
  );

  // 2. Taxa máxima: varia annualInterestRate até advantage = 0
  // Taxa alta → comprar fica caro → advantage cai
  // Taxa baixa → comprar fica barato → advantage sobe
  const maxInterestRate = bisect(
    (rate) => getAdvantage({ ...input, annualInterestRate: rate }),
    0.5,
    30,
    100,
  );

  // 3. Entrada mínima: varia downPayment até advantage = 0
  // Entrada alta → menos financiamento → comprar melhor (advantage sobe)
  // Entrada baixa → mais financiamento → comprar pior (advantage desce)
  const minDownPayment = bisect(
    (dp) => getAdvantage({ ...input, downPayment: dp }),
    0,
    input.propertyValue * 0.9,
    100,
  );

  return { maxRent, maxInterestRate, minDownPayment };
}

// Helpers de formatação
export function formatBRL(value: number): string {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function formatMonths(months: number): string {
  const years = Math.floor(months / 12);
  const remainingMonths = months % 12;
  if (years === 0) return `${remainingMonths} meses`;
  if (remainingMonths === 0) return `${years} anos`;
  return `${years} anos e ${remainingMonths} meses`;
}
