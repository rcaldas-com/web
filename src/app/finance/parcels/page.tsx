import { fetchExpenseTypes } from '@/lib/finance/data';
import Parcels from './parcels';

export default async function ParcelsPage() {
    const expenseTypes = await fetchExpenseTypes();

    return (
        <div className="flex flex-col items-center justify-center min-h-screen bg-gray-100 p-4">
            <Parcels expenseTypes={expenseTypes} />
        </div>
    );
}