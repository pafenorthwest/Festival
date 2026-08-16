# AGENTS.md

## Autonomous Coding Principles

### 1. Lock Goals Before Action

Do not plan or implement until goals, constraints, and success criteria are explicit and locked.
Do not reinterpret or expand locked goals.

### 2. Respect Stage Gates

Treat the current lifecycle gate as authoritative before proceeding.
Proceed only when the current gate explicitly permits advancement; stop when it does not.

### 3. Keep Changes Minimal

Use the simplest implementation that satisfies locked goals.
Change only in-scope files and behavior.

### 4. Fail Fast and Explicitly

Use assertions for impossible states.
Handle external and recoverable failures explicitly.
Do not hide uncertainty or errors.

### 5. Verify, Then Declare Done

Completion requires passing verification or explicitly documented blockers.
Tests are mandatory when behavior is changed.

### 6. Detect Drift and Stop

If goals, scope, tests, touched surfaces, verification plans, or locked completion criteria drift, stop the active stage and emit `BLOCKED`.
Treat drift detection as a hard gate, including loop-prevention limits (`N=45m`, `M=5 cycles`, `K=2 no-evidence cycles`).
