import { cookies } from 'next/headers';
import { getUserById } from './data';
import { UserRole, UserSession } from './definitions';

export const MASTER_ADMIN_EMAIL = 'rclgsm@gmail.com';

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

export async function getCurrentUser(): Promise<UserSession | null> {
  try {
    const cookieStore = await cookies();
    const userId = cookieStore.get('userId')?.value;

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
  cookieStore.set('userId', userId, {
    httpOnly: true,
    secure: false,
    sameSite: 'strict',
    maxAge: 60 * 60 * 24 * 7, // 7 days
    path: '/',
  });
}

export async function clearUserSessionCookie() {
  const cookieStore = await cookies();
  cookieStore.set('userId', '', {
    httpOnly: true,
    secure: false,
    sameSite: 'strict',
    maxAge: 0,
    path: '/',
  });
}
