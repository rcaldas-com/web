import { redirect } from 'next/navigation';
import { getManagedUsers } from '@/lib/actions/admin-users';
import { AuthError, MASTER_ADMIN_EMAIL } from '@/lib/auth';
import UserRow from './user-row';

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
              {users.map((user) => (
                <UserRow
                  key={user._id}
                  user={user}
                  isMaster={user.email.toLowerCase() === MASTER_ADMIN_EMAIL}
                />
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
