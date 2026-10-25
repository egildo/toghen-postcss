# @toghen/postcss

An adapter: it resolves `toghen()` directives in CSS to concrete values.

Toghen is a design-tokens toolkit split into one repository per package. What the repositories share lives in house.

The rules are in the constitution, at `.specify/memory/constitution.md`: the shared principles and this package's own section. Read it before changing anything. This file holds only what is not a rule.

## The docs

| Doc | What it is |
|---|---|
| `guide.md` | How to use it: setup, workflows, examples |
| `reference.md` | The API surface: signatures, protocol, schemas |
| `specs.md` | Why it is built this way: architecture, contracts, decisions, open questions |
| `decisions.md` | The archive: dated rulings, what was considered and rejected, what the build found, superseded sections, open questions |
| `tutorial.md` | One lesson: the running example's button from tokens to a styled, themed, hoverable element |

## Commands

```sh
pnpm typecheck
pnpm test
pnpm build
pnpm check   # coming in the tooling round
```
