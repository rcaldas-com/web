import ForgotPasswordForm from '@/app/(auth)/forgot-password/forgot-password-form';
import Link from 'next/link';

export default function ForgotPasswordPage() {
  return (
    <main className="flex items-center justify-center min-h-screen bg-zinc-100">
      <div className="relative mx-auto flex w-full max-w-[400px] flex-col space-y-2.5 p-4">
        <div className="flex h-24 w-full items-center justify-center rounded-lg bg-zinc-800 p-3">
          <span className="text-2xl font-bold text-white">RCaldas</span>
        </div>
        <ForgotPasswordForm />
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
