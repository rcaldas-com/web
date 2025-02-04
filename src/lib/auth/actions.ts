'use server';
import client from '../mongodb';
import { ObjectId } from 'mongodb';
import { signIn } from '@/auth';
import { AuthError } from 'next-auth';
import { z } from 'zod';

// import { db } from '@/drizzle/db';
// import { users } from '@/drizzle/schema';
// import {
//   FormState,
//   LoginFormSchema,
//   SignupFormSchema,
// } from './model';
// import { createSession, deleteSession } from '@/app/auth/02-stateless-session';
// import bcrypt from 'bcrypt';
// import { eq } from 'drizzle-orm';

export type State = {
  errors?: any;
  message?: string | null;
}

const LoginSchema = z.object({
  email: z.string().email({ message: 'Digite um email válido.' }),
  password: z
    .string()
    .min(6, { message: 'A senha precisa ter pelo menos 6 caracteres.' }),
})


export async function signup(
  state: FormState,
  formData: FormData,
): Promise<FormState> {
  // 1. Validate form fields
  const validatedFields = SignupFormSchema.safeParse({
    name: formData.get('name'),
    email: formData.get('email'),
    password: formData.get('password'),
  });

  // If any form fields are invalid, return early
  if (!validatedFields.success) {
    return {
      errors: validatedFields.error.flatten().fieldErrors,
    };
  }

  // 2. Prepare data for insertion into database
  const { name, email, password } = validatedFields.data;

  // 3. Check if the user's email already exists
  const existingUser = await db.query.users.findFirst({
    where: eq(users.email, email),
  });

  if (existingUser) {
    return {
      message: 'Email already exists, please use a different email or login.',
    };
  }

  // Hash the user's password
  const hashedPassword = await bcrypt.hash(password, 10);

  // 3. Insert the user into the database or call an Auth Provider's API
  const data = await db
    .insert(users)
    .values({
      name,
      email,
      password: hashedPassword,
    })
    .returning({ id: users.id });

  const user = data[0];

  if (!user) {
    return {
      message: 'An error occurred while creating your account.',
    };
  }

  // 4. Create a session for the user
  const userId = user.id.toString();
  await createSession(userId);
}

export async function login(state: FormState, formData: FormData) {
  // 1. Validate form fields
  const validatedFields = LoginSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  });
  // If any form fields are invalid, return early
  if (!validatedFields.success) {
    return {
        ...state,
        errors: validatedFields.error.flatten().fieldErrors,
        message: 'Valores incorretos.',
    };
  }
  // 2. Query the database for the user with the given email
  try {
    await signIn('credentials', validatedFields.data);
    return {
      ...state,
      message: 'Login realizado com sucesso.',
      errors: {
        email: undefined,
        password: undefined,
      },
    };
  } catch (error) {
    if (error instanceof AuthError) {
      switch (error.type) {
        case 'CredentialsSignin':
          return {
            ...state,
            errors: {
              email: [],
              password: [],
            },
            message: 'Credenciais inválidas.',
          };
        default:
          return {
            ...state,
            errors: {
              email: [],
              password: [],
            },
            message: 'Algo deu errado.',
          };
      }
    }
    throw error;
  }
}

