'use client';

import {
  AtSymbolIcon,
  KeyIcon,
  ExclamationCircleIcon,
} from '@heroicons/react/24/outline';
import { ArrowRightIcon } from '@heroicons/react/20/solid';
import { useFormStatus } from 'react-dom';
import { loginAction } from '@/lib/actions/users';
import { useActionState, useEffect, useState } from 'react';

function LoginButton() {
  const { pending } = useFormStatus();
  return (
    <button
      className="mt-4 w-full flex items-center justify-center gap-2 rounded-md bg-zinc-800 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 transition disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-white"
      disabled={pending}
    >
      {pending ? 'Entrando...' : 'Entrar'}
      <ArrowRightIcon className="h-5 w-5" />
    </button>
  );
}

export default function LoginForm({ callbackUrl, defaultEmail }: { callbackUrl?: string; defaultEmail?: string }) {
  const initialState = { message: '', errors: {} as Record<string, string[]> };
  const [state, dispatch] = useActionState(loginAction, initialState);
  const [email, setEmail] = useState(defaultEmail || '');
  // Trocar a key força o React a remontar o campo (senha some); o email fica
  // de fora dessa troca, então uma tentativa errada nunca apaga o que a
  // pessoa já digitou ali.
  const [passwordResetKey, setPasswordResetKey] = useState(0);

  useEffect(() => {
    if (state.message) {
      setPasswordResetKey((k) => k + 1);
    }
  }, [state]);

  return (
    <form action={dispatch} className="space-y-3">
      {callbackUrl && <input type="hidden" name="callbackUrl" value={callbackUrl} />}
      <div className="flex-1 rounded-lg bg-white px-6 pb-4 pt-8 shadow-sm dark:border dark:border-zinc-800 dark:bg-zinc-900 dark:shadow-none">
        <h1 className="mb-3 text-2xl font-semibold">
          Entre para continuar
        </h1>
        <div className="w-full">
          <div>
            <label
              className="mb-2 mt-4 block text-xs font-medium text-gray-900 dark:text-zinc-200"
              htmlFor="email"
            >
              Email
            </label>
            <div className="relative">
              <input
                className="peer block w-full rounded-md border border-gray-200 py-[9px] pl-10 text-sm text-zinc-900 outline-2 placeholder:text-gray-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:placeholder:text-zinc-500"
                id="email"
                type="email"
                name="email"
                placeholder="Digite seu email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
              <AtSymbolIcon className="pointer-events-none absolute left-3 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-gray-500 peer-focus:text-gray-900 dark:text-zinc-400 dark:peer-focus:text-white" />
            </div>
          </div>

          <div className="mt-4">
            <label
              className="mb-2 mt-4 block text-xs font-medium text-gray-900 dark:text-zinc-200"
              htmlFor="password"
            >
              Senha
            </label>
            <div className="relative">
              <input
                className="peer block w-full rounded-md border border-gray-200 py-[9px] pl-10 text-sm text-zinc-900 outline-2 placeholder:text-gray-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:placeholder:text-zinc-500"
                key={passwordResetKey}
                id="password"
                type="password"
                name="password"
                placeholder="Digite sua senha"
                minLength={6}
                required
              />
              <KeyIcon className="pointer-events-none absolute left-3 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-gray-500 peer-focus:text-gray-900 dark:text-zinc-400 dark:peer-focus:text-white" />
            </div>
          </div>
        </div>
        <LoginButton />
        <div className="mt-3 min-h-6" aria-live="polite" aria-atomic="true">
          {state.message && (
            <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
              <ExclamationCircleIcon className="mt-0.5 h-4 w-4 shrink-0" />
              <p>{state.message}</p>
            </div>
          )}
        </div>
      </div>
    </form>
  );
}
