import NextAuth from "next-auth"
import { authConfig } from './middleware';
import Credentials from 'next-auth/providers/credentials';
import client from "./lib/mongodb"
import type { User } from './lib/auth/definitions';
import bcrypt from 'bcrypt';

async function getUser(email: string | unknown): Promise<User | null> {
    try {
      const client = await client;
      const db = client.db();
      const user = await db
        .collection('user')
        .findOne<User>({ email }, { projection: { _id: 0, password: 1 } });
      return user;
    } catch (error) {
      console.error('Failed to fetch user:', error);
      throw new Error('Failed to fetch user.');
    }
  }

export const { handlers, signIn, signOut, auth } = NextAuth({
    ...authConfig,
    providers: [
      Credentials({
        async authorize(credentials) {
          const { email, password } = credentials;
          if (typeof password !== 'string') {
            return null;
          }
          const user = await getUser(email);
          if (!user) return null;
          const passwordsMatch = await bcrypt.compare(password, user.password);
          if (passwordsMatch) return user;
          return null;
        },
      }),
    ],  
})