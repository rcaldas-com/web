import { redirect } from 'next/navigation';
import { getManagedUsers, updateManagedUser } from '@/lib/actions/admin-users';
import { AuthError, MASTER_ADMIN_EMAIL } from '@/lib/auth';

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

export default async function UsersSettingsPage() {
  let users;
  try {
    users = await getManagedUsers();
  } catch (error) {
    if (error instanceof AuthError) redirect('/login?callbackUrl=/configuracoes/usuarios');
    throw error;
  }

  return (
    <main className="mx-auto w-full max-w-7xl px-5 py-10 space-y-6">
      <div className="space-y-1">
        <h1 className="text-3xl font-bold text-zinc-900 dark:text-zinc-50">Gerenciamento de Usuários</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Controle permissões dos módulos RCaldas. Admin é reservado ao usuário master.
        </p>
      </div>

      <section className="rounded-xl border bg-white shadow-sm overflow-hidden dark:border-zinc-700 dark:bg-zinc-900">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
            <thead className="bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500 dark:bg-zinc-800 dark:text-zinc-300">
              <tr>
                <th className="px-5 py-3 text-left font-semibold">Usuário</th>
                <th className="px-5 py-3 text-left font-semibold">Roles</th>
                <th className="px-5 py-3 text-left font-semibold">Status</th>
                <th className="px-5 py-3 text-left font-semibold">Criado em</th>
                <th className="px-5 py-3 text-right font-semibold">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 bg-white dark:divide-zinc-800 dark:bg-zinc-900">
              {users.map((user) => {
                const isMaster = user.email.toLowerCase() === MASTER_ADMIN_EMAIL;
                return (
                  <tr key={user._id} className="align-top dark:text-zinc-200">
                    <td className="px-5 py-4">
                      <div className="font-medium text-zinc-900 dark:text-zinc-50">{user.name || '-'}</div>
                      <div className="text-zinc-500 dark:text-zinc-400">{user.email}</div>
                    </td>
                    <td className="px-5 py-4">
                      <form action={updateManagedUser} id={`user-${user._id}`} className="space-y-2">
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
                      <label className="flex items-center gap-2 text-zinc-700 dark:text-zinc-200" form={`user-${user._id}`}>
                        <input
                          type="checkbox"
                          name="isActive"
                          defaultChecked={user.isActive}
                          disabled={isMaster}
                          form={`user-${user._id}`}
                          className="h-4 w-4 rounded border-zinc-300 dark:border-zinc-600 dark:bg-zinc-800"
                        />
                        Ativo
                      </label>
                      <label className="flex items-center gap-2 text-zinc-700 dark:text-zinc-200" form={`user-${user._id}`}>
                        <input
                          type="checkbox"
                          name="emailVerified"
                          defaultChecked={user.emailVerified}
                          form={`user-${user._id}`}
                          className="h-4 w-4 rounded border-zinc-300 dark:border-zinc-600 dark:bg-zinc-800"
                        />
                        Email verificado
                      </label>
                    </td>
                    <td className="px-5 py-4 whitespace-nowrap text-zinc-500 dark:text-zinc-400">
                      {formatDate(user.createdAt)}
                    </td>
                    <td className="px-5 py-4 text-right">
                      <button
                        type="submit"
                        form={`user-${user._id}`}
                        className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-zinc-300"
                      >
                        Salvar
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
