'use server';

import { redirect } from 'next/navigation';
import { authenticateUser, getUserByEmail } from '@/lib/data';
import { setUserSessionCookie, clearUserSessionCookie } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { headers } from 'next/headers';

export async function loginAction(prevState: { message: string; errors: Record<string, string[]> }, formData: FormData) {
  const headersList = await headers();
  const ip = headersList.get('x-real-ip') || headersList.get('x-forwarded-for') || 'unknown';
  const limited = await rateLimit(`login:${ip}`, 5, 900);
  if (!limited.ok) {
    return { message: `Muitas tentativas. Tente novamente em ${Math.ceil(limited.retryAfter / 60)} min.`, errors: {} };
  }

  try {
    const email = formData.get('email') as string;
    const password = formData.get('password') as string;

    if (!email || !password) {
      return {
        message: 'Email e senha são obrigatórios',
        errors: {},
      };
    }

    const user = await authenticateUser(email, password);
    if (!user) {
      const existingUser = await getUserByEmail(email);
      if (existingUser && !existingUser.emailVerified) {
        return {
          message: 'Verifique seu email antes de fazer login.',
          errors: {},
        };
      }

      return {
        message: 'Email ou senha inválidos',
        errors: {},
      };
    }

    await setUserSessionCookie(user._id.toString());
  } catch (error: unknown) {
    if (error instanceof Error && 'digest' in error && typeof (error as { digest?: string }).digest === 'string' && (error as { digest: string }).digest.startsWith('NEXT_REDIRECT')) {
      throw error;
    }
    console.error('Login error:', error);
    return {
      message: 'Erro interno do servidor',
      errors: {},
    };
  }

  const callbackUrl = formData.get('callbackUrl') as string;
  const safeUrl = callbackUrl?.startsWith('/') && !callbackUrl.startsWith('//') ? callbackUrl : '/dashboard';
  redirect(safeUrl);
}

export async function logoutAction() {
  try {
    await clearUserSessionCookie();
  } catch (error: unknown) {
    if (error instanceof Error && 'digest' in error && typeof (error as { digest?: string }).digest === 'string' && (error as { digest: string }).digest.startsWith('NEXT_REDIRECT')) {
      throw error;
    }
    console.error('Logout error:', error);
  }

  redirect('/login');
}
