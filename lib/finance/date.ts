export const FINANCE_TIME_ZONE = 'America/Sao_Paulo';

const todayFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: FINANCE_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export interface FinanceDateParts {
  year: number;
  month: number;
  day: number;
  yearMonth: string;
}

export function formatYearMonth(year: number, month: number) {
  return `${year}-${String(month).padStart(2, '0')}`;
}

export function getFinanceToday(date = new Date()): FinanceDateParts {
  const parts = todayFormatter.formatToParts(date);
  const year = Number(parts.find(part => part.type === 'year')?.value);
  const month = Number(parts.find(part => part.type === 'month')?.value);
  const day = Number(parts.find(part => part.type === 'day')?.value);
  return { year, month, day, yearMonth: formatYearMonth(year, month) };
}

export function daysInYearMonth(yearMonth: string) {
  const [year, month] = yearMonth.split('-').map(Number);
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function addMonthsToYearMonth(yearMonth: string, months: number) {
  const [year, month] = yearMonth.split('-').map(Number);
  const monthIndex = year * 12 + (month - 1) + months;
  const nextYear = Math.floor(monthIndex / 12);
  const nextMonth = (monthIndex % 12) + 1;
  return formatYearMonth(nextYear, nextMonth);
}

export function yearMonthIndex(yearMonth: string) {
  const [year, month] = yearMonth.split('-').map(Number);
  return year * 12 + (month - 1);
}

export function monthLabelPtBr(yearMonth: string) {
  const [year, month] = yearMonth.split('-').map(Number);
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'UTC',
    month: 'long',
    year: 'numeric',
  }).format(new Date(Date.UTC(year, month - 1, 1)));
}
