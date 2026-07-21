/**
 * Provision progress snapshot type for dashboard polling / workspace restore UI.
 * Multi-step boot checklist removed from UX — server engine still emits this shape.
 */

export type ProvisionTimelineStepState = 'done' | 'active' | 'pending';

export type ProvisionTimelineStep = {
  stage: string;
  label: string;
  labelVi?: string;
  state: ProvisionTimelineStepState;
};

export type ProvisionProgressSnapshot = {
  stage: string;
  tick?: string | null;
  startedAt?: string | null;
  elapsedMs?: number;
  estimatedRemainingMs?: number;
  progressPercent?: number;
  provider?: string | null;
  gpuType?: string | null;
  hostId?: string | null;
  message?: string | null;
  estimatedRemainingLabel?: string | null;
  estimatedRemainingLabelVi?: string | null;
  timeline?: ProvisionTimelineStep[];
  requestId?: string | null;
  machineId?: string | null;
  gpuSessionId?: string | null;
};
