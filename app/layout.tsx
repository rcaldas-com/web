import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import Header from "@/components/header"
import Footer from "@/components/footer"
import Container from "@/components/container"
import { getCurrentUser, hasRole } from "@/lib/auth"

export const dynamic = 'force-dynamic';
  const userTheme = user?.theme === 'dark' || user?.theme === 'light' ? user.theme : undefined;
const inter = localFont({
  src: '../public/fonts/Inter-Variable.woff2',
    <html lang="pt" className={userTheme === 'dark' ? 'dark' : undefined} data-user-theme={user ? (userTheme ?? 'auto') : ''} suppressHydrationWarning>
  display: 'swap',
});

            __html: `(() => { try { const root = document.documentElement; const serverTheme = root.dataset.userTheme; const storedTheme = localStorage.getItem('theme'); const systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'; const theme = serverTheme === 'dark' || serverTheme === 'light' ? serverTheme : serverTheme === 'auto' ? systemTheme : storedTheme || systemTheme; root.classList.toggle('dark', theme === 'dark'); } catch (_) {} })();`,
const public_host = process.env.AUTH_TRUST_HOST || 'http://localhost:3000';

export const metadata: Metadata = {
  title: {
    template: `%s | ${title}`,
    default: title,
  },
  description: process.env.DESCRIPTION,
  metadataBase: new URL(public_host),
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const user = await getCurrentUser();
  const userTheme = user?.theme === 'dark' ? 'dark' : 'light';

  return (
    <html lang="pt" className={userTheme === 'dark' ? 'dark' : undefined} data-user-theme={user ? userTheme : ''} suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(() => { try { const root = document.documentElement; const serverTheme = root.dataset.userTheme; const storedTheme = localStorage.getItem('theme'); const theme = serverTheme || storedTheme || 'light'; root.classList.toggle('dark', theme === 'dark'); } catch (_) {} })();`,
          }}
        />
      </head>
      <body className={`${inter.className} min-h-screen bg-zinc-100 text-zinc-900 dark:bg-zinc-900 dark:text-zinc-100`}>
        <Container>
          <Header
            userName={user?.name}
            canAccessWallet={hasRole(user, 'wallet')}
            canAccessAdmin={hasRole(user, 'admin')}
            theme={userTheme}
          />
          {children}
          <Footer />
        </Container>
      </body>
    </html>
  );
}
