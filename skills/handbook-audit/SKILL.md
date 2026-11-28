---
name: handbook-audit
description: Audit the current repository against the Engineering Handbook (qiheme/handbook) and report where it conforms, where it differs, and what to fix first. Use when asked to audit a repo, check it against the standard or the handbook, see whether it is up to standard, or bring it up to standard.
argument-hint: "[full | fix]"
---

# Audit this repository against the Engineering Handbook

The handbook is the standard for how these projects are built: <https://qiheme.github.io/handbook/>. This skill checks one repository against it, reports, and **logs every finding as a GitHub issue** so nothing is tracked only in a chat. It changes no files unless the request says to fix.

Modes, from `$ARGUMENTS`:

| Request | Do |
| --- | --- |
| nothing, or "quick" | Steps 1 to 3, report (6), log the findings (7) |
| `full` | Steps 1 to 5, report (6), log the findings (7) |
| `fix`, "adopt", "bring it up to standard" | Steps 1 to 3, report (6), log the findings (7), then step 8 |
| "dry run", "don't file issues" | As above, but in step 7 show the drafts instead of filing them |

## Reading the handbook

Read pages as Markdown, never from memory. Try in this order and use the first that works:

1. A local clone, if one is attached to this session: `../handbook/<path>`.
2. `https://raw.githubusercontent.com/qiheme/handbook/HEAD/<path>`
3. `https://qiheme.github.io/handbook/<path>`

`llms.txt` at the root lists every page. If none of the three is reachable, say so and carry on with what this file and the script cover; do not fill the gap from memory.

## Step 1: run the conformance script

```bash
node "${CLAUDE_SKILL_DIR}/scripts/audit.mjs" . --all
```

It needs only Node and installs nothing. It checks what a machine can check: required files, script names, the Node pin, hooks, CI, lint and test configuration, the deploy pipeline, framework versions. Each line names the handbook page that states the rule.

| Label | Meaning | Fails the run? |
| --- | --- | --- |
| `FAIL` | A rule the handbook marks Adopted or In use is not met | Yes |
| `TODO` | A rule the handbook marks Proposed is not met | No |
| `DEV` | A rule is not met, and the repo lists it as a deviation with a reason | No |

Add `--json` for the full result. The blueprint comes from the `**Blueprint:**` line in the repo's `CLAUDE.md` if there is one, otherwise from its dependencies; pass `--blueprint <name>` to override.

The script reports facts. The next steps are the judgement it cannot make.

## Step 2: separate gaps from deviations

The script already reads the "Deviations" table in this repo's `CLAUDE.md`: a row with the rule id in backticks and a reason shows as `DEV`. Report those as **accepted deviations**, with the repo's reason. Every `FAIL` is a **gap**.

Then read the Deviations section yourself. It may describe differences in prose, or in rows with no rule id, that the script cannot match. If a `FAIL` is clearly covered by one of those, say so and report it as "deviation, not yet in the form the check reads", with the row that would fix it.

If the repo has no `CLAUDE.md`, every failure is a gap, and the missing rulebook is the first one.

Do not treat a `TODO` as a gap. Those rules are proposals in the handbook's `decisions.md`; list them separately, as "proposed, not yet decided".

## Step 3: read the blueprint page

The script names the blueprint. Read `blueprints/<blueprint>.md` in the handbook and compare its "The stack" table and folder layout with the repo. Note differences the script did not report: a different router, a different data-access pattern, tests in an unexpected place, a folder the blueprint does not have.

## Step 4 (full): what only reading the code can tell

Check each of these and give evidence (a file and line) for anything you report. Do not report a suspicion as a finding.

| Area | Look for | Handbook page |
| --- | --- | --- |
| Testability | Logic in pure modules that take their dependencies as arguments. Coverage exclusions each have a written reason | `standards/testing.md` |
| Data | Row-level security on every table. Schema changes as migration files that only add things | `standards/data.md` |
| Security | Nothing secret behind a `VITE_` or `PUBLIC_` name. Server endpoints authenticate inside the handler. No token in a committed file | `standards/security.md` |
| UI | Cobalt components used before hand-rolled ones. No raw hex values. Component levels import only from their own level or below. Every component has stories. Every export has JSDoc | `standards/ui.md` |
| Front end | Changed or key pages reviewed against the Front-End Checklist; `e2e/quality.spec.ts` present and passing | `standards/frontend-checklist.md` |
| Docs | README has the standard sections and matches what the code does | `standards/repo-contract.md` |

## Step 5 (full): run the gates

Only if dependencies are already installed. Do not install anything to run an audit; say the gates were not run instead.

```bash
npm run lint
npm run typecheck
npm run test:coverage
npm run build
```

Report each as passed, failed (with the first error), or not run (with the reason). A script that does not exist is already a gap from step 1.

## Step 6: report

