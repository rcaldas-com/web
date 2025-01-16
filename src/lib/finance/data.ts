import clientPromise from '../mongodb';

export async function fetchExpenseTypes() {
    try {
        const client = await clientPromise;
        const db = client.db();
        const expenseTypes = await db.collection('ExpenseTypes')
            .find({}).project({ name: 1 }).toArray();
        // Convert ObjectId to string
        return expenseTypes.map(expenseType => ({
            ...expenseType,
            _id: expenseType._id.toString(),
        }));
    } catch (error) {
        console.error('Failed to fetch expense types:', error);
        throw new Error('Failed to fetch expense types');
    }
}