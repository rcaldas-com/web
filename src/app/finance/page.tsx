'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { FaPlus, FaTrash } from 'react-icons/fa';

export interface AdditionalIncome {
    id: number;
    type: string;
    value: string;
}
export interface Expense {
    id: number;
    name: string;
    type: string;
    frequency: string;
    value: string;
}
export interface FinanceData {
    monthlyIncome: string;
    additionalIncomes: AdditionalIncome[];
    expenses: Expense[];
}

export default function FinancePage() {
    const [financeData, setFinanceData] = useState<FinanceData>({
        monthlyIncome: '',
        additionalIncomes: [],
        expenses: [{ id: Date.now(), name: '', type: 'comum', frequency: 'mensal', value: '' }],
    });
    const router = useRouter();

    useEffect(() => {
        const storedFinanceData = localStorage.getItem('financeData');
        if (storedFinanceData) {
            const parsedData = JSON.parse(storedFinanceData);
            setFinanceData((prev) => ({
                ...prev,
                ...parsedData,
                expenses: parsedData.expenses.length > 0 ? parsedData.expenses : prev.expenses,
            }));
        }
    }, []);

    const handleIncomeChange = (field: string, value: string) => {
        setFinanceData((prev) => ({
            ...prev,
            [field]: value,
        }));
    };

    const handleAdditionalIncomeChange = (id: number, field: string, value: string) => {
        setFinanceData((prev) => ({
            ...prev,
            additionalIncomes: prev.additionalIncomes.map((income) =>
                income.id === id ? { ...income, [field]: value } : income
            ),
        }));
    };

    const addAdditionalIncome = () => {
        setFinanceData((prev) => ({
            ...prev,
            additionalIncomes: [
                ...prev.additionalIncomes,
                { id: Date.now(), type: 'renda mensal', value: '' },
            ],
        }));
    };

    const removeAdditionalIncome = (id: number) => {
        setFinanceData((prev) => ({
            ...prev,
            additionalIncomes: prev.additionalIncomes.filter((income) => income.id !== id),
        }));
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        localStorage.setItem('financeData', JSON.stringify(financeData));
        router.push('/finance/expenses');
    };

    return (
        <div className="flex flex-col items-center justify-center min-h-screen bg-gray-100 p-4">
            <h1 className="text-2xl font-bold mb-4">Controle Financeiro</h1>
            <form onSubmit={handleSubmit} className="w-full max-w-md bg-white p-6 rounded-lg shadow-md">
                <div className="mb-4 flex items-center space-x-2">
                    <div className="flex-1">
                        <label htmlFor="monthlyIncome" className="block text-sm font-medium text-gray-700">
                            Receita Mensal
                        </label>
                        <input
                            type="number"
                            id="monthlyIncome"
                            value={financeData.monthlyIncome}
                            onChange={(e) => handleIncomeChange('monthlyIncome', e.target.value)}
                            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                            required
                        />
                    </div>
                    <button
                        type="button"
                        onClick={addAdditionalIncome}
                        className="bg-green-500 hover:bg-green-700 text-white font-bold py-1 px-2 rounded flex items-center"
                    >
                        <FaPlus className="h-4 w-4 m-1" />
                        Nova Renda
                    </button>
                </div>
                {financeData.additionalIncomes.map((income) => (
                    <div key={income.id} className="mb-4 flex items-center space-x-2">
                        <div className="flex-1">
                            <label className="block text-sm font-medium text-gray-700">
                                Tipo de Receita Adicional
                            </label>
                            <select
                                value={income.type}
                                onChange={(e) => handleAdditionalIncomeChange(income.id, 'type', e.target.value)}
                                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                            >
                                <option value="renda mensal">Renda Mensal</option>
                                <option value="alimentação">Alimentação</option>
                                <option value="transporte">Transporte</option>
                            </select>
                        </div>
                        <div className="flex-1">
                            <label className="block text-sm font-medium text-gray-700">
                                Valor
                            </label>
                            <input
                                type="number"
                                value={income.value}
                                onChange={(e) => handleAdditionalIncomeChange(income.id, 'value', e.target.value)}
                                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                                placeholder="Valor"
                                required
                            />
                        </div>
                        <button
                            type="button"
                            onClick={() => removeAdditionalIncome(income.id)}
                            className="mt-6 bg-red-500 hover:bg-red-700 text-white font-bold py-1 px-2 rounded flex items-center"
                        >
                            <FaTrash className="h-4 w-4 m-1" />
                        </button>
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