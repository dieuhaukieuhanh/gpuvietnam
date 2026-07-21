import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";

import {
  RETRY_ERROR_CATEGORY,
  classifyRetryError,
  decideRetryPolicy,
  computeBackoffMs,
  applyJitter,
  registerRetryPolicyHook,
  clearRetryPolicyHooksForTests,
  ensureDefaultRetryPolicyHooks,
  getRetryPolicyMetrics,
  resetRetryPolicyMetrics,
  shouldRetrySameHost,
  shouldRetryAnotherHost,
} from "./index.js";
import { resetDefaultRetryPolicyHooksFlagForTests } from "./retry-policy-defaults.js";

describe("provider-retry-policy", () => {
  beforeEach(() => {
    clearRetryPolicyHooksForTests();
    resetDefaultRetryPolicyHooksFlagForTests();
    ensureDefaultRetryPolicyHooks();
    resetRetryPolicyMetrics();
  });

  afterEach(() => {
    clearRetryPolicyHooksForTests();
    resetRetryPolicyMetrics();
  });

  it("classifies canonical categories", () => {
    assert.equal(classifyRetryError("currency-not-allowed code 6"), RETRY_ERROR_CATEGORY.CURRENCY);
    assert.equal(classifyRetryError("429 rate limit"), RETRY_ERROR_CATEGORY.RATE_LIMIT);
    assert.equal(classifyRetryError("ETIMEDOUT"), RETRY_ERROR_CATEGORY.TIMEOUT);
    assert.equal(classifyRetryError("ECONNRESET"), RETRY_ERROR_CATEGORY.NETWORK);
    assert.equal(classifyRetryError("failed to pull image"), RETRY_ERROR_CATEGORY.IMAGE_PULL);
    assert.equal(classifyRetryError("ComfyUI never healthy"), RETRY_ERROR_CATEGORY.HEALTH);
    assert.equal(classifyRetryError("no mapped port endpoint"), RETRY_ERROR_CATEGORY.ENDPOINT);
    assert.equal(classifyRetryError("no_such_ask already rented"), RETRY_ERROR_CATEGORY.NO_CAPACITY);
    assert.equal(classifyRetryError("invalid api key"), RETRY_ERROR_CATEGORY.AUTH);
    assert.equal(classifyRetryError("unsupported gpu line"), RETRY_ERROR_CATEGORY.VALIDATION);
    assert.equal(classifyRetryError("code 1 database error"), RETRY_ERROR_CATEGORY.PROVIDER_INTERNAL);
  });

  it("currency refreshes capability cache and switches host", () => {
    const d = decideRetryPolicy({
      provider: "clore",
      operation: "rent",
      error: new Error("currency-not-allowed"),
      retryCount: 0,
      rng: () => 0.5,
    });
    assert.equal(d.category, RETRY_ERROR_CATEGORY.CURRENCY);
    assert.equal(d.retrySameHost, false);
    assert.equal(d.retryAnotherHost, true);
    assert.equal(d.refreshCapabilityCache, true);
    assert.equal(d.failImmediately, false);
  });

  it("rate limit uses exponential backoff and same-host retry", () => {
    const d = decideRetryPolicy({
      provider: "clore",
      operation: "create_order",
      error: new Error("429 rate limit"),
      retryCount: 0,
      rng: () => 0.5,
    });
    assert.equal(d.category, RETRY_ERROR_CATEGORY.RATE_LIMIT);
    assert.ok(shouldRetrySameHost(d));
    assert.ok(d.waitDurationMs >= 5500);
  });

  it("provider internal switches host immediately (no same-host burn)", () => {
    const first = decideRetryPolicy({
      provider: "clore",
      operation: "create_order",
      error: new Error("code 1 database error"),
      retryCount: 0,
      rng: () => 0.5,
    });
    assert.equal(first.category, RETRY_ERROR_CATEGORY.PROVIDER_INTERNAL);
    assert.equal(shouldRetrySameHost(first), false);
    assert.ok(shouldRetryAnotherHost(first));
    assert.equal(first.blacklistHost, true);
    assert.equal(first.waitDurationMs, 0);

    const rent = decideRetryPolicy({
      provider: "clore",
      operation: "rent",
      error: new Error("Clore.ai 500 (code 1): Internal Server Error"),
      retryCount: 0,
      rng: () => 0.5,
    });
    assert.equal(shouldRetrySameHost(rent), false);
    assert.ok(shouldRetryAnotherHost(rent));
    assert.equal(rent.blacklistHost, true);
  });

  it("auth and validation fail immediately", () => {
    const auth = decideRetryPolicy({
      provider: "vast",
      operation: "rent",
      error: new Error("unauthorized invalid api key"),
      retryCount: 0,
    });
    assert.equal(auth.failImmediately, true);
    assert.equal(auth.retry, false);

    const validation = decideRetryPolicy({
      provider: "vast",
      operation: "rent",
      error: new Error("unsupported gpu line"),
      retryCount: 0,
    });
    assert.equal(validation.failImmediately, true);
  });

  it("image pull blacklists and switches host", () => {
    const d = decideRetryPolicy({
      provider: "vast",
      operation: "rent",
      error: new Error("failed to pull image"),
      retryCount: 0,
    });
    assert.equal(d.blacklistHost, true);
    assert.ok(shouldRetryAnotherHost(d));
  });

  it("unknown allows one retry then fails", () => {
    const first = decideRetryPolicy({
      provider: "clore",
      operation: "rent",
      error: new Error("weird glitch"),
      retryCount: 0,
    });
    assert.ok(first.retry);

    const second = decideRetryPolicy({
      provider: "clore",
      operation: "rent",
      error: new Error("weird glitch"),
      retryCount: 1,
    });
    assert.equal(second.retry, false);
  });

  it("backoff exponential and jitter", () => {
    assert.equal(computeBackoffMs({ strategy: "immediate", baseMs: 1000 }), 0);
    assert.equal(computeBackoffMs({ strategy: "fixed", baseMs: 3000, maxMs: 10000 }), 3000);
    assert.equal(
      computeBackoffMs({ strategy: "exponential", baseMs: 2000, retryCount: 0, maxMs: 30000 }),
      2000,
    );
    assert.equal(
      computeBackoffMs({ strategy: "exponential", baseMs: 2000, retryCount: 2, maxMs: 30000 }),
      8000,
    );
    const jittered = applyJitter(1000, 0.2, () => 1);
    assert.equal(jittered, 1200);
  });

  it("provider hooks can override wait", () => {
    clearRetryPolicyHooksForTests();
    registerRetryPolicyHook("runpod", "create", (_input, decision) => ({
      ...decision,
      waitDurationMs: 999,
    }));
    const d = decideRetryPolicy({
      provider: "runpod",
      operation: "create",
      error: new Error("429 rate limit"),
      retryCount: 0,
      rng: () => 0.5,
    });
    assert.equal(d.waitDurationMs, 999);
  });

  it("exposes metrics shape", () => {
    decideRetryPolicy({
      provider: "clore",
      operation: "rent",
      error: new Error("429"),
      retryCount: 0,
      rng: () => 0.5,
    });
    const m = getRetryPolicyMetrics();
    assert.ok(m.retryCountByCategory.RATE_LIMIT >= 1);
    assert.ok("retrySuccessRate" in m);
    assert.ok("averageRetriesPerProvision" in m);
    assert.ok("providerSwitchCount" in m);
    assert.ok("hostSwitchCount" in m);
    assert.ok("retryLatency" in m);
  });
});