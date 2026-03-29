# Prompt: self-improve-skills-triage

Use this prompt when triaging child issues created through `codex/prompts/self-improve-skills.md`.

## Purpose

Normalize incident metadata, preserve cross-repository provenance, identify repeated signatures, and escalate repeated problems into parent issues only when evidence is strong enough.

## Inputs

- child issue in `ericpassmore/prompts`
- reporter-provided evidence bundle
- linked repository/task artifacts when present

## Triage Responsibilities

For each new child issue:

1. confirm the primary incident category
2. normalize severity
3. extract a short signature
4. preserve source repository, task, and skill/stage provenance
5. decide whether the issue is:
   - a standalone confirmed defect
   - a child issue for later clustering
   - an immediate blocker needing direct change work

## Severity Guide

- `high`: blocks progress, creates drift risk, or breaks a core lifecycle path
- `medium`: causes material rework or recurring workflow cost but has a safe workaround
- `low`: minor friction with limited downstream effect

## Signature Model

A clustering signature should include:

- skill or stage
- incident category
- stable failure or friction summary
- optional script/template identifier when relevant

Prefer narrow signatures. Do not cluster unrelated issues just because they happen in the same stage.

## Provenance Rules

Every child issue must retain:

- source repository
- originating task name, if present
- skill or stage
- direct link or path to supporting artifacts when available

Parent issues must link back to all child issues. They do not replace them.

## Parent Issue Threshold

Create or update a parent issue when either condition is true:

- at least 3 related child issues occur within 30 days
- the same signature appears in at least 2 repositories

If evidence is below threshold, keep the issue as a child issue and record the current signature.

## Parent Issue Shape

A parent issue should contain:

- signature summary
- linked child issues
- repositories affected
- why the cluster is actionable now
- likely affected skills, scripts, prompts, or rules
- expected reduction signal after remediation

## Routing To Change Work

Escalate from issue to proposed change when:

- a child issue is a confirmed defect with a bounded fix, or
- a parent issue has crossed the action threshold and the remediation surface is clear

The proposed change should name:

- the triggering child issue or parent issue
- the target surface to change
- the expected validation signal

## Validation And Rollout Expectations

Before considering the loop closed:

- the implemented change must point back to the issue evidence
- verification must be recorded
- rollout notes must describe the expected reduction signal

## Guardrails

- Do not force reporters to provide triage-only metadata during initial filing.
- Do not weaken the parent threshold just to reduce backlog size.
- Do not collapse multiple different failure patterns into one parent issue.
