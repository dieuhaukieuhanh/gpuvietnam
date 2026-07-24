import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canWalkToNextHostAfterCancel,
  cancelOrphanBeforeNextHost,
  walkRentCandidates,
} from "./rent-candidate-walk.js";

describe("cancelOrphanBeforeNextHost", () => {
  it("invokes cancelOrphan and does not throw when cancel fails", async () => {
    let called = 0;
    const result = await cancelOrphanBeforeNextHost({
      providerId: "test",
      offerId: "1",
      cancelOrphan: async () => {
        called += 1;
        throw new Error("cancel boom");
      },
      log: () => {},
    });
    assert.equal(called, 1);
    assert.equal(result.cancelled, false);
    assert.equal(canWalkToNextHostAfterCancel(result), false);
  });
});

describe("walkRentCandidates", () => {
  it("requires cancelOrphan", async () => {
    await assert.rejects(
      () =>
        walkRentCandidates({
          providerId: "test",
          candidates: [{ id: 1 }],
          getOfferId: (c) => c.id,
          rentOne: async () => ({ ok: true }),
          afterFailure: () => "continue",
        }),
      /requires cancelOrphan/,
    );
  });

  it("cancels orphan before trying the next host", async () => {
    const cancelled = [];
    const rented = [];
    const walked = await walkRentCandidates({
      providerId: "test",
      sourceLabel: "initial",
      candidates: [{ id: "a" }, { id: "b" }],
      getOfferId: (c) => c.id,
      rentOne: async (_c, offerId) => {
        rented.push(offerId);
        if (offerId === "a") throw new Error("rent a failed after create");
        return { id: offerId };
      },
      cancelOrphan: async (_c, offerId) => {
        cancelled.push(offerId);
      },
      afterFailure: () => "continue",
      log: () => {},
    });

    assert.deepEqual(rented, ["a", "b"]);
    assert.deepEqual(cancelled, ["a"]);
    assert.equal(walked.result?.id, "b");
  });

  it("does not walk further when afterFailure returns throw", async () => {
    const rented = [];
    await assert.rejects(
      () =>
        walkRentCandidates({
          providerId: "test",
          candidates: [{ id: "a" }, { id: "b" }],
          getOfferId: (c) => c.id,
          rentOne: async (_c, offerId) => {
            rented.push(offerId);
            throw new Error("auth");
          },
          cancelOrphan: async () => {},
          afterFailure: () => "throw",
          log: () => {},
        }),
      /auth/,
    );
    assert.deepEqual(rented, ["a"]);
  });

  it("refuses second rent when orphan cancel fails", async () => {
    const rented = [];
    const walked = await walkRentCandidates({
      providerId: "test",
      sourceLabel: "initial",
      candidates: [{ id: "a" }, { id: "b" }],
      getOfferId: (c) => c.id,
      rentOne: async (_c, offerId) => {
        rented.push(offerId);
        throw new Error("rent failed after create");
      },
      cancelOrphan: async () => {
        throw new Error("cancel boom");
      },
      afterFailure: () => "continue",
      log: () => {},
    });

    assert.deepEqual(rented, ["a"], "must not rent host b while orphan may still be live");
    assert.equal(walked.result, null);
    assert.match(String(walked.lastError?.message ?? ""), /rent failed after create/);
  });
});