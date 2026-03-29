# Prompt: self-improve-skills

Use this prompt when an agent notices that a centralized skill, supporting script, template, or lifecycle workflow caused rework, a workaround, a poor-fit invocation, or repeated friction.

## Purpose

Capture concrete incidents quickly in `ericpassmore/prompts`, preserve enough evidence for later triage, and route repeated problems into validated skill improvements.

## First-rollout assets

- Reporter workflow: `codex/prompts/self-improve-skills.md`
- Triage workflow: `codex/prompts/self-improve-skills-triage.md`
- GitHub CLI rule surface: `codex/rules/git-safe.rules`

## Hard rule

Every concrete skill or workflow incident starts with a child GitHub issue in `ericpassmore/prompts`.

Do not wait for batch analysis when the issue is already observable.

## Active stage reminder

When the incident is discovered during an active lifecycle stage, file the child issue before continuing whenever it is safe to do so.

If continuing would hide the failure, weaken verification, or create drift risk, stop and treat the incident as blocking.

## File Immediately

Create an issue as soon as any of these are noticed:

- obvious bug in a skill, script, validator, or template
- confirmed defect with a reproducible failure or clearly broken behavior
- repeated bash script runs caused by the skill or process
- repeated permission escalations for the same command
- blocked progress caused by lack of access without actionable resolution steps
- poor-fit skill invocation, including a skill being used for work it should reject
- repeated low-value workflow friction that an agent had to work around

## Fast Path For Obvious Bugs

Use the fast path when the failure is obvious or already confirmed:

1. Create the child issue immediately.
2. Include a minimal repro and severity.
3. Continue work only if the workaround is safe, bounded, and does not hide the failure.
4. If the workaround changes behavior or creates drift risk, stop and treat the incident as blocking.

## Minimum Evidence Bundle

Every child issue must include:

- source repository
- task name, if present
- skill name or lifecycle stage
- incident type
- short repro or direct observation
- user-visible or workflow-visible impact
- whether work can continue safely
- links or paths to relevant task artifacts when available

Keep the bundle short. Triage adds enrichment later.

## Suggested Child Issue Shape

Use a title in this pattern:

`<skill-or-stage>: <incident summary>`

Use a body with these fields:

```md
## Incident
- Source repo:
- Task:
- Skill or stage:
- Incident type:
- Severity:

## Observation
- What happened:
- Expected:
- Can work continue safely:

## Evidence
- Repro or minimal steps:
- Relevant files/artifacts:
- Workaround used (if any):
```

## GitHub CLI Path

When using the GitHub CLI, use the central repository explicitly:

```bash
./codex/scripts/gh-wrap.sh issue create --repo ericpassmore/prompts --title "<skill-or-stage>: <incident summary>" --body-file <body-file>
```

The allowed CLI path is intentionally narrow. Do not broaden it to unrelated repositories or GitHub operations. If wrapper auth fails on create, the user may be prompted to run `./codex/scripts/gh-auth-check.sh --repo ericpassmore/prompts`, but the diagnostic must never be run automatically.

## Incident Categories

Use one primary category per child issue:

- `bug`
- `friction`
- `access-block`
- `permission-escalation`
- `repeat-run`
- `poor-fit`

## Issue-To-Change Loop

After child issue creation:

1. Triage normalizes labels, signature, and severity.
2. Repeated child issues are clustered under a parent issue when threshold evidence exists.
3. Confirmed defects or actionable parent issues move into a proposed skill change.
4. The change is validated against the issue pattern it is meant to reduce.
5. Rollout records the expected reduction signal and any follow-up checks.

## Improvement Metrics

Primary metrics:

- reduction in goals modified after implementation starts
- reduction in post-lock goal drift
- reduction in repeated tasks with materially similar goals

Secondary metric:

- reduced time from goals locked to GitHub pull request creation

## Guardrails

- Do not require heavyweight telemetry before filing child issues.
- Do not add skill rejection logic before the poor-fit pattern is captured as evidence.
- Do not replace child issues with a parent issue. Parent issues aggregate them.
