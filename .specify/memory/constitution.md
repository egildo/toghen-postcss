> Copied from house, constitution version 0.1.0.

# Toghen Constitution

Toghen is a pure, general-purpose design-tokens toolkit. It turns one portable token source into many targets. It is built on the W3C [Design Tokens Format](https://www.w3.org/community/reports/design-tokens/CG-FINAL-format-20251028/) and [Resolver](https://www.w3.org/community/reports/design-tokens/CG-FINAL-resolver-20251028/) reports. Any design system must be able to use it on its own merits, and it knows nothing of who consumes it.

This document holds Toghen's rules, each stated once. A repository's `CLAUDE.md` holds what is not a rule: what the package is, its docs and its commands.

## Core Principles

### The purity rule

Toghen never contains knowledge of a specific design system or consumer.

- No brand names. No consumer's token paths, palettes, component names or workflows. This holds in source, tests, examples, docs and skills.
- If a line of Toghen names the downstream project, that line is wrong.
- A capability is added generically or not at all. "A sibling consumer needs X" becomes "design systems may need X".
- It is built for the general case and tested with synthetic fixtures.

*Source: `CLAUDE.md`, "The purity rule".*

### The loop, and Toghen's step in it

Real consumers exercise Toghen. Today that is a sibling consumer, used as a proving ground.

```
consumer adopts Toghen  →  real usage surfaces a gap or a bug
        →  generalise it into a Toghen capability, for any design system
        →  implement it in the right layer, with tests and docs
        →  the consumer adopts the new published API
```

Toghen's step is the middle one: receive a generalised need, implement it purely, prove it, document it.

- Never reach into a consumer's repository to fix a Toghen limitation.
- Never special-case a consumer to make its adoption easier.

*Source: `CLAUDE.md`, "The loop".*

### The core owns the semantics

`@toghen/lib` is the single source of truth for token semantics, resolution and normalisation. Its only production dependency is [culori](https://culorijs.org/). It stays lean and unopinionated.

*Source: `CLAUDE.md`, "The purity rule".*

### Adapters translate

An adapter translates a resolved `DesignSystem` into an environment's target, such as CSS or Figma. It never redefines token semantics. It never embeds one system's meaning.

*Source: `CLAUDE.md`, "The purity rule".*

### The architectural invariants

- Tokens are immutable. A change returns a new instance.
- Resolution is recursive, and it detects circular references.
- Several contexts, such as light and dark, are expressed through the `Resolver`.
- Type behaviour lives in handlers, not in `DesignToken`.
- Every package is pure ESM and managed with pnpm. tsup builds lib and postcss; esbuild builds figma.

*Source: `CLAUDE.md`, "Architectural invariants".*

### Tests prove the documented format

- Tests use generic, synthetic tokens.
- Tests cover the real W3C structured shapes: a colour as `{colorSpace, components}`, a dimension as `{value, unit}`, a `fontFamily` as an array. Convenient plain strings alone are not enough.
- The reason: a serialisation bug once hid behind green tests that never exercised the documented format.
- A change to resolution, or to an adapter's output, adds a test in the structured shape.
- After such a change, rebuild the Figma plugin in the local workspace. Its stylesheet comes from toghen-ui's tokens through `@toghen/postcss`. Confirm that no `[object Object]` and no unresolved `toghen(` reaches the build.

*Source: `CLAUDE.md`, "Testing — and a standing lesson".*

### The docs

- Read a package's docs before changing the package.
- Each kind of doc owns one kind of statement. The guide says how to use the package. The specs say why it is built this way. The reference is the API surface. The decisions file is the archive.
- The reference owns every type shape. Other docs link to it rather than restate a shape.
- The decisions file is added to, never rewritten.
- The UX rulebook binds. Each of its rules was written from a defect. A change that breaks one is a regression, whether or not a test catches it. Touching the plugin's screen means reading the rulebook first.
- A new rulebook rule has all four parts: spot, purpose, limit and reason. A reason is only a real user need, or consistency with another rule.

*Source: `CLAUDE.md`, "The docs, and which of them bind you"; the UX rulebook's opening.*

## Package rules

Each section holds only the rules the package's own docs already state. The shared principles above apply to every package and are not repeated.

### lib

- The core writes nothing out. An adapter serialises. *(lib specs, "Purpose")*
- Consumers ask the core and never re-derive. Every export answers one of the core's nine questions, is the shape of an answer, or is the error it gives. A question enters the core once a second consumer asks it. *(lib specs, "The questions the core answers")*
- The arithmetic of `calc()` and `color-mix()` is the core's own, written on culori, so culori stays the only dependency. *(lib specs, "Minimal and Unopinionated")*
- The handlers are not exported, and a resolved token carries no methods. An adapter reads a value's normalised forms through the exported functions. *(lib specs, "Handler Pattern for Extensibility")*
- A new colour space is a registry entry, not core logic. *(lib specs, "Data-Driven Design")*
- Failures are errors, not warnings. An unresolvable or circular reference throws. `resolveToken()` returns `null` only for a lookup miss, so a broken token is never mistaken for an absent one. *(lib specs, "Failures are errors, not warnings")*
- An undeclared mode throws. No mode falls back to another mode's value. `getDefaultMode()` is the single source of the default mode. *(lib specs, "Strictness")*
- The component model, the running example and the glossary are said once, in the model doc. Every other doc links to it. The running example is lib's. *(`CLAUDE.md`, the docs table; lib model, opening)*

### postcss

- The plugin is thin. Every token semantic and all resolution are lib's. The plugin decides only how CSS spells what lib answers. *(postcss specs, "Purpose")*
- It emits standard CSS and no dialect of its own. *(postcss specs, "Purpose")*
- It receives a pre-built `DesignSystem` through its options. It loads no tokens from disk and assumes no filesystem. *(postcss specs, "Resolution boundary")*
- On a failure that does not throw, the original `toghen(...)` call stays in the output, so it stays visible and greppable. *(postcss specs, "Error modes")*
- A warning goes through the `result` the visitor is given, never through the root's `toResult()`. *(postcss specs, "Error modes")*

### query

- Every answer is exactly one call to one public `@toghen/lib` export, then printing. *(query specs, "The one rule")*
- The package computes no semantics. A command that would need one is a question the core is missing. It prints `missing`, and the question goes to the core first. *(query specs, "The one rule"; `CLAUDE.md`, the docs section)*
- Three forms read more than one export: `system`, `check` and `value … across`. Each says so in its last line. *(query specs, "The one rule")*
- It never imports an adapter or knows a target. It writes no file except a session it was asked to update, and only under `UPDATE_SESSIONS=1`. It answers nothing the core does not. *(query specs, "What it must not do")*
- Its sessions are its spec, and their answers are the golden files. *(query specs, "How sessions serve the docs")*

### ui

- What the plugin may know of its design system is what this package exports. *(ui specs, "Purpose")*
- A gap in Toghen shows first as a defect on the screen. It is fixed in Toghen, generically. *(ui specs, "Purpose")*
- Visual changes come from the design system. The UX rulebook still binds where things go and what they say. *(ui specs, "Purpose")*
- Light DOM, no shadow root. A custom element only where script is needed. *(ui specs, "Principles")*
- Variants and sizes are `data-*` attributes, never a modifier class. States come from the platform and ARIA, never from classes. *(ui specs, "Principles")*
- Three token tiers: primitives, semantic, and a component tier keyed by CSS property. No component token holds a literal the semantic tier could hold. *(ui specs, "Principles")*
- A variant and its states are parts of one group, and nothing is mapped by a table. Text styles are tokens. *(ui specs, "Principles")*
- Unresolved references fail the build. Parts write every state, except the few hand-written rules the specs list. *(ui specs, "Build", "Hand-written rules", "Testing")*

### figma

- The plugin consumes resolver-driven token inputs. It never rebuilds a resolver document from Figma state. *(figma specs, "Integration Contract with @toghen/lib")*
- Mode names, reference resolution and unit normalisation belong to lib. The plugin never derives combined mode names and never reads `{…}` syntax itself. *(figma specs, "Mode naming belongs to the library", "Reference resolution belongs to the library")*
- A value Figma cannot hold is translated where it can be and reported where it cannot, naming the token. The plugin never guesses. The value is skipped and the run goes on. *(figma specs, "Values Figma cannot hold as written")*
- The plugin holds all the machinery. The command line is a second front-end, not a second engine: it speaks the screen's protocol and holds no component logic. *(figma specs, "One runtime: the plugin", "A second front-end, not a second engine")*
- The plugin does not roll back. It stops before its first write for everything it can foresee, and the next run finishes a half-written set. *(figma specs, "A second front-end, not a second engine")*
- Every operation is Plan, then Execute, side by side. *(figma ui, "Design Principles")*
- The screen is one self-contained file. Its window has no network, so nothing is fetched. *(figma ui, "Design Principles")*
- The UX map says what each area of the screen is for. Read it with the rulebook before moving anything. *(figma specs, opening; figma ui, opening)*
- Breaking a rulebook rule needs sign-off, recorded as an exception. An exception made general becomes a change to the rule. *(UX rulebook, "Exceptions allowed")*

### skills

- The skills contain no code Toghen runs. Their examples use synthetic names. *(skills specs, "What this package is")*
- Every skill pins the version it describes: in its frontmatter (`compatibility`, and `metadata` with `documents`, `version` and `checked`) and in a table at its top, with sources. *(skills specs, "Keeping a skill pinned")*
- A skill is checked again when the software it pins moves, or when Toghen changes a command it teaches. Read the release notes and docs at the new version's tag, never at the latest. Measure against the running software, in one's own files. Update the skill, its pins and its date, and bump the plugin's version. Record the change in the decisions file. *(skills specs, "Keeping a skill pinned")*
- One plugin, with one version for all its skills. A skill's main file stays under 500 lines. *(skills specs, "Layout")*

## Governance

- This constitution is amended only in house, with Egildo's sign-off.
- Each repository carries a copy at `.specify/memory/constitution.md`. Its first line names the house version it was copied from: `> Copied from house, constitution version 0.1.0.` The rest is the house text unchanged, so a diff against house shows any drift.
- Versions follow semantic versioning. A principle removed or redefined is a major change. A principle or package rule added or widened is a minor change. A change of wording alone is a patch.
- A rule is stated here and nowhere else. A `CLAUDE.md` holds what is not a rule and points here.
- Each feature's plan checks itself against this constitution before its design.

**Version**: 0.1.0 | **Ratified**: 2026-10-25 | **Last Amended**: 2026-10-25
