import { redirect } from 'next/navigation';
import { getCurrentUser, canAccessWallet } from '@/lib/auth';

// Resquício de quando o wallet ainda não era um app separado. Hoje ele vive
// em WALLET_URL (subdomínio próprio em produção); esta rota só existe para
// quem cair aqui via link antigo ou fallback (WALLET_URL não configurado).
export default async function WalletHome() {
  const user = await getCurrentUser();
  if (!user) redirect(`/login?callbackUrl=${encodeURIComponent('/wallet')}`);
  if (!canAccessWallet(user)) redirect('/');

  const walletUrl = process.env.WALLET_URL;
  // Sem WALLET_URL configurado, redirecionar cairia nesta mesma página (loop).
  if (walletUrl && walletUrl !== '/wallet') {
    redirect(walletUrl);
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <p className="text-center text-gray-600">
        WALLET_URL não está configurada. Peça para o administrador definir a
        variável de ambiente apontando para o app do Wallet.
      </p>
    </main>
  );
}