Lead with the verdict in one line. Then:

1. **A table by area** (repo contract, stack, testing, CI/CD, data, security, UI, agents): 🟢 meets the standard, 🟡 partly, 🔴 does not, with one line of why. Missing or unchecked is never green.
2. **Gaps**, most valuable first. Use the order in the handbook's `adoption.md`: cheap changes that make the repo look like the others first (Node pin, script names, hooks, rulebook, templates), then quality gaps (lint, coverage, end-to-end), then the host, then long migrations. Give each a size: XS under two hours, S half a day, M a weekend, L several weekends.
3. **Accepted deviations**, with the reason the repo gives.
4. **Not checked**, and why. Say plainly which steps you skipped.

Label what you verified and what you inferred.

## Step 7: log every finding as an issue

Work here starts with an issue, so a finding that is not an issue does not exist. Do this on every audit, without being asked.

**Get the drafts.** The script writes them, so every issue has the same shape:

```bash
node "${CLAUDE_SKILL_DIR}/scripts/audit.mjs" . --issues
```

It prints JSON: a `parent` issue and one entry in `findings` for each `FAIL`. Each is in the Task form (What, Why now, Done when, Parent issue, Effort estimate). A finding's title starts `[Infra] Handbook audit:`, the parent's starts `Handbook audit:`, and a finding's title ends with its rule id in brackets, which is how a later audit finds it again. If there is no `FAIL`, there is nothing to file: say so.

**Look before you file.** List this repository's issues, open and closed, whose title contains `Handbook audit:`. That also finds issues filed before titles changed, which start `[Task]: Handbook audit:`. Also search for an existing issue that already covers a finding under another title (search the rule's key words). Never file a duplicate.

Then, for the parent and each finding:

| Situation | Do |
| --- | --- |
| No parent issue is open | Create it from `parent`. Set the Issue Type to Task if the repo has issue types |
| A parent is open | Reuse it. Replace its body with the new `parent` body so its table is current |
| No issue exists for the rule | Create it from the draft, as a **sub-issue of the parent**. Replace `{{parent}}` in the body with the parent's number |
| An open issue already exists for the rule | Leave it. Do not create another |
| An issue under another title already covers it | Do not create one. Attach that issue to the parent as a sub-issue |
| A closed issue exists and the rule fails again | Reopen it and comment with today's finding |
| An open issue exists but the rule now passes, or is now a listed deviation | Comment with the evidence (the script's line for that rule) and close it as completed |

Follow anything this repo's `CLAUDE.md` adds about issues: a project board to add them to, fields to set, a roadmap issue to attach the parent to.

**What does not become an issue:**

- `TODO` lines. They are proposals, listed in the parent issue and decided in the handbook's `decisions.md`.
- `DEV` lines. The owner has already decided; they are listed in the parent issue.

**Findings from reading the code** (step 4) are logged too, one issue each, in the repo's Task or Bug form, as sub-issues of the same parent. Give the file and line as evidence.

**A security weakness** is the exception to "file it where everyone can see". In a private repository, file it as an issue. In a public repository, do not: report it in this conversation and tell the owner to open a private security advisory. It is never written into the handbook, which is public.

**If you cannot create issues here** (no access, no tool), print each draft in full and say plainly that nothing was filed.

Finish by listing what you did: the parent's number, each issue created, reused, reopened or closed, and anything you could not file.

## Step 8 (fix): close the gaps

Only when asked. Follow this repo's own workflow for every change: an issue first, test first, the repo's commit format, a pull request. The issues from step 7 are the issues to work from; each pull request says `Closes #<n>` for the findings it fixes.

1. Small mechanical findings can share one pull request. Each still closes its own issue.
2. Start with the mechanical gaps. Copy files from the handbook's `kit/` (read `kit/README.md` for what goes where) rather than writing them from memory. Fill in every placeholder.
3. Re-run the script after each change. The gap is closed when its line is gone.
4. Where the repo should stay different, do not "fix" it. That is the owner's decision: ask, then add a row to the Deviations table in its `CLAUDE.md` with the rule id in backticks and the owner's reason. Never write a reason on the owner's behalf to make a check pass.
5. Stop and ask before anything that needs the owner: renaming the default branch, changing hosts, adding secrets or a dependency, repository settings.
6. When the pull request merges, the repo's row in the handbook's `adoption.md` is out of date. Say so; updating it is a separate pull request to the handbook.

## What this skill does not do

- It does not decide that a deviation is acceptable. The repo's owner does, by listing it with a reason.
- It does not make a proposed rule binding. `TODO` lines never fail the run.
- It does not audit product behaviour, only how the project is built.
- It does not leave findings in the chat. Every `FAIL` ends as an issue, or the skill says why it could not file one.
- It does not replace CI. The same script can run there as a gate: see `standards/agents.md` in the handbook.
