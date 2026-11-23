# Festival scheduling specification

**Status:** Scheduling setup UI specified; ProClass export contract pending
**Version:** 0.14 — November 17, 2026
**Audience:** Festival operations, product, frontend, backend, QA

## 1. Purpose and scope

The Festival App shall let authorized staff configure a festival schedule, validate its inputs, generate a complete schedule for confirmed entries, retain immutable versions, publish one active version, and export the published version as JSON or XML for the intended ProClass integration. Failed runs report entries that could not be scheduled. This specification covers room and adjudicator blocks, class timing, section and placement-group construction, student and accompanist placement, version review, and export. It does not change registration checkout, payment, or waitlist promotion.

The current app has festival classes, registrations, child and accompanist availability, and rooms, but no student scheduling model. Existing room records do not supply room/day time windows. Scheduling therefore needs its own festival-scoped configuration and stored output. Registration alone configures and enforces each class's capacity and offers a separate waitlist path when full. The scheduler receives only the confirmed roster; it has no cap or waitlist input and never rechecks the registration limit.

This document uses the user's explicit requirements and follow-up answers as the new policy. The attached PafeScheduler.docx and Student Selection.docx describe legacy behavior; the pasted email thread is historical context. A legacy detail is adopted below only where it is identified as a default or where the new request confirms it.

## 2. Terms and units

| Term | Meaning |
| --- | --- |
| Class code | One configured catalog class, such as PC.12-13, used to select scheduling timing and section rules. |
| Scheduling entry | One solo or concerto registration, or one ensemble entry represented by its primary participant. Additional ensemble participants stay linked to that entry and add no separate playing or oral time. An ensemble gets the age-12 priority if any participant is at least 12. |
| Section | A dated, timed sequence of entries for one class code, with an adjudicator and room. |
| Placement group | One or more related sections with the same adjudicator, after which that adjudicator completes placement forms. |
| Available day | A festival date with at least one nonempty effective availability time block for that person, including the app's default 8 a.m.–5 p.m. hours on an unsaved date. |
| Held entry | A confirmed entry that cannot form a section of the configured minimum size for its class code. It appears in a failed-run diagnostic, not in a successful schedule version. This is distinct from a waitlist entry. |
| Version | An immutable snapshot of inputs, settings, assignments, and diagnostics produced by a successful generation run. |

All times use the festival's configured IANA time zone. Store timestamps unambiguously and calculate durations in seconds, so the 1.5-minute transition is exact. Display times in local festival time. Age means the existing festival registration-age snapshot, not age on the scheduling run date.

## 3. Scheduling policy

### 3.1 Named invariants

1. **Concerto deadline.** Every confirmed scheduling entry for PC.12-13, PC.14-15, PC.16-17, SC.12-13, SC.14-15, SC.16-17, CC.12-13, CC.14-15, CC.16-17, and WC.14-17 must be placed in a section that finishes by the end of Wednesday in the applicable festival week. The deadline is evaluated on the end of the entry's section in festival local time. A run that cannot satisfy this invariant fails before a version is created.
2. **Conditional availability.** For each student, including each additional ensemble participant, and each accompanist independently, count their available festival dates using effective hours: saved blocks where present and the app's default 8 a.m.–5 p.m. blocks on unsaved dates. If the count is **three or more**, the student's whole section and the accompanist's performance interval must fit within their respective time blocks. If the count is **fewer than three**, their stated availability does not constrain placement. The input review shows the count, saved/default provenance, and resulting rule. A run that cannot satisfy a required availability window fails before a version is created.

### 3.2 Other hard validity rules

