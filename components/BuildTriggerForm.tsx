'use client';

import { useActionState } from 'react';
import { triggerBuildAction, type BuildTriggerResult } from '@/lib/actions/builds';
import SubmitButton from '@/components/SubmitButton';

const initialState: BuildTriggerResult = { ok: true, message: '' };

// Client component só pra este botão: precisa de useActionState pra
// mostrar POR QUE o clique não fez nada (build já rodando, sem worker,
// etc) em vez de ficar mudo -- ver o comentário em triggerBuildAction.
export default function BuildTriggerForm({ service, emAndamento }: { service: string; emAndamento: boolean }) {
  const [state, formAction] = useActionState(triggerBuildAction, initialState);

  return (
    <div className="flex flex-col items-end gap-1">
      <form action={formAction} className="flex items-center gap-3">
        <input type="hidden" name="service" value={service} />
        <SubmitButton className="rounded-full bg-zinc-900 px-3 py-1 text-xs text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300">
          {emAndamento ? 'build em andamento...' : 'buildar agora'}
        </SubmitButton>
      </form>
      {!state.ok && state.message && (
        <p className="text-xs text-amber-700 dark:text-amber-400">{state.message}</p>
      )}
    </div>
  );
}
