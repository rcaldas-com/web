import { requireAuth } from '@/lib/auth';
import { logoutAction } from '@/lib/actions/users';
import Link from 'next/link';

export default async function DashboardPage() {
  const user = await requireAuth();

  return (
    <main className="min-h-screen bg-zinc-100">
      <div className="max-w-4xl mx-auto p-6">
        <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
          <div className="flex items-center justify-between mb-6">
            <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
            <form action={logoutAction}>
              <button
                type="submit"
                className="rounded-md bg-zinc-800 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 transition"
              >
                Sair
              </button>
            </form>
          </div>

          <div className="border-t pt-4">
            <h2 className="text-lg font-semibold mb-3">Informações do Usuário</h2>
            <div className="space-y-2 text-sm text-gray-700">
              <p><span className="font-medium">Nome:</span> {user.name}</p>
              <p><span className="font-medium">Email:</span> {user.email}</p>
              <p>
                <span className="font-medium">Email verificado:</span>{' '}
                {user.emailVerified ? (
                  <span className="text-green-600">Sim</span>
                ) : (
                  <span className="text-amber-600">Não</span>
                )}
              </p>
              <p><span className="font-medium">Perfil:</span> {user.globalRole || 'usuário'}</p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Link
            href="/"
            className="bg-white rounded-lg shadow-sm p-6 hover:shadow-md transition"
          >
            <h3 className="font-semibold text-gray-900">Página Inicial</h3>
            <p className="text-sm text-gray-600 mt-1">Voltar para a página inicial</p>
          </Link>
          <Link
            href="/posts"
            className="bg-white rounded-lg shadow-sm p-6 hover:shadow-md transition"
          >
            <h3 className="font-semibold text-gray-900">Posts</h3>
            <p className="text-sm text-gray-600 mt-1">Ver todos os posts</p>
          </Link>
        </div>
      </div>
    </main>
  );
}
