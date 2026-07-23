'use server';

import { redirect } from 'next/navigation';
import { authenticateUser, getUserByEmail } from '@/lib/data';
import { setUserSessionCookie, clearUserSessionCookie } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { headers } from 'next/headers';

// Destino pós-login. Aceita caminho relativo ou URL absoluta de uma origem
// conhecida (o wallet, que em produção roda em domínio próprio) — nunca um host
// arbitrário vindo da query, para não virar open redirect.
function resolveCallbackUrl(raw: string | null): string {
  if (!raw) return '/dashboard';
  if (raw.startsWith('/') && !raw.startsWith('//')) return raw;

  const allowedOrigins = [process.env.WALLET_URL, process.env.AUTH_TRUST_HOST]
    .filter((u): u is string => Boolean(u))
    .map((u) => {
      try {
        return new URL(u).origin;
      } catch {
        return null;
      }
    })
    .filter((o): o is string => o !== null);

  try {
    const url = new URL(raw);
    if (allowedOrigins.includes(url.origin)) return url.toString();
  } catch {
    // URL inválida — cai no padrão.
  }
  return '/dashboard';
}

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

  redirect(resolveCallbackUrl(formData.get('callbackUrl') as string | null));
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