- A room, adjudicator, student, or accompanist cannot be assigned to simultaneous appearances. Every confirmed entry must be assigned exactly once in a successful version. The whole ensemble moves together; availability and conflicts are checked for every additional participant as well as the primary.
- A performance by an accompanist must start at least the configured accompanist gap after that accompanist's previous performance ends, including performances in the same section. This setting is separate from the between-class transition/form interval and initially equals **7 minutes**.
- Each assigned section must fit its configured room/adjudicator block and room compatibility requirements. An adjudicator-day may use at most **440 minutes** of scheduling time, including sections and the configured shared transition/form intervals. On a full day, a 30-minute lunch starting within the configured lunch window and one 10-minute break before and after lunch occupy real room/adjudicator time; on a half day, one 10-minute break does. These intervals are **outside** the 440-minute budget.
- Each class code has configured minimum and maximum section sizes, with defaults based on its Playing minutes: **3–5 entries** below 8 minutes, **2–4 entries** from 8 through 10 minutes inclusive, and **2–3 entries** above 10 minutes. Staff may override the pair for an individual class code; validation requires positive whole numbers with minimum no greater than maximum. Changing Playing minutes recomputes limits that still use defaults, while preserving explicit overrides. Entries that cannot form a section meeting the configured minimum are held in the failed-run report; any such entry blocks version creation. An ensemble counts as one entry.
- A Concerto placement group may span Tuesday and Wednesday only when staff enables a per-class-code split in configuration. Both segments use the group's adjudicator, must each fit their room/adjudicator windows and 440-minute day budget, and all sections must finish by Wednesday. The group remains one logical group; placement-form time occurs once, after its final Wednesday segment.
- No successful version may contain unresolved hard-rule conflicts. A failed run returns structured, actionable diagnostics without creating a version.

The first two rules are the specifically named scheduling invariants from the request. The remaining rules protect schedule validity and apply the supplied configuration values. Staff cannot publish or export a version with hard-rule errors.

### 3.3 Ordered preferences

Registration's per-class cap is not a scheduling preference. The scheduling priorities are:

| Rank | Rule | Treatment |
| ---: | --- | --- |
| 1 | Prioritize students age 12 or older. | If capacity is insufficient, rank entries containing a student age 12+ ahead of younger-only entries in the failed-run diagnostic and any proposed remedial plan. An ensemble qualifies if any participant is at least 12. The run creates no version; a successful version schedules every confirmed entry. This priority does not request earlier clock times. |
| 2 | Different adjudicators for a student with multiple classes. | Prefer distinct stable adjudicator IDs across that student's scheduled non-ensemble classes. Ensemble entries do not enter this score. |
| 3 | Keep students under age 12 on one day. | Prefer one festival date across each such student's scheduled entries. |
| 4 | Diversify placement groups across teachers. | Count teachers linked to all participants, including additional ensemble participants. Prefer more distinct teachers and avoid domination by one teacher when an otherwise feasible swap exists. No minimum teacher count applies. |
| 5 | Balance the number of entries in each section. | Among schedules tied on higher ranks, minimize the total number of sections across class codes. Then make sections within each class code as even in size as possible, comparing the sum of squared deviations from each code's average section size. Each code's configured hard minimum and maximum still control every section. |

Rank 1 guides failed-run diagnostics; it does not remove confirmed entries or choose earlier clock times. The scheduler compares complete feasible schedules lexicographically on ranks 2–5. A lower-ranked preference must never break a higher-ranked one or a hard rule. Within otherwise equivalent class orders, put age bands with higher upper ages first, then higher lower ages; for identical bands, order Solo, Concerto, then Ensemble. Finish deterministic ties by class code and stable registration ID. Record preference scores and any unmet preference per version.

## 4. Frontend configuration and review

Add an authorized **Scheduling** area under the selected festival. The interface has Setup, Input review, Generate, Versions, and Export views. Every view shows festival name, dates, time zone, current configuration revision, and the active version.

### 4.1 Setup

Staff can configure and save:

