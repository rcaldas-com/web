
export default function Container({ children }: { children: React.ReactNode }) {
    return <div className="max-w-[1100px] mx-auto bg-white min-h-screen flex flex-col border-l border-r border-zinc-200 dark:border-zinc-700 dark:bg-zinc-900">{children}</div>;
}