# Implementation Plan: [FEATURE]

**Feature folder**: `specs/[YYYY-MM-DD-short-name]` | **Date**: [DATE] | **Spec**: [link]

**Input**: Feature specification from `spec.md` in the feature folder.

**Note**: This template is filled in by the `__SPECKIT_COMMAND_PLAN__` command; its definition describes the execution workflow.

<!--
  HOUSE REGISTER
  - Plain, short English sentences. One idea each.
  - Refer to things by name. Numbers and codes (units, FR, SC) are working papers.
    They never go in a report to the owner or in the living docs.
  - Name no downstream consumer.
  - Delete every comment block when you fill the template in.
-->

## Constitution check *(gate: the plan must pass this before Design)*

<!--
  Read .specify/memory/constitution.md. Make one row for each rule in it and for each section
  that applies to the packages this feature touches. A rule that does not apply says so and why.
  Result is Pass, Fail or Not applicable. A Fail stops the plan: change the plan, or ask the owner
  as a question in the spec. A rule is never diluted to make a plan pass.
  Check again after Design, and write the second result beside the first.
-->

| Rule | Applies because | Result before Design | Result after Design |
|------|-----------------|----------------------|---------------------|
| [Rule from the constitution] | [Why it applies, or why not] | [Pass / Fail / Not applicable] | [Pass / Fail / Not applicable] |

**Gate**: [Passed | Stopped, with the failing rule and what changes]

## Technical context

<!--
  What the stock plan and tasks commands read: the stack and the structure.
  Mark anything not yet known as NEEDS CLARIFICATION; the plan command turns those into research.
  The files named under Design serve as the project structure.
-->

- **Packages touched**: [package names]
- **Language and runtime**: [e.g. TypeScript, ESM, Node 24]
- **Dependencies**: [what this feature uses or adds]
- **Tests and gates**: [e.g. pnpm check, and any feature-specific command]
- **Unknowns**: [each one as NEEDS CLARIFICATION, or "none"]

## Design

<!--
  How the feature is built, in prose. Start from the answered questions and the confirmed findings
  of the spec. For each decision, name the alternative you rejected and why.
  Say which package owns each piece, and name the files.
  If the feature touches a type shape, say which doc owns it.
-->

[The approach, in short paragraphs.]

**Files touched**:

- `[path/to/file]`: [what changes]

## Units

<!--
  A unit is a piece of work one agent or one person can finish alone.
  "Waits for" names the units that must be merged first. A unit that waits for nothing can start now.
  Two units that touch the same file are never parallel: one waits for the other.
-->

| Unit | What it does | Owns (files) | Waits for |
|------|--------------|--------------|-----------|
| [A] | [One sentence] | [Paths] | Nothing |
| [B] | [One sentence] | [Paths] | [A] |

## Risks

<!--
  What can go wrong, and what limits the damage. One bullet each: the risk, then the limit.
  Include what a green test run would not catch.
-->

- **[Risk]**: [What happens.] *Limit*: [What contains it, or what we check.]
