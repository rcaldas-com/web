'use client';

import { useState } from 'react';
import {
  type HabitarInput,
  type HabitarResult,
  type EquilibriumResult,
  calculateHabitar,
  calculateEquilibrium,
  formatBRL,
  formatMonths,
} from '@/lib/habitar/calc';

const defaultInput: HabitarInput = {
  propertyValue: 750000,
  downPayment: 150000,
  annualInterestRate: 11.49,
  loanTermMonths: 420,
  amortizationSystem: 'SAC',
  itbiRate: 0,
  registryFees: 5000,
  brokerageBuyRate: 0,
  iptuMonthly: 0,
  condoMonthly: 0,
  maintenanceRate: 0,
  homeInsuranceMonthly: 0,
  rentValue: 7000,
  annualRentIncrease: 5,
  investmentReturnRate: 10,
  monthlyExtraAmortization: 3000,
  annualExtraAmortization: 0,
  annualPropertyAppreciation: 4.14,
  annualMonetaryCorrection: 4.14,
  analysisMonths: 360,
  includeDownPaymentInInvestment: false,
};

function InputField({
  label,
  name,
  value,
  onChange,
  type = 'number',
  step = 'any',
  prefix,
  suffix,
  hint,
}: {
  label: string;
  name: string;
  value: number | string;
  onChange: (name: string, value: number) => void;
  type?: string;
  step?: string;
  prefix?: string;
  suffix?: string;
  hint?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={name} className="text-sm font-medium text-gray-700">
        {label}
      </label>
      <div className="flex items-center gap-1">
        {prefix && <span className="text-sm text-gray-500">{prefix}</span>}
        <input
          id={name}
          name={name}
          type={type}
          step={step}
          value={value}
          onChange={(e) => onChange(name, parseFloat(e.target.value) || 0)}
          className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        {suffix && <span className="text-sm text-gray-500 whitespace-nowrap">{suffix}</span>}
      </div>
      {hint && <span className="text-xs text-gray-400">{hint}</span>}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border border-gray-200 rounded-lg p-4 space-y-3">
      <h3 className="font-semibold text-gray-800 text-sm uppercase tracking-wide">{title}</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {children}
      </div>
    </div>
  );
}

function ResultCard({
  title,
  value,
  sub,
  color = 'gray',
}: {
  title: string;
  value: string;
  sub?: string;
  color?: 'green' | 'red' | 'blue' | 'gray' | 'yellow';
}) {
  const colors = {
    green: 'bg-green-50 border-green-200 text-green-800',
    red: 'bg-red-50 border-red-200 text-red-800',
    blue: 'bg-blue-50 border-blue-200 text-blue-800',
    gray: 'bg-gray-50 border-gray-200 text-gray-800',
    yellow: 'bg-yellow-50 border-yellow-200 text-yellow-800',
  };
  return (
    <div className={`rounded-lg border p-4 ${colors[color]}`}>
      <div className="text-xs uppercase tracking-wide opacity-75">{title}</div>
      <div className="text-lg font-bold mt-1">{value}</div>
      {sub && <div className="text-xs mt-1 opacity-60">{sub}</div>}
    </div>
  );
}

