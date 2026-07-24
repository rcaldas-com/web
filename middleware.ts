import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { verifySessionToken } from '@/lib/session';
import { resolveCallbackUrl } from '@/lib/callback-url';

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

  // Redirect authenticated users away from auth pages — mas sem descartar um
  // callbackUrl vindo da query (ex.: link do wallet aberto com uma sessão já
  // válida), senão a pessoa fica presa no destino padrão em vez de voltar
  // pra onde estava indo.
  if (authRoutes.some((route) => pathname.startsWith(route))) {
    if (userId) {
      const resolved = resolveCallbackUrl(request.nextUrl.searchParams.get('callbackUrl'));
      const destination = resolved.startsWith('/') ? new URL(resolved, request.url) : resolved;
      return NextResponse.redirect(destination);
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
