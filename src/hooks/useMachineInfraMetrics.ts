import { useCallback, useEffect, useRef, useState } from 'react';

import type { MachineSessionPhase } from '@/hooks/useDashboard';
import {
  createEmptyMachineMetrics,
  isAutostopOfflineMessage,
  mergeMetricsFromStatusPoll,
  type MachineMetricsSnapshot,
} from '@/lib/scb-dashboard-machine-view';

const STATUS_POLL_BOOT_MS = 10_000;
const STATUS_POLL_RUNNING_MS = 30_000;
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

function shouldPollInfra(phase: MachineSessionPhase | null | undefined): boolean {
  return (
    phase === 'opening' ||
    phase === 'running' ||
    phase === 'stopping' ||
    phase === 'disconnected'
  );
}

function pollIntervalMs(phase: MachineSessionPhase | null | undefined): number {
  if (phase === 'stopping') return STATUS_POLL_STOPPING_MS;
  if (phase === 'running') return STATUS_POLL_RUNNING_MS;
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

  const refreshMetrics = useCallback(async () => {
    const token = accessToken;
    const isInitial = isInitialFetchRef.current;
    if (!token) {
      setMetricsLoaded(true);
      return;
    }

    try {
      const res = await fetch('/api/machines/status', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = (await res.json()) as InfraPollResponse;

      if (!res.ok) {
        if (data.error) onPollError?.(data.error);
        return;
      }

      const offlineMessage = data.message ?? '';
      const viewPhase = phaseRef.current;

      if (isAutostopOfflineMessage(offlineMessage) && viewPhase === 'running') {
        setMetrics(createEmptyMachineMetrics());
        if (!isInitial) {
          await onAutostopDetected?.(offlineMessage);
        }
        return;
      }

      setMetrics((prev) => mergeMetricsFromStatusPoll(prev, data));

      if (
        (data.status === 'offline' || isAutostopOfflineMessage(offlineMessage)) &&
        (viewPhase === 'running' || viewPhase === 'stopping' || viewPhase === 'disconnected') &&
        !isInitial
      ) {
        await onAutostopDetected?.();
      }
    } catch {
      // Keep last infra snapshot; lifecycle comes from dashboard/me.
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
      return;
    }
    void refreshMetrics();
  }, [accessToken, refreshMetrics]);

  useEffect(() => {
    if (!accessToken || !shouldPollInfra(phase)) return undefined;
    const id = window.setInterval(() => void refreshMetrics(), pollIntervalMs(phase));
    return () => window.clearInterval(id);
  }, [accessToken, phase, refreshMetrics]);

  return {
    metrics,
    metricsLoaded,
    refreshMetrics,
  };
}
