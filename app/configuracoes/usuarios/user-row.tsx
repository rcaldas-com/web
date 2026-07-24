'use client';

import { useActionState, useEffect, useState } from 'react';
import {
  updateManagedUser,
  updateUserEmail,
  type ManagedUser,
  type UpdateManagedUserState,
  type UpdateUserEmailState,
} from '@/lib/actions/admin-users';
import ImpersonateButton from '@/components/impersonate-button';
import DeleteUserButton from '@/components/delete-user-button';

function formatDate(value: Date | null) {
  if (!value) return '-';
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Sao_Paulo',
  }).format(value);
}

const initialState: UpdateManagedUserState = { success: false, message: '' };
const initialEmailState: UpdateUserEmailState = { success: false, message: '' };

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
        <EmailCell userId={user._id} email={user.email} isMaster={isMaster} />
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
            <>
              <ImpersonateButton userId={user._id} userName={user.name} userEmail={user.email} />
              <DeleteUserButton userId={user._id} userName={user.name} userEmail={user.email} />
            </>
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

// Email com edição inline. O master não é editável (email reservado). A troca
// não derruba a sessão do usuário — login/SSO são por id, não por email.
function EmailCell({ userId, email, isMaster }: { userId: string; email: string; isMaster: boolean }) {
  const [editing, setEditing] = useState(false);
  const [state, formAction, isPending] = useActionState(updateUserEmail, initialEmailState);

  // Fecha o editor quando a troca dá certo (o email novo chega via revalidate).
  useEffect(() => {
    if (state.success) setEditing(false);
  }, [state]);

  if (isMaster) {
    return <div className="text-zinc-500 dark:text-zinc-400">{email}</div>;
  }

  if (!editing) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-zinc-500 dark:text-zinc-400">{email}</span>
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="text-xs font-medium text-zinc-400 hover:text-zinc-700 dark:text-zinc-500 dark:hover:text-zinc-200"
        >
          editar
        </button>
      </div>
    );
  }

  return (
    <form action={formAction} className="mt-1 space-y-1">
      <input type="hidden" name="userId" value={userId} />
      <div className="flex items-center gap-1.5">
        <input
          type="email"
          name="email"
          defaultValue={email}
          required
          autoFocus
          className="w-56 max-w-full rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm text-zinc-900 focus:border-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-200 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100 dark:focus:ring-zinc-700"
        />
        <button
          type="submit"
          disabled={isPending}
          className="rounded-md bg-zinc-900 px-2.5 py-1 text-xs font-medium text-white transition hover:bg-zinc-700 disabled:opacity-70 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-zinc-300"
        >
          {isPending ? '…' : 'Salvar'}
        </button>
        <button
          type="button"
          onClick={() => setEditing(false)}
          className="rounded-md px-2 py-1 text-xs font-medium text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
        >
          Cancelar
        </button>
      </div>
      {!isPending && state.message && !state.success && (
        <p className="text-xs text-red-500">{state.message}</p>
      )}
    </form>
  );
}
