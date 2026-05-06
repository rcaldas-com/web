'use client'

import Image from "next/image"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { useEffect, useState, useTransition } from "react"
import { Bars3Icon, MoonIcon, SunIcon, XMarkIcon } from "@heroicons/react/24/outline"
import { updateThemePreference } from "@/lib/actions/preferences"
import type { ThemePreference } from "@/lib/definitions"

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
    theme?: ThemePreference;
}

export default function Header({ userName, canAccessWallet = false, canAccessAdmin = false, theme = 'light' }: HeaderProps) {
    const pathname = usePathname()
    const [open, setOpen] = useState(false)
    const [currentTheme, setCurrentTheme] = useState<ThemePreference>(theme)
    const [, startTransition] = useTransition()
    const links = publicLinks.filter(link => {
        if (link.requires === 'wallet') return canAccessWallet;
        if (link.requires === 'admin') return canAccessAdmin;
        return true;
    });
    const isActive = (href: string) =>
        href === '/' ? pathname === '/' : pathname.startsWith(href);
    const currentLabel = links.find(link => isActive(link.href))?.label || 'Menu';

    useEffect(() => {
        const savedTheme = userName ? theme : (localStorage.getItem('theme') as ThemePreference | null);
        const nextTheme = savedTheme === 'dark' ? 'dark' : theme;
        setCurrentTheme(nextTheme);
        document.documentElement.classList.toggle('dark', nextTheme === 'dark');
    }, [theme, userName]);

    useEffect(() => setOpen(false), [pathname]);

    const toggleTheme = () => {
        const nextTheme: ThemePreference = currentTheme === 'dark' ? 'light' : 'dark';
        setCurrentTheme(nextTheme);
        document.documentElement.classList.toggle('dark', nextTheme === 'dark');
        localStorage.setItem('theme', nextTheme);
        if (userName) {
            startTransition(() => {
                updateThemePreference(nextTheme);
            });
        }
    };

    const linkClass = (href: string) =>
        `${isActive(href) ? 'text-zinc-950 font-medium dark:text-white' : 'text-zinc-500 dark:text-zinc-300'} hover:text-zinc-900 dark:hover:text-white transition`;

    const ThemeButton = ({ compact = false }: { compact?: boolean }) => (
        <button
            type="button"
            onClick={toggleTheme}
            className={`${compact ? 'h-9 w-9' : 'h-10 w-10'} inline-flex items-center justify-center rounded-md border border-zinc-200 text-zinc-600 hover:bg-zinc-50 hover:text-zinc-950 transition dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700 dark:hover:text-white`}
            aria-label={currentTheme === 'dark' ? 'Usar modo claro' : 'Usar modo escuro'}
            title={currentTheme === 'dark' ? 'Modo claro' : 'Modo escuro'}
        >
            {currentTheme === 'dark' ? <SunIcon className="h-5 w-5" /> : <MoonIcon className="h-5 w-5" />}
        </button>
    );

    return (
        <header className="relative z-50 border-b border-zinc-200 bg-white/95 px-4 py-3 backdrop-blur dark:border-zinc-700 dark:bg-zinc-900/95 sm:px-7">
            <div className="flex items-center justify-between gap-3">
            <Link href="/" className="shrink-0" aria-label="RCaldas">
                <Image
                    src="/logo.png"
                    alt="Logo"
                    className="h-10 w-10 object-contain"
                    width={42}
                    height={42}
                />
            </Link>

            <nav className="hidden min-w-0 flex-1 justify-center md:flex">
                <ul className="flex items-center gap-x-5 text-[15px]">
                    {links.map((link) => (
                        <li key={link.href}>
                            <Link
                                className={linkClass(link.href)}
                                href={link.href}
                            >
                                {link.label}
                            </Link>
                        </li>
                    ))}
                </ul>
            </nav>

            <div className="hidden items-center gap-3 md:flex">
                <ThemeButton />
                {userName ? (
                    <Link
                        className={`${pathname === '/dashboard' ? 'text-zinc-950 dark:text-white' : 'text-zinc-500 dark:text-zinc-300'} max-w-36 truncate text-sm hover:text-zinc-900 dark:hover:text-white transition`}
                        href="/dashboard"
                    >
                        {userName}
                    </Link>
                ) : (
                    <Link
                        className={`${pathname === '/login' ? 'text-zinc-950 dark:text-white' : 'text-zinc-500 dark:text-zinc-300'} text-sm hover:text-zinc-900 dark:hover:text-white transition`}
                        href="/login"
                    >
                        Entrar
                    </Link>
                )}
            </div>

            <div className="flex min-w-0 flex-1 items-center justify-end gap-2 md:hidden">
                <span className="min-w-0 truncate text-sm font-medium text-zinc-700 dark:text-zinc-100">{currentLabel}</span>
                <ThemeButton compact />
                <button
                    type="button"
                    onClick={() => setOpen(value => !value)}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-zinc-200 text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700"
                    aria-expanded={open}
                    aria-label={open ? 'Fechar menu' : 'Abrir menu'}
                >
                    {open ? <XMarkIcon className="h-5 w-5" /> : <Bars3Icon className="h-5 w-5" />}
                </button>
            </div>
            </div>

            {open && (
                <nav className="absolute left-3 right-3 top-[calc(100%+8px)] z-[100] rounded-lg border border-zinc-200 bg-white p-2 shadow-lg dark:border-zinc-600 dark:bg-zinc-800 md:hidden">
                    <div className="grid gap-1">
                        {links.map(link => (
                            <Link
                                key={link.href}
                                href={link.href}
                                className={`rounded-md px-3 py-2 text-sm ${isActive(link.href) ? 'bg-zinc-100 text-zinc-950 font-medium dark:bg-zinc-700 dark:text-white' : 'text-zinc-600 hover:bg-zinc-50 dark:text-zinc-200 dark:hover:bg-zinc-700'}`}
                            >
                                {link.label}
                            </Link>
                        ))}
                        <div className="my-1 border-t border-zinc-100 dark:border-zinc-700" />
                        {userName ? (
                            <Link
                                href="/dashboard"
                                className="rounded-md px-3 py-2 text-sm text-zinc-600 hover:bg-zinc-50 dark:text-zinc-200 dark:hover:bg-zinc-700"
                            >
                                {userName}
                            </Link>
                        ) : (
                            <Link
                                href="/login"
                                className="rounded-md px-3 py-2 text-sm text-zinc-600 hover:bg-zinc-50 dark:text-zinc-200 dark:hover:bg-zinc-700"
                            >
                                Entrar
                            </Link>
                        )}
                    </div>
                </nav>
            )}
        </header>
    )
}