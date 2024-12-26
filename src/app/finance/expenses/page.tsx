'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { FaPlus, FaTrash } from 'react-icons/fa';

interface Expense {
    id: number;
    type: string;
    frequency: string;
    value: string;
}

export default function ExpensesPage() {
    const [expenses, setExpenses] = useState<Expense[]>([
        { id: Date.now(), type: 'comum', frequency: 'mensal', value: '' }
    ]);
    const router = useRouter();

    useEffect(() => {
        const financeData = localStorage.getItem('financeData');
        if (!financeData) {
            router.push('/finance');
        }
    }, [router]);

    const handleExpenseChange = (id: number, value: string) => {
        setExpenses((prev) =>
            prev.map((expense) => (expense.id === id ? { ...expense, value } : expense))
        );
    };

    const handleExpenseTypeChange = (id: number, type: string) => {
        setExpenses((prev) =>
            prev.map((expense) => (expense.id === id ? { ...expense, type } : expense))
        );
    };

    const handleExpenseFrequencyChange = (id: number, frequency: string) => {
        setExpenses((prev) =>
            prev.map((expense) => (expense.id === id ? { ...expense, frequency } : expense))
        );
    };

    const addExpense = () => {
        setExpenses((prev) => [
            ...prev,
            { id: Date.now(), type: 'comum', frequency: 'mensal', value: '' },
        ]);
    };

    const removeExpense = (id: number) => {
        setExpenses((prev) => prev.filter((expense) => expense.id !== id));
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        const expenseData = {
            expenses,
        };
        localStorage.setItem('expenseData', JSON.stringify(expenseData));
        // TODO: Redirect to the next step or save to backend
    };

    return (
        <div className="flex flex-col items-center justify-center min-h-screen bg-gray-100 p-4">
            <h1 className="text-2xl font-bold mb-4">Despesas</h1>
            <form onSubmit={handleSubmit} className="w-full max-w-md bg-white p-6 rounded-lg shadow-md">
                {expenses.map((expense, index) => (
                    <div key={expense.id} className="mb-4 flex items-center space-x-2">
                        <div className="flex-1">
                            <label className="block text-sm font-medium text-gray-700">
                                Tipo
                            </label>
                            <select
                                value={expense.type}
                                onChange={(e) => handleExpenseTypeChange(expense.id, e.target.value)}
                                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                            >
                                <option value="comum">Comum</option>
                                <option value="alimentação">Alimentação</option>
                                <option value="transporte">Transporte</option>
                            </select>
                        </div>
                        <div className="flex-1">
                            <label className="block text-sm font-medium text-gray-700">
                                Frequência
                            </label>
                            <select
                                value={expense.frequency}
                                onChange={(e) => handleExpenseFrequencyChange(expense.id, e.target.value)}
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
                                onChange={(e) => handleExpenseChange(expense.id, e.target.value)}
                                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                                placeholder="Valor"
                                required
                            />
                        </div>
                        {index === 0 ? (
                            <button
                                type="button"
                                onClick={addExpense}
                                className="mt-6 bg-green-500 hover:bg-green-700 text-white font-bold py-1 px-2 rounded flex items-center"
                            >
                                <FaPlus className="h-4 w-4 m-1" />
                                Nova Despesa
                            </button>
                        ) : (
                            <button
                                type="button"
                                onClick={() => removeExpense(expense.id)}
                                className="mt-6 bg-red-500 hover:bg-red-700 text-white font-bold py-1 px-2 rounded flex items-center"
                            >
                                <FaTrash className="h-4 w-4 m-1" />
                            </button>
                        )}
                    </div>
                ))}
                <button
                    type="submit"
                    className="w-full bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded"
                >
                    Avançar
                </button>
            </form>
        </div>
    );
}