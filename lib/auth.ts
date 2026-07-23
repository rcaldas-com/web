import { cookies } from 'next/headers';
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

// Id do usuário autenticado, já verificado (cookie assinado). Use isto em vez
// de ler o cookie 'userId' diretamente — o valor bruto não é mais confiável.
export async function getSessionUserId(): Promise<string | null> {
  const cookieStore = await cookies();
  return verifySessionToken(cookieStore.get('userId')?.value);
}

export async function getCurrentUser(): Promise<UserSession | null> {
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
}

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
