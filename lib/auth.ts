import { cache } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getUserById } from './data';
import { signSessionToken, verifySessionToken } from './session';
import { UserRole, UserSession } from './definitions';

export const MASTER_ADMIN_EMAIL = 'rclgsm@gmail.com';

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

// Id da sessão real, ignorando qualquer impersonation ativa. Só deve ser
// usado para autorizar o INÍCIO de uma impersonation (precisa ser o admin de
// verdade, não quem ele está impersonando no momento) — para tudo mais, use
// getSessionUserId() ou getCurrentUser(), que respeitam impersonation.
//
// cache() do React: memoiza por request, não entre requests diferentes. Cada
// ponto que chama isso na mesma renderização (layout raiz, layout do
// dashboard, sidenav, etc.) reaproveita o mesmo resultado em vez de reler
// cookie + reverificar o token do zero. Seguro porque login/logout/começo e
// fim de impersonation sempre terminam em redirect() ou numa Response nova
// (nunca relêem a sessão no mesmo request depois de trocar o cookie) —
// conferido em lib/actions/users.ts, app/api/impersonate/route.ts e
// app/api/impersonate/end/route.ts antes de aplicar.
export const getRealSessionUserId = cache(async (): Promise<string | null> => {
  const cookieStore = await cookies();
  return verifySessionToken(cookieStore.get('userId')?.value, 'session');
});

// Id do usuário "efetivo" — o alvo da impersonation, se houver uma ativa
// (só vale com os dois tokens válidos); senão, a sessão real. Use isto em vez
// de ler o cookie 'userId' diretamente — o valor bruto não é mais confiável.
export const getSessionUserId = cache(async (): Promise<string | null> => {
  const cookieStore = await cookies();

  const targetId = await verifySessionToken(
    cookieStore.get('impersonate_target_user')?.value,
    'impersonate-target',
  );
  const originalId = await verifySessionToken(
    cookieStore.get('impersonate_original_user')?.value,
    'impersonate-original',
  );
  if (targetId && originalId) {
    return targetId;
  }

  return getRealSessionUserId();
});

// A chamada mais cara da cadeia (getUserById bate no Mongo) e a mais
// repetida: layout raiz, layout do dashboard/monitor/finance e cada page.tsx
// individual chamam requireAuth/requireAdmin/getCurrentUser de forma
// independente na mesma requisição. Sem cache() aqui, cada visita de página
// vira N consultas ao banco em vez de 1.
export const getCurrentUser = cache(async (): Promise<UserSession | null> => {
  try {
    const userId = await getSessionUserId();

    if (!userId) {
      return null;
    }

    const user = await getUserById(userId);
    if (!user) {
      return null;
    }

    return {
      _id: user._id,
      name: user.name,
      email: user.email,
      globalRole: user.globalRole,
      roles: user.roles,
      isActive: user.isActive,
      emailVerified: user.emailVerified,
      theme: user.theme,
    };
  } catch (error) {
    console.error('Error getting current user:', error);
    return null;
  }
});

export function hasRole(user: UserSession | null | undefined, role: UserRole): boolean {
  if (!user) return false;
  if (role === 'admin' && user.email.toLowerCase() === MASTER_ADMIN_EMAIL) return true;
  if (role === 'admin' && user.globalRole === 'admin') return true;
  return user.roles.includes(role);
}

// Acesso ao módulo Wallet: quem tem o papel 'wallet' ou é administrador.
// Mesma regra aplicada dentro do app wallet (canUseWallet).
export function canAccessWallet(user: UserSession | null | undefined): boolean {
  return hasRole(user, 'wallet') || hasRole(user, 'admin');
}

export async function requireAuth(): Promise<UserSession> {
  const user = await getCurrentUser();
  if (!user) {
    throw new AuthError('Authentication required');
  }
  return user;
}

export async function requireAdmin(): Promise<UserSession> {
  const user = await requireAuth();
  if (!hasRole(user, 'admin')) {
    throw new AuthError('Admin access required');
  }
  return user;
}

/**
 * requireAdmin() para uma page.tsx: nunca deixa o AuthError estourar pro
 * error boundary genérico do Next ("Application error", só um digest sem
 * pista nenhuma) -- foi assim que apareceu um crash real no PWA do
 * /monitor, causado por uma sessão de impersonação ("ver como") presa no
 * storage isolado daquele PWA, apontando pra um usuário não-admin.
 *
 * NÃO manda toda falha pro /login, de propósito: sessão realmente ausente
 * ('Authentication required') vai pra lá com segurança, mas uma sessão
 * VÁLIDA sem papel de admin ('Admin access required' -- o caso da
 * impersonação presa) faria o middleware ver sessão válida em /login e
 * devolver direto pro mesmo callbackUrl, given que ele não sabe de papel
 * nenhum, só de sessão existir -- looping pra sempre entre /login e a
 * page. /dashboard sempre resolve pra essa sessão (só exige requireAuth)
 * e já reflete o papel atual escondendo o que não se aplica.
 */
export async function requireAdminPage(callbackUrl: string): Promise<UserSession> {
  try {
    return await requireAdmin();
  } catch (error) {
    if (!(error instanceof AuthError)) throw error;
    if (error.message === 'Authentication required') {
      redirect(`/login?callbackUrl=${callbackUrl}`);
    }
    redirect('/dashboard');
  }
}

export async function requireRole(role: UserRole): Promise<UserSession> {
  const user = await requireAuth();
  if (!hasRole(user, role)) {
    throw new AuthError(`${role} access required`);
  }
  return user;
}

export async function setUserSessionCookie(userId: string) {
  const cookieStore = await cookies();
  const isProd = process.env.NODE_ENV === 'production';
  const token = await signSessionToken(userId);
  cookieStore.set('userId', token, {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 30, // 30 days
    path: '/',
    ...(isProd ? { domain: '.rcaldas.com' } : {}),
  });
}

export async function clearUserSessionCookie() {
  const cookieStore = await cookies();
  const isProd = process.env.NODE_ENV === 'production';
  cookieStore.set('userId', '', {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    maxAge: 0,
    path: '/',
    ...(isProd ? { domain: '.rcaldas.com' } : {}),
  });
}
