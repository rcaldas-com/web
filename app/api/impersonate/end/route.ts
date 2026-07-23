import { NextResponse } from 'next/server';

export async function POST() {
  try {
    const response = NextResponse.json({ success: true });

    response.cookies.delete('impersonate_original_user');
    response.cookies.delete('impersonate_target_user');

    return response;
  } catch (error) {
    console.error('Erro ao encerrar impersonate:', error);
    return NextResponse.json({ error: 'Erro ao processar solicitação' }, { status: 500 });
  }
}
