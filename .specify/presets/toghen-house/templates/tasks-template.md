---

description: "Task list template for feature implementation"
---

# Tasks: [FEATURE NAME]

**Input**: Design documents from the feature folder `specs/[YYYY-MM-DD-short-name]/`

**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: Tests are OPTIONAL in speckit's own rule. In Toghen they are expected for any change to resolution or to an adapter's output, and they must cover the structured shapes of the real format.

**Organization**: Tasks are grouped by user story. The last phase is always Fold.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

<!--
  ============================================================================
  The tasks below are SAMPLES. The __SPECKIT_COMMAND_TASKS__ command MUST replace them with real
  tasks from the spec (stories with their priorities), the plan (units) and the research notes.
  Do not keep the sample tasks.

  THE LAST PHASE IS ALWAYS FOLD. It comes after every story phase and after any polish.
  Keep it in every tasks file. Do not rename it, merge it into polish, or drop it.
  Speckit's own text says the final phase is polish. In this repository the final phase is Fold.
  Polish tasks go at the end of the last story phase.

  Task ids, story labels and the checklist format are working papers for the commands.
  ============================================================================
-->

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure

- [ ] T001 [Setup task with exact path]
- [ ] T002 [P] [Setup task with exact path]

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: What MUST be complete before ANY user story can be implemented

- [ ] T003 [Foundational task with exact path]

**Checkpoint**: Foundation ready. User story implementation can now begin.

---

## Phase 3: User Story 1 - [Title] (Priority: P1) 🎯 MVP

**Goal**: [Brief description of what this story delivers]

**Independent Test**: [How to verify this story works on its own]

### Tests for User Story 1

> Write these first. Make sure they FAIL before the implementation.

- [ ] T004 [P] [US1] [Test in the structured shape of the real format, with exact path]

### Implementation for User Story 1

- [ ] T005 [P] [US1] [Implementation task with exact path]
- [ ] T006 [US1] [Implementation task with exact path] (depends on T005)

**Checkpoint**: User Story 1 is fully functional and testable on its own.

---

## Phase 4: User Story 2 - [Title] (Priority: P2)

**Goal**: [Brief description of what this story delivers]

**Independent Test**: [How to verify this story works on its own]

- [ ] T007 [US2] [Task with exact path]

**Checkpoint**: Stories 1 and 2 both work on their own.

---

[Add more user story phases as needed, following the same pattern]

---

## Phase N: Fold (always last)

**Purpose**: The outcome goes into the living docs, each doc taking what it owns. A feature is not done until it is folded.

**Rules**: Write in the docs' own register. No task ids, story labels or requirement codes in them. Reference owns every type shape, so other docs link to it instead of restating.

- [ ] TXXX Fold the design into `specs.md` of each package the feature touches: the decision and why, in the doc's own words
- [ ] TXXX Fold type shapes, signatures and protocol into `reference.md` of each package that has one
- [ ] TXXX Fold how to use it into `guide.md` of each package the feature touches
- [ ] TXXX Add a dated entry to `decisions.md` of each package the feature touches: what was ruled, what was considered and rejected, what the build found. Add to it, never rewrite it
- [ ] TXXX Run the docs' own checks: no link left dangling, no stale name left behind, and the examples still run
- [ ] TXXX Mark the feature's spec **Status: Folded** and write the fold date beside it

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies. Can start immediately.
- **Foundational (Phase 2)**: Depends on Setup. BLOCKS all user stories.
- **User Stories (Phase 3+)**: All depend on Foundational. They can run in parallel or in priority order.
- **Fold (last phase)**: Depends on all the other phases being complete.

### Within Each User Story

- Tests MUST be written and FAIL before implementation
- Models before services, services before endpoints
- Story complete before the next priority

### Parallel Opportunities

- Tasks marked [P] in the same phase can run in parallel
- Different user stories can be worked on in parallel
- Fold tasks that touch different docs can run in parallel. The decisions entry waits for the others

---

## Implementation Strategy

1. Complete Setup and Foundational.
2. Complete User Story 1, then STOP and validate it on its own.
3. Add the next story, validate, repeat.
4. Fold. Only then is the feature done.

## Notes

- [P] tasks = different files, no dependencies
- Each user story is independently completable and testable
- Verify tests fail before implementing
- Commit after each task or logical group
- Avoid: vague tasks, same-file conflicts, cross-story dependencies that break independence
