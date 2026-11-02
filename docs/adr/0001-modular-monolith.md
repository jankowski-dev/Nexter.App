# ADR 0001 — Modular monolith

## Status

Accepted.

## Context

Nexter is a private, single-user finance application with several future modules: crypto accounting, swaps, passwords, tasks, notes. Microservices would add network calls, distributed transactions, deployment complexity, and operational overhead without a scaling need.

## Decision

Use a modular monolith:

- one NestJS API;
- one React SPA served by Nest in production;
- one separate worker process for background jobs;
- one PostgreSQL database;
- clear module boundaries with public `index.ts` files.

## Consequences

- Simpler deployment and debugging.
- Domain transactions remain local.
- Module boundaries must be enforced by review and dependency rules.
- A module can be extracted later if a real scaling need appears.
