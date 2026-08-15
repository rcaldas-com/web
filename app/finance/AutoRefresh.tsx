'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';

// Triggers router.refresh() when the tab/app comes back into focus,
// but no more than once per minIntervalMs to avoid hammering the server
// when switching tabs quickly.
//
// pollMs is opt-in (undefined by default, so existing callers are
// unaffected): when set, also refreshes on a fixed interval while the tab
// is visible, for pages like /monitor where stale data isn't just
// stale -- someone is actively watching it expecting it to be live.
export default function AutoRefresh({ minIntervalMs = 60_000, pollMs }: { minIntervalMs?: number; pollMs?: number }) {
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

  useEffect(() => {
    if (!pollMs) return;
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') {
        lastRefresh.current = Date.now();
        router.refresh();
      }
    }, pollMs);
    return () => clearInterval(id);
  }, [router, pollMs]);

  return null;
}
