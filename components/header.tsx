'use client'

import Image from "next/image"
import Link from "next/link"
import { usePathname } from "next/navigation"

const publicLinks = [
    { href: "/", label: "Home" },
    { href: "/finance", label: "Finance" },
    { href: "/wallet", label: "Wallet" },
    { href: "/habitar", label: "Habitar" },
    { href: "/digitar", label: "DigitaR" },
]

interface HeaderProps {
    userName?: string | null;
}

export default function Header({ userName }: HeaderProps) {
    const pathname = usePathname()
    const links = publicLinks;
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