'use client';

import { useState } from 'react';

export default function CopyLinkButton({ url, className }: { url: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(url);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      className={className}
    >
      {copied ? 'copiado!' : 'copiar'}
    </button>
  );
}
