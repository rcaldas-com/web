import { Suspense } from 'react';
import Link from 'next/link';
import { getCurrentUser } from '@/lib/auth';

const modules = [
  {
    href: '/finance',
    icon: '📊',
    title: 'Finance',
    description: 'Controle de receitas, despesas, cartões e projeções mensais.',
    color: 'from-blue-500 to-blue-600',
    bg: 'bg-blue-50',
  },
  {
    href: '/wallet',
    icon: '💰',
    title: 'Wallet',
    description: 'Carteira digital para transações e pagamentos.',
    color: 'from-emerald-500 to-emerald-600',
    bg: 'bg-emerald-50',
  },
  {
    href: '/habitar',
    icon: '🏠',
    title: 'Habitar',
    description: 'Simulador: alugar vs comprar — compare cenários com financiamento e investimentos.',
    color: 'from-amber-500 to-amber-600',
    bg: 'bg-amber-50',
  },
  {
    href: '/ocr',
    icon: '🧾',
    title: 'OCR',
    description: 'Extraia texto de fotos de documentos com alta precisão e preservação de formatação.',
    color: 'from-rose-500 to-orange-500',
    bg: 'bg-rose-50',
  },
];

function ModuleCardSkeleton() {
  return (
    <div className="animate-pulse rounded-xl border p-6 space-y-3">
      <div className="h-12 w-12 rounded-lg bg-zinc-200" />
      <div className="h-5 w-24 rounded bg-zinc-200" />
      <div className="h-4 w-full rounded bg-zinc-100" />
      <div className="h-4 w-3/4 rounded bg-zinc-100" />
    </div>
  );
}

async function ModuleCards() {
  const user = await getCurrentUser();

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
        {modules.map((mod) => (
          <Link
            key={mod.href}
            href={mod.href}
            className={`group rounded-xl border p-6 space-y-3 text-center hover:shadow-lg hover:border-zinc-300 transition-all duration-200 ${mod.bg}`}
          >
            <div className={`h-12 w-12 mx-auto rounded-lg bg-gradient-to-br ${mod.color} flex items-center justify-center text-2xl`}>
              {mod.icon}
            </div>
            <h2 className="text-xl font-bold text-zinc-800 group-hover:text-zinc-900">
              {mod.title}
            </h2>
            <p className="text-sm text-zinc-600 leading-relaxed">
              {mod.description}
            </p>
            <span className="inline-flex items-center text-sm font-medium text-zinc-500 group-hover:text-zinc-700 transition">
              Acessar →
            </span>
          </Link>
        ))}
      </div>

      {!user && (
        <div className="text-center space-y-4 pt-4">
          <p className="text-zinc-400 text-sm">Faça login para sincronizar seus dados na nuvem.</p>
          <div className="flex gap-4 justify-center">
            <Link
              href="/login"
              className="bg-zinc-800 text-white px-6 py-2.5 rounded-md hover:bg-zinc-700 transition font-medium"
            >
              Entrar
            </Link>
            <Link
              href="/register"
              className="border border-zinc-300 text-zinc-700 px-6 py-2.5 rounded-md hover:bg-zinc-50 transition font-medium"
            >
              Criar Conta
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

export default function Home() {
  return (
    <main className="px-5 py-16 max-w-3xl mx-auto space-y-10">
      <div className="text-center space-y-3">
        <h1 className="text-3xl font-bold text-zinc-900 md:text-4xl">RCaldas</h1>
        <p className="text-zinc-500 text-lg">Plataforma pessoal de gestão financeira e serviços.</p>
      </div>

      <Suspense fallback={
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          <ModuleCardSkeleton />
          <ModuleCardSkeleton />
        </div>
      }>
        <ModuleCards />
      </Suspense>
    </main>
  );
}
