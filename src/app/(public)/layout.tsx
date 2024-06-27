import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "../globals.css";
import Header from "@/ui/header-public"
import Footer from "@/ui/footer"
import Container from "@/ui/container"


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

export default function PublicLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <>
      <Header />
      <main className="container mx-auto my-auto flex max-w-7xl justify-center">
        {children}
      </main>
    </>
  );
}
