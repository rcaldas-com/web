'use client'

import Image from "next/image"
import Link from "next/link"
import { usePathname } from "next/navigation"

const navlinks = [
    {
        href: "/",
        label:  "Home",
    },
    {
        href: "/posts",
        label:  "Posts",
    },
]

interface HeaderProps {
    userName?: string | null;
}

export default function Header({ userName }: HeaderProps) {
    const pathname = usePathname()

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
                    {
                        navlinks.map((link) => (
                            <li key={link.href}>
                                <Link
                                    className={`${
                                        pathname === link.href ? 'text-gray-900' : 'text-zinc-400'
                                    } hover:text-zinc-700`}
                                    href={link.href}
                                >
                                    {link.label}
                                </Link>
                            </li>
                        ))
                    }
                    <li>
                        {userName ? (
                            <Link
                                className={`${
                                    pathname === '/dashboard' ? 'text-gray-900' : 'text-zinc-400'
                                } hover:text-zinc-700`}
                                href="/dashboard"
                            >
                                {userName}
                            </Link>
                        ) : (
                            <Link
                                className={`${
                                    pathname === '/login' ? 'text-gray-900' : 'text-zinc-400'
                                } hover:text-zinc-700`}
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