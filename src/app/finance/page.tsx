'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { FaPlus, FaTrash } from 'react-icons/fa';

interface AdditionalIncome {
    id: number;
    type: string;
    value: string;
}

export default function FinancePage() {
    const [monthlyIncome, setMonthlyIncome] = useState('');
    const [additionalIncomes, setAdditionalIncomes] = useState<AdditionalIncome[]>([]);
    const router = useRouter();

    const handleMonthlyIncomeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setMonthlyIncome(e.target.value);
    };

    const handleAdditionalIncomeChange = (id: number, value: string) => {
        setAdditionalIncomes((prev) =>
            prev.map((income) => (income.id === id ? { ...income, value } : income))
        );
    };

    const handleAdditionalIncomeTypeChange = (id: number, type: string) => {
        setAdditionalIncomes((prev) =>
            prev.map((income) => (income.id === id ? { ...income, type } : income))
        );
    };

    const addAdditionalIncome = () => {
        setAdditionalIncomes((prev) => [
            ...prev,
            { id: Date.now(), type: 'renda mensal', value: '' },
        ]);
    };

    const removeAdditionalIncome = (id: number) => {
        setAdditionalIncomes((prev) => prev.filter((income) => income.id !== id));
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        // TODO: Save the income data to local storage or backend
        router.push('/finance/next-step');
    };

    return (
        <div className="flex flex-col items-center justify-center min-h-screen bg-gray-100 p-4">
            <h1 className="text-2xl font-bold mb-4">Controle Financeiro</h1>
            <form onSubmit={handleSubmit} className="w-full max-w-md bg-white p-6 rounded-lg shadow-md">
                <div className="mb-4 flex items-center space-x-2">
                    <div className="flex-1">
                        <label htmlFor="monthlyIncome" className="block text-sm font-medium text-gray-700">
                            Receita Líquida Mensal
                        </label>
                        <input
                            type="number"
                            id="monthlyIncome"
                            value={monthlyIncome}
                            onChange={handleMonthlyIncomeChange}
                            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                            required
                        />
                    </div>
                    <button
                        type="button"
                        onClick={addAdditionalIncome}
                        className="bg-green-500 hover:bg-green-700 text-white font-bold p-2 rounded-full"
                    >
                        <FaPlus className="h-5 w-5" />
                    </button>
                </div>
                {additionalIncomes.map((income) => (
                    <div key={income.id} className="mb-4 flex items-center space-x-2">
                        <div className="flex-1">
                            <label className="block text-sm font-medium text-gray-700">
                                Tipo de Receita Adicional
                            </label>
                            <select
                                value={income.type}
                                onChange={(e) => handleAdditionalIncomeTypeChange(income.id, e.target.value)}
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
                                onChange={(e) => handleAdditionalIncomeChange(income.id, e.target.value)}
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