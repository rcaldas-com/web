import { MongoClient } from 'mongodb';

if (!process.env.MONGO_URI) {
  throw new Error('Please add your Mongo URI to .env.local');
}

const uri = process.env.MONGO_URI;
const client = new MongoClient(uri);

async function seedExpenseTypes() {
  try {
    await client.connect();
    const db = client.db();
    const expenseTypesCollection = db.collection('ExpenseTypes');

    const expenseTypes = [
      { name: 'Comum' },
      { name: 'Alimentação' },
      { name: 'Transporte' },
      { name: 'Educação' },
      { name: 'Saúde' },
      { name: 'Lazer' },
      { name: 'Moradia' },
      { name: 'Vestuário' },
    ];

    for (const expenseType of expenseTypes) {
      await expenseTypesCollection.updateOne(
        { name: expenseType.name },
        { $setOnInsert: expenseType },
        { upsert: true }
      );
    }

    console.log('Expense types seeded successfully');
  } catch (error) {
    console.error('Failed to seed expense types:', error);
  } finally {
    await client.close();
  }
}

seedExpenseTypes();