'use client';

import {
  KeyIcon,
  ExclamationCircleIcon,
  EyeIcon,
  EyeSlashIcon,
} from '@heroicons/react/24/outline';
import { ArrowRightIcon } from '@heroicons/react/20/solid';
import { useFormStatus } from 'react-dom';
import { resetPassword } from '@/lib/actions/auth';
import { useActionState, useState } from 'react';

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      className="mt-4 w-full flex items-center justify-center gap-2 rounded-md bg-zinc-800 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 transition disabled:opacity-50"
      disabled={pending}
    >
      {pending ? 'Redefinindo...' : 'Redefinir Senha'}
      <ArrowRightIcon className="h-5 w-5" />
    </button>
  );
}

export default function ResetPasswordForm({ token }: { token: string }) {
  const initialState = { message: '', success: false, errors: {} as Record<string, string[]> };
  const boundResetPassword = resetPassword.bind(null, token);
  const [state, dispatch] = useActionState(boundResetPassword, initialState);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  if (state.success) {
    return (
      <div className="flex-1 rounded-lg bg-white px-6 pb-4 pt-8 shadow-sm">
        <h1 className="mb-3 text-2xl font-semibold">Senha Redefinida!</h1>
        <p className="text-sm text-green-600">{state.message}</p>
        <a
          href="/login"
          className="mt-4 inline-block w-full text-center rounded-md bg-zinc-800 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 transition"
        >
          Ir para o Login
        </a>
      </div>
    );
  }

  return (
    <form action={dispatch} className="space-y-3">
      <div className="flex-1 rounded-lg bg-white px-6 pb-4 pt-8 shadow-sm">
        <h1 className="mb-3 text-2xl font-semibold">Nova Senha</h1>
        <p className="mb-4 text-sm text-gray-600">
          Digite sua nova senha abaixo.
        </p>

        <div className="w-full">
          <div>
            <label className="mb-2 mt-4 block text-xs font-medium text-gray-900" htmlFor="password">
              Nova Senha
            </label>
            <div className="relative">
              <input
                className="peer block w-full rounded-md border border-gray-200 py-[9px] pl-10 pr-10 text-sm outline-2 placeholder:text-gray-500"
                id="password" type={showPassword ? 'text' : 'password'} name="password"
                placeholder="Digite a nova senha" minLength={6} required
              />
              <KeyIcon className="pointer-events-none absolute left-3 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-gray-500 peer-focus:text-gray-900" />
              <button type="button" className="absolute right-3 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-gray-500 hover:text-gray-900" onClick={() => setShowPassword(!showPassword)}>
                {showPassword ? <EyeSlashIcon /> : <EyeIcon />}
              </button>
            </div>
          </div>

          <div className="mt-4">
            <label className="mb-2 mt-4 block text-xs font-medium text-gray-900" htmlFor="confirmPassword">
              Confirmar Nova Senha
            </label>
            <div className="relative">
              <input
                className="peer block w-full rounded-md border border-gray-200 py-[9px] pl-10 pr-10 text-sm outline-2 placeholder:text-gray-500"
                id="confirmPassword" type={showConfirm ? 'text' : 'password'} name="confirmPassword"
                placeholder="Confirme a nova senha" required
              />
              <KeyIcon className="pointer-events-none absolute left-3 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-gray-500 peer-focus:text-gray-900" />
              <button type="button" className="absolute right-3 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-gray-500 hover:text-gray-900" onClick={() => setShowConfirm(!showConfirm)}>
                {showConfirm ? <EyeSlashIcon /> : <EyeIcon />}
              </button>
            </div>
          </div>
        </div>

        <SubmitButton />

        <div className="mt-3 min-h-6" aria-live="polite" aria-atomic="true">
          {state.message && !state.success && (
            <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              <ExclamationCircleIcon className="mt-0.5 h-4 w-4 shrink-0" />
              <p>{state.message}</p>
            </div>
          )}
        </div>
      </div>
    </form>
  );
}
