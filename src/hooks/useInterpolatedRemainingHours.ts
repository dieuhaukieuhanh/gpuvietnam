import { useEffect, useRef, useState } from 'react';

import {
  computeDisplayRemainingHours,
  resolveRemainingHoursAnchor,
} from '@/lib/scb-ui-view-model';

/**
 * Smooth remaining-hours display — presentation only.
 * Anchors to API remainingHours + sessionDurationSeconds; resyncs on poll updates.
 * Decreases in sync with useSessionElapsedSeconds() between polls.
 */
export function useInterpolatedRemainingHours(
  remainingHours: number | null,
  sessionDurationSeconds: number,
  currentElapsedSeconds: number,
  active: boolean,
): number | null {
  const [display, setDisplay] = useState<number | null>(remainingHours);
  const anchorRef = useRef<ReturnType<typeof resolveRemainingHoursAnchor>>(null);
  const elapsedRef = useRef(currentElapsedSeconds);

  useEffect(() => {
    elapsedRef.current = currentElapsedSeconds;
  }, [currentElapsedSeconds]);

  useEffect(() => {
    if (!active) {
      anchorRef.current = null;
      setDisplay(remainingHours);
      return;
    }

    const anchor = resolveRemainingHoursAnchor(remainingHours, sessionDurationSeconds);
    anchorRef.current = anchor;

    if (anchor) {
      setDisplay(computeDisplayRemainingHours(anchor, elapsedRef.current));
    } else {
      setDisplay(remainingHours);
    }
  }, [active, remainingHours, sessionDurationSeconds]);

  useEffect(() => {
    if (!active) return undefined;

    const id = window.setInterval(() => {
      const anchor = anchorRef.current;
      if (!anchor) return;
      setDisplay(computeDisplayRemainingHours(anchor, elapsedRef.current));
    }, 1000);

    return () => window.clearInterval(id);
  }, [active, remainingHours, sessionDurationSeconds]);

  return display;
}
