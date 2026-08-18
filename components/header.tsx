'use client'

import Image from "next/image"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { useEffect, useState, useTransition } from "react"
import { Bars3Icon, ChevronDownIcon, MoonIcon, SunIcon, XMarkIcon } from "@heroicons/react/24/outline"
import { updateThemePreference } from "@/lib/actions/preferences"
import type { ThemePreference } from "@/lib/definitions"

type HeaderLink = { href: string; label: string; requires?: 'wallet' | 'admin' };

// Os mais usados ficam direto na barra. O resto entra no submenu "Mais"
// (moreLinks, abaixo) so' no desktop -- no mobile tudo continua numa
// lista so', ja que la' nao tem barra pra aliviar.
const publicLinks: HeaderLink[] = [
    { href: "/", label: "Home" },
    { href: "/finance", label: "Finance" },
    { href: "/wallet", label: "Wallet", requires: "wallet" },
    { href: "/monitor", label: "Monitor", requires: "admin" },
    { href: "/configuracoes/usuarios", label: "Configurações", requires: "admin" },
]

const moreLinks: HeaderLink[] = [
    { href: "/habitar", label: "HabitaR" },
    { href: "/digitar", label: "DigitaR" },
    { href: "/upload", label: "Upload/Links" },
]

interface HeaderProps {
    userName?: string | null;
    canAccessWallet?: boolean;
    canAccessAdmin?: boolean;
    theme?: ThemePreference;
    // O wallet pode estar sob /wallet (dev) ou em domínio próprio (produção).
    walletUrl?: string;
}

function getSystemTheme(): ThemePreference {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export default function Header({ userName, canAccessWallet = false, canAccessAdmin = false, theme, walletUrl = '/wallet' }: HeaderProps) {
    const pathname = usePathname()
    const [open, setOpen] = useState(false)
    const [moreOpen, setMoreOpen] = useState(false)
    const [currentTheme, setCurrentTheme] = useState<ThemePreference>(theme ?? 'light')
    const [, startTransition] = useTransition()
    const links = publicLinks
        .filter(link => {
            if (link.requires === 'wallet') return canAccessWallet;
            if (link.requires === 'admin') return canAccessAdmin;
            return true;
        })
        .map(link => (link.requires === 'wallet' ? { ...link, href: walletUrl } : link));
    const more = moreLinks;
    const isActive = (href: string) =>
        href === '/' ? pathname === '/' : pathname.startsWith(href);
    const currentLabel =
        links.find(link => isActive(link.href))?.label ||
        more.find(link => isActive(link.href))?.label ||
        'Menu';

    useEffect(() => {
        const rootTheme = document.documentElement.dataset.userTheme;
        const storedTheme = localStorage.getItem('theme') as ThemePreference | null;
        const savedTheme = userName
            ? rootTheme === 'dark' || rootTheme === 'light'
                ? rootTheme
                : undefined
            : storedTheme;
        const nextTheme = savedTheme === 'dark' || savedTheme === 'light' ? savedTheme : getSystemTheme();
        setCurrentTheme(nextTheme);
        document.documentElement.classList.toggle('dark', nextTheme === 'dark');
    }, [theme, userName]);

    useEffect(() => setOpen(false), [pathname]);
    useEffect(() => setMoreOpen(false), [pathname]);

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
                            {link.requires === 'wallet' ? (
                                // Wallet é outro app Next.js por trás do mesmo nginx (dev:
                                // /wallet, prod: domínio próprio) — <Link> faria navegação
                                // client-side (RSC) e travaria silenciosamente contra um app
                                // que não sabe responder nesse formato. Precisa recarregar.
                                <a className={linkClass(link.href)} href={link.href}>
                                    {link.label}
                                </a>
                            ) : (
                                <Link className={linkClass(link.href)} href={link.href}>
                                    {link.label}
                                </Link>
                            )}
                        </li>
                    ))}
                    <li className="relative">
                        <button
                            type="button"
                            onClick={() => setMoreOpen(v => !v)}
                            className={`inline-flex items-center gap-1 ${more.some(l => isActive(l.href)) ? 'text-zinc-950 font-medium dark:text-white' : 'text-zinc-500 dark:text-zinc-300'} hover:text-zinc-900 dark:hover:text-white transition`}
                            aria-expanded={moreOpen}
                            aria-haspopup="true"
                        >
                            Mais
                            <ChevronDownIcon className={`h-4 w-4 transition-transform ${moreOpen ? 'rotate-180' : ''}`} />
                        </button>
                        {moreOpen && (
                            <>
                                {/* Camada transparente pra fechar ao clicar fora, sem precisar de ref/listener global. */}
                                <div className="fixed inset-0 z-[90]" onClick={() => setMoreOpen(false)} />
                                <div className="absolute left-1/2 top-[calc(100%+10px)] z-[100] w-40 -translate-x-1/2 rounded-lg border border-zinc-200 bg-white p-1 shadow-lg dark:border-zinc-600 dark:bg-zinc-800">
                                    {more.map(link => (
                                        <Link
                                            key={link.href}
                                            href={link.href}
                                            className={`block rounded-md px-3 py-2 text-sm ${isActive(link.href) ? 'bg-zinc-100 text-zinc-950 font-medium dark:bg-zinc-700 dark:text-white' : 'text-zinc-600 hover:bg-zinc-50 dark:text-zinc-200 dark:hover:bg-zinc-700'}`}
                                        >
                                            {link.label}
                                        </Link>
                                    ))}
                                </div>
                            </>
                        )}
                    </li>
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
                        {links.map(link => {
                            const className = `rounded-md px-3 py-2 text-sm ${isActive(link.href) ? 'bg-zinc-100 text-zinc-950 font-medium dark:bg-zinc-700 dark:text-white' : 'text-zinc-600 hover:bg-zinc-50 dark:text-zinc-200 dark:hover:bg-zinc-700'}`;
                            // Mesmo motivo do menu desktop: Wallet é outro app, precisa de
                            // navegação completa (<a>), não client-side (<Link>).
                            return link.requires === 'wallet' ? (
                                <a key={link.href} href={link.href} className={className}>
                                    {link.label}
                                </a>
                            ) : (
                                <Link key={link.href} href={link.href} className={className}>
                                    {link.label}
                                </Link>
                            );
                        })}
                        <div className="my-1 border-t border-zinc-100 dark:border-zinc-700" />
                        {more.map(link => (
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