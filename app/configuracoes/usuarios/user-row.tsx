'use client';

import { useActionState, useEffect, useState } from 'react';
import { updateManagedUser, type ManagedUser, type UpdateManagedUserState } from '@/lib/actions/admin-users';
import ImpersonateButton from '@/components/impersonate-button';

function formatDate(value: Date | null) {
  if (!value) return '-';
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(value);
}

const initialState: UpdateManagedUserState = { success: false, message: '' };

export default function UserRow({ user, isMaster }: { user: ManagedUser; isMaster: boolean }) {
  const [state, formAction, isPending] = useActionState(updateManagedUser, initialState);
  const [justSaved, setJustSaved] = useState(false);
  const formId = `user-${user._id}`;

  // Confirmação breve depois de salvar, sem depender de toast global.
  useEffect(() => {
    if (state.success) {
      setJustSaved(true);
      const timer = setTimeout(() => setJustSaved(false), 2000);
      return () => clearTimeout(timer);
    }
  }, [state]);

  return (
    <tr className="align-top dark:text-zinc-200">
      <td className="px-5 py-4">
        <div className="font-medium text-zinc-900 dark:text-zinc-50">{user.name || '-'}</div>
        <div className="text-zinc-500 dark:text-zinc-400">{user.email}</div>
      </td>
      <td className="px-5 py-4">
        <form action={formAction} id={formId} className="space-y-2">
          <input type="hidden" name="userId" value={user._id} />
          <label className="flex items-center gap-2 text-zinc-700 dark:text-zinc-200">
            <input type="checkbox" checked={isMaster} disabled className="h-4 w-4 rounded border-zinc-300 dark:border-zinc-600 dark:bg-zinc-800" />
            Admin
            {isMaster && <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-500 dark:bg-zinc-800 dark:text-zinc-300">master</span>}
          </label>
          <label className="flex items-center gap-2 text-zinc-700 dark:text-zinc-200">
            <input
              type="checkbox"
              name="roles"
              value="wallet"
              defaultChecked={user.roles.includes('wallet')}
              className="h-4 w-4 rounded border-zinc-300 dark:border-zinc-600 dark:bg-zinc-800"
            />
            Wallet
          </label>
          <label className="flex items-center gap-2 text-zinc-700 dark:text-zinc-200">
            <input
              type="checkbox"
              name="roles"
              value="digitar"
              defaultChecked={user.roles.includes('digitar')}
              className="h-4 w-4 rounded border-zinc-300 dark:border-zinc-600 dark:bg-zinc-800"
            />
            DigitaR IA externa
          </label>
        </form>
      </td>
      <td className="px-5 py-4 space-y-2">
        <label className="flex items-center gap-2 text-zinc-700 dark:text-zinc-200" form={formId}>
          <input
            type="checkbox"
            name="isActive"
            defaultChecked={user.isActive}
            disabled={isMaster}
            form={formId}
            className="h-4 w-4 rounded border-zinc-300 dark:border-zinc-600 dark:bg-zinc-800"
          />
          Ativo
        </label>
        <label className="flex items-center gap-2 text-zinc-700 dark:text-zinc-200" form={formId}>
          <input
            type="checkbox"
            name="emailVerified"
            defaultChecked={user.emailVerified}
            form={formId}
            className="h-4 w-4 rounded border-zinc-300 dark:border-zinc-600 dark:bg-zinc-800"
          />
          Email verificado
        </label>
      </td>
      <td className="px-5 py-4 whitespace-nowrap text-zinc-500 dark:text-zinc-400">
        {formatDate(user.createdAt)}
      </td>
      <td className="px-5 py-4 text-right">
        <div className="flex items-center justify-end gap-1">
          {!isMaster && (
            <ImpersonateButton userId={user._id} userName={user.name} userEmail={user.email} />
          )}
          <button
            type="submit"
            form={formId}
            disabled={isPending}
            className={`min-w-24 rounded-md px-4 py-2 text-sm font-medium text-white transition disabled:opacity-70 ${
              justSaved
                ? 'bg-emerald-600'
                : 'bg-zinc-900 hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-zinc-300'
            }`}
          >
            {isPending ? 'Salvando…' : justSaved ? 'Salvo ✓' : 'Salvar'}
          </button>
        </div>
        {!isPending && state.message && !state.success && (
          <p className="mt-1 text-xs text-red-500">{state.message}</p>
        )}
      </td>
    </tr>
  );
}
