'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { FinanceData } from '../incomes/page';


export default function FinancePage() {
    const [financeData, setFinanceData] = useState<FinanceData | null>(null);
    const router = useRouter();

    useEffect(() => {
        const storedFinanceData = localStorage.getItem('financeData');
        if (storedFinanceData) {
            setFinanceData(JSON.parse(storedFinanceData));
        } else {
            router.push('/finance/incomes');
        }
    }, [router]);

    if (!financeData) {
        return <div>Loading...</div>;
    }

    const getDaysInMonth = (year: number, month: number) => {
        return new Date(year, month, 0).getDate();
    };
    
    const calculateMonthlyExpenses = () => {
        const now = new Date();
        const daysInMonth = getDaysInMonth(now.getFullYear(), now.getMonth() + 1);
        return financeData.expenses.reduce((total, expense) => {
            const value = parseFloat(expense.value);
            if (expense.frequency === 'mensal') {
                return total + value;
            } else if (expense.frequency === 'semanal') {
                return total + (value * (daysInMonth / 7));
            } else if (expense.frequency === 'diária') {
                return total + (value * daysInMonth);
            }
            return total;
        }, 0);
    };

    const calculateInstallments = () => {
        const now = new Date();
        return financeData.installments.reduce((total, installment) => {
            if (installment.type === 'parcelada' && installment.installments) {
                const installmentDate = new Date(installment.id);
                const monthsDifference = (now.getFullYear() - installmentDate.getFullYear()) * 12 + (now.getMonth() - installmentDate.getMonth());
                if (monthsDifference < installment.installments) {
                    return total + parseFloat(installment.amount);
                }
            }
            return total;
        }, 0);
    };

    const monthlyIncome = parseFloat(financeData.monthlyIncome);
    const additionalIncomes = financeData.additionalIncomes.reduce((total, income) => total + parseFloat(income.value), 0);
    const monthlyExpenses = calculateMonthlyExpenses();
    const monthlyInstallments = calculateInstallments();
    const totalMonthlyIncome = monthlyIncome + additionalIncomes;
    const balance = totalMonthlyIncome - monthlyExpenses - monthlyInstallments;

    const allBalances = financeData.balances.reduce((total, balance) => total + parseFloat(balance.value), 0);

    // Soma de todas as parcelas futuras sem considerar as parcelas do mês atual
    const futureInstallments = financeData.installments.reduce((total, installment) => {
        if (installment.type === 'parcelada' && installment.installments) {
            const remainingInstallments = installment.installments - 1; // Subtract 1 for the current month
            return total + (parseFloat(installment.amount) * remainingInstallments);
        }
        return total;
    }, 0);
    // Saldo total considerando as despesas do mês atual e as parcelas futuras
    const totalBalance = allBalances - monthlyExpenses - monthlyInstallments - futureInstallments;

    const calculateFutureDebt = () => {
        let futureDebt = 0;
        let futureInstallments = financeData.installments.map(installment => ({
            ...installment,
            remainingInstallments: installment.installments || 0
        }));
        let futureMonthlyBalance = balance;
        let futureDebts = [];

        // Calculate future months
        while (futureMonthlyBalance < 0) {
            futureMonthlyBalance = totalMonthlyIncome - monthlyExpenses;
            futureInstallments = futureInstallments.map(installment => {
                if (installment.type === 'parcelada' && installment.remainingInstallments > 0) {
                    futureMonthlyBalance -= parseFloat(installment.amount);
                    installment.remainingInstallments--;
                }
                return installment;
            });
            if (futureMonthlyBalance < 0) {
                futureDebts.push(futureMonthlyBalance);
                futureDebt += futureMonthlyBalance;
            }
        }

        return { futureDebt, futureDebts };
    };

    const { futureDebt, futureDebts } = calculateFutureDebt();

    return (
        <div className="flex flex-col items-center justify-center min-h-screen bg-gray-100 p-4">
            <h1 className="text-2xl font-bold mb-4">Controle Financeiro</h1>
            <div className="w-full max-w-4xl bg-white p-6 rounded-lg shadow-md">
                <h2 className="text-xl font-bold mb-2">Visão do Mês Atual</h2>
                <div className="mb-4">
                    <p><strong>Receita Mensal: </strong>R$ {monthlyIncome.toFixed(2)}</p>
                    <p><strong>Receitas Adicionais: </strong>R$ {additionalIncomes.toFixed(2)}</p>
                    <p><strong>Despesas Mensais: </strong>R$ {monthlyExpenses.toFixed(2)}</p>
                    <p><strong>Parcelas Mensais: </strong>R$ {monthlyInstallments.toFixed(2)}</p>
                    <p className="text-xl"><strong>Saldo do Mês: </strong>R$ {balance.toFixed(2)}</p>
                </div>

                <h2 className="text-xl font-bold mb-2">Visão Geral</h2>
                <div className="mb-4">
                    <p><strong>Saldo em Conta: </strong>R$ {allBalances.toFixed(2)}</p>
                </div>
                <div className="mb-4">
                    <p><strong>Valor Devedor: </strong>R$ {futureInstallments.toFixed(2)}</p>
                </div>
                <div className="mb-4">
                    <p className="text-xl"><strong>Saldo Total: </strong>R$ {totalBalance.toFixed(2)}</p>
                </div>
                <hr></hr>

                <div className="mb-4">
                    <p className="text-xl"><strong>Saldo Futuro: </strong>R$ {futureDebt.toFixed(2)}</p>
                </div>
                <h2 className="text-xl font-bold mb-2">Dívida Futura</h2>
                <div className="mb-4">
                    {futureDebts.map((debt, index) => (
                        <p key={index}><strong>Mês {index + 1}: </strong>R$ {debt.toFixed(2)}</p>
                    ))}
                </div>

            </div>
        </div>
    );
}