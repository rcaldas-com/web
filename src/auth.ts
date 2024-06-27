import NextAuth from "next-auth"
import { MongoDBAdapter } from "@auth/mongodb-adapter"
import mongoose from 'mongoose';

 
export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: MongoDBAdapter(mongoose.connection),
})