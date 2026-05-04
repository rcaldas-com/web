'use client'

import Image from "next/image"
import Link from "next/link"
import { usePathname } from "next/navigation"

type HeaderLink = { href: string; label: string; requires?: 'wallet' | 'admin' };

const publicLinks: HeaderLink[] = [
    { href: "/", label: "Home" },
    { href: "/finance", label: "Finance" },
    { href: "/habitar", label: "Habitar" },
    { href: "/digitar", label: "DigitaR" },
    { href: "/wallet", label: "Wallet", requires: "wallet" },
    { href: "/configuracoes/usuarios", label: "Configurações", requires: "admin" },
]

interface HeaderProps {
    userName?: string | null;
    canAccessWallet?: boolean;
    canAccessAdmin?: boolean;
}

export default function Header({ userName, canAccessWallet = false, canAccessAdmin = false }: HeaderProps) {
    const pathname = usePathname()
    const links = publicLinks.filter(link => {
        if (link.requires === 'wallet') return canAccessWallet;
        if (link.requires === 'admin') return canAccessAdmin;
        return true;
    });
    const isActive = (href: string) =>
        href === '/' ? pathname === '/' : pathname.startsWith(href);

    return (
        <header className="flex justify-between items-center py-4 px-7 border-b">
            <Link href="/">
                <Image
                    src="/logo.png"
                    alt="Logo"
                    className="w-[42px] h-[42px]"
                    width={42}
                    height={42}
                />
            </Link>
            <nav>
                <ul className="flex gap-x-5 text-[15px] items-center">
                    {links.map((link) => (
                        <li key={link.href}>
                            <Link
                                className={`${
                                    isActive(link.href) ? 'text-gray-900 font-medium' : 'text-zinc-400'
                                } hover:text-zinc-700 transition`}
                                href={link.href}
                            >
                                {link.label}
                            </Link>
                        </li>
                    ))}
                    <li>
                        {userName ? (
                            <Link
                                className={`${
                                    pathname === '/dashboard' ? 'text-gray-900' : 'text-zinc-400'
                                } hover:text-zinc-700 transition`}
                                href="/dashboard"
                            >
                                {userName}
                            </Link>
                        ) : (
                            <Link
                                className={`${
                                    pathname === '/login' ? 'text-gray-900' : 'text-zinc-400'
                                } hover:text-zinc-700 transition`}
                                href="/login"
                            >
                                Entrar
                            </Link>
                        )}
                    </li>
                </ul>
            </nav>
        </header>
    )
}