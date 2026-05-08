import { requireAuth } from '@/lib/auth';
import { logoutAction } from '@/lib/actions/users';
import Link from 'next/link';

export default async function DashboardPage() {
  const user = await requireAuth();

  return (
    <main className="min-h-screen bg-zinc-100 dark:bg-zinc-950">
      <div className="max-w-4xl mx-auto p-6">
        <div className="bg-white rounded-lg border border-zinc-200 shadow-sm p-6 mb-6 dark:border-zinc-800 dark:bg-zinc-900 dark:shadow-none">
          <div className="flex items-center justify-between mb-6">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-zinc-50">Dashboard</h1>
            <form action={logoutAction}>
              <button
                type="submit"
                className="rounded-md bg-zinc-800 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 transition dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-white"
              >
                Sair
              </button>
            </form>
          </div>

          <div className="border-t border-zinc-200 pt-4 dark:border-zinc-800">
            <h2 className="text-lg font-semibold mb-3 text-zinc-900 dark:text-zinc-100">Informações do Usuário</h2>
            <div className="space-y-2 text-sm text-gray-700 dark:text-zinc-300">
              <p><span className="font-medium">Nome:</span> {user.name}</p>
              <p><span className="font-medium">Email:</span> {user.email}</p>
              <p>
                <span className="font-medium">Email verificado:</span>{' '}
                {user.emailVerified ? (
                  <span className="text-green-600 dark:text-green-400">Sim</span>
                ) : (
                  <span className="text-amber-600 dark:text-amber-400">Não</span>
                )}
              </p>
              <p><span className="font-medium">Perfil:</span> {user.globalRole || 'usuário'}</p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Link
            href="/finance"
            className="rounded-lg border border-blue-100 bg-blue-50 p-6 shadow-sm transition hover:shadow-md dark:border-blue-900/60 dark:bg-blue-950/30 dark:hover:bg-blue-950/45 dark:hover:shadow-none"
          >
            <h3 className="font-semibold text-gray-900 dark:text-blue-100">📊 Finance</h3>
            <p className="text-sm text-gray-600 mt-1 dark:text-blue-200/80">Receitas, despesas, cartões e projeções</p>
          </Link>
          <Link
            href="/wallet"
            className="rounded-lg border border-emerald-100 bg-emerald-50 p-6 shadow-sm transition hover:shadow-md dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:hover:border-emerald-800 dark:hover:bg-emerald-900/35 dark:hover:shadow-none"
          >
            <h3 className="font-semibold text-gray-900 dark:text-emerald-100">💰 Wallet</h3>
            <p className="text-sm text-gray-600 mt-1 dark:text-emerald-200/80">Carteira digital e transações</p>
          </Link>
        </div>
      </div>
    </main>
  );
}
