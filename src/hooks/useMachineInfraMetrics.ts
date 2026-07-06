import { useCallback, useEffect, useRef, useState } from 'react';

import type { MachineSessionPhase } from '@/hooks/useDashboard';
import {
  createEmptyMachineMetrics,
  isAutostopOfflineMessage,
  mergeMetricsFromStatusPoll,
  type MachineMetricsSnapshot,
} from '@/lib/scb-dashboard-machine-view';

const STATUS_POLL_BOOT_MS = 6_000;
const STATUS_POLL_RUNNING_MS = 30_000;
const STATUS_POLL_RUNNING_WAIT_COMFY_MS = 4_000;
const STATUS_POLL_STOPPING_MS = 3_000;

type InfraPollResponse = {
  status?: string;
  message?: string | null;
  error?: string;
  metrics?: MachineMetricsSnapshot['metrics'];
  comfyUrl?: string | null;
  ip?: string | null;
  port?: number | null;
  template?: string | null;
  idleMinutes?: number | null;
  lastActivity?: string | null;
  minutesUntilAutoStop?: number | null;
  idleWarningActive?: boolean;
};

export function shouldPollInfra(phase: MachineSessionPhase | null | undefined): boolean {
  return (
    phase === 'opening' ||
    phase === 'running' ||
    phase === 'stopping' ||
    phase === 'disconnected'
  );
}

export function pollIntervalMs(
  phase: MachineSessionPhase | null | undefined,
  hasComfyUrl = false,
): number {
  if (phase === 'stopping') return STATUS_POLL_STOPPING_MS;
  if (phase === 'running') {
    return hasComfyUrl ? STATUS_POLL_RUNNING_MS : STATUS_POLL_RUNNING_WAIT_COMFY_MS;
  }
  return STATUS_POLL_BOOT_MS;
}

type UseMachineInfraMetricsOptions = {
  accessToken: string | null | undefined;
  phase: MachineSessionPhase | null | undefined;
  onAutostopDetected?: (message?: string | null) => void | Promise<void>;
  onPollError?: (message: string) => void;
};

export function useMachineInfraMetrics({
  accessToken,
  phase,
  onAutostopDetected,
  onPollError,
}: UseMachineInfraMetricsOptions) {
  const [metrics, setMetrics] = useState<MachineMetricsSnapshot>(createEmptyMachineMetrics());
  const [metricsLoaded, setMetricsLoaded] = useState(false);
  const isInitialFetchRef = useRef(true);
  const phaseRef = useRef(phase);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  useEffect(() => {
    if (phase === 'idle' || phase == null) {
      setMetrics(createEmptyMachineMetrics());
    }
  }, [phase]);

  const refreshMetrics = useCallback(async (): Promise<MachineMetricsSnapshot | null> => {
    const token = accessToken;
    const isInitial = isInitialFetchRef.current;
    if (!token) {
      setMetricsLoaded(true);
      return null;
    }

    try {
      const res = await fetch('/api/machines/status', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = (await res.json()) as InfraPollResponse;

      if (!res.ok) {
        if (data.error) onPollError?.(data.error);
        return null;
      }

      const offlineMessage = data.message ?? '';
      const viewPhase = phaseRef.current;

      if (isAutostopOfflineMessage(offlineMessage) && viewPhase === 'running') {
        setMetrics(createEmptyMachineMetrics());
        if (!isInitial) {
          await onAutostopDetected?.(offlineMessage);
        }
        return createEmptyMachineMetrics();
      }

      let nextMetrics: MachineMetricsSnapshot | null = null;
      setMetrics((prev) => {
        nextMetrics = mergeMetricsFromStatusPoll(prev, data);
        return nextMetrics;
      });

      if (
        (data.status === 'offline' || isAutostopOfflineMessage(offlineMessage)) &&
        (viewPhase === 'running' || viewPhase === 'stopping' || viewPhase === 'disconnected') &&
        !isInitial
      ) {
        await onAutostopDetected?.();
      }
      return nextMetrics;
    } catch {
      return null;
    } finally {
      isInitialFetchRef.current = false;
      setMetricsLoaded(true);
    }
  }, [accessToken, onAutostopDetected, onPollError]);

  useEffect(() => {
    if (!accessToken) {
      setMetrics(createEmptyMachineMetrics());
      setMetricsLoaded(false);
      isInitialFetchRef.current = true;
    }
  }, [accessToken]);

  return {
    metrics,
    metricsLoaded,
    refreshMetrics,
  };
}
