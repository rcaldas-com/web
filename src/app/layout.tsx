import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import Header from "../components/header"
import Footer from "../components/footer"
import Container from "../components/container"


const inter = Inter({ subsets: ["latin"] });

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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt">
      <body className={`${inter.className} min-h-screen bg-zinc-100 text-zinc-900`}>
        <Container>
          <Header />
          {children}
          <Footer />
        </Container>
      </body>
    </html>
  );
}
