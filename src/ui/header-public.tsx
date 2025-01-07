'use client'

import Image from "next/image"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { MenuIcon } from '@/ui/icons';

interface NavLink {
    href: string;
    label: string;
}

const navlinks: NavLink[] = [
    // {
    //     href: "/",
    //     label:  "Home",
    // },
    // {
    //     href: "/network",
    //     label:  "Network",
    // },
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
            <div className="hidden items-center space-x-4 md:flex">
                <Link
                    className="rounded-md border px-4 py-1.5 text-sm font-medium transition-colors hover:border-black hover:bg-black hover:text-white"
                    href="/auth/login"
                >
                    Login
                </Link>
            </div>
            <div className="flex items-center space-x-4 md:hidden">
                <Link
                    className="inline-flex h-8 items-center rounded-md border border-gray-200 bg-white px-3 text-sm font-medium"
                    href="/auth/login"
                >
                    Login
                </Link>
                <button className="inline-flex rounded-md md:hidden" type="button">
                    <MenuIcon className="h-6 w-6" />
                    <span className="sr-only">Toggle Menu</span>
                </button>
            </div>
        </header>
    )
}