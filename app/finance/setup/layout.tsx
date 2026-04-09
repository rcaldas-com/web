import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';

export default async function SetupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const cookieStore = await cookies();
  const userId = cookieStore.get('userId')?.value;
  if (!userId) redirect('/login');

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold mb-6">Configuração Financeira</h1>
      {children}
    </div>
  );
}
