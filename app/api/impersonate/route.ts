import { NextResponse } from 'next/server';
import { getRealSessionUserId, hasRole } from '@/lib/auth';
import { getUserById } from '@/lib/data';
import { signSessionToken } from '@/lib/session';

export async function POST(request: Request) {
  try {
    // Deliberadamente a sessão real, não a "efetiva": quem inicia uma
    // impersonation precisa ser o admin de verdade, mesmo que já esteja
    // impersonando outra pessoa no momento.
    const currentUserId = await getRealSessionUserId();

    if (!currentUserId) {
      return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });
    }

    const currentUser = await getUserById(currentUserId);
    if (!hasRole(currentUser, 'admin')) {
      return NextResponse.json({ error: 'Apenas administradores podem usar esta funcionalidade' }, { status: 403 });
    }

    const { userId } = await request.json();
    if (!userId) {
      return NextResponse.json({ error: 'userId é obrigatório' }, { status: 400 });
    }

    const targetUser = await getUserById(userId);
    if (!targetUser) {
      return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 404 });
    }

    // Cookies assinados — não podem ser forjados via devtools.
    const response = NextResponse.json({ success: true });
    const impersonationTtl = '2h';
    const isProd = process.env.NODE_ENV === 'production';

    const originalToken = await signSessionToken(currentUserId, {
      expiresIn: impersonationTtl,
      purpose: 'impersonate-original',
    });
    const targetToken = await signSessionToken(userId, {
      expiresIn: impersonationTtl,
      purpose: 'impersonate-target',
    });

    // Sem `domain` amplo de propósito: fica restrito a este host, não
    // vazando para os demais subdomínios que compartilham a sessão (SSO).
    response.cookies.set('impersonate_original_user', originalToken, {
      httpOnly: true,
      secure: isProd,
      sameSite: 'lax',
      maxAge: 60 * 60 * 2,
      path: '/',
    });
    response.cookies.set('impersonate_target_user', targetToken, {
      httpOnly: true,
      secure: isProd,
      sameSite: 'lax',
      maxAge: 60 * 60 * 2,
      path: '/',
    });

    return response;
  } catch (error) {
    console.error('Erro no impersonate:', error);
    return NextResponse.json({ error: 'Erro ao processar solicitação' }, { status: 500 });
  }
}
