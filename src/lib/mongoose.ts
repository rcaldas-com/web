import mongoose from 'mongoose'

if (!process.env.MONGO_URI) {
  throw new Error('Invalid/Missing environment variable: "MONGO_URI"')
}

const connection: { isConnected?: number } = {}

export default async function dbConnect() {
  if(connection.isConnected) {
    return true
  }
  try {
    await mongoose.connect(process.env.MONGO_URI as string)
    connection.isConnected = mongoose.connection.readyState
    return true
  } catch (error) {
    console.error('MongoDB connection error', error);
    return false
  }
}
