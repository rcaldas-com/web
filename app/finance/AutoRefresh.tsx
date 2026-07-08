'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';

// Triggers router.refresh() when the tab/app comes back into focus,
// but no more than once per minIntervalMs to avoid hammering the server
// when switching tabs quickly.
export default function AutoRefresh({ minIntervalMs = 60_000 }: { minIntervalMs?: number }) {
  const router = useRouter();
  const lastRefresh = useRef(Date.now());

  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        const now = Date.now();
        if (now - lastRefresh.current >= minIntervalMs) {
          lastRefresh.current = now;
          router.refresh();
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [router, minIntervalMs]);

  return null;
}
