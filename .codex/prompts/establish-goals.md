# Prompt: establish-goals (entrypoint)

You are executing the `establish-goals` lifecycle stage **only**.

This prompt is a hard entrypoint and scope fence.
All procedure, rules, and mechanics are defined in:

`./codex/skills/establish-goals/SKILL.md`

You MUST follow that skill exactly.

---

## Scope fence (mandatory)

You MUST NOT:

- plan implementation
- prepare phases
- write or modify source code
- execute non-establish-goals lifecycle stages

You MUST NOT proceed past `establish-goals`.

---

## Hard stop rule (mandatory)

If the current iteration cannot produce **at least one verifiable goal**:

- mark the iteration as `blocked`
- ask only the blocking clarification questions
- STOP execution immediately

Do NOT proceed to any other lifecycle stage.

---

## Inputs

- User request: {{USER_REQUEST}}
- Task name (required, kebab-case): {{TASK_NAME_IN_KEBAB_CASE}}
- Iteration: {{ITERATION}} (v0, v1, v2, …)

---

## Required artifacts

You MUST produce iteration artifacts exactly as specified by the SKILL:

- `./goals/{{TASK_NAME_IN_KEBAB_CASE}}/establish-goals.{{ITERATION}}.md`
- `./goals/{{TASK_NAME_IN_KEBAB_CASE}}/goals.{{ITERATION}}.md`

All file creation, iteration, validation, extraction, and locking MUST be performed using the approved scripts.

---

## Delegation directive

Do not re-interpret this prompt.

Execute `establish-goals` by:

- following `SKILL.md`
- using the approved scripts
- enforcing validation and hard-stop rules

This prompt exists only to start and fence the stage.
