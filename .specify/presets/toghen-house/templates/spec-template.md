# Feature Specification: [FEATURE NAME]

**Feature folder**: `specs/[YYYY-MM-DD-short-name]`

**Created**: [DATE]

**Status**: Draft

<!--
  Status moves Draft, then Ready (questions answered), then Folded.
  Folded means the outcome is in the living docs and a dated entry is in decisions.md.
  A feature is not done until its spec says Folded. The Fold phase of the tasks sets it.
-->

**Input**: User description: "$ARGUMENTS"

<!--
  HOUSE REGISTER
  - Plain, short English sentences. One idea each.
  - Refer to things by name. The numbers below (stories, FR, SC, question numbers) are working
    papers: the speckit commands use them. Never write them in a report to the owner,
    and never in the living docs the Fold phase writes.
  - Name no downstream consumer. Say "a design system" or "a sibling consumer".
  - Delete every comment block when you fill the template in.
-->

## Findings *(mandatory)*

<!--
  What is true today, found by reading the code and the docs. Not what you remember, not what you hope.
  One finding per bullet. Each is checked against the code and ends with its proof as path:line.
  Mark it Confirmed, Refuted or Unchecked. An Unchecked finding must not carry a requirement.
  If a doc and the code disagree, that is a finding. Say which one is right.
-->

- **F1. [What is true]**. [One or two sentences.] *Checked*: `[path/to/file.ts:123]`. *Status*: [Confirmed | Refuted | Unchecked]
- **F2. [What is true]**. [One or two sentences.] *Checked*: `[path/to/file.ts:45]`. *Status*: [Confirmed | Refuted | Unchecked]

## User Scenarios & Testing *(mandatory)*

<!--
  Stories are ordered by importance. Each story is independently testable: built alone,
  it still delivers value. P1 is the most critical.
  Name a story in plain words. The label US1, US2 and so on is for the working papers only.
-->

### User Story 1 - [Brief Title] (Priority: P1)

[Describe this user journey in plain language]

**Why this priority**: [Explain the value and why it has this priority level]

**Independent Test**: [Describe how this can be tested independently]

**Acceptance Scenarios**:

1. **Given** [initial state], **When** [action], **Then** [expected outcome]
2. **Given** [initial state], **When** [action], **Then** [expected outcome]

---

### User Story 2 - [Brief Title] (Priority: P2)

[Describe this user journey in plain language]

**Why this priority**: [Explain the value and why it has this priority level]

**Independent Test**: [Describe how this can be tested independently]

**Acceptance Scenarios**:

1. **Given** [initial state], **When** [action], **Then** [expected outcome]

---

[Add more user stories as needed, each with an assigned priority]

### Edge Cases

<!--
  ACTION REQUIRED: replace these placeholders with the real edge cases.
  Include the structured shapes of the real format, not only plain strings.
-->

- What happens when [boundary condition]?
- How does the system handle [error scenario]?

## Requirements *(mandatory)*

### Functional Requirements

<!--
  Each requirement is testable and rests on a finding or an answered question.
-->

- **FR-001**: System MUST [specific capability]
- **FR-002**: System MUST [specific capability]
- **FR-003**: Users MUST be able to [key interaction]

### Key Entities *(include if the feature involves data)*

- **[Entity 1]**: [What it represents, key attributes without implementation]
- **[Entity 2]**: [What it represents, relationships to other entities]

## Success Criteria *(mandatory)*

### Measurable Outcomes

<!--
  Measurable and checkable without reading the implementation.
-->

- **SC-001**: [Measurable outcome, e.g. "the gate commands pass in every package"]
- **SC-002**: [Measurable outcome]

## Assumptions

<!--
  Reasonable defaults chosen where the description was silent. If an assumption would change
  the design when wrong, it is a question instead.
-->

- [Assumption about scope boundaries]
- [Assumption about the environment]
- [Dependency on something that already exists]

## Questions *(mandatory when a decision is open)*

<!--
  A decision the owner must make. Not a detail you can default.
  Each question has four parts:
    Context: what the owner needs to know to choose, in two or three sentences.
    Alternatives: two or three, lettered, each with its cost.
    Recommendation: one alternative, marked "Recommended", with the reason.
    (The owner may still choose another.)
  Ask the questions one by one. Do not decide for the owner. Do not copy an answer
  into the requirements until it is in Answers.
-->

1. **[The question, in one sentence]**
   - *Context*: [What the owner needs to know.]
   - a. [First alternative]: [what it gives, what it costs]. *Recommended*: [why].
   - b. [Second alternative]: [what it gives, what it costs].
   - c. [Third alternative, if there is one]: [what it gives, what it costs].

## Answers ([DATE])

<!--
  Empty until the owner has answered. Never fill this in yourself.
  When the owner answers, write the date in the heading, then one line per question:
  the question's number, the chosen alternative, and the owner's reason if given.
  Then update the requirements the answer changes.
-->
