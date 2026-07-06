import { useEffect, useMemo, useRef } from 'react';

import {
  computeDisplayRemainingHours,
  resolveRemainingHoursAnchor,
} from '@/lib/scb-ui-view-model';

const REMAINING_REGRESSION_EPSILON_HOURS = 0.02;

/**
 * Smooth remaining-hours display — presentation only.
 * Decreases in lockstep with useSessionElapsedSeconds() between polls.
 * After session end, ignores stale poll regressions until settlement catches up.
 */
export function useInterpolatedRemainingHours(
  remainingHours: number | null,
  sessionDurationSeconds: number,
  currentElapsedSeconds: number,
  active: boolean,
): number | null {
  const anchorRef = useRef<ReturnType<typeof resolveRemainingHoursAnchor>>(null);
  const floorRef = useRef<number | null>(null);
  const prevActiveRef = useRef(false);

  const anchor = useMemo(() => {
    if (!active) {
      anchorRef.current = null;
      return null;
    }
    const candidate = resolveRemainingHoursAnchor(remainingHours, sessionDurationSeconds);
    if (!candidate) return anchorRef.current;

    const prev = anchorRef.current;
    if (!prev || candidate.sessionDurationSeconds >= prev.sessionDurationSeconds) {
      anchorRef.current = candidate;
      return candidate;
    }
    return prev;
  }, [active, remainingHours, sessionDurationSeconds]);

  const activeDisplay = useMemo(() => {
    if (!active) return remainingHours;
    if (anchor) {
      return computeDisplayRemainingHours(anchor, currentElapsedSeconds);
    }
    return remainingHours;
  }, [active, anchor, currentElapsedSeconds, remainingHours]);

  useEffect(() => {
    if (active && !prevActiveRef.current) {
      floorRef.current = null;
    }
    prevActiveRef.current = active;
  }, [active]);

  useEffect(() => {
    if (!active || activeDisplay == null || !Number.isFinite(activeDisplay)) return;
    floorRef.current =
      floorRef.current == null ? activeDisplay : Math.min(floorRef.current, activeDisplay);
  }, [active, activeDisplay]);

  useEffect(() => {
    if (active || floorRef.current == null || remainingHours == null) return;
    if (remainingHours <= floorRef.current + REMAINING_REGRESSION_EPSILON_HOURS) {
      floorRef.current = null;
    }
  }, [active, remainingHours]);

  return useMemo(() => {
    if (active) return activeDisplay;
    if (
      floorRef.current != null &&
      remainingHours != null &&
      remainingHours > floorRef.current + REMAINING_REGRESSION_EPSILON_HOURS
    ) {
      return floorRef.current;
    }
    return remainingHours;
  }, [active, activeDisplay, remainingHours]);
}
