import VerifyEmailContent from '@/app/(auth)/verify-email/verify-email-content';
import { Suspense } from 'react';

export default function VerifyEmailPage() {
  return (
    <main className="flex items-center justify-center min-h-screen bg-zinc-100 dark:bg-zinc-950">
      <div className="relative mx-auto flex w-full max-w-[400px] flex-col space-y-2.5 p-4">
        <div className="flex h-24 w-full items-center justify-center rounded-lg bg-zinc-800 p-3 dark:bg-zinc-100">
          <span className="text-2xl font-bold text-white dark:text-zinc-950">RCaldas</span>
        </div>
        <Suspense
          fallback={
            <div className="flex-1 rounded-lg bg-white px-6 pb-4 pt-8 shadow-sm dark:border dark:border-zinc-800 dark:bg-zinc-900 dark:shadow-none">
              <p>Carregando...</p>
            </div>
          }
        >
          <VerifyEmailContent />
        </Suspense>
      </div>
    </main>
  );
}
