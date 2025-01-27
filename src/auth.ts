import NextAuth from "next-auth"
import { MongoDBAdapter } from "@auth/mongodb-adapter"
import Resend from "next-auth/providers/resend"
import client from "./lib/mongodb"
// import mongoose from 'mongoose';


export const { handlers, signIn, signOut, auth } = NextAuth({
    adapter: MongoDBAdapter(client),
    // adapter: MongoDBAdapter(mongoose.connection),
    providers: [Resend],
})