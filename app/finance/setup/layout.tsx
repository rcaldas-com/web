export default async function SetupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="finance-setup max-w-2xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold mb-6 text-zinc-950 dark:text-zinc-50">Configuração Financeira</h1>
      {children}
    </div>
  );
}
