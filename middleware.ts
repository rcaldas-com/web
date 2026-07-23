import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { verifySessionToken } from '@/lib/session';

const protectedRoutes = ['/dashboard', '/wallet', '/configuracoes', '/monitor'];
const authRoutes = ['/login', '/register', '/forgot-password', '/reset-password'];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  // Um cookie presente mas adulterado deve contar como "não autenticado".
  let userId = await verifySessionToken(request.cookies.get('userId')?.value, 'session');

  // Impersonation ativa (só vale com os dois tokens válidos) — o usuário
  // "efetivo" passa a ser o alvo, para toda a lógica de rota abaixo.
  const impersonateTargetId = await verifySessionToken(
    request.cookies.get('impersonate_target_user')?.value,
    'impersonate-target',
  );
  const impersonateOriginalId = await verifySessionToken(
    request.cookies.get('impersonate_original_user')?.value,
    'impersonate-original',
  );
  if (impersonateTargetId && impersonateOriginalId) {
    userId = impersonateTargetId;
  }

  // Protect dashboard routes - redirect to login if not authenticated
  if (protectedRoutes.some((route) => pathname.startsWith(route))) {
    if (!userId) {
      const loginUrl = new URL('/login', request.url);
      loginUrl.searchParams.set('callbackUrl', pathname);
      return NextResponse.redirect(loginUrl);
    }
  }

  // Redirect authenticated users away from auth pages
  if (authRoutes.some((route) => pathname.startsWith(route))) {
    if (userId) {
      const dashboardUrl = new URL('/dashboard', request.url);
      return NextResponse.redirect(dashboardUrl);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/dashboard/:path*',
    '/wallet/:path*',
    '/configuracoes/:path*',
    '/monitor/:path*',
    '/finance/:path*',
    '/login',
    '/register',
    '/forgot-password',
    '/reset-password',
  ],
};
