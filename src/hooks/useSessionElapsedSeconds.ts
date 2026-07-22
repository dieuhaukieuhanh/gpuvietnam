import { useEffect, useRef, useState } from 'react';

import {
  computeSessionElapsedSeconds,
  resolveSessionElapsedAnchor,
} from '@/lib/scb-ui-view-model';

/**
 * Smooth session elapsed display — presentation only.
 * Anchors to API sessionDurationSeconds / billingStartedAt / verifiedRunningAt.
 */
export function useSessionElapsedSeconds(
  sessionDurationSeconds: number,
  billingStartedAt: string | null,
  verifiedRunningAt: string | null,
  active: boolean,
): number {
  const [elapsed, setElapsed] = useState(0);
  const anchorRef = useRef<ReturnType<typeof resolveSessionElapsedAnchor> | null>(null);

  useEffect(() => {
    if (!active) {
      anchorRef.current = null;
      // Only clear when billing anchor is gone (session truly ended).
      // Avoids 00:00 flash when phase briefly leaves `running` (e.g. optimistic stopping).
      if (!billingStartedAt) {
        setElapsed(0);
      }
      return;
    }

    const anchor = resolveSessionElapsedAnchor(
      { sessionDurationSeconds, billingStartedAt, verifiedRunningAt },
      Date.now(),
    );
    const nextElapsed = computeSessionElapsedSeconds(anchor);
    setElapsed((prev) => {
      if (prev > 0 && nextElapsed < prev) {
        return prev;
      }
      anchorRef.current = anchor;
      return nextElapsed;
    });
  }, [active, sessionDurationSeconds, billingStartedAt, verifiedRunningAt]);

  useEffect(() => {
    if (!active) return undefined;

    const id = window.setInterval(() => {
      const anchor = anchorRef.current;
      if (!anchor) return;
      setElapsed(computeSessionElapsedSeconds(anchor));
    }, 1000);

    return () => window.clearInterval(id);
  }, [active, sessionDurationSeconds, billingStartedAt, verifiedRunningAt]);

  return elapsed;
}
