import { useMemo } from 'react';

import {
  computeDisplayRemainingHours,
  resolveRemainingHoursAnchor,
} from '@/lib/scb-ui-view-model';

/**
 * Smooth remaining-hours display — presentation only.
 * Decreases in lockstep with useSessionElapsedSeconds() between polls.
 */
export function useInterpolatedRemainingHours(
  remainingHours: number | null,
  sessionDurationSeconds: number,
  currentElapsedSeconds: number,
  active: boolean,
): number | null {
  const anchor = useMemo(
    () =>
      active ? resolveRemainingHoursAnchor(remainingHours, sessionDurationSeconds) : null,
    [active, remainingHours, sessionDurationSeconds],
  );

  return useMemo(() => {
    if (!active) return remainingHours;
    if (anchor) {
      return computeDisplayRemainingHours(anchor, currentElapsedSeconds);
    }
    return remainingHours;
  }, [active, anchor, currentElapsedSeconds, remainingHours]);
}
