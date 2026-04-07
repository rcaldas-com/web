import ResetPasswordForm from '@/app/(auth)/reset-password/reset-password-form';
import Link from 'next/link';

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const params = await searchParams;
  const token = params.token;

  if (!token) {
    return (
      <main className="flex items-center justify-center min-h-screen bg-zinc-100">
        <div className="relative mx-auto flex w-full max-w-[400px] flex-col space-y-2.5 p-4">
          <div className="flex h-24 w-full items-center justify-center rounded-lg bg-zinc-800 p-3">
            <span className="text-2xl font-bold text-white">RCaldas</span>
          </div>
          <div className="flex-1 rounded-lg bg-white px-6 pb-4 pt-8 shadow-sm">
            <h1 className="mb-3 text-2xl font-semibold">Link Inválido</h1>
            <p className="text-sm text-gray-600">
              O link de recuperação de senha é inválido ou está faltando o token.
            </p>
            <Link
              href="/forgot-password"
              className="mt-4 inline-block text-sm text-zinc-600 hover:underline font-medium"
            >
              Solicitar novo link
            </Link>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="flex items-center justify-center min-h-screen bg-zinc-100">
      <div className="relative mx-auto flex w-full max-w-[400px] flex-col space-y-2.5 p-4">
        <div className="flex h-24 w-full items-center justify-center rounded-lg bg-zinc-800 p-3">
          <span className="text-2xl font-bold text-white">RCaldas</span>
        </div>
        <ResetPasswordForm token={token} />
        <div className="flex justify-center pt-2">
          <Link
            href="/login"
            className="text-sm text-zinc-600 hover:underline font-medium transition"
          >
            Voltar para o login
          </Link>
        </div>
      </div>
    </main>
  );
}