export default function HabitarPage() {
  const [input, setInput] = useState<HabitarInput>(defaultInput);
  const [result, setResult] = useState<HabitarResult | null>(null);
  const [equilibrium, setEquilibrium] = useState<EquilibriumResult | null>(null);
  const [showSchedule, setShowSchedule] = useState(false);
  const [tab, setTab] = useState<'comparativo' | 'equilibrio'>('comparativo');

  const handleChange = (name: string, value: number) => {
    setInput((prev) => ({ ...prev, [name]: value }));
  };

  const handleSelectChange = (name: string, value: string) => {
    setInput((prev) => ({ ...prev, [name]: value }));
  };

  const handleCalculate = () => {
    const r = calculateHabitar(input);
    setResult(r);
    const eq = calculateEquilibrium(input);
    setEquilibrium(eq);
  };

  const financedAmount = input.propertyValue - input.downPayment;

  return (
    <main className="max-w-6xl mx-auto p-4 md:p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Habitar</h1>
        <p className="text-gray-500 text-sm mt-1">
          Simulador: Alugar vs Comprar — Compare cenários com financiamento, amortização e investimentos
        </p>
      </div>

      {/* FORMULÁRIO */}
      <div className="space-y-4">
        <Section title="Imóvel e Financiamento">
          <InputField label="Valor do Imóvel" name="propertyValue" value={input.propertyValue} onChange={handleChange} prefix="R$" />
          <InputField label="Entrada" name="downPayment" value={input.downPayment} onChange={handleChange} prefix="R$" hint={`${((input.downPayment / input.propertyValue) * 100).toFixed(1)}% do valor`} />
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-gray-700">Valor Financiado</label>
            <div className="border border-gray-200 rounded px-3 py-2 text-sm bg-gray-50 font-semibold">
              {formatBRL(financedAmount)}
            </div>
          </div>
          <InputField label="Taxa de Juros Efetiva (ao ano)" name="annualInterestRate" value={input.annualInterestRate} onChange={handleChange} suffix="%" />
          <InputField label="Prazo do Financiamento" name="loanTermMonths" value={input.loanTermMonths} onChange={handleChange} suffix="meses" hint={formatMonths(input.loanTermMonths)} />
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-gray-700">Sistema de Amortização</label>
            <select
              value={input.amortizationSystem}
              onChange={(e) => handleSelectChange('amortizationSystem', e.target.value)}
              className="border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="SAC">SAC - Amortização Constante</option>
              <option value="PRICE">PRICE - Prestação Fixa</option>
            </select>
          </div>
          <InputField label="Correção Monetária (TR/IPCA ao ano)" name="annualMonetaryCorrection" value={input.annualMonetaryCorrection} onChange={handleChange} suffix="%" hint="Aplicada ao saldo devedor" />
        </Section>

        <Section title="Custos de Aquisição">
          <InputField label="ITBI" name="itbiRate" value={input.itbiRate} onChange={handleChange} suffix="%" hint={`≈ ${formatBRL(input.propertyValue * input.itbiRate / 100)}`} />
          <InputField label="Registro / Cartório" name="registryFees" value={input.registryFees} onChange={handleChange} prefix="R$" />
        </Section>

        <Section title="Custos Mensais do Proprietário">
          <InputField label="IPTU mensal" name="iptuMonthly" value={input.iptuMonthly} onChange={handleChange} prefix="R$" />
          <InputField label="Condomínio mensal" name="condoMonthly" value={input.condoMonthly} onChange={handleChange} prefix="R$" />
          <InputField label="Manutenção (% ao ano)" name="maintenanceRate" value={input.maintenanceRate} onChange={handleChange} suffix="%" hint={`≈ ${formatBRL(input.propertyValue * input.maintenanceRate / 100 / 12)}/mês`} />
          <InputField label="Seguro adicional mensal" name="homeInsuranceMonthly" value={input.homeInsuranceMonthly} onChange={handleChange} prefix="R$" />
        </Section>

        <Section title="Cenário de Aluguel">
          <InputField label="Aluguel mensal" name="rentValue" value={input.rentValue} onChange={handleChange} prefix="R$" />
          <InputField label="Reajuste anual do aluguel" name="annualRentIncrease" value={input.annualRentIncrease} onChange={handleChange} suffix="%" hint="IGPM, IPCA, etc." />
        </Section>

        <Section title="Investimentos (cenário aluguel)">
          <InputField label="Rendimento anual" name="investmentReturnRate" value={input.investmentReturnRate} onChange={handleChange} suffix="%" hint="CDI, Selic, etc." />
          <div className="flex flex-col gap-1">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={input.includeDownPaymentInInvestment}
                onChange={(e) => setInput((prev) => ({ ...prev, includeDownPaymentInInvestment: e.target.checked }))}
                className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm text-gray-700">Incluir entrada como capital inicial</span>
            </label>
            <span className="text-xs text-gray-400 ml-6">
              Marque se o valor da entrada estaria disponível para investir (não veio de FGTS).
              {input.includeDownPaymentInInvestment && (
                <> Capital inicial: {formatBRL(input.downPayment + input.propertyValue * input.itbiRate / 100 + input.registryFees)}</>
              )}
            </span>
          </div>
          <div className="flex flex-col gap-1 col-span-2">
            <span className="text-xs text-gray-400">
              Quem aluga investe a diferença entre o custo total de comprar e o aluguel.
              Ambos os cenários usam o mesmo orçamento mensal.
            </span>
          </div>
        </Section>

        <Section title="Amortização Extra">
          <InputField label="Amortização extra mensal" name="monthlyExtraAmortization" value={input.monthlyExtraAmortization} onChange={handleChange} prefix="R$" />
          <InputField label="Amortização extra anual" name="annualExtraAmortization" value={input.annualExtraAmortization} onChange={handleChange} prefix="R$" hint="13º, FGTS, etc." />
        </Section>

        <Section title="Valorização e Horizonte">
          <InputField label="Valorização do imóvel (% ao ano)" name="annualPropertyAppreciation" value={input.annualPropertyAppreciation} onChange={handleChange} suffix="%" />
          <InputField label="Horizonte de análise" name="analysisMonths" value={input.analysisMonths} onChange={handleChange} suffix="meses" hint={formatMonths(input.analysisMonths)} />
        </Section>
      </div>

      <button
        onClick={handleCalculate}
        className="w-full bg-blue-600 text-white py-3 px-6 rounded-lg font-semibold hover:bg-blue-700 transition-colors"
      >
        Calcular Comparação
      </button>

      {/* TABS */}
      {result && (
        <div className="flex gap-0 border-b border-gray-200">
          <button
            onClick={() => setTab('comparativo')}
            className={`px-6 py-3 text-sm font-semibold transition-colors ${
              tab === 'comparativo'
                ? 'border-b-2 border-blue-600 text-blue-600'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            Comparativo
          </button>
          <button
            onClick={() => setTab('equilibrio')}
            className={`px-6 py-3 text-sm font-semibold transition-colors ${
              tab === 'equilibrio'
                ? 'border-b-2 border-blue-600 text-blue-600'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            Equilíbrio
          </button>
        </div>
      )}

      {/* TAB: EQUILÍBRIO */}
      {result && equilibrium && tab === 'equilibrio' && (
        <div className="space-y-6 pt-4">
          <p className="text-sm text-gray-500">
            Pontos de equilíbrio calculados a partir dos seus parâmetros. Mostra os limites onde a decisão muda.
          </p>

          {/* Aluguel máximo */}
          <div className="border border-gray-200 rounded-xl p-6 space-y-2">
            <h3 className="font-bold text-gray-800">Aluguel de Equilíbrio</h3>
            <p className="text-sm text-gray-500">
              Com estas condições de financiamento, qual o aluguel máximo em que alugar empata com comprar?
            </p>
            {equilibrium.maxRent !== null ? (
              <div className="mt-3">
                <div className="text-3xl font-bold text-blue-700">{formatBRL(equilibrium.maxRent)}</div>
                <p className="text-sm text-gray-600 mt-1">
                  Se o aluguel for <strong>menor</strong> que {formatBRL(equilibrium.maxRent)}, alugar é mais vantajoso.
                  Se for <strong>maior</strong>, comprar vale mais a pena.
                </p>
                <p className="text-xs text-gray-400 mt-2">
                  Seu aluguel atual: {formatBRL(input.rentValue)} — {
                    input.rentValue < equilibrium.maxRent
                      ? 'alugar está vantajoso'
                      : input.rentValue > equilibrium.maxRent
                        ? 'comprar está vantajoso'
                        : 'praticamente no equilíbrio'
                  }
                </p>
              </div>
            ) : (
              <p className="text-sm text-yellow-700 mt-3">
                Não foi possível encontrar um ponto de equilíbrio no intervalo analisado.
              </p>
            )}
          </div>

          {/* Taxa de juros máxima */}
          <div className="border border-gray-200 rounded-xl p-6 space-y-2">
            <h3 className="font-bold text-gray-800">Taxa de Juros de Equilíbrio</h3>
            <p className="text-sm text-gray-500">
              Até qual taxa de juros comprar ainda é mais vantajoso que alugar?
            </p>
            {equilibrium.maxInterestRate !== null ? (
              <div className="mt-3">
                <div className="text-3xl font-bold text-green-700">{equilibrium.maxInterestRate.toFixed(2)}% a.a.</div>
                <p className="text-sm text-gray-600 mt-1">
                  Comprar vale a pena se a taxa for <strong>até {equilibrium.maxInterestRate.toFixed(2)}%</strong> ao ano.
                  Acima disso, alugar se torna mais vantajoso.
                </p>
                <p className="text-xs text-gray-400 mt-2">
                  Sua taxa atual: {input.annualInterestRate}% a.a. — {
                    input.annualInterestRate < equilibrium.maxInterestRate
                      ? 'comprar está vantajoso'
                      : input.annualInterestRate > equilibrium.maxInterestRate
                        ? 'alugar está vantajoso'
                        : 'praticamente no equilíbrio'
                  }
                </p>
              </div>
            ) : (
              <p className="text-sm text-yellow-700 mt-3">
                Não foi possível encontrar um ponto de equilíbrio no intervalo analisado.
              </p>
            )}
          </div>

          {/* Entrada mínima */}
          <div className="border border-gray-200 rounded-xl p-6 space-y-2">
            <h3 className="font-bold text-gray-800">Entrada Mínima de Equilíbrio</h3>
            <p className="text-sm text-gray-500">
              Qual a entrada mínima necessária para que comprar seja mais vantajoso que alugar?
            </p>
            {equilibrium.minDownPayment !== null ? (
              <div className="mt-3">
                <div className="text-3xl font-bold text-green-700">{formatBRL(equilibrium.minDownPayment)}</div>
                <p className="text-sm text-gray-600 mt-1">
                  Com entrada <strong>acima de {formatBRL(equilibrium.minDownPayment)}</strong> ({((equilibrium.minDownPayment / input.propertyValue) * 100).toFixed(1)}% do imóvel), comprar é mais vantajoso.
                  Abaixo disso, alugar vale mais.
                </p>
                <p className="text-xs text-gray-400 mt-2">
                  Sua entrada atual: {formatBRL(input.downPayment)} ({((input.downPayment / input.propertyValue) * 100).toFixed(1)}%) — {
                    input.downPayment > equilibrium.minDownPayment
                      ? 'comprar está vantajoso'
                      : input.downPayment < equilibrium.minDownPayment
                        ? 'alugar está vantajoso'
                        : 'praticamente no equilíbrio'
                  }
                </p>
              </div>
            ) : (
              <p className="text-sm text-yellow-700 mt-3">
                Não foi possível encontrar um ponto de equilíbrio no intervalo analisado.
              </p>
            )}
          </div>
        </div>
      )}

      {/* TAB: COMPARATIVO */}
      {result && tab === 'comparativo' && (
        <div className="space-y-6 pt-4 border-t">
          {/* Veredicto */}
          <div className={`rounded-xl p-6 text-center ${
            result.verdict === 'BUY' ? 'bg-green-100 border-2 border-green-400' :
            result.verdict === 'RENT' ? 'bg-blue-100 border-2 border-blue-400' :
            'bg-yellow-100 border-2 border-yellow-400'
          }`}>
            <div className="text-sm uppercase tracking-widest opacity-75">
              {result.verdict === 'BUY' ? 'Comprar é mais vantajoso' :
               result.verdict === 'RENT' ? 'Alugar é mais vantajoso' :
               'Praticamente equivalentes'}
            </div>
            <div className="text-3xl font-bold mt-2">
              {result.verdict !== 'EQUIVALENT' && (
                <>Vantagem de {formatBRL(result.advantage)}</>
              )}
              {result.verdict === 'EQUIVALENT' && 'Diferença menor que R$ 1.000'}
            </div>
            <div className="text-sm mt-2 opacity-75">
              Em {formatMonths(input.analysisMonths)} de análise
              {result.breakEvenMonth && ` • Break-even no mês ${result.breakEvenMonth} (${formatMonths(result.breakEvenMonth)})`}
            </div>
            <div className="text-sm mt-1 opacity-75">
              Visão caixa (patrimônio - desembolso):
              {' '}
              {result.verdictCashFlow === 'BUY' ? 'Comprar melhor por ' : result.verdictCashFlow === 'RENT' ? 'Alugar melhor por ' : 'Praticamente equivalente ('}
              {formatBRL(result.advantageCashFlow)}
              {result.verdictCashFlow === 'EQUIVALENT' ? ')' : ''}
            </div>
          </div>

          {/* Comparação lado a lado */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* COMPRAR */}
            <div className="space-y-3">
              <h2 className="text-lg font-bold text-green-800 flex items-center gap-2">
                <span className="w-3 h-3 bg-green-500 rounded-full"></span>
                Cenário: Comprar
              </h2>
              <ResultCard
                title="Patrimônio Final"
                value={formatBRL(result.buy.netWorthAtEnd)}
                sub={`Imóvel valorizado: ${formatBRL(result.buy.propertyValueAtEnd)}`}
                color="green"
              />
              <ResultCard
                title="Total Pago em Prestações"
                value={formatBRL(result.buy.totalPaid)}
                sub={`Juros: ${formatBRL(result.buy.totalInterest)}`}
                color="red"
              />
              <ResultCard
                title="Custos de Aquisição"
                value={formatBRL(result.buy.acquisitionCosts)}
                sub={`Entrada + ITBI + cartório`}
                color="gray"
              />
              <ResultCard
                title="Custos de Propriedade"
                value={formatBRL(result.buy.totalOwnershipCosts)}
                sub={`IPTU + condo + manutenção (${formatMonths(input.analysisMonths)})`}
                color="gray"
              />
              <ResultCard
                title="Desembolso Total no Período"
                value={formatBRL(result.buy.totalCashOutflow)}
                sub="Tudo que saiu do bolso para chegar ao patrimônio final"
                color="red"
              />
              <ResultCard
                title="Saldo Líquido (Patrimônio - Desembolso)"
                value={formatBRL(result.buy.netAfterCashOutflow)}
                color={result.buy.netAfterCashOutflow >= 0 ? 'green' : 'yellow'}
              />
              <ResultCard
                title="Prazo para Quitar"
                value={formatMonths(result.buy.effectiveMonthsToPayOff)}
                sub={`${result.buy.effectiveMonthsToPayOff} parcelas (com amortizações extras)`}
                color="blue"
              />
            </div>

            {/* ALUGAR */}
            <div className="space-y-3">
              <h2 className="text-lg font-bold text-blue-800 flex items-center gap-2">
                <span className="w-3 h-3 bg-blue-500 rounded-full"></span>
                Cenário: Alugar + Investir
              </h2>
              <ResultCard
                title="Patrimônio Final (Investimentos)"
                value={formatBRL(result.rent.netWorthAtEnd)}
                sub={`Saldo acumulado investindo a diferença`}
                color="blue"
              />
              <ResultCard
                title="Total Pago em Aluguel"
                value={formatBRL(result.rent.totalRentPaid)}
                color="red"
              />
              <ResultCard
                title="Renda Passiva Mensal"
                value={formatBRL(result.rent.monthlyPassiveIncome)}
                sub="Rendimento mensal ao final do período"
                color="green"
              />
              <ResultCard
                title="Aluguel Coberto pela Renda Passiva?"
                value={result.rent.monthsUntilRentCovered
                  ? `Sim, a partir do mês ${result.rent.monthsUntilRentCovered}`
                  : 'Não alcançado no período'}
                sub={result.rent.monthsUntilRentCovered
                  ? formatMonths(result.rent.monthsUntilRentCovered)
                  : 'Rendimento ainda não cobre o aluguel'}
                color={result.rent.monthsUntilRentCovered ? 'green' : 'yellow'}
              />
              <ResultCard
                title="Capital Inicial Investido"
                value={formatBRL(input.includeDownPaymentInInvestment ? input.downPayment + input.propertyValue * input.itbiRate / 100 + input.registryFees : 0)}
                sub={input.includeDownPaymentInInvestment ? 'Entrada + ITBI + cartório investidos' : 'Começa do zero (entrada via FGTS)'}
                color="gray"
              />
              <ResultCard
                title="Aportes em Investimentos"
                value={formatBRL(result.rent.totalInvestedContributions)}
                sub="Soma dos aportes mensais ao longo do período"
                color="gray"
              />
              <ResultCard
                title="Desembolso Total no Período"
                value={formatBRL(result.rent.totalCashOutflow)}
                sub="Aluguel + aportes + capital inicial"
                color="red"
              />
              <ResultCard
                title="Saldo Líquido (Patrimônio - Desembolso)"
                value={formatBRL(result.rent.netAfterCashOutflow)}
                color={result.rent.netAfterCashOutflow >= 0 ? 'green' : 'yellow'}
              />
            </div>
          </div>

          {/* Tabela de amortização */}
          <div>
            <button
              onClick={() => setShowSchedule(!showSchedule)}
              className="text-sm text-blue-600 hover:text-blue-800 font-medium"
            >
              {showSchedule ? '▼ Ocultar' : '▶ Mostrar'} tabela de amortização ({result.buy.schedule.length} parcelas)
            </button>

            {showSchedule && (
              <div className="mt-3 overflow-x-auto">
                <table className="min-w-full text-xs border-collapse">
                  <thead>
                    <tr className="bg-gray-100">
                      <th className="border px-2 py-1 text-left">Mês</th>
                      <th className="border px-2 py-1 text-right">Prestação</th>
                      <th className="border px-2 py-1 text-right">Juros</th>
                      <th className="border px-2 py-1 text-right">Amortização</th>
                      <th className="border px-2 py-1 text-right">Saldo Devedor</th>
                      <th className="border px-2 py-1 text-right">Amort. Extra</th>
                      <th className="border px-2 py-1 text-right">Saldo após Extra</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.buy.schedule.map((row) => (
                      <tr key={row.month} className={row.month % 2 === 0 ? 'bg-gray-50' : ''}>
                        <td className="border px-2 py-1">{row.month}</td>
                        <td className="border px-2 py-1 text-right">{formatBRL(row.payment)}</td>
                        <td className="border px-2 py-1 text-right">{formatBRL(row.interest)}</td>
                        <td className="border px-2 py-1 text-right">{formatBRL(row.amortization)}</td>
                        <td className="border px-2 py-1 text-right">{formatBRL(row.balance)}</td>
                        <td className="border px-2 py-1 text-right">{row.extraAmortization > 0 ? formatBRL(row.extraAmortization) : '-'}</td>
                        <td className="border px-2 py-1 text-right font-medium">{formatBRL(row.balanceAfterExtra)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Tabela evolução aluguel */}
          <div>
            <button
              onClick={() => {
                const el = document.getElementById('rent-table');
                if (el) el.classList.toggle('hidden');
              }}
              className="text-sm text-blue-600 hover:text-blue-800 font-medium"
            >
              ▶ Mostrar/Ocultar evolução do cenário de aluguel
            </button>

            <div id="rent-table" className="hidden mt-3 overflow-x-auto">
              <table className="min-w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-gray-100">
                    <th className="border px-2 py-1 text-left">Mês</th>
                    <th className="border px-2 py-1 text-right">Aluguel</th>
                    <th className="border px-2 py-1 text-right">Investido no Mês</th>
                    <th className="border px-2 py-1 text-right">Saldo Investimentos</th>
                  </tr>
                </thead>
                <tbody>
                  {result.rent.rentSchedule.map((row) => (
                    <tr key={row.month} className={row.month % 2 === 0 ? 'bg-gray-50' : ''}>
                      <td className="border px-2 py-1">{row.month}</td>
                      <td className="border px-2 py-1 text-right">{formatBRL(row.rent)}</td>
                      <td className="border px-2 py-1 text-right">{formatBRL(row.invested)}</td>
                      <td className="border px-2 py-1 text-right font-medium">{formatBRL(row.balance)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
