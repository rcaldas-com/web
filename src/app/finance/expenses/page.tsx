import { fetchExpenseTypes } from '../../../lib/finance/data';
import Expenses from './expenses';

export default async function ExpensesPage() {
    const expenseTypes = await fetchExpenseTypes();

    return (
        <div className="flex flex-col items-center justify-center min-h-screen bg-gray-100 p-4">
            <Expenses expenseTypes={expenseTypes} />
        </div>
    );
}