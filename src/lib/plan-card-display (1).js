/** Client-safe plan card display helpers (no server imports). */

const REMAINING_REGRESSION_EPSILON_HOURS = 0.02;

export function resolvePlanCardTotalHours(planInventoryTotalHours, subscriptionPackageHours) {
  if (planInventoryTotalHours != null && Number(planInventoryTotalHours) > 0) {
    return Number(planInventoryTotalHours);
  }
  if (subscriptionPackageHours != null && Number(subscriptionPackageHours) > 0) {
    return Number(subscriptionPackageHours);
  }
  return null;
}

/** Align plan card hours with billingView (M2) - same source as dashboard Goi & Gio. */
export function resolvePlanCardHours({
  inventoryHoursRemaining = null,
  inventoryHoursTotal = null,
  subscriptionPackageHours = null,
  billingView = null,
  postSessionFloorHours = null,
} = {}) {
  const inventoryTotal =
    inventoryHoursTotal != null && Number(inventoryHoursTotal) > 0
      ? Number(inventoryHoursTotal)
      : null;
  const subscriptionTotal =
    subscriptionPackageHours != null && Number(subscriptionPackageHours) > 0
      ? Number(subscriptionPackageHours)
      : null;

  const hoursTotal =
    resolvePlanCardTotalHours(inventoryTotal, subscriptionTotal) ??
    (billingView?.planCardTotalHours != null ? Number(billingView.planCardTotalHours) : null) ??
    Number(inventoryHoursTotal ?? 0);

  let hoursRemaining =
    billingView?.planCardRemainingHours != null
      ? Math.max(0, Number(billingView.planCardRemainingHours))
      : Math.max(0, Number(inventoryHoursRemaining ?? 0));

  hoursRemaining = clampPlanCardRemainingHours(hoursRemaining, postSessionFloorHours);

  return { hoursTotal, hoursRemaining };
}

export function clampPlanCardRemainingHours(value, floorHours) {
  if (value == null || !Number.isFinite(Number(value))) {
    return floorHours != null ? Number(floorHours) : 0;
  }
  const hours = Math.max(0, Number(value));
  if (floorHours == null || !Number.isFinite(Number(floorHours))) return hours;
  const floor = Number(floorHours);
  if (hours > floor + REMAINING_REGRESSION_EPSILON_HOURS) return floor;
  return hours;
}

export function resolvePlanCardValidUntil(inventoryValidUntil, subscriptionExpiresAt) {
  if (subscriptionExpiresAt) return subscriptionExpiresAt;
  return inventoryValidUntil ?? null;
}
