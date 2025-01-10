'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { FaPlus, FaTrash } from 'react-icons/fa';


interface Installment {
    id: number;
    description: string;
    amount: string;
    type: 'normal' | 'parcelada';
    installments?: number;
}

export default function CreditCardInstallmentsPage() {
    const [installments, setInstallments] = useState<Installment[]>([]);
    const router = useRouter();

    const handleInstallmentChange = (id: number, field: string, value: string) => {
        setInstallments((prev) =>
            prev.map((installment) =>
                installment.id === id ? { ...installment, [field]: value } : installment
            )
        );
    };

    const addInstallment = () => {
        setInstallments((prev) => [
            ...prev,
            { id: Date.now(), description: '', amount: '', type: 'normal' },
        ]);
    };

    const removeInstallment = (id: number) => {
        setInstallments((prev) => prev.filter((installment) => installment.id !== id));
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        localStorage.setItem('installmentsData', JSON.stringify(installments));
        // Redirecionar para a próxima página ou realizar outra ação
    };

    return (
        <div className="flex flex-col items-center justify-center min-h-screen bg-gray-100 p-4">
            <h1 className="text-2xl font-bold mb-4">Fatura / Parcelas no Cartão</h1>
            <form onSubmit={handleSubmit} className="w-full max-w-md bg-white p-6 rounded-lg shadow-md">
                {installments.map((installment) => (
                    <div key={installment.id} className="mb-4 p-4 rounded-lg shadow-md bg-gray-50">
                        <div className="flex space-x-2 mb-2">
                            <div className="flex-1">
                                <label className="block text-sm font-medium text-gray-700">
                                    Descrição
                                </label>
                                <input
                                    type="text"
                                    value={installment.description}
                                    onChange={(e) => handleInstallmentChange(installment.id, 'description', e.target.value)}
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
                                    value={installment.amount}
                                    onChange={(e) => handleInstallmentChange(installment.id, 'amount', e.target.value)}
                                    className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                                    required
                                />
                            </div>
                        </div>
                        <div className="flex space-x-2 mb-2">
                            <div className="flex-1">
                                <label className="block text-sm font-medium text-gray-700">
                                    Tipo
                                </label>
                                <select
                                    value={installment.type}
                                    onChange={(e) => handleInstallmentChange(installment.id, 'type', e.target.value)}
                                    className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                                    required
                                >
                                    <option value="normal">Normal</option>
                                    <option value="parcelada">Parcelada</option>
                                </select>
                            </div>
                            {installment.type === 'parcelada' && (
                                <div className="flex-1">
                                    <label className="block text-sm font-medium text-gray-700">
                                        Parcelas
                                    </label>
                                    <input
                                        type="number"
                                        value={installment.installments || ''}
                                        onChange={(e) => handleInstallmentChange(installment.id, 'installments', e.target.value)}
                                        className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                                        required
                                    />
                                </div>
                            )}
                        </div>
                        <div className="flex items-end">
                            <button
                                type="button"
                                onClick={() => removeInstallment(installment.id)}
                                className="bg-red-500 hover:bg-red-700 text-white font-bold py-1 px-2 rounded flex items-center"
                            >
                                <FaTrash className="h-4 w-4" />
                            </button>
                        </div>
                    </div>
                ))}
                <button
                    type="button"
                    onClick={addInstallment}
                    className="w-full bg-green-500 hover:bg-green-700 text-white font-bold py-2 px-4 rounded mb-4"
                >
                    <FaPlus className="h-4 w-4 m-1" />
                    Adicionar Parcela
                </button>
                <button
                    type="submit"
                    className="w-full bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded"
                >
                    Salvar
                </button>
            </form>
            <button
                type="button"
                onClick={() => router.push('/finance/balances')}
                className="mt-3 bg-gray-500 hover:bg-gray-700 text-white py-2 px-4 rounded"
            >
                Voltar
            </button>
        </div>
    );
}