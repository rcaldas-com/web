export default function Spinner({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <span
      role="status"
      aria-label="processando"
      className={`inline-block shrink-0 animate-spin rounded-full border-[2.5px] border-current border-t-transparent opacity-80 ${className}`}
    />
  );
}
