'use client';

import { TrashIcon } from '@heroicons/react/24/outline';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { getUserDeletionPreview, deleteUserAction } from '@/lib/actions/delete-user';

interface DeleteUserButtonProps {
  userId: string;
  userName: string;
  userEmail: string;
}

export default function DeleteUserButton({ userId, userName, userEmail }: DeleteUserButtonProps) {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);

  const handleDelete = async () => {
    setIsLoading(true);
    try {
      const preview = await getUserDeletionPreview(userId);

      if (preview.blocked) {
        alert(preview.reason);
        return;
      }

      const lines = preview.wallets.flatMap((w) => w.lines);
      const closing = preview.wallets.length > 0;

      const walletSummary =
        lines.length > 0
          ? `A carteira Stellar será esvaziada:\n${lines
              .map(
                (l) =>
                  `  ${l.coin}: ${l.amount} → ${l.destination === 'issuer' ? 'devolvido ao issuer' : 'enviado para a conta principal'}`,
              )
              .join('\n')}\n\n${closing ? 'A conta on-chain será ENCERRADA (accountMerge).\n\n' : ''}`
          : 'O usuário não tem saldo em carteira.\n\n';

      const message =
        `Excluir ${userName} (${userEmail})?\n\n` +
        walletSummary +
        'Carros e manutenções permanecem. Nenhum email é enviado.\n\n' +
        'Essa ação não pode ser desfeita. Confirma?';

      if (!confirm(message)) return;

      const result = await deleteUserAction(userId);
      if (!result.success) {
        alert(result.message);
        return;
      }
      router.refresh();
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Erro ao excluir usuário.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <button
      onClick={handleDelete}
      disabled={isLoading}
      className="inline-flex items-center px-2 py-1 text-sm text-red-500 hover:text-red-700 disabled:opacity-50 dark:text-red-400 dark:hover:text-red-300"
      title={`Excluir ${userName}`}
    >
      <TrashIcon className="w-5 h-5" />
      {isLoading && <span className="ml-1">...</span>}
    </button>
  );
}
