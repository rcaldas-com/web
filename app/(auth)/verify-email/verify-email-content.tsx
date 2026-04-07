'use client';

import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import Link from 'next/link';

export default function VerifyEmailContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token');
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!token) {
      setStatus('error');
      setMessage('Token de verificação não encontrado.');
      return;
    }

    fetch('/api/verify-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    })
      .then(async (res) => {
        const data = await res.json();
        if (res.ok) {
          setStatus('success');
          setMessage(data.message || 'Email verificado com sucesso!');
        } else {
          setStatus('error');
          setMessage(data.message || 'Erro ao verificar email.');
        }
      })
      .catch(() => {
        setStatus('error');
        setMessage('Erro ao verificar email. Tente novamente.');
      });
  }, [token]);

  return (
    <div className="flex-1 rounded-lg bg-white px-6 pb-4 pt-8 shadow-sm">
      <h1 className="mb-3 text-2xl font-semibold">Verificação de Email</h1>

      {status === 'loading' && (
        <div className="flex items-center space-x-2">
          <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-zinc-800"></div>
          <p className="text-sm text-gray-600">Verificando seu email...</p>
        </div>
      )}

      {status === 'success' && (
        <div>
          <p className="text-sm text-green-600 mb-4">{message}</p>
          <Link
            href="/login"
            className="inline-block w-full text-center rounded-md bg-zinc-800 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 transition"
          >
            Ir para o Login
          </Link>
        </div>
      )}

      {status === 'error' && (
        <div>
          <p className="text-sm text-red-500 mb-4">{message}</p>
          <Link
            href="/login"
            className="inline-block w-full text-center rounded-md bg-zinc-800 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 transition"
          >
            Voltar para o Login
          </Link>
        </div>
      )}
    </div>
  );
}
