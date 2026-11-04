'use client';

import { TrashIcon } from '@heroicons/react/24/outline';

// Peças comuns das linhas das 4 abas de Configurar. O layout anterior
// empilhava um rótulo + campo de largura cheia por linha no celular, e o
// botão de apagar sobrava sozinho numa linha própria: um cartão ocupava
// quatro linhas de tela pra três campos curtos. Agora a linha principal
// (nome + valor curto + remover) cabe numa linha em qualquer largura.

export const FIELD =
  'block h-9 w-full rounded-md border-zinc-300 px-2 text-sm shadow-sm focus:border-blue-500 focus:ring-blue-500';

export const LABEL = 'mb-0.5 block text-xs text-zinc-500';

// Sempre ocupa a coluna, mesmo quando não pode remover (última linha):
// sem o espaço reservado o grid desalinha de uma linha pra outra.
export function RemoveRowButton({
  onClick,
  label,
  hidden,
}: {
  onClick: () => void;
  label: string;
  hidden?: boolean;
}) {
  if (hidden) return <span className="block h-9 w-9" aria-hidden />;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="flex h-9 w-9 items-center justify-center rounded-md text-zinc-400 transition hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40"
    >
      <TrashIcon className="h-5 w-5" />
    </button>
  );
}
