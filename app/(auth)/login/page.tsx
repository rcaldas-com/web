import LoginForm from '@/app/(auth)/login/login-form';
import Link from 'next/link';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ message?: string; callbackUrl?: string }>;
}) {
  const params = await searchParams;

  return (
    <main className="flex items-center justify-center min-h-screen bg-zinc-100 dark:bg-zinc-950">
      <div className="relative mx-auto flex w-full max-w-[400px] flex-col space-y-2.5 p-4">
        <div className="flex h-24 w-full items-center justify-center rounded-lg bg-zinc-800 p-3 dark:bg-zinc-100">
          <span className="text-2xl font-bold text-white dark:text-zinc-950">RCaldas</span>
        </div>

        {params.message && (
          <div className="p-3 bg-green-50 border border-green-200 rounded text-green-700 text-sm dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">
            {params.message}
          </div>
        )}

        <LoginForm callbackUrl={params.callbackUrl} />
        <div className="flex justify-between pt-2">
          <Link
            href="/register"
            className="text-sm text-zinc-600 hover:underline font-medium transition dark:text-zinc-300 dark:hover:text-white"
          >
            Criar nova conta
          </Link>
          <Link
            href="/forgot-password"
            className="text-sm text-zinc-600 hover:underline font-medium transition dark:text-zinc-300 dark:hover:text-white"
          >
            Esqueceu a senha?
          </Link>
        </div>
      </div>
    </main>
  );
}
