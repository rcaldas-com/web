import { redirect } from 'next/navigation';
import { getManagedUsers } from '@/lib/actions/admin-users';
import { AuthError, MASTER_ADMIN_EMAIL } from '@/lib/auth';
import UsersManager from './users-manager';

export default async function UsersSettingsPage() {
  let users;
  try {
    users = await getManagedUsers();
  } catch (error) {
    if (error instanceof AuthError) redirect('/login?callbackUrl=/configuracoes/usuarios');
    throw error;
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">Usuários</h2>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Controle permissões dos módulos RCaldas. Admin é reservado ao usuário master.
        </p>
      </div>

      <UsersManager users={users} masterEmail={MASTER_ADMIN_EMAIL} />
    </div>
  );
}