- Festival dates and the Wednesday deadline date within that festival's configured week.
- Festival-scoped adjudicator records with stable IDs, names, and eligible divisions, or an explicit link to an authoritative adjudicator source. The current app has no such master record; names alone cannot support conflict checks or the distinct-adjudicator preference.
- Room/day windows whose location selects an existing festival room by ID. Each row has festival date, room, adjudicator ID, start/end, full-day or half-day designation, division or eligible class types, concerto eligibility, and any blocked intervals. Show the selected room's piano type/count from the existing room record rather than re-entering it. Multiple rows may describe separate windows in the same room/day. Show overlaps and missing adjudicator or room references.
- A unique mapping between each festival catalog class and its scheduling class code. Use one class-rules grid with class name/code, Playing minutes per entry, Oral minutes per entry, editable minimum and maximum entries per section, and placement-group exceptions. Prefill section limits from the three Playing-time bands in Section 3.2, and display whether a value is still the default or a staff override. Scheduling Playing is stored separately from the catalog's published performanceMinutes; editing it never updates that catalog field. Show the published value as read-only context and warn when it differs from Scheduling Playing. Registration capacity is edited in the existing class catalog, not in Scheduling Setup.
- Placement-group settings: by default all sections of one Concerto class code form one group within a day, while other class codes use balanced groups of no more than two sections. Staff can configure an exception per class code before generation, including a Tuesday/Wednesday Concerto split. Show estimated duration before staff enables a split; for example, 26 PC.16-17 entries require at least 689 minutes before section gaps and forms, exceeding one 440-minute day.
- One editable between-class transition/form-time value, initially seven minutes and validated as a positive whole number of minutes. It is the gap between same-day sections and the placement-form interval at the end of a placement group; when the two coincide, count it once. A final group still receives that interval for forms. A separate editable accompanist gap, initially seven minutes, is also a positive whole number of minutes. The 90-second performer transition and 440-minute adjudicator-day budget are fixed policy values shown read-only in setup.
- Lunch and long-break windows. A full day reserves a 30-minute lunch and two 10-minute long breaks, one before and one after lunch. The default lunch-start window is 11:45–12:30. A half day reserves one 10-minute long break and no lunch. Staff may configure the placement windows per festival; all intervals remain outside the 440-minute budget but must fit the room/adjudicator calendar. The UI must not hide them inside a hard-coded class factor.
- Any required room/instrument compatibility and adjudicator assignment mapping.

Inputs are versioned as a configuration revision. Editing a value creates a new revision; it never rewrites an existing schedule version. Changes to timing, section limits, dates, or room windows show a scheduling-capacity preview before saving. A user must be able to inspect the effective values for every class code.

### 4.2 Input review and readiness

Before Generate is enabled, show:

- Confirmed registrations, scheduling entries, ensemble primary/additional links, class code, student age snapshot, teacher, and accompanist.
- Student and accompanist available-day counts and time blocks, with saved/default provenance and a clear label indicating whether availability is enforced under the three-day rule.
- Per-code confirmed demand, section-size feasibility, estimated minutes, room/adjudicator windows, concerto Wednesday capacity, and adjudicator-day budget.
- Blocking errors for missing or invalid class-code mappings or timing, room/adjudicator mappings, dates, contradictory time blocks, class-code demand below its applicable section-size minimum, and impossible hard constraints. Warnings cover soft-preference tradeoffs and any confirmed registration whose repertoire total exceeds its class's separate Scheduling Playing allowance; name the registration and show both durations. This warning does not block generation or increase the scheduled duration.

The review must identify the affected class codes and registration IDs so staff can correct the source data. Waitlist enrollment and capacity checks remain entirely in registration.

## 5. Generation workflow

1. **Freeze inputs.** Read confirmed scheduling entries, ensemble links, catalog/age snapshots, teacher and accompanist IDs, availability, room/adjudicator windows, the selected rooms' piano type/count metadata, and one configuration revision in a consistent snapshot. Record source revision IDs or a content hash, including the inherited room metadata.
2. **Validate.** Apply the readiness checks to the confirmed roster. Do not start placement with blocking errors.
3. **Build candidate sections and groups.** Group entries by class code and enumerate feasible section partitions under each code's configured minimum and maximum. Do not commit to a partition yet: section count and balance are rank 5, below the judge, under-12-day, and teacher-diversity preferences. By default a Concerto class code forms one group within a day; other codes use groups of at most two sections. Include explicit per-code exceptions, including configured Tuesday/Wednesday Concerto splits. Preserve primary/additional ensemble linkage. If any confirmed entry cannot form a valid section, mark it held in the failed-run report and create no version. Do not use the legacy six-student section cap or legacy class-factor formula.
4. **Solve placement and section formation together.** Choose a candidate partition, placement groups, room/adjudicator windows, performer order, and exact start times jointly. Place concerto-deadline groups within eligible windows ending Wednesday; use a Tuesday/Wednesday split only for a class code with that exception enabled. Treat a split group as one logical group with two day segments and forms after the final segment. Satisfy enforced availability and resource conflicts using the exact timing model below. Compare complete feasible solutions by the ordered preferences in Section 3.3. A deterministic seed and algorithm version make repeated runs with identical inputs reproducible.
5. **Materialize the chosen times.** Within each section, run performances in order. Reserve each entry's Scheduling Playing minutes followed by its 90-second transition, including the final entry; writing/note time overlaps transition and is not added again. After all performances, reserve the sum of the entries' Oral minutes as one pooled oral-adjudication period. Thus each entry contributes **Scheduling Playing + Oral + 1.5 minutes** to section duration, but does not receive a contiguous oral slot. The accompanist's availability is checked against the Scheduling Playing interval, and starts must maintain the separate configured accompanist gap. Insert the configured transition/form interval between consecutive same-day sections; when a placement group ends, that same interval serves the placement form and is counted once. A Tuesday/Wednesday split has no overnight gap or Tuesday form interval. Give the last group the configured interval for forms. Additional ensemble participants share the primary performance and add zero duration. Count sections, gaps, and forms inside 440 minutes; reserve lunch and long breaks outside that budget.
6. **Validate the result again.** Recompute all hard rules from the completed assignment rather than trusting solver state. If any fail, retain a run-failure record with diagnostics and create no version. Otherwise create one immutable draft version.

