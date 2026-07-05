# GPUVietnam Engineering Constitution
Version: 1.0
Architecture Baseline: SCB Architecture Freeze v3.2

---

# Mission

The goal is NOT simply to make the code work.

The goal is to continuously improve GPUVietnam while preserving:

- Architecture consistency
- Single Source of Truth
- Idempotency
- Rollback safety
- Projection-first design
- Long-term maintainability

Every change must leave the architecture equal or better than before.

---

# Core Philosophy

## 1. Single Source of Truth (SSOT)

Every piece of business truth must exist in exactly one place.

Never duplicate business logic.

Never duplicate endpoint generation.

Never duplicate state computation.

If identical logic already exists, reuse it.

---

## 2. Canonical Flow

There must be only one official path.

Never introduce parallel implementations.

Example:

GOOD

Start
→ Provision
→ Persist
→ Projection
→ Consumer

BAD

Start A
Start B
Start C

---

## 3. Projection First

Consumers never talk directly to providers.

Consumer

↓

Projection

↓

Provider

NOT

Consumer

↓

Provider

Projection is the only read model.

---

## 4. State Before Action

Never execute behavior from assumptions.

Behavior must always depend on explicit state.

Example:

BAD

if(port)
    fetch metrics

GOOD

if(isEndpointReadyForTraffic(machine))
    fetch metrics

---

## 5. Explicit Readiness

Never infer readiness.

Never guess readiness.

Never synthesize readiness.

Readiness must have explicit rules.

Example

EndpointReady =
EndpointResolved
AND
HealthOK

---

## 6. Consumers Never Synthesize Truth

Consumers never build:

http://IP:PORT

Consumers never use:

port ?? DEFAULT_GPU_PORT

Consumers never reconstruct endpoints.

Consumers consume canonical values only.

---

## 7. One Responsibility Per Layer

Provider

↓

Raw data

Projection

↓

Synchronization

Read Path

↓

Read model

Consumer

↓

Presentation

Billing

↓

Accounting

Destroy

↓

Cleanup

Never mix responsibilities.

---

## 8. Idempotency

Running the same operation multiple times must produce the same result.

Retries must be safe.

Queue retries must never duplicate effects.

---

## 9. Rollback Safety

Failures must leave no orphan resources.

Provision failure

↓

Rollback

Database failure

↓

Rollback

Destroy failure

↓

Retry

Never leave inconsistent state.

---

## 10. Eventual Consistency

Temporary delay is acceptable.

Incorrect state is NOT.

Eventually every consumer must observe the same truth.

---

# Technical Rules

## NEVER

- Duplicate business logic
- Duplicate endpoint builders
- Duplicate state mapping
- Introduce hidden side effects
- Introduce fallback behavior
- Add temporary hacks
- Add silent assumptions
- Add technical debt

---

## ALWAYS

Prefer:

shared utility

instead of

duplicated code

Prefer:

canonical helper

instead of

local implementation

Prefer:

projection

instead of

provider reads

Prefer:

explicit state

instead of

implicit behavior

---

# Before Writing Code

Always answer these questions.

1.

What is the Single Source of Truth?

2.

Is this logic already implemented somewhere?

3.

Am I introducing duplicated logic?

4.

Does this preserve canonical flow?

5.

Does this preserve projection-first?

6.

Can retries safely happen?

7.

Can rollback safely happen?

8.

Will this introduce technical debt?

If any answer is uncertain,

STOP

and explain before coding.

---

# Bug Fix Rules

When fixing a bug:

DO NOT

rewrite architecture.

DO NOT

refactor unrelated files.

DO NOT

change behavior outside bug scope.

Fix only the root cause.

Then run

npm test

npm run build

Report

- Root cause
- Files changed
- Behavior changes
- Regression risks
- Test results
- Build results

---

# Feature Development Rules

When implementing new features:

Step 1

Understand architecture.

Step 2

Find canonical extension point.

Step 3

Reuse existing abstractions.

Step 4

Implement minimal change.

Step 5

Verify architecture is preserved.

Never redesign architecture unless explicitly requested.

---

# Refactoring Rules

Refactoring is NOT allowed unless explicitly requested.

If architecture improvement is discovered:

DO NOT implement immediately.

Instead propose

Architecture vNext

including

- Motivation
- Benefits
- Risks
- Migration plan

Implementation only begins after approval.

---

# Architecture Freeze

Current baseline

SCB Architecture Freeze v3.2

Protected contracts include

- Projection-first read path
- EndpointReady gate
- buildConsumerEndpoint()
- isEndpointReadyForTraffic()
- Rollback invariants
- Billing invariants
- Destroy pipeline
- Canonical endpoint generation

Any change affecting these contracts requires a new Architecture proposal before coding.

---

# Definition of Done

A task is complete only if:

✓ Architecture preserved

✓ No duplicated logic

✓ No technical debt introduced

✓ Canonical flow maintained

✓ npm test passes

✓ npm run build passes

✓ Regression risks documented

Only then is the implementation considered complete.

---

# Guiding Principle

Correct architecture is more valuable than clever code.

Simple, canonical, maintainable systems always win over complex optimizations.

Protect the architecture first.

Everything else is secondary.