'use server';

import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { z } from 'zod';
import clientPromise from '@/lib/mongodb';
import { sendPasswordResetEmail } from '@/lib/email';
import { rateLimit } from '@/lib/rate-limit';
import { headers } from 'next/headers';

type State = {
  message: string;
  errors: Record<string, string[] | undefined>;
  success?: boolean;
};

const ForgotPasswordSchema = z.object({
  email: z.string().email({ message: 'Digite um email válido.' }),
});

export async function requestPasswordReset(prevState: State, formData: FormData) {
  const headersList = await headers();
  const ip = headersList.get('x-real-ip') || headersList.get('x-forwarded-for') || 'unknown';
  const limited = await rateLimit(`forgot-password:${ip}`, 3, 3600);
  if (!limited.ok) {
    return { ...prevState, errors: {}, message: `Muitas tentativas. Tente novamente em ${limited.retryAfter}s.`, success: false };
  }

  const parsed = ForgotPasswordSchema.safeParse({
    email: formData.get('email'),
  });

  if (!parsed.success) {
    return {
      ...prevState,
      errors: parsed.error.flatten().fieldErrors,
      message: 'Dados inválidos.',
      success: false,
    };
  }

  try {
    const client = await clientPromise;
    const db = client.db();
    const user = await db.collection('user').findOne({ email: parsed.data.email });

    if (!user) {
      return {
        ...prevState,
        errors: {},
        message: 'Se o e-mail existir, um link de redefinição foi enviado.',
        success: true,
      };
    }

    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 20 * 60 * 1000);

    await db.collection('rcaldas_token').insertOne({
      email: parsed.data.email,
      token,
      feature: 'reset-password',
      expiresAt,
      createdAt: new Date(),
      used: false,
    });

    await sendPasswordResetEmail(parsed.data.email, token, user.name || '');

    return {
      ...prevState,
      message: 'Se o e-mail existir, um link de redefinição foi enviado.',
      errors: {},
      success: true,
    };
  } catch (error) {
    console.log('Erro ao solicitar reset de senha:', error);
    return {
      ...prevState,
      message: 'Erro ao solicitar redefinição de senha.',
      errors: {},
      success: false,
    };
  }
}

export async function verifyPasswordReset(token: string): Promise<string | null> {
  try {
    const client = await clientPromise;
    const db = client.db();
    const tokenDoc = await db.collection('rcaldas_token').findOne({
      token,
      feature: 'reset-password',
      used: false,
      expiresAt: { $gt: new Date() },
    });

    if (!tokenDoc) {
      return null;
    }

    return tokenDoc.email as string;
  } catch (error) {
    console.error('Erro ao validar token de reset:', error);
    return null;
  }
}

export async function resetPassword(token: string, prevState: State & { success?: boolean }, formData: FormData) {
  const password = formData.get('password');
  const confirm = formData.get('confirm');

  if (!password || !confirm) {
    return { ...prevState, errors: {}, message: 'Dados inválidos.', success: false };
  }

  if (password !== confirm) {
    return {
      ...prevState,
      errors: { confirm: ['As senhas não coincidem.'] },
      message: 'As senhas não coincidem.',
      success: false,
    };
  }

  try {
    const client = await clientPromise;
    const db = client.db();

    const tokenDoc = await db.collection('rcaldas_token').findOne({
      token,
      feature: 'reset-password',
      used: false,
      expiresAt: { $gt: new Date() },
    });

    if (!tokenDoc) {
      return {
        ...prevState,
        errors: {},
        message: 'Token inválido ou expirado.',
        success: false,
      };
    }

    const salt = await bcrypt.genSalt(12);
    const passwordHash = await bcrypt.hash(password as string, salt);

    await db.collection('user').updateOne(
      { email: tokenDoc.email },
      { $set: { password: passwordHash } }
    );

    await db.collection('rcaldas_token').updateOne(
      { _id: tokenDoc._id },
      { $set: { used: new Date() } }
    );

    return {
      ...prevState,
      errors: {},
      message: '',
      success: true,
    };
  } catch (error) {
    console.error('Erro ao redefinir senha:', error);
    return {
      ...prevState,
      errors: {},
      message: 'Erro interno ao redefinir senha.',
      success: false,
    };
  }
}