The legacy workflow treated group formation, placement, section timing, and student assignment as distinct stages. This specification retains those concepts while solving partition and placement choices together under the new timing formula. Generation must not write to ProClass, change registration status, or alter waitlist records.

## 6. Versions and publication

- Each successful generation creates a new immutable draft with a monotonic version number within the festival. Store generation time, actor, algorithm version/seed, configuration revision, source snapshot identifiers/hash including selected room piano metadata, all scheduled sections and entries, preference scores, and validation report.
- Staff can compare two versions by moved entry, class/section, room, adjudicator, date/time, and preference score. They can view the input changes behind a new version.
- At most one version is active per festival; there are none before first publication. Publishing atomically changes the active-version pointer after revalidating the immutable version. The captured roster, availability, room windows, selected room piano metadata, and configuration revision must still match current source state; otherwise staff regenerate. Prior publication events remain in the audit trail, and an older version may be reselected only if it passes the same checks.
- A new generation never silently replaces the active version. A failed generation has a run report but no schedule version. Store who published which version and when.
- Publishing and export are staff-authorized operations. Export reads a specific published version, not live mutable configuration or registration state.

## 7. JSON and XML export

Both formats must represent the same published version and preserve stable identifiers, exact local date/time with time-zone context, class code, section and placement-group IDs, room and adjudicator IDs, scheduled entry/registration IDs, ensemble links, performer order, performance start/end, pooled oral period, and calculated durations. Include version ID, festival ID, generated/published timestamps, schema version, and a checksum wherever the importer contract permits. Validate that an exported file round-trips to the same canonical schedule before download.

**ProClass compatibility is pending an importer contract.** The local PAFE and ProClass projects contain ProClass XLSX *export* readers and web-form automation, but no schedule JSON/XML importer, schema, or sample. The user has elected to leave export compatibility pending that contract. The exact JSON keys, XML elements, ordering, identifiers, and import handshake must come from the importer schema/sample. Do not label a Festival-defined file “ProClass-compatible” until a fixture can be imported successfully. The Export view should show the target format and schema version; implementation acceptance requires contract tests against representative ProClass fixtures for both JSON and XML.

## 8. API and persistence contract

The backend needs festival-scoped operations to read/update configuration revisions, preview readiness, start a generation run, inspect run diagnostics, list/get/compare immutable versions, publish a version, and download a version export. Scheduling Playing and Oral values use scheduling configuration storage and endpoints, not the existing catalog-class update path; the catalog's performanceMinutes remains the published repertoire limit. Writes require the existing authorized staff role and an expected revision/version token to prevent stale updates. Long-running generation returns a run ID and progress state; retries with the same idempotency key do not create duplicate versions.

Persist configuration separately from generated schedules. A schedule version owns immutable section, placement-group, entry-order, diagnostics, and input-snapshot records. Link assignments to stable registration, child, accompanist, teacher, class, room, and adjudicator IDs; avoid depending on display names. Export only the data required by its contract and audit access to student schedule data.

## 9. Acceptance criteria

