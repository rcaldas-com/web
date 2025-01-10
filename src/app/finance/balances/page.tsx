'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { FaPlus, FaTrash } from 'react-icons/fa';
import { FinanceData } from '../page';


export default function BalancesPage() {
    const [financeData, setFinanceData] = useState<FinanceData>({
        monthlyIncome: '',
        additionalIncomes: [],
        expenses: [],
        balances: [{ id: Date.now(), name: 'Saldo em conta', value: '' }],
    });
    const router = useRouter();

    useEffect(() => {
        const storedFinanceData = localStorage.getItem('financeData');
        if (storedFinanceData) {
            const parsedData = JSON.parse(storedFinanceData);
            setFinanceData((prev) => ({
                ...prev,
                ...parsedData,
                balances: parsedData.balances || [{ id: Date.now(), name: 'Saldo em conta', value: '' }],
            }));
        }
    }, []);

    useEffect(() => {
        const timeoutId = setTimeout(() => {
            localStorage.setItem('financeData', JSON.stringify(financeData));
        }, 2000);

        return () => clearTimeout(timeoutId);
    }, [financeData]);

    const handleBalanceChange = (id: number, field: string, value: string) => {
        setFinanceData((prev) => ({
            ...prev,
            balances: prev.balances.map((balance) =>
                balance.id === id ? { ...balance, [field]: value } : balance
            ),
        }));
    };

    const addBalance = () => {
        setFinanceData((prev) => ({
            ...prev,
            balances: [
                ...prev.balances,
                { id: Date.now(), name: '', value: '' },
            ],
        }));
    };

    const removeBalance = (id: number) => {
        setFinanceData((prev) => ({
            ...prev,
            balances: prev.balances.filter((balance) => balance.id !== id),
        }));
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        localStorage.setItem('financeData', JSON.stringify(financeData));
        // Redirecionar para a próxima página ou realizar outra ação
    };

    const formatFrequency = (frequency: string) => {
        switch (frequency) {
            case 'diária':
                return '/dia';
            case 'semanal':
                return '/semana';
            case 'mensal':
                return '/mês';
            default:
                return '';
        }
    };

    return (
        <div className="flex flex-col items-center justify-center min-h-screen bg-gray-100 p-4">
            <h1 className="text-2xl font-bold mb-4">Saldos</h1>
            <form onSubmit={handleSubmit} className="w-full max-w-md bg-white p-6 rounded-lg shadow-md">
                {financeData.balances.map((balance, index) => (
                    <div key={balance.id} className="mb-4 p-4 rounded-lg shadow-md bg-gray-50">
                        <div className="flex space-x-2 mb-2">
                            <div className="flex-1">
                                <label className="block text-sm font-medium text-gray-700">
                                    Nome
                                </label>
                                <input
                                    type="text"
                                    value={balance.name}
                                    onChange={(e) => handleBalanceChange(balance.id, 'name', e.target.value)}
                                    className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                                    required
                                />
                            </div>
                            <div className="flex-1">
                                <label className="block text-sm font-medium text-gray-700">
                                    Valor
                                </label>
                                <input
                                    type="number"
                                    value={balance.value}
                                    onChange={(e) => handleBalanceChange(balance.id, 'value', e.target.value)}
                                    className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                                    placeholder="Valor"
                                    required
                                />
                            </div>
                            <div className="flex items-end">
                                {index === 0 ? (
                                    <button
                                        type="button"
                                        onClick={addBalance}
                                        className="bg-green-500 hover:bg-green-700 text-white font-bold py-1 px-2 rounded flex items-center"
                                    >
                                        <FaPlus className="h-4 w-4" />
                                    </button>
                                ) : (
                                    <button
                                        type="button"
                                        onClick={() => removeBalance(balance.id)}
                                        className="bg-red-500 hover:bg-red-700 text-white font-bold py-1 px-2 rounded flex items-center"
                                    >
                                        <FaTrash className="h-4 w-4" />
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                ))}
                <button
                    type="submit"
                    className="w-full bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded"
                >
                    Salvar
                </button>
            </form>


            <div className="w-full max-w-md p-6  mt-4">

                <h2 className="text-lg font-bold mb-2">Receitas</h2>
                {financeData.additionalIncomes.map((income) => (
                    <p key={income.id}>- {income.value} ({income.type})</p>
                ))}

                <h2 className="text-lg font-bold my-2">Despesas</h2>
                {financeData.expenses.map((expense) => (
                    <p key={expense.id}>
                        {expense.type === 'comum'
                            ? `- ${expense.name}: ${expense.value}${formatFrequency(expense.frequency)}`
                            : `- ${expense.name} (${expense.type}): ${expense.value}${formatFrequency(expense.frequency)}`}
                    </p>
                ))}

                <button
                    type="button"
                    onClick={() => router.push('/finance/expenses')}
                    className="mt-3 bg-gray-500 hover:bg-gray-700 text-white py-2 px-4 rounded"
                >
                    Voltar
                </button>
            </div>



        </div>
    );
}