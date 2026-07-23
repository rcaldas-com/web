'use client';

import { EyeIcon } from '@heroicons/react/24/outline';
import { useState } from 'react';

interface ImpersonateButtonProps {
  userId: string;
  userName: string;
  userEmail: string;
}

export default function ImpersonateButton({ userId, userName, userEmail }: ImpersonateButtonProps) {
  const [isLoading, setIsLoading] = useState(false);

  const handleImpersonate = async () => {
    if (!confirm(`Ver o sistema como ${userName} (${userEmail})?\n\nVocê poderá navegar como este usuário por até 2 horas. Para voltar, use o botão no aviso amarelo no topo da página.`)) {
      return;
    }

    setIsLoading(true);
    try {
      const response = await fetch('/api/impersonate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Erro ao iniciar visualização');
      }

      window.location.href = '/dashboard';
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Erro ao iniciar visualização');
      setIsLoading(false);
    }
  };

  return (
    <button
      onClick={handleImpersonate}
      disabled={isLoading}
      className="inline-flex items-center px-2 py-1 text-sm text-zinc-500 hover:text-zinc-900 disabled:opacity-50 dark:text-zinc-400 dark:hover:text-white"
      title={`Ver como ${userName}`}
    >
      <EyeIcon className="w-5 h-5" />
      {isLoading && <span className="ml-1">...</span>}
    </button>
  );
}