1. A staff user can configure room/adjudicator windows and all effective scheduling values, review candidate counts and validation issues, and generate a draft without changing registrations or ProClass.
2. A version containing any named invariant, section-size, room/person conflict, configured accompanist gap, or 440-minute budget violation is never created or published; a failed run names the affected entries and constraints.
3. Exactly three available festival days enforces both student and accompanist time blocks; two days does not. Unsaved days count using the existing 8 a.m.–5 p.m. default hours, and the review distinguishes default from saved blocks. The check is independent for each person.
4. All confirmed entries in listed older concerto classes end by Wednesday. A Concerto class requiring more than one 440-minute day succeeds across Tuesday/Wednesday only when its split exception is configured. Tests include a section crossing midnight or the Wednesday boundary, insufficient eligible room capacity, and a conflicting accompanist.
5. Timing tests verify sequential performances, a pooled oral period, 90-second entry transitions, no double-counted writing time, a configured section/form interval counted once where roles coincide, zero extra time for ensemble additional participants, and the specified full-day/half-day lunch and break pattern outside the 440-minute total.
6. The scheduler accepts the confirmed roster from registration without reading a registration cap or waitlist. A class code with fewer confirmed entries than its configured section minimum is held in the failed-run report and blocks version creation. Section-size tests cover defaults at playing times just below 8, exactly 8, exactly 10, and above 10 minutes, plus per-class overrides, including valid two-entry sections at and above 8 under default limits and a failed two-entry class below 8. Every successful version assigns every confirmed entry.
7. On a capacity failure, diagnostics list age-12+ entries ahead of younger-only entries without creating a version. Among complete feasible outcomes, the engine prefers distinct adjudicators across a student's non-ensemble classes, then a one-day under-12 schedule, then better teacher diversity. Only after those ranks does it prefer fewer sections and balanced section sizes: for 10 entries with a 2–4 range, it chooses three sections sized 4, 3, and 3 over five sections sized 2 each. Identical inputs, settings, and seed produce identical output.
8. Drafts remain unchanged after configuration or roster edits. Publishing makes exactly one version active, with audit history. A failed run creates no version.
9. JSON and XML exports for the same published version contain equivalent assignments and pass schema/fixture round-trip checks. ProClass compatibility acceptance remains blocked until the importer contract in Section 7 is supplied or replaced by an approved new contract.
10. If confirmed repertoire totals exceed Scheduling Playing, input review identifies the affected registrations and both values, while generation still uses Scheduling Playing. Editing Scheduling Playing leaves the catalog's performanceMinutes and existing repertoire validation unchanged.
11. A room's piano metadata is captured in the generation snapshot. Changing that metadata before publication makes the draft stale and requires regeneration; the previous piano configuration cannot silently be used for publish or export.

## 10. Source and precedence notes

- Current request and follow-up answers: new policy, timing table, versioning, cap, availability threshold, and failure behavior.
- Student Selection.docx, paragraphs 5–8 and 13–15: legacy generic-class to scheduled-section transition, ensemble-primary linkage, and later within-class transfers.
- PafeScheduler.docx, pages 1–6: legacy staged scheduling, room preparation, breaks, and ProClass handoff.
- Pasted text.txt, lines 67–69 and 294–306: historical timing model and proposals. The new Playing + Oral + transition formula supersedes the legacy G/H/I factor; the proposed class startup time has no adopted value.
- Festival repository: catalog and registration models in packages/common/src/catalog.ts and registration.ts; availability in packages/common/src/availability.ts; rooms in packages/common/src/tenant.ts. The existing registration UI spec keeps waitlist records separate.

## 11. Open decisions

1. Provide the existing ProClass JSON/XML importer schema, sample files, or source path. Until then the exact external contract and its acceptance test remain pending.

## Appendix A. Initial class timing configuration

Scheduling Playing and Oral are minutes per scheduling entry. Additional ensemble participant rows have zero values because they share the primary ensemble entry's scheduled performance. These editable scheduling values remain separate from the published class catalog and do not change its performanceMinutes field.

