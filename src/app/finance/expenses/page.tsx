'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { FaPlus, FaTrash } from 'react-icons/fa';
import { FinanceData } from '../page';


export default function ExpensesPage() {
    const [financeData, setFinanceData] = useState<FinanceData>({
        monthlyIncome: '',
        additionalIncomes: [],
        expenses: [{ id: Date.now(), name: '', type: 'comum', frequency: 'mensal', value: '' }],
    });
    const router = useRouter();

    useEffect(() => {
        const storedFinanceData = localStorage.getItem('financeData');
        if (!storedFinanceData) {
            router.push('/finance');
        } else {
            const parsedData = JSON.parse(storedFinanceData);
            setFinanceData((prev) => ({
                ...prev,
                ...parsedData,
                expenses: parsedData.expenses || [{ id: Date.now(), name: '', type: 'comum', frequency: 'mensal', value: '' }],
            }));
        }
    }, [router]);

    useEffect(() => {
        const timeoutId = setTimeout(() => {
            localStorage.setItem('financeData', JSON.stringify(financeData));
        }, 2000);

        return () => clearTimeout(timeoutId);
    }, [financeData]);

    const handleExpenseChange = (id: number, field: string, value: string) => {
        setFinanceData((prev) => ({
            ...prev,
            expenses: prev.expenses.map((expense) =>
                expense.id === id ? { ...expense, [field]: value } : expense
            ),
        }));
    };

    const addExpense = () => {
        setFinanceData((prev) => ({
            ...prev,
            expenses: [
                ...prev.expenses,
                { id: Date.now(), name: '', type: 'comum', frequency: 'mensal', value: '' },
            ],
        }));
    };

    const removeExpense = (id: number) => {
        setFinanceData((prev) => ({
            ...prev,
            expenses: prev.expenses.filter((expense) => expense.id !== id),
        }));
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        localStorage.setItem('financeData', JSON.stringify(financeData));
        router.push('/finance/balances');
    };

    return (
        <div className="flex flex-col items-center justify-center min-h-screen bg-gray-100 p-4">
            <h1 className="text-2xl font-bold mb-4">Despesas</h1>
            <form onSubmit={handleSubmit} className="w-full max-w-md bg-white p-6 rounded-lg shadow-md">
            {financeData.expenses.map((expense, index) => (
                    <div key={expense.id} className="mb-4 p-4 rounded-lg shadow-md bg-gray-50">
                        <div className="flex space-x-2 mb-2">
                            <div className="flex-1">
                                <label className="block text-sm font-medium text-gray-700">
                                    Nome
                                </label>
                                <input
                                    type="text"
                                    value={expense.name}
                                    onChange={(e) => handleExpenseChange(expense.id, 'name', e.target.value)}
                                    className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                                />
                            </div>
                            <div className="flex-1">
                                <label className="block text-sm font-medium text-gray-700">
                                    Tipo
                                </label>
                                <select
                                    value={expense.type}
                                    onChange={(e) => handleExpenseChange(expense.id, 'type', e.target.value)}
                                    className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                                >
                                    <option value="comum">Comum</option>
                                    <option value="alimentação">Alimentação</option>
                                    <option value="transporte">Transporte</option>
                                </select>
                            </div>
                        </div>
                        <div className="flex space-x-2">
                            <div className="flex-1">
                                <label className="block text-sm font-medium text-gray-700">
                                    Frequência
                                </label>
                                <select
                                    value={expense.frequency}
                                    onChange={(e) => handleExpenseChange(expense.id, 'frequency', e.target.value)}
                                    className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                                >
                                    <option value="mensal">Mensal</option>
                                    <option value="semanal">Semanal</option>
                                    <option value="diária">Diária</option>
                                </select>
                            </div>
                            <div className="flex-1">
                                <label className="block text-sm font-medium text-gray-700">
                                    Valor
                                </label>
                                <input
                                    type="number"
                                    value={expense.value}
                                    onChange={(e) => handleExpenseChange(expense.id, 'value', e.target.value)}
                                    className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                                    placeholder="Valor"
                                    required
                                />
                            </div>
                            <div className="flex items-end">
                                {index === 0 ? (
                                    <button
                                        type="button"
                                        onClick={addExpense}
                                        className="bg-green-500 hover:bg-green-700 text-white font-bold py-1 px-2 rounded flex items-center"
                                    >
                                        <FaPlus className="h-4 w-4" />
                                    </button>
                                ) : (
                                    <button
                                        type="button"
                                        onClick={() => removeExpense(expense.id)}
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
                    Avançar
                </button>
            </form>
 
            <div className="w-full max-w-md p-6  mt-4">

                {/* Lazy load */}
                <h2 className="text-lg font-bold mb-2">Receitas</h2>
                <p>- {financeData.monthlyIncome}</p>
                {financeData.additionalIncomes.map((income) => (
                    <p key={income.id}>- {income.value} ({income.type})</p>
                ))}

                <button
                    onClick={() => router.push('/finance')}
                    className="mt-3 bg-gray-500 hover:bg-gray-700 text-white py-2 px-4 rounded"
                >
                    Voltar
                </button>
            </div>

        </div>
    );
}