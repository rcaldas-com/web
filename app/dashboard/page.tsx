import { requireAuth, hasRole, canAccessWallet } from '@/lib/auth';
import { logoutAction } from '@/lib/actions/users';
import Link from 'next/link';

// Mesmo conjunto de módulos do menu superior (components/header.tsx),
// já filtrado pela role do usuário — cada card só some/aparece pelas mesmas
// regras do menu (`canAccessWallet`/`hasRole(user, 'admin')`).
const cardStyles = {
  blue: {
    card: 'rounded-lg border border-blue-100 bg-blue-50 p-6 shadow-sm transition hover:shadow-md dark:border-blue-900/60 dark:bg-blue-950/30 dark:hover:bg-blue-950/45 dark:hover:shadow-none',
    title: 'font-semibold text-gray-900 dark:text-blue-100',
    desc: 'text-sm text-gray-600 mt-1 dark:text-blue-200/80',
  },
  emerald: {
    card: 'rounded-lg border border-emerald-100 bg-emerald-50 p-6 shadow-sm transition hover:shadow-md dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:hover:border-emerald-800 dark:hover:bg-emerald-900/35 dark:hover:shadow-none',
    title: 'font-semibold text-gray-900 dark:text-emerald-100',
    desc: 'text-sm text-gray-600 mt-1 dark:text-emerald-200/80',
  },
  purple: {
    card: 'rounded-lg border border-purple-100 bg-purple-50 p-6 shadow-sm transition hover:shadow-md dark:border-purple-900/60 dark:bg-purple-950/30 dark:hover:bg-purple-950/45 dark:hover:shadow-none',
    title: 'font-semibold text-gray-900 dark:text-purple-100',
    desc: 'text-sm text-gray-600 mt-1 dark:text-purple-200/80',
  },
  amber: {
    card: 'rounded-lg border border-amber-100 bg-amber-50 p-6 shadow-sm transition hover:shadow-md dark:border-amber-900/60 dark:bg-amber-950/30 dark:hover:bg-amber-950/45 dark:hover:shadow-none',
    title: 'font-semibold text-gray-900 dark:text-amber-100',
    desc: 'text-sm text-gray-600 mt-1 dark:text-amber-200/80',
  },
  rose: {
    card: 'rounded-lg border border-rose-100 bg-rose-50 p-6 shadow-sm transition hover:shadow-md dark:border-rose-900/60 dark:bg-rose-950/30 dark:hover:bg-rose-950/45 dark:hover:shadow-none',
    title: 'font-semibold text-gray-900 dark:text-rose-100',
    desc: 'text-sm text-gray-600 mt-1 dark:text-rose-200/80',
  },
  zinc: {
    card: 'rounded-lg border border-zinc-200 bg-zinc-50 p-6 shadow-sm transition hover:shadow-md dark:border-zinc-700 dark:bg-zinc-800/40 dark:hover:bg-zinc-800/60 dark:hover:shadow-none',
    title: 'font-semibold text-gray-900 dark:text-zinc-100',
    desc: 'text-sm text-gray-600 mt-1 dark:text-zinc-300/80',
  },
} as const;

export default async function DashboardPage() {
  const user = await requireAuth();
  const isAdmin = hasRole(user, 'admin');

  const modules: { href: string; icon: string; title: string; description: string; color: keyof typeof cardStyles }[] = [
    { href: '/finance', icon: '📊', title: 'Finance', description: 'Receitas, despesas, cartões e projeções', color: 'blue' },
    { href: '/habitar', icon: '🏠', title: 'HabitaR', description: 'Simulação de financiamento imobiliário vs. aluguel', color: 'purple' },
    { href: '/digitar', icon: '🧾', title: 'DigitaR', description: 'Extração de dados de documentos com IA', color: 'amber' },
    ...(canAccessWallet(user)
      ? [{ href: process.env.WALLET_URL || '/wallet', icon: '💰', title: 'Wallet', description: 'Carteira digital e transações', color: 'emerald' as const }]
      : []),
    ...(isAdmin
      ? [{ href: '/monitor', icon: '🩺', title: 'Monitor', description: 'Status dos serviços e integrações', color: 'rose' as const }]
      : []),
    ...(isAdmin
      ? [{ href: '/configuracoes/usuarios', icon: '⚙️', title: 'Configurações', description: 'Gerenciar usuários e permissões', color: 'zinc' as const }]
      : []),
  ];

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
          {modules.map((mod) => {
            const style = cardStyles[mod.color];
            return (
              <Link key={mod.href} href={mod.href} className={style.card}>
                <h3 className={style.title}>{mod.icon} {mod.title}</h3>
                <p className={style.desc}>{mod.description}</p>
              </Link>
            );
          })}
        </div>
      </div>
    </main>
  );
}
