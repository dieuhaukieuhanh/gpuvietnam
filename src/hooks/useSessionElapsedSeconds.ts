import { useEffect, useRef, useState } from 'react';

import {
  computeSessionElapsedSeconds,
  resolveSessionElapsedAnchor,
} from '@/lib/scb-ui-view-model';

/**
 * Smooth session elapsed display — presentation only.
 * Anchors to API sessionDurationSeconds / billingStartedAt; resyncs on poll updates.
 */
export function useSessionElapsedSeconds(
  sessionDurationSeconds: number,
  billingStartedAt: string | null,
  active: boolean,
): number {
  const [elapsed, setElapsed] = useState(0);
  const anchorRef = useRef<ReturnType<typeof resolveSessionElapsedAnchor> | null>(null);

  useEffect(() => {
    if (!active) {
      anchorRef.current = null;
      setElapsed(0);
      return;
    }

    const anchor = resolveSessionElapsedAnchor(
      { sessionDurationSeconds, billingStartedAt },
      Date.now(),
    );
    anchorRef.current = anchor;
    setElapsed(computeSessionElapsedSeconds(anchor));
  }, [active, sessionDurationSeconds, billingStartedAt]);

  useEffect(() => {
    if (!active) return undefined;

    const id = window.setInterval(() => {
      const anchor = anchorRef.current;
      if (!anchor) return;
      setElapsed(computeSessionElapsedSeconds(anchor));
    }, 1000);

    return () => window.clearInterval(id);
  }, [active, sessionDurationSeconds, billingStartedAt]);

  return elapsed;
}
