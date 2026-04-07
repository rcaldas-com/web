import { NextRequest, NextResponse } from 'next/server';
import { resendVerificationEmail } from '@/lib/data';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email } = body;

    if (!email) {
      return NextResponse.json(
        { error: 'Email não fornecido.' },
        { status: 400 }
      );
    }

    const result = await resendVerificationEmail(email);
    return NextResponse.json(result);
  } catch {
    return NextResponse.json(
      { error: 'Erro interno do servidor.' },
      { status: 500 }
    );
  }
}
