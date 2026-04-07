'use client';

import {
  AtSymbolIcon,
  ExclamationCircleIcon,
} from '@heroicons/react/24/outline';
import { ArrowRightIcon } from '@heroicons/react/20/solid';
import { useFormStatus } from 'react-dom';
import { requestPasswordReset } from '@/lib/actions/auth';
import { useActionState } from 'react';

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      className="mt-4 w-full flex items-center justify-center gap-2 rounded-md bg-zinc-800 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 transition disabled:opacity-50"
      disabled={pending}
    >
      {pending ? 'Enviando...' : 'Enviar Link de Recuperação'}
      <ArrowRightIcon className="h-5 w-5" />
    </button>
  );
}

export default function ForgotPasswordForm() {
  const initialState = { message: '', success: false, errors: {} as Record<string, string[]> };
  const [state, dispatch] = useActionState(requestPasswordReset, initialState);

  return (
    <form action={dispatch} className="space-y-3">
      <div className="flex-1 rounded-lg bg-white px-6 pb-4 pt-8 shadow-sm">
        <h1 className="mb-3 text-2xl font-semibold">Recuperar Senha</h1>
        <p className="mb-4 text-sm text-gray-600">
          Digite seu email e enviaremos um link para redefinir sua senha.
        </p>

        <div className="w-full">
          <div>
            <label
              className="mb-2 mt-4 block text-xs font-medium text-gray-900"
              htmlFor="email"
            >
              Email
            </label>
            <div className="relative">
              <input
                className="peer block w-full rounded-md border border-gray-200 py-[9px] pl-10 text-sm outline-2 placeholder:text-gray-500"
                id="email"
                type="email"
                name="email"
                placeholder="Digite seu email"
                required
              />
              <AtSymbolIcon className="pointer-events-none absolute left-3 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-gray-500 peer-focus:text-gray-900" />
            </div>
          </div>
        </div>

        <SubmitButton />

        <div className="flex h-8 items-end space-x-1" aria-live="polite" aria-atomic="true">
          {state.message && !state.success && (
            <>
              <ExclamationCircleIcon className="h-5 w-5 text-red-500" />
              <p className="text-sm text-red-500">{state.message}</p>
            </>
          )}
          {state.message && state.success && (
            <p className="text-sm text-green-600">{state.message}</p>
          )}
        </div>
      </div>
    </form>
  );
}
