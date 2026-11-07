# Locked goals v1

User-authorized scope: fix the race between final class capacity admission and durable checkout cart attachment, preserving soft capacity and already attached carts.

1. Create a branch from current main; pinned base: 5c8dd582d18861926956f46bc376b0345fc4855e.
2. Coordinate final admission and durable attachment with capacity changes and paid placement writes so a newly attached cart cannot cross the cutoff unnoticed.
3. Preserve soft capacity: already durably attached carts can complete payment and receive placements above capacity.
4. Add deterministic regression coverage for the attachment race, rejection cleanup, and preserved grandfathering, including PostgreSQL concurrency behavior.
5. Run the full PostgreSQL-enabled test suite, proportional static/build checks, and independent code review; fix actionable findings.
6. Commit only this task, push origin, and open a PR targeting main.

Non-goals: hard reservations, capacity policy changes, unrelated frontend csrfToken typing, benchmarks, merging or deployment.
