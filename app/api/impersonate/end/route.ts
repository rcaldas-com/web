import { NextResponse } from 'next/server';

export async function POST() {
  try {
    const response = NextResponse.json({ success: true });
    const isProd = process.env.NODE_ENV === 'production';

    // .delete() sem domain não remove um cookie que foi setado com domain
    // explícito (.rcaldas.com em produção) — são cookies distintos para o
    // navegador. Precisa reescrever com o mesmo domain e maxAge 0.
    for (const name of ['impersonate_original_user', 'impersonate_target_user']) {
      response.cookies.set(name, '', {
        httpOnly: true,
        secure: isProd,
        sameSite: 'lax',
        maxAge: 0,
        path: '/',
        ...(isProd ? { domain: '.rcaldas.com' } : {}),
      });
    }

    return response;
  } catch (error) {
    console.error('Erro ao encerrar impersonate:', error);
    return NextResponse.json({ error: 'Erro ao processar solicitação' }, { status: 500 });
  }
}
