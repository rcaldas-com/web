import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { verifySessionToken } from '@/lib/session';

const protectedRoutes = ['/dashboard', '/wallet', '/configuracoes', '/monitor'];
const authRoutes = ['/login', '/register', '/forgot-password', '/reset-password'];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  // Um cookie presente mas adulterado deve contar como "não autenticado".
  const userId = await verifySessionToken(request.cookies.get('userId')?.value);

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
