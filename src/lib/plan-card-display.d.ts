export const BILLING_PACKAGE_LABELS: {
  hourly: string;
  combo1: string;
  combo2: string;
  gift: string;
};

export const PURCHASE_BILLING_MODES: readonly ['hourly', 'combo1', 'combo2'];

export function resolvePlanCardTotalHours(
  planInventoryTotalHours?: number | null,
  subscriptionPackageHours?: number | null,
): number | null;

export function resolvePlanCardHours(options?: {
  inventoryHoursRemaining?: number | null;
  inventoryHoursTotal?: number | null;
  subscriptionPackageHours?: number | null;
  billingView?: {
    planCardRemainingHours?: number | null;
    planCardTotalHours?: number | null;
  } | null;
}): { hoursTotal: number; hoursRemaining: number };

export function clampPlanCardRemainingHours(value?: number | null): number;

export function resolvePlanCardValidUntil(
  inventoryValidUntil?: string | null,
  subscriptionExpiresAt?: string | null,
): string | null;

export function resolveInventoryBillingMode(plan: {
  billing?: string | null;
  planType?: string;
}): 'hourly' | 'combo1' | 'combo2' | 'gift';

export function daysUntilExpiry(validUntil: string | null | undefined): number | null;

export function formatPackageRemainingLine(
  hoursRemaining: number,
  validUntil: string | null | undefined,
): string;

export function treeBranchPrefix(index: number, total: number): string;

export function formatPurchasePackageLine(hoursLabel: string, validityDays: number | null): string;

export function comparePlansByExpiry(
  a: { validUntil?: string | null; id?: number },
  b: { validUntil?: string | null; id?: number },
): number;

export function comparePlansByBurnOrder(
  a: { validUntil?: string | null; id?: number },
  b: { validUntil?: string | null; id?: number },
): number;

export function getTierPurchaseBillingOptions(tierKey: string): Array<{
  billing: string;
  label: string;
  detail: string;
  validitySuffix: string;
  unitPrice: number;
  unitPriceLabel: string;
  packagePrice: number;
  packagePriceLabel: string;
}>;

export function groupInventoryPlansByTier<T extends { planName: string; id?: number }>(
  items: T[] | null | undefined,
): { starter: T[]; pro: T[]; studio: T[] };

export function resolveActiveTierKey<T extends { planName: string; isActive?: boolean; usable?: boolean }>(
  grouped: { starter: T[]; pro: T[]; studio: T[] },
  activePlan: { planName?: string } | null | undefined,
): 'starter' | 'pro' | 'studio' | null;

export function pickTierActivationTarget<T extends { usable?: boolean; isActive?: boolean }>(
  tierPlans: T[] | null | undefined,
): T | null;

export const PLAN_ORDER: readonly ['starter', 'pro', 'studio'];

export function getPlanNameFromKey(key: string): string;
