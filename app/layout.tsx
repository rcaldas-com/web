import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import Header from "@/components/header"
import Footer from "@/components/footer"
import Container from "@/components/container"
import { getCurrentUser, hasRole } from "@/lib/auth"

export const dynamic = 'force-dynamic';

const inter = localFont({
  src: '../public/fonts/Inter-Variable.woff2',
  variable: '--font-inter',
  display: 'swap',
});

const title = process.env.TITLE || '';
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

  return (
    <html lang="pt">
      <body className={`${inter.className} min-h-screen bg-zinc-100 text-zinc-900`}>
        <Container>
          <Header
            userName={user?.name}
            canAccessWallet={hasRole(user, 'wallet')}
            canAccessAdmin={hasRole(user, 'admin')}
          />
          {children}
          <Footer />
        </Container>
      </body>
    </html>
  );
}
