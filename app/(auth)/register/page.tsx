import RegisterForm from '@/app/(auth)/register/register-form';
import Link from 'next/link';

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string }>;
}) {
  const params = await searchParams;
  const loginHref = params.callbackUrl
    ? `/login?callbackUrl=${encodeURIComponent(params.callbackUrl)}`
    : '/login';

  return (
    <main className="flex items-center justify-center min-h-screen bg-zinc-100 dark:bg-zinc-950">
      <div className="relative mx-auto flex w-full max-w-[400px] flex-col space-y-2.5 p-4">
        <div className="flex h-24 w-full items-center justify-center rounded-lg bg-zinc-800 p-3 dark:bg-zinc-100">
          <span className="text-2xl font-bold text-white dark:text-zinc-950">RCaldas</span>
        </div>
        <RegisterForm callbackUrl={params.callbackUrl} />
        <div className="flex justify-center pt-2">
          <Link
            href={loginHref}
            className="text-sm text-zinc-600 hover:underline font-medium transition dark:text-zinc-300 dark:hover:text-white"
          >
            Já tem uma conta? Entre aqui
          </Link>
        </div>
      </div>
    </main>
  );
}
