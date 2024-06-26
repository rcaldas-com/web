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
        href: "/network",
        label:  "Network",
    },
]

export default function Header() {
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
                <ul className="flex gap-x-5 text-[15px]">
                    {
                        navlinks.map((link) => (
                            <li key={link.href}>
                                <Link
                                    className={`${
                                        pathname.split('/')[1] === link.href.split('/')[1] ? 'text-gray-900' : 'text-zinc-400'
                                    } hover:text-zinc-700`}
                                    href={link.href}
                                >
                                    {link.label}
                                </Link>
                            </li>
                        ))
                    }
                </ul>
            </nav>
        </header>
    )
}