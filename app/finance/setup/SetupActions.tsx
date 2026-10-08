'use client';

import Link from 'next/link';
import SubmitButton from '@/components/SubmitButton';

const secondary = 'text-zinc-600 hover:text-zinc-800 px-4 py-2 border rounded-md hover:bg-zinc-50 transition';
const primary = 'bg-blue-600 text-white px-6 py-2 rounded-md hover:bg-blue-700 transition';

// Barra Salvar/Concluir das 4 abas de Configurar.
//
// Autenticado: Concluir só salva se houver alteração (`dirty`); sem ela é
// um <Link> comum -- navega pelo router do Next (com prefetch do painel),
// sem server action, sem reenviar o form. Salvar fica desabilitado sem
// alteração: é o sinal de "está tudo salvo".
//
// Convidado: gravar é localStorage instantâneo, não há o que economizar --
// e um rascunho restaurado ainda não foi salvo, então Concluir sempre grava.
export default function SetupActions({
  isGuest,
  dirty,
  saved,
  finishAction,
  onGuestFinish,
}: {
  isGuest?: boolean;
  dirty: boolean;
  saved: boolean;
  finishAction: (formData: FormData) => void | Promise<void>;
  onGuestFinish: () => void;
}) {
  return (
    <div className="flex items-center justify-end gap-3">
      {saved && <span className="text-sm text-emerald-600">✓ Salvo</span>}
      {isGuest ? (
        <>
          <button type="button" onClick={onGuestFinish} className={secondary}>
            Concluir ✓
          </button>
          <button type="submit" className={primary}>
            Salvar
          </button>
        </>
      ) : (
        <>
          {dirty ? (
            <SubmitButton formAction={finishAction} className={secondary}>
              Concluir ✓
            </SubmitButton>
          ) : (
            <Link href="/finance" className={secondary}>
              Concluir ✓
            </Link>
          )}
          <SubmitButton disabled={!dirty} className={primary}>
            Salvar
          </SubmitButton>
        </>
      )}
    </div>
  );
}
