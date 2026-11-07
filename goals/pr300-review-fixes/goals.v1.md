# PR #300 review fixes

User-authorized scope: fix gttps comments #4 and #5, integrate #298 and address the cross-PR locking hazards in #1 and #2, test and update PR #300.

1. Order persisted checkout lines by line_index when evaluating cutoff failures.
2. Hold one in-memory capacity lock across order finalization and rollback without nested lock acquisition.
3. Integrate #298 and serialize audited in-memory configuration mutations, including live publication, under the same gate.
4. Acquire the PostgreSQL capacity advisory lock before the audited update's row lock.
5. Add deterministic concurrency regressions, run relevant PostgreSQL-enabled tests and static checks, independently review, commit and push the existing PR branch, and update its description.

Non-goals: capacity policy changes, frontend fixes, deployment, or merging either PR into main.