| Code | Class | Playing | Oral |
| --- | --- | ---: | ---: |
| PS.6-7 | Piano Solo 6–7 | 5 | 6 |
| PS.8-9 | Piano Solo 8–9 | 6 | 6 |
| PS.10-11 | Piano Solo 10–11 | 8 | 6 |
| PS.12-13 | Piano Solo 12–13 | 10 | 7 |
| PS.14-15 | Piano Solo 14–15 | 10 | 7 |
| PS.16-17 | Piano Solo 16–17 | 12 | 7 |
| PC.6-7 | Piano Concerto 6–7 | 8 | 8 |
| PC.8-9 | Piano Concerto 8–9 | 8 | 8 |
| PC.10-11 | Piano Concerto 10–11 | 10 | 9 |
| PC.12-13 | Piano Concerto 12–13 | 12 | 9 |
| PC.14-15 | Piano Concerto 14–15 | 15 | 10 |
| PC.16-17 | Piano Concerto 16–17 | 15 | 10 |
| PEP.6-9 | Piano Ensemble 6–9, primary | 6 | 6 |
| PEA.6-9 | Piano Ensemble 6–9, additional | 0 | 0 |
| PEP.10-13 | Piano Ensemble 10–13, primary | 8 | 6 |
| PEA.10-13 | Piano Ensemble 10–13, additional | 0 | 0 |
| PEP.14-17 | Piano Ensemble 14–17, primary | 10 | 7 |
| PEA.14-17 | Piano Ensemble 14–17, additional | 0 | 0 |
| SS.8-9 | Violin-Viola Solo 8–9 | 5 | 6 |
| SS.10-11 | Violin-Viola Solo 10–11 | 6 | 6 |
| SS.12-13 | Violin-Viola Solo 12–13 | 8 | 6 |
| SS.14-15 | Violin-Viola Solo 14–15 | 10 | 7 |
| SS.16-17 | Violin-Viola Solo 16–17 | 10 | 7 |
| SC.8-9 | Violin-Viola Concerto 8–9 | 8 | 8 |
| SC.10-11 | Violin-Viola Concerto 10–11 | 8 | 8 |
| SC.12-13 | Violin-Viola Concerto 12–13 | 10 | 9 |
| SC.14-15 | Violin-Viola Concerto 14–15 | 15 | 10 |
| SC.16-17 | Violin-Viola Concerto 16–17 | 15 | 10 |
| SEP.8-13 | String Ensemble 8–13, primary | 8 | 6 |
| SEA.8-13 | String Ensemble 8–13, additional | 0 | 0 |
| SEP.14-17 | String Ensemble 14–17, primary | 12 | 7 |
| SEA.14-17 | String Ensemble 14–17, additional | 0 | 0 |
| WS.9-11 | Woodwind Solo 9–11 | 6 | 6 |
| WS.12-13 | Woodwind Solo 12–13 | 8 | 6 |
| WS.14-15 | Woodwind Solo 14–15 | 10 | 7 |
| WS.16-17 | Woodwind Solo 16–17 | 10 | 7 |
| WC.9-11 | Woodwind Concerto 9–11 | 8 | 8 |
| WC.12-13 | Woodwind Concerto 12–13 | 8 | 8 |
| WC.14-17 | Woodwind Concerto 14–17 | 12 | 9 |
| WEP.9-13 | Woodwind or Mixed Ensemble 9–13, primary | 8 | 6 |
| WEA.9-13 | Woodwind or Mixed Ensemble 9–13, additional | 0 | 0 |
| WEP.14-17 | Woodwind or Mixed Ensemble 14–17, primary | 10 | 7 |
| WEA.14-17 | Woodwind or Mixed Ensemble 14–17, additional | 0 | 0 |
| CS.8-9 | Cello-Bass Solo 8–9 | 5 | 6 |
| CS.10-11 | Cello-Bass Solo 10–11 | 6 | 6 |
| CS.12-13 | Cello-Bass Solo 12–13 | 8 | 6 |
| CS.14-15 | Cello-Bass Solo 14–15 | 8 | 7 |
| CS.16-17 | Cello-Bass Solo 16–17 | 10 | 9 |
| CC.8-9 | Cello-Bass Concerto 8–9 | 8 | 8 |
| CC.10-11 | Cello-Bass Concerto 10–11 | 8 | 8 |
| CC.12-13 | Cello-Bass Concerto 12–13 | 10 | 9 |
| CC.14-15 | Cello-Bass Concerto 14–15 | 10 | 10 |
| CC.16-17 | Cello-Bass Concerto 16–17 | 15 | 10 |
