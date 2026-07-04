# GPUVIETNAM SCB Documentation

Status: Active

This directory contains the authoritative documentation for the SCB
(Session Control & Billing) architecture.

Before making ANY code changes, read the documents in the following order.

---

# Reading Order

1. SCB_ARCHITECTURE.md

Defines the architecture, domain model, invariants and system rules.

---

2. SCB_IMPLEMENTATION_ROADMAP.md

Defines implementation phases and build order.

---

3. SCB_WORKLOG.md

Current project status.

Read this first before continuing development.

---

4. SCB_DECISIONS.md

Architecture Decision Records (ADR).

Explains WHY important decisions were made.

---

5. SCB_CHANGELOG.md

Historical changes.

Useful when debugging regressions.

---

6. SCB_TEST_PLAN.md

Regression and production test checklist.

---

# Rules

The documentation is the authoritative source.

If implementation conflicts with documentation:

Documentation wins.

---

# Development Principles

- Single Source of Truth
- Domain First
- Thin API
- Immutable Session
- Projection Is Disposable
- Provider Independent

---

# Forbidden

Do NOT:

- Introduce duplicate lifecycle.
- Introduce duplicate billing logic.
- Introduce hidden business rules.
- Put business logic into API routes.
- Treat projection as source of truth.

---

# Current Status

See:

SCB_WORKLOG.md