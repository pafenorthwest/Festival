# AGENTS.md

## Autonomous Coding Principles

### 1. Keep Changes Minimal

Use the simplest implementation that satisfies the request.
Change only in-scope files and behavior.

### 2. Fail Fast and Explicitly

Use assertions for impossible states.
Handle external and recoverable failures explicitly.
Do not hide uncertainty or errors.

### 3. Verify, Then Declare Done

Completion requires passing verification or explicitly documented blockers.
Tests are mandatory when behavior is changed.

### 4. Detect Drift

If goals, scope, tests, touched surfaces, verification plans, or completion criteria drift, flag the change and continue with the user's latest direction.
