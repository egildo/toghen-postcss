# @toghen/postcss — Decisions

> **Audience:** contributors asking why the plugin is built this way, or what is still undecided.
> The current explanation is in [specs.md](./specs.md). This file is added to, and its sections are not rewritten.

This is the archive of `@toghen/postcss`. It holds the sections that describe the dialect retired on 13 October 2026: the `:toghen()` selector, the `@toghen` directives for bases, modes, states and layers, and the element-state machinery that the component model replaced. It also holds the history of a failure path that deadlocked, the rulings from the playground and from a second consumer, the alternatives the component model rejected, and the open questions.

Each section is kept as it was written, under the heading of the part of the specs it came from. An open question that the retirement made moot is marked at its start. The only other edits are links that point at a section still in the specs.

---

## From specs.md: Architecture

### Short forms

Status: **built** (ruled 7 October 2026; built 8 October 2026).

`t()` is `toghen()`, `:t()` is `:toghen()`, and `@t` is `@toghen` with
everything after it unchanged: `@t base`, `@t mode`, `@t path;`, `@t declare`,
`@t contexts`. They are aliases, not replacements. The long forms stay, because
every existing stylesheet and the documentation use them, and an alias costs one
name in each of three places.

**One prefix, shortened; never dropped.** `@mode` and `@base` read better and
were rejected. Undecorated at-rule names are CSS's, and one CSS or another plugin
ships later would collide with no error. The plain block directive has no keyword
to drop, so dropping the prefix would still leave `@t ds.button;` beside `@base`:
one family written two ways. With the prefix shortened, every directive is `@t`
followed by what the long form says, and the alias is mechanical.

**`t(` is matched as a whole name.** CSS function names end in `t(` often
(`inset(`, `rect(`, `repeat(`, `format(`), so `t(` counts only where a function
name can start: at the beginning of a value or after whitespace, a comma, `(`,
`/` or an operator, never after a letter, a digit, `-` or `_`. The same boundary
applies to `toghen(`. `:t(` is matched with its colon and not after a second one.

**A known risk, accepted.** Plain-named functions are CSS's too; CSS's own newer
functions are plain (`if()`, `env()`), and author functions are dashed
(`--name()`). A CSS `t()` is unlikely and not impossible. If one ships, the long
form is unaffected and the alias is withdrawn.

### A context as a selector

`:toghen(theme=dark)` states a context, and the document spells it. The author
no longer writes `[data-theme='dark']` in components, so a context renamed or
re-spelled (an attribute becomes a class, a context becomes a media query) is a
change in one place, the resolver document, and the stylesheet keeps meaning
what it said.

**A pseudo-class, because CSS already says "same element or descendant" with
position.** `.card:toghen(theme=dark)` and `:toghen(theme=dark) .card` differ the
way their hand-written forms do. A directive with a flag for the relationship
would restate, badly, what a selector says. It also works unchanged inside native
nesting (`&:toghen(theme=dark)`): the plugin replaces text in a selector and does
not need to know where the rule sits.

A selector-spelled context is allowed inside `:not()`, `:is()`, `:where()` and `:has()`, where it means exactly what its selector says; the plugin refuses an at-rule-spelled one there, since a wrapping at-rule has no meaning inside a pseudo-class.

**A list is a compound selector, same element only.** The case it serves is a
token built from two modifiers, which `contexts` can only warn about: the author
writes the combination and gets `[data-theme='dark'][data-density='compact']`.
Measured ([results](./measurements/RESULTS.md), fixture
[c4.html](./measurements/c4.html)): both attributes must be on one element; on two
elements the selector does not match. The pseudo-class cannot express modifiers on different elements,
and does not pretend to.

**A context spelled only as an at-rule wraps the rule.** A selector cannot
express `@media`, so the rule is wrapped in it, in place, which also keeps a rule
inside the layer it was written in. This is why the position rules in the
reference are narrow: an at-rule has no ancestor to describe, so a context of
that kind next to a combinator other than a leading descendant one, or under
`:not()`, has no faithful rewrite and is refused instead of guessed.

**The selector spelling must be compound.** The plugin joins it to the author's
own selector; `a b` or `a, b` cannot be joined, and splicing one into the middle
of a compound would change what the rule matches.

**The modifier needs a collection.** Modifiers belong to collections, and the
pseudo-class names none. It looks in the collection of the `@toghen base` in
scope when there is one, otherwise in all of them, and a name found in two is an
error: guessing which spelling is meant would be a silent wrong answer.

**A failure leaves the rule as written.** For the reason given under
[Error Modes](./specs.md#error-modes): the text stays visible, and a browser drops a rule
whose selector it cannot parse, so it cannot be mistaken for a working rule.

**Names match case-insensitively** (*ruled 6 October 2026, built*). The
resolver lower-cases modifier and context names, as the standard asks, so
`valueAt({ Theme: 'Dark' })` answers; `:toghen(Theme=Dark)` and the mode
argument of `toghen(path, Theme=Dark)` follow the same rule, so the plugin and
the lib answer the same question the same way. The mode argument's rule lives
in the lib's `modeNamed()`, once, where every adapter routes; the selector's in
the plugin, which matches names before it writes the document's spelling.

**A `:toghen()` left in an at-rule's parameters is reported** (*ruled 6 October 2026, built*). Only rule selectors are rewritten; `@scope (.x:toghen(theme=dark))` passed through untouched, and a browser drops it. After the walk, the plugin reports any `:toghen(` still found in an at-rule's parameters through `onUnresolved`. Rewriting it there, for `@scope`, waits for someone who needs it.

**Before other tools.** The pseudo-class is not CSS, so the plugin must run
before anything that parses selectors, and `@toghen base` applies to its
container, so the plugin must read the tree before anything that flattens
nesting and moves rules out of it. The guide says where to put it; no tool is
named there that has not been run beside this one.

### Components read the property, the token layer declares it

Until now `toghen(path, mode)` chose the value: the component named the mode,
and the sheet held literals. With `tokenLayer` set the split is the one CSS
already has. The token layer *declares* every context as custom properties; every
other layer *consumes* by name, and the cascade, at the element, picks the
context. A component written `toghen(ds.card.surface)` is correct inside any
subtree, which is the designer's intent: this surface, in whatever context it
finds itself.

**The fallback is the default context's literal.** `var(--card-surface, #ffffff)`
fails soft where the token layer is not loaded or a property is missing. The cost
is bytes, and that a missing declaration is hidden rather than reported; this is
the trade the open question on fallbacks named, taken for the consumer side only.
The token layer's own `var()`s under `references: 'var'` stay unfallbacked,
because there a missing target is a bug that should show. The consumer fallback
is a resolved literal, never a `var()`: a fallback that is a `var()` needs its
own fallback, and the chain ends nowhere.

**Members read their own properties, since 8 October 2026.** Only a token that
`@toghen declare` would declare has a property to read, and at first a member
path (`ds.type.body.fontSize`) had none: members stayed literals even outside
the token layer, so a dark subtree turned a card's surface dark and left its
shadow's colour at the default's. What was missing was a naming rule for an
inner part. With names spelled by `cssIdentifier`, a member path has a name, and
a composite with longhands declares its members (see *How a query is printed*),
so a plain read of such a member, `toghen(ds.card.border.color)`, reads its
property outside the token layer as any token does,
`var(--card-border-color, #d0d0d6)`. What remains literal is a shadow's member:
`box-shadow` has no longhand to read it through.

**An explicit mode is the author's choice.** `toghen(ds.card.surface, dark)`
says which value is meant; a `var()` would hand the decision back to the cascade.
So it writes the literal, **whatever `references` says** (*corrected 8 October
2026*: under `references: 'var'` an explicit mode wrote `var()` of the first hop,
which the cascade then decided, against this rule). Inside the token layer, and
without `tokenLayer`, `references: 'var'` keeps its first-hop form, which is how
a token sheet points at the tier below. So does a read under `@toghen mode`, the same choice
made for several reads; a selector's `:toghen()` does not (see *The query
scope*).

**Inside the token layer, no read of a token's own property.** The declarations
themselves must hold values, or the first-hop `var()` that `references: 'var'`
writes to point at the tier below, never a `var()` of themselves.

**Why an option, and why the layer by name.** Without `tokenLayer` the plugin
cannot know which positions are token declarations, and a plugin that wrote
`var()` for them would break every existing stylesheet. The layer is the one
thing that separates "declares" from "consumes" in a stylesheet that is not
otherwise annotated. Sublayers of the token layer count as inside, since that is
where `contexts` writes them. Unlayered rules count as outside: they beat any
layer, so they are consumers by position.

### Relative paths

`@toghen base ds.card;` is a prefix for what follows in its container, and a
leading dot marks a path as relative. A stylesheet for one component names the
component once, and a rename touches one line. The spelling stays greppable:
`toghen(.surface)` still contains `toghen(`, and the full path still works
anywhere.

**Scoping is by container, shadowing replaces.** A container is a rule, an
at-rule, a layer or the stylesheet, which are the units an author already thinks
in. An inner base replaces the outer instead of adding to it, so what a path
means is decided by the nearest base above it; a base that is itself relative
is therefore an error: a base is always a full path, never joined to the outer
one. Joining would make the meaning of a path depend on a chain of bases, and the
nested component can write its whole path once.

**Considered and rejected: a base derived from the layer name.**
`@layer components.card` meaning `ds.card` is tidy and saves a line. It makes the
meaning of every path depend on a name chosen for another purpose, and a
rename of the layer changes it with no error, only different tokens. An explicit
line costs one line. Also rejected: finding a token from its custom-property
name (`toghen(--card-surface)`), because `propertyName` is a function the author
can replace and is not guaranteed to be injective.

### The query scope

Status: **built** (ruled 7 and 8 October 2026; built 8 October 2026).

A query asks three things: *which token* (a path, relative through `base`), *in
which context* (a mode), and *printed how* (a literal, a `var()`, or a block of
declarations). Until now the context was per call only, so a selector that
named a context did not set it for the queries inside its rule:
`.card:toghen(theme=dark) { padding: toghen(.pad) }` wrote the default's value.
Under `tokenLayer` the cascade made the two agree; under literal output they
silently differed.

The scope has two fields, a base path and a mode. `@toghen base` sets the first;
`@toghen mode` sets the second; a selector's `:toghen()` sets the second for its
rule. Every query inside a scope answers in it.

**The directive is `@toghen mode`.** *Mode* is already the word for what it sets:
`toghen(path, mode)`, `@toghen path, mode;`, `@toghen declare path, mode from
base`. The scope sets the mode a call would otherwise carry. `@toghen context`
was rejected for sitting one letter from `@toghen contexts`, which declares, the
opposite job; a typo between them would do the wrong thing quietly. `@toghen in`
was a new word for an existing idea.

```css
.button {
  @toghen base ds.button;
  &.is-hover {
    @toghen mode state=hover;
    color: toghen(.fg);
    background: toghen(.bg);
    border-color: toghen(.edge);
  }
}
```

**Its container rules are the base's.** It applies to what follows it in its
container, nested containers included; a nested one applies inside its container
and the outer one again after it; it is removed from the output. Its grammar is
`@toghen mode <mode>;`, a mode in either spelling, pairs or a plain name, as the
call's argument takes it. `mode` joins `declare`, `contexts` and `base` as a
reserved first word.

**How scopes combine: merge per modifier, only when both are pairs.** A scope
written as pairs (`theme=dark state=hover`) is a set of independent choices, and
a nested scope that names one modifier has no reason to touch the others:
`.card:toghen(theme=dark) { @toghen mode state=hover; … }` answers in
`theme=dark state=hover`, and only a modifier named again is replaced. Replacing
the whole set would make the selector's `dark` disappear the moment an inner rule
set a state, which breaks the case the scope is for. A plain mode name has no
parts, so where either side is one, the inner replaces the outer whole, as an
inner base does. Modifiers named by neither side stay at their defaults, as they
do in a call's argument today.

The order, outermost first: a selector's `:toghen()`, then `@toghen mode`, by
nesting, then the mode written on the call, which is the nearest of all and wins
the same way. One rule, ordered by nesting only; a selector and a directive are
the same kind of scope.

**One line where one line does.** A mode on the call serves one query
(`@toghen ds.button, state=hover;`); `@toghen mode` serves several queries in a
rule that share a mode; a selector serves a whole rule. A block query does not
set the base as a side effect: a query that changed how every path after it reads
would make the order of lines change meaning, and the base is always written
where it takes effect.

**Declaring directives ignore the scope.** `@toghen declare` and `@toghen
contexts` declare; they do not query. Their modes are their own arguments.

**Pairs are checked where the scope is written, and applied where they fit.**
The pairs of a selector or of `@toghen mode` must name a modifier the way
`:toghen()` already requires: in the base's collection when a base is in scope,
otherwise in exactly one collection (see *A context as a selector*). A typo is
reported there, once, through `onUnresolved`. A query then takes from the scope
only the pairs its own collection has modifiers for, and passes over the rest:

```css
.card:toghen(theme=dark) {
  background: toghen(ds.card.surface);  /* ds has theme: dark */
  padding: toghen(space.md);            /* space has no theme: its default */
}
```

Passing over cannot hide a typo, since it was caught where the scope was
written; it only skips a modifier that does not apply to this collection. A plain
name in a scope must be a mode of some collection, applies to the collections
that have it, and is passed over by the others. **A mode written on the call
stays strict**: it is named for that one token, and a pair its collection does
not know is an error, as today.

**Under `tokenLayer`, an `@toghen mode` pins; a selector does not.** An explicit mode on the call writes the literal, because the author chose the value. A mode set by `@toghen mode` is the same choice made for several calls, so a read outside the token layer inside it writes the literal too: `.swatch .button { @toghen mode theme=dark; … }` shows a dark button on a light page. A literal pins every modifier, the ones the scope does not name at their defaults, so a pinned swatch inside a compact subtree keeps the regular density; the guide says that putting the context's own spelling on the element in the HTML is the plainer way, and keeps the cascade.

A selector's `:toghen()` does not pin. The rule only matches where the context is set, the token layer's blocks for that context apply there, and the `var()` already reads the context's value; a literal would add nothing for the named modifier and would pin the others to their defaults, wrong inside a subtree that sets them. So under `tokenLayer` a selector scope changes the output of no read outside the token layer; it changes the literals, which are what the scope was found missing for. Inside the token layer, and without `tokenLayer`, every scope sets the literal's mode.

A selector naming an **element state** is the exception: nothing but that rule sets a state, so a read in it writes the state's value (see *Element states*).

### Why a block is an at-rule

A function yields a value, and a block is declarations. `toghen()` sits inside a
declaration's value, so whatever it returns becomes the value of one property;
there is no spelling of a function whose result is three properties. An at-rule
sits where declarations sit, and PostCSS can replace it with them. So the block
directive is `@toghen`, with the same path and mode grammar as `toghen()`.

**Block-ness is decided by `$type`, not by shape.** A typography value and a
shadow layer are both objects of members, and guessing from the shape would
expand one layer of a shadow into `offset-x:`, `blur:` and other properties that
do not exist. The type is what `resolveToken()` reports, inherited `$type`
included, and the set of block types is one constant in `src/index.ts`. The kind
belongs to the type, not to this adapter; when a second adapter needs to ask it,
it moves to the core's type handlers.

The property is the member name kebab-cased, not a table. DTCG typography member
names are the CSS longhands camelCased, so a member the standard adds later is
written without a change here.

**An at-rule left in place is harmless.** On `warn` and `ignore` a failed
`@toghen` stays in the output, as a failed `toghen(` does. A browser ignores an
at-rule it does not know, and the directive stays visible and greppable, which is
the same reason given under [Error Modes](./specs.md#error-modes).

**A value with no spelling is refused, never stringified.** `valueToCss` used to
end in `return String(value)`, which turned every one of the above into the
literal text `[object Object]` in a stylesheet, silently. That is the same defect
the structured-colour path had before this package existed; a fallback producing
plausible-looking output is how it survived a second time.

Adding a type to the core therefore does **not** silently produce broken CSS
here: it produces a refusal naming the shape, which is the outcome that gets
noticed.

### A group as a block

Status: **built** (ruled 7 October 2026; built 8 October 2026).

A system can name a component's tokens by the properties they fill:

```json
"button": {
  "backgroundColor": { "$type": "color", "$value": "{color.accent}" },
  "paddingBlock":    { "$type": "dimension", "$value": { "value": 0.5, "unit": "rem" } },
  "font":            { "$type": "typography", "$value": { … } },
  "hover": { "backgroundColor": { "$type": "color", "$value": "{color.accent-strong}" } }
}
```

Then `@toghen ds.button;` on the group writes the component: one declaration per
token one level down, the key spelled as a property, the value what
`toghen(path)` writes for that token in that position.

```css
.button       { @toghen ds.button; }
.button:hover { @toghen ds.button.hover; }
/* tokenLayer: 'tokens', typography: 'font' → */
.button {
  background-color: var(--button-background-color, #1a66e6);
  padding-block: var(--button-padding-block, 0.5rem);
  font: var(--button-font, 600 0.875rem/1.25 Inter, sans-serif);
}
.button:hover { background-color: var(--button-hover-background-color, #1450be); }
```

**No new syntax.** `@toghen path;` already means "write this as declarations";
a group becomes one more thing it accepts. A path naming a token keeps today's
behaviour: a block expands, anything else is refused with today's messages.

**The key is spelled by the CSSOM rule**, the one `element.style.backgroundColor`
uses and that a typography member already follows here: each capital becomes a
hyphen and its lowercase. A vendor property is a key with a leading hyphen
(`-webkitLineClamp` → `-webkit-line-clamp`). The function is lib's `cssIdentifier`, shared with
the custom property names (see *Custom property names*).

**Each value is `toghen(path)`'s.** So everything a single read does, a group
read does per token: `var()` with the default's fallback outside the token layer,
the literal inside it or under a pin, the scope's mode, `references: 'var'`. No
second way of writing a value exists to drift from the first.

**Subgroups are not written.** A group inside the group (`hover`) is a part read
by its own path. Writing it would need a property to hang it on, and the only one
available is its key, which is not a property.

**A key that is not a known CSS property is reported, and written.** `bgHover` becomes `bg-hover: …`, which a browser drops without a word, the kind of silent failure the query scope was opened to remove.

The plugin checks each spelled key against [`mdn-data`](https://github.com/mdn/data)'s `css/properties.json`, MDN's own machine-readable CSS data (CC0), and reports an unknown one through `onUnresolved`. It still writes it: the data lags CSS, and a property newer than the data must not be removed by the tool that failed to know it. Under `throw` the build stops, which is what CI wants.

The same data gives each shorthand's longhands (see *How a query is printed*), so one dependency serves both checks. It is a dependency of this adapter only; lib stays on `culori` alone. (Ruled 8 October 2026, replacing stylelint's `known-css-properties`, which knows only whether a property exists.)

**A token its position cannot write is reported; the others are written.** A
typography token under the default `typography: 'block'` is refused as a value,
so `font` in a group under `'block'` is reported with the message `toghen()`
gives, and the rest of the group is written. The fix the message names is
`typography: 'font'`, or `@toghen ds.button.font;` for the longhands. A group
that holds no token one level down is reported as naming nothing to write.

**A typography key under `'font'` writes what the shorthand cannot carry beside it** (*ruled and built 8 October 2026*). The group wrote `font` and stopped, so `letterSpacing`, and any other member outside the shorthand's five, never reached the rule. `@toghen declare` already declares those members beside the shorthand (`--type-label-letter-spacing`); the group now writes them too, after `font`, one declaration per member at its own property (`letter-spacing`). Each value is what `toghen(path.member)` writes in that position: under `tokenLayer` outside the token layer, `var(--eyebrow-font-letter-spacing, 0.5px)`, the member property `declare` gave; otherwise the literal. A key whose typography value is a reference to another typography token (`"{type.label}"`) writes the referenced token's members, as `toghen(path.member)` already resolves through it.

**Order** is the group's, as the document lists its keys.

**Considered and rejected.**

- *Writing only keys that look like properties*: no rule tells `bgHover` from `paddingBlock` without a list.
- *Trusting the naming*: no dependency, and a typo fails silently.
- *A table from keys to properties in the document*: the key already is the property, spelled the way CSS spells it from script.

### How a query is printed

Status: **built** (ruled 8 October 2026; built 8 October 2026).

A query asks which token, in which context, printed how. The third has been
decided by options and position: `tokenLayer` and where the read sits choose a
literal or a `var()`, `typography` chooses the `font` shorthand or longhands.
Those stay the defaults. A query may now say otherwise, with `as` and a form
right after the path, before any mode:

```css
.chart  { --series-1: t(ds.color.accent as value); }   /* #1a66e6, wherever it sits */
.button { background: t(.bg as var); }                 /* var(--button-bg, #1a66e6) */
.card   { border-color: t(.edge as value, theme=dark); }
.card   { @t ds.card.border as longhands; }
.text   { @t ds.type.body as shorthand; }
```

| Form | Where | Writes |
|---|---|---|
| `value` | `toghen()` | The resolved literal, as with no `tokenLayer`, in any position |
| `var` | `toghen()` | `var(<name>, <literal>)`, the property read with the default's fallback, in any position, `tokenLayer` set or not; refused for a path with no property of its own (see below) |
| `longhands` | `@toghen` | One declaration per member of a composite, at the longhands below |
| `shorthand` | `@toghen` | One declaration: the composite as its shorthand, at the property its key names (`border`, `borderTop` → `border-top`); a typography token at `font`, as `typography: 'font'` writes it, **and each member the shorthand cannot carry** (`letterSpacing`, `textTransform`, `textDecoration`, and any further CSS property) at its own property beside it, valued as the group form and `declare` value them (*ruled 12 October 2026, built the same day*) |

**`as` comes before the comma**, so it cannot be read as part of a mode. `as` and the four form names are reserved after a path; a token path never holds a space, so nothing that parses today changes meaning. A form where it does not apply (a `longhands` on `toghen()`, a `value` on `@toghen`, `longhands` on a type with none) the plugin refuses through `onUnresolved`, naming the form and the token's type.

**Prior art.** Style Dictionary decides the same choice per token with an
`outputReferences` function, and splits composites with its `expand` option.
`@csstools/postcss-design-tokens` puts a keyword after the path,
`design-token('size.spacing.small' to rem)`, the same slot used for unit
conversion. Unit conversion is not in this design.

**Longhands come from mdn-data, not a table.** A composite is written member by member: member *M* of a composite whose key is the property *K* goes to *K*-*M* when mdn-data lists that among *K*'s longhands, so `border` writes `border-width`, `border-style`, `border-color`, and a border token at `borderTop` writes `border-top-width` and the rest. Otherwise *M* goes to its own spelling when that is a property, which is a typography member (`fontSize` → `font-size`), wherever the typography token sits. For anything else the plugin refuses the token, naming the member. A `shadow` has no longhands (`box-shadow` has none) and a `gradient` is refused as everywhere. The key is spelled by lib's `cssIdentifier`.

`@toghen path;` with no form keeps today's behaviour: a typography block expands to longhands, a composite value is refused.

**`as shorthand` on typography no longer drops members** (*ruled and built 12 October 2026*). It wrote `font: …` alone, so `letter-spacing` and `text-transform` were lost, while the group form and `declare` write them beside the `font` line. Now `as shorthand` writes the same set: the `font` declaration, then each member the shorthand cannot carry. Output of a token with only `font` members is unchanged, and a bare `@toghen path;` is untouched; the `typography` option still decides only whether a bare block writes longhands or the shorthand, and `as longhands` is the way back. Ruled against also letting the option change the bare form of a block (a larger change, moving existing output).

**Members get properties, which closes a limit.** Under `tokenLayer` a longhand read outside the token layer reads the member's own property, `var(--card-border-width, 1px)`, so a border's colour follows the cascade where before it was a literal (see *Components read the property*).

For that, `@toghen declare` and `@toghen contexts` declare, beside a composite's own property, one property per member that has a longhand: `--card-border-width`, `--card-border-style`, `--card-border-color`, named by `cssPropertyName` on the member path. Under `typography: 'block'` a typography token's members are declared the same way (`--type-body-font-size`), where before the token was skipped. A context block declares a member property by the same comparison of resolved values as any token. With `references: 'var'`, a member written as a reference is its `var()`. A shadow's members get none: there is no longhand to read them.

**`composites: 'shorthand'` declares a composite's own property and no member properties; a directive may override it** (*ruled and built 8 October 2026*). The option takes `'longhands'`, the default and today's output, or `'shorthand'`. It sits beside `typography: 'block' | 'font'` and works the same way: one choice for the system, followed by both declaring and reading.

- **Declaring.** Under `'shorthand'`, `@toghen declare` and `@toghen contexts` write `--card-border` and no `--card-border-width`, `-style`, `-color`.
- **Reading.** Under `'shorthand'`, a longhand read (`toghen(ds.card.border.width)`, `@toghen ds.card.border as longhands;`) under `tokenLayer` outside the token layer writes the literal, `1px`, not `var(--card-border-width, 1px)`: the property does not exist, and a `var()` naming it would claim a context reaches the read when none does. A whole read (`toghen(ds.card.border)`, `as shorthand`) is unchanged.
- **The override.** `@toghen declare ds.card as longhands;` and `@toghen contexts ds as shorthand;` set the form for that directive's output alone. The form comes after the path and before the comma, as in a query: `@toghen declare ds as shorthand, theme=dark from light;`. `value` and `var` are refused through `onUnresolved` as forms of `toghen()`.

Two needs bring it. A system that never reads a longhand gets a sheet without three properties per border. And a system that keeps a component tier from reading a primitive can keep it: under `references: 'var'` each member property is a `var()` of its own member's first hop, so when `card.border` is `{stroke.subtle}`, `--card-border` reads `var(--stroke-subtle)` but `--card-border-width` reads `var(--space-1)`, the primitive under it. Pointing the member property at the referenced token's member property instead (`var(--stroke-subtle-width)`) was asked for and is not done: `stroke.subtle` sits at a key that is not a CSS property, so it has no member properties, and the `var()` would name nothing. Giving every referenced composite member properties is the remaining way; it waits for a system that needs longhands and tiers both.

**Typography is not affected.** Its members beside `font` are not longhands of a shorthand; they are the properties the shorthand cannot carry, and dropping them loses them. It follows `typography` under either form.

**Reads follow the option, not the override.** A read cannot see which directive declared what: the directive may sit in another stylesheet, or another build. So reads follow `composites`, and an override is the author's exception, with its cost stated. `as longhands` under `'shorthand'` declares member properties no read uses, which is harmless. `as shorthand` under `'longhands'` leaves reads writing `var(--card-border-width, 1px)` with nothing declaring it, so they always take the fallback, the default context's literal, and a context does not reach them. The reference says so beside the override.

### Element states

Status: **built** (ruled 8 October 2026; built 8 October 2026).

*Superseded 13 October 2026 by [The component model, in standard CSS](./specs.md#the-component-model-in-standard-css): a state is a part in the path, written as a nested rule of the group's mixin. This section records the output as it is until the build.*

Modifiers are of two kinds, and CSS treats them differently.

- **Ambient contexts** (theme, density, contrast, brand) are set on an ancestor
  and hold for its subtree. Custom properties inherit, so they live in the token
  layer: a sublayer per modifier in resolution order, a context as a remapping of
  pointers, a chain where one decision spans two. A component names none of them.
- **Element states** (hover, pressed, disabled, selected) belong to one element
  and must not pass to its descendants. Written as a block, `:hover { --x: … }`
  is wrong: `<html>` is hovered too, so every button under the pointer's path
  would look hovered.

**The document says which kind.** `"inherits": false` beside the modifier's CSS
spelling marks an element state, CSS's own word for a value that does not pass
down (`@property`). Absent, it is `true`, today's behaviour, so no existing
document changes meaning. The plugin never infers the kind from the spelling: a
pseudo-class can only be an element state, but `[data-state='open']` could be
either, and a guess would be a silent wrong answer.

```json
"state": {
  "default": "rest",
  "contexts": { "rest": [{}], "hover": [ … ], "pressed": [ … ], "disabled": [ … ] },
  "$extensions": { "com.toghen": { "css": {
    "selector": ":{context}",
    "inherits": false,
    "contexts": { "pressed": { "selector": ":active" } }
  } } }
}
```

**`@toghen contexts` writes nothing for an element state.** The rest values are
the defaults', and the states are written by the components that use them.

**A block writes its component's states.** `@toghen path;` in a rule writes the
rule's declarations, then one sibling rule per non-default context of each
element-state modifier its tokens depend on (`dependsOn`, lib):

```css
@layer components { .button { @t ds.button; } }
/* → */
@layer components {
  .button {
    background-color: var(--button-background-color, #1a66e6);
    color: var(--button-color, #ffffff);
  }
  .button:hover    { --button-background-color: var(--surface-accent-strong); }
  .button:active   { --button-background-color: var(--surface-accent-deep); }
  .button:disabled { --button-background-color: var(--surface-muted); --button-color: var(--text-muted); }
}
```

- *The selector* is the rule's selector joined to the context's spelling, as `:toghen()` joins it, each part of a list on its own (`.a, .b` → `.a:hover, .b:hover`). The plugin refuses a spelling that cannot be joined (not compound, or an at-rule), naming the context.
- *The contents* are only the tokens that vary on that state.
- *The order* is the resolver's: modifiers in resolution order, contexts in the
  document's order. Two state rules can match at once (`:hover` and `:active`);
  source order decides, so the later one wins as it does in the resolver. A pair
  that needs its own value has two answers, below (*Combined states*).
- *The output is flat*: sibling rules after the rule, never nested, so nothing
  downstream depends on CSS nesting. The rule's own `@toghen` is replaced in
  place as today.
- It is the principle of `@toghen contexts`: a directive writes everything the
  document says about its target. Adding a state to the document adds its rule
  to every component that uses it.

**A state rule re-declares the token's own property, under `tokenLayer`.** The state does not get a property of its own; its rule sets the token's property on the element, as a Figma variant pins a mode on its node. A declaration on an element beats an inherited one, so the rest rule's `var()` reads the state's value there, descendants that read the token follow (an icon in the button turns with it), and nothing needs a name. The value written is the token's step for that context (the state's step in lib's `contextsOf` chain), with references kept as `var()` of the first hop whatever `references` says, so a theme set above still reaches it; a literal step is that literal.

Where an ambient modifier that comes **later** than the state in resolution order also defines the token, the later one must win on hover too, and a plain re-declaration in a component layer always wins. Under `bind: 'chain'` the value is then a chain head that reads that modifier's link first (`var(--button-background-color--theme, var(--surface-accent-strong))`); without it, the plugin gives the warning it gives for a token that changes under two modifiers, and writes the step.

**A token that varies on a state through a reference** (*corrected 8 October 2026, after the first build*). `button.backgroundColor` is `{surface.accent}`, and `hover` redefines `surface.accent`. The button's own step is unchanged, and writing `var()` of its first hop on the element reads the rest value, since `--surface-accent` was substituted where it was declared. Writing the resolved literal instead pins every ambient modifier, and leaves a descendant that reads `--surface-accent` on the rest value. The rule is the one complete blocks follow (see *Declaring a context*): a state rule re-declares the **closure**, every token on the reference path from what the block writes down to the token the state defines, each with its own text in that state. `--surface-accent` gets the state's step, `--button-background-color` its unchanged `var(--surface-accent)`, and both are substituted on the hovered element.

Under `references: 'resolve'` the token layer holds literals and there is no path to re-declare: the state rule writes the token's literal in that state, and, when the token also depends on an ambient modifier, gives the two-modifier warning.

**Without `tokenLayer`** there are no properties to re-declare. A state rule writes the CSS properties with the literal for that context, every ambient modifier at its default: `.button:hover { background-color: #1450be; }`.

**A state's scope written by hand.** `.button:t(state=hover) { @t ds.button; }`
writes only that state's rule, as above. A single read in it,
`.button:t(state=hover) { background: t(.bg); }`, writes what the token is in
that state: under `tokenLayer` the step with references kept (or the chain head),
since a `var()` of the token's own property would read the rest value; without
it, the literal. This is where an element-state selector differs from an ambient
one, which does not change a read under `tokenLayer` (see *The query scope*): an
ambient context is set by the cascade where the rule matches, a state is set by
nobody but this rule. A token that does not vary on the state reads as usual.

**A single read can re-point the component's own property** (*ruled and built 12 October 2026*). A system whose components read only their own wiring, never a semantic token, cannot use the plain read above: it writes `var(--border-separator)`, the state's step. And `as var` there reads the component's own property, which holds the rest value: the form is wrong in that place. So `as var` in a state's scope gets its honest meaning. `t(.scrollbarColor as var)` in `.quiet:t(state=hover)` writes the read as `var(--scroller-scrollbar-color)` **and declares that property in the same rule** with the state's step:

```css
.quiet:t(state=hover) { scrollbar-color: t(.scrollbarColor as var) transparent; }
/* → */
.quiet:hover { --scroller-scrollbar-color: var(--border-separator); scrollbar-color: var(--scroller-scrollbar-color) transparent; }
```

- **The value declared** is what a state rule writes for that token: the step in that state, references kept as `var()` of the first hop under `references: 'var'`, the literal otherwise; with `tokenLayer` unset it is still declared, on the element, since the declaration is what makes the read right.
- **Where the declaration sits:** in the same rule, immediately before the first declaration that reads the property; one declaration however many reads of the token the rule holds.
- **When it applies:** the rule's scope names an element-state context (written by `:t()` or pinned by `@toghen mode` that names only element states, as above) and the token varies on it. A token that does not vary on the state, or a scope that names an ambient modifier, reads as `as var` does today.
- **Refused as now:** `as var` on a path with no property of its own.
- **A plain read is unchanged,** and no option makes the re-pointing the default: that would move the output of every existing state rule.
- **The limit stays,** stated: a state that changes the token only through a reference leaves the referenced property at its rest value; only a block, which re-declares the closure, is right then.
- **What counts as a state scope.** A mixed selector, `:t(theme=dark, state=hover)`, counts as one, as it does for a plain read; a pin that names an ambient modifier does not. A read with a mode argument, `t(x as var, theme=dark)`, behaves as before.

**Not designed:** leaving a state out of a block, for a component that handles
`disabled` its own way.

#### Combined states (*ruled 12 October 2026, documented only*)

The later modifier wins a property whole, so a control that is selected and hovered loses its selection tint when hover sets the same property. The document does not give a pair its own value, and will not: a source naming a combination of contexts breaks the sum that both adapters are built on. Two ways already work, and the guide shows both.

- *A third element-state modifier,* ordered after the two and spelled as the compound. Probed: it writes `.row:is([aria-selected='true']):hover {…}`. In Figma it is an extra axis, pruned with `include`.
- *Composing instead of replacing.* Hover adds a wash over whatever the selection set, so no pair needs its own value. This is what `toghen-ui`'s hover wash does, and it is the lighter answer when it fits.

#### A component whose states live on a child (*ruled and built 12 October 2026*)

A context has one spelling for the whole document, so a block joins it to the rule's own selector. For a wrapper whose state is carried by a child (a field whose focus is its input's, a checkbox label whose checked state is its box's) that writes rules that never match: `.field:focus-visible`, on a label that cannot be focused. The component needs to say how its states join.

```css
.field { @toghen states via ':has(> input{state})'; @toghen ds.field; }
/* → .field:has(> input:focus-visible) { … }
     .field:has(> input:is(:disabled, [aria-disabled='true'])) { … } */
```

- **The directive** `@toghen states via '<selector>';` (short form `@t states via …`) sits in a rule and applies to the blocks in that rule and its nested rules, found by the same walk-back that `@toghen mode` and `@toghen base` use. The string holds `{state}` at least once; each occurrence is replaced by the document's spelling of the state being written. A string with none is refused, naming the rule. The spelling stays in the document, in one place; only the shape of the join is the component's.
- **What it changes.** The selector of the sibling rules a block writes: the rule's selector joined to the `via` string with each state's spelling put in, instead of the spelling joined to the rule's selector. Everything else about those rules is as above. With no directive, nothing changes.
- **A `:toghen()` nested in a pseudo-class sets a scope.** Until now a `:toghen()` inside `:has()`, `:is()` or `:where()` wrote the document's spelling and set no scope, so a plain read in the rule got the rest value. It now sets the scope the way an outer `:toghen()` does, so `.field:has(> input:t(availability=disabled)) { color: t(.color); }` reads the disabled value. Two exceptions, stated: under `:not()` it sets none, since negation means the opposite context; and a rule whose alternatives name different contexts of one modifier (`:is(:t(a=b), :t(a=c))`) sets none for that modifier. This fixes the surprise that the directive makes visible, and needs no `@toghen mode` pin.
- **In the document of the system that found the gap:** the selection spelling gains `:checked`, since a native checkbox carries `:checked`, not `aria-checked`; it never matches a row, so it is harmless there.
- **Figma** is unaffected: a variant pins the modifier's mode on the component root, and how CSS joins the selector is invisible to it.

- **A limit found in the build: one join for every state of a block.** `via` joins all the states the block writes through the child, hover and pressed included. That is right for a field and a plain checkbox label, whose every state is the child's. It is wrong for a boxed checkbox, where hover belongs to the whole label (`:has(> input:hover)` would wash only when the pointer is over the box itself), and for a disclosure row, whose open state sits on the summary button and whose hover sits on the row. Those components keep their hand-written pairs, with the reads pinned by a nested `:toghen()` instead of `@toghen mode`. A block cannot pick a spelling per state; that is the case the named spellings below would cover, and now has two real components behind it.
- **A limit found in the build: an alternative that names no context.** `:is(:t(a=b), .other)` sets the scope for the whole rule, so the `.other` branch reads the state's value too. The ruling is applied as written and the case is not special-cased.

*An alternative kept for later: named spellings in the document* (*pinned 12 October 2026, not ruled; two components in the playground are waiting on it*). A context gets more than one spelling, `"contexts": { "visible": { "selector": ":focus-visible", "within": ":focus-within" } }`, and a rule or block picks one by name (`:t(focus=visible:within)`). Every spelling then stays readable by other tools, the stated reason for putting spellings in the document. It costs a new document field, a name argument in lib's `getContextSelector`, and validation. Wanted if a respelling appears that a join shape cannot express, for example `:focus-within` where no `:has()` is wanted.

### Element states against selectors, layers and pins

*Superseded 13 October 2026; see [The component model, in standard CSS](./specs.md#the-component-model-in-standard-css).*

Ruled 10 October 2026, built 11 October 2026. A large real system met three limits of the element-state rules above.

**A variant that beats a state.** A block writes `.day:hover { --day-background: … }`; a later hand-written `.day.selected { background: … }` sets the colour directly, at the same selector strength, so a selected day keeps its selected colour on hover. Two answers, both kept:

- *A variant that is a state, declared as one.* When `selected` is an element-state modifier of the document, the plugin writes both rules, in resolution order, and the later one wins where both match, as the resolver says. This already works; the guide shows it as the preferred way, since the document then states the order itself.
- *`stateLayer`*, an option naming the cascade layer that generated state rules are written into, as `tokenLayer` names the layer that declares. Set, every state rule a block writes goes into that layer (`@layer states { .day:hover { … } }`), placed at the top level of the stylesheet beside the block's own layers, and the author orders it after the components: `@layer tokens, components, states;`. A state then beats any hand-written variant, whatever the selectors. Unset, state rules stay beside their rule, as today. A nested layer (`@layer components.states`) was considered and rejected: rules written directly inside `components` count as its last sublayer, so they would still beat it (a fact of CSS cascade layers, not measured here). Moving a rule out of its place must not change when it applies: the at-rules that enclose the block's rule (`@media`, `@supports`, `@container`, but not `@layer`) are written again around the state rule inside the state layer, and so is a context spelled as an at-rule. A block inside a nested rule is refused under `stateLayer`, naming it, since the state rule would lose its parent's selector.

**A hand-written state rule can go into the state layer too** (*ruled and built 12 October 2026*). `stateLayer` moves the rules a block generates; a hand-written `.day:t(state=hover) { … }` stays where it is written, so it beats a variant class only by source order and specificity, and every new variant has to be placed above it. A marker in the rule, `@toghen layer;` (short form `@t layer;`), moves that rule into the state layer, with its own selector and the same enclosing at-rules (`@media`, `@supports`, `@container`) written again around it, exactly as for a generated state rule. The marker is removed from the output.

- **Opt-in, per rule.** A rule without the marker is never moved: moving a rule must not change when it applies, and an author may have placed a rule where it is on purpose. So existing output is unchanged. The marker is allowed on any rule, not only one that names a state: the author is saying that rule should beat the components.
- **It needs `stateLayer`.** With the option unset the marker is refused through `onUnresolved`, naming the rule, rather than ignored: ignoring it would silently undo what the author asked for.
- **Its rule must be at the top level,** as for a block: a rule inside another rule is refused, naming both, since the moved rule would lose its parent's selector.
- **Placement and order** follow the generated state rules: the layer block is written after the top-level node that holds the rule, in the order the rules are met. The move happens when the rule is finished, so a block, a relative path or a pin inside the rule is written first. An enclosing `@layer` stays; a `@media`, `@supports` or `@container` the move leaves empty is removed. A selector list is not split by the marker alone, only by the rule's contexts, so two parts that name different contexts each get their own layer block.
- **The word is taken.** `@toghen layer;` could once have meant a block for a collection named `layer`. The marker wins; a collection with that name is written with its full path.

**A selector list naming a different context in each part.** `.quiet:t(state=hover), .quiet:t(state=focus-within) { … }` was refused: a read in it has one value per context, and the rule named two. Now a rule whose list parts name different contexts is written as **one rule per part**, in the list's order, each with its reads answered in its own context. Splitting a list into adjacent rules changes nothing in the cascade: each part keeps its own specificity and its place. Consecutive parts that name the same context stay together; no part moves across another. A rule that reads nothing (no `toghen()`, no block) keeps its list. A `:where()` or `:is()` whose arguments each name a context is split the same way, each rule keeping the wrapper around its one argument (`:where(:hover)`); `:where()` keeps zero specificity, and an `:is()` whose arguments differ in specificity is refused, naming the selector, since splitting it would lower the specificity of its weaker arguments. One rule when every part's values agree was considered and left out: it saves lines and costs a comparison, and the split output is as correct.

**A pin to an element state keeps the ambient modifiers.** A read under `@toghen mode` wrote a literal, pinning every modifier the pin did not name at its default: an open disclosure pinned to `state=hover` showed the default theme's hover colour inside a dark region. A pin that names **only element-state modifiers** now reads as a state's scope written by hand does (above): under `tokenLayer` the token's step in that state with references kept as `var()` of the first hop (or the chain head), so the theme above still reaches it; without `tokenLayer`, the literal. A pin that names an ambient modifier writes the literal, as before: there the author asked to fix it. `as var` was not used for this: it already means the token's own property, which would read the rest value.

*The limit, stated.* A state that changes the token only through a reference leaves the first hop's property at its rest value. A system that puts hover on a shared surface (`surface.raised` changes on hover, `disclosure.background` is `{surface.raised}` in every state) reads, under such a pin, `var(--surface-raised)`, the rest value; the plugin then falls back to the literal, right in the default theme only, as a hand-written state read does. A block in the rule (`@toghen ds.disclosure;`) re-declares the whole closure and is right in every theme. Adding the closure's declarations to the rule of a single read would fix it at a cost: `--surface-raised` would read hovered for the element's descendants too. Left open (see *Open questions*).

### Not built: mixins

A way to name a group of declarations once and use it in many rules
(`@toghen define` and `@toghen use`) was considered and is not built. A mixin
that gains parameters, conditions and loops is a template language, and Toghen
already has one for generated artifacts: kdlet. The only form that would be
worth having here is textual substitution of paths, modes and context lists into
what this plugin already writes, and the tools it would save typing for are the
selector and relative paths above. Logic belongs in kdlet, not in a stylesheet
directive. Revisit only when a real stylesheet repeats the same lines.

### The default failure path deadlocked

`onUnresolved: 'warn'` is the default and it **hung the build**, with no error,
no timeout and no output, for as long as this package existed.

`decl.warn(decl.root().toResult(), …)` inside a `Declaration` visitor re-enters
PostCSS's own lazy processing, which waits on the walk that is calling it. The
visitor's second argument carries the `Result` directly and is what the plugin
uses now.

Nothing caught it because **no test ever passed `'warn'` as a value**: the string appeared in the test file only inside a helper's type signature. Every consumer that took the default and mistyped one token path got a build that stopped and never said why; the ones that passed `'throw'` never met it.

**A regression here announces itself as a test run that emits nothing at all.** Neither a per-test `timeout` nor racing the call against a timer converts it into a failure: the deadlock blocks the runner, and the runner buffers its report until a run that never ends. `test/plugin.test.ts` now exercises all three branches, and their existing is the guard; their going red is not available.

## From specs.md: The component model, in standard CSS

**Considered and rejected.**

- *A part rule setting the CSS property* (`background: var(--button-hover-background)`) instead of re-pointing. Simpler, and the icon inside stops following. Rejected for the reason of 8 October.
- *`--when-*` mixins for parts.* A wrapper's state is on a child, which no mixin argument can say, since arguments are values, not selectors. A part mixin applied under the author's selector is the honest form.
- *Keeping the dialect beside the standard form.* Two ways to say one thing, and the specs double.

## Ruled: gaps the playground found

Found 11 October 2026 by `toghen-ui`, the design system of the plugin's own screen, built as Toghen's customer; investigated the same day, ruled 12 October 2026. The full investigation, with code lines, prior art and costs, is in [toghen-ui/decisions.md](https://codeberg.org/Toghen/ui/src/branch/main/decisions.md#five-gaps-toghen-ui-found-in-toghenpostcss-and-toghenlib). Each workaround in `toghen-ui` is marked `TOGHEN GAP:`.

1. **A component cannot respell a state for itself.** Ruled and built: the rule-scoped `@toghen states via` directive, and a nested `:toghen()` sets a scope. Named spellings in the document are pinned as an alternative. See *Element states*, *A component whose states live on a child*.
2. **A group cannot mark a key as not a CSS property.** Ruled: documented only. Move the key into a subgroup, which is never written. The guide says so. A mark on the token (`css.property: false`) was not chosen; a per-use exception list is rejected, since it restates the same fact at every use.
3. **A colour from a data value plus tokens.** Ruled: documented only. The monogram's pattern is the right CSS: the data value is a property set on the element, and the tokens complete it in the rule, `hsl(var(--hue, 210) calc(toghen(…) * 1%) …)`. It cannot be a token, since a custom property declared at the root reads the data value at the root. Not built: a token with a parameter, which needs a new idea in the lib and both adapters and has no Figma meaning. *The side defect:* colours are written as hex, so an `hsl` colour with a `none` hue comes out with hue 0; ruled: documented, no code. A hex colour cannot carry a missing component, and CSS Color 4 treats a missing component as 0 when converting between spaces (not re-checked against the spec text).
4. **`as shorthand` dropped members of a typography token.** Ruled and built. See *How a query is printed*.
5. **No combined states across modifiers.** Ruled: documented only; combination sources stay out of the document. See *Combined states*.

## Ruled: issues from a second consumer (12 October 2026)

Three issues from the second real consumer, ruled the day they were filed; the generalised need is stated in each place.

1. **A hand-written state rule can go into the state layer.** Ruled and built: an opt-in marker on the rule, `@toghen layer;`. See *Element states against selectors, layers and pins*. Not chosen: moving every rule that names a state automatically, which changes where existing rules apply.
2. **A single read in a state rule can write the component's own custom property.** Ruled: `as var` in a state's scope re-points the property in the same rule. Built. See *Element states*, *A state's scope written by hand*. Not chosen: making it the behaviour of every single read, which moves existing output.
3. **A token can name the value Figma writes where its CSS value cannot be held.** Ruled and built, in the Figma specs: see *Values Figma cannot hold as written*.

## Ruled: the hand-over round (13 October 2026)

Eight issues from the second consumer, filed after the component model landed, ruled and built the same day. The current text is in the specs, [The hand-over round](./specs.md#the-hand-over-round-ruled-and-built-13-october-2026). What the ruling found and weighed:

- **The diagnosis.** The model hands work to the mixins polyfill, to `@toghen contexts` and to the cascade, and did not check the hand-over. Not a flaw in the model: each fix is local.
- **One pipeline.** `@csstools/postcss-mixins` 1.1.0 does all its work in `Once`, which PostCSS runs for every plugin before any visitor, so a mixin written in a visitor arrives too late. Rejected: documenting two passes as the way.
- **A mixin name written twice.** The polyfill drops both definitions of one name (it deletes a name it meets twice) and leaves the `@apply` as written. The CSS Mixins draft of 8 October 2026 says the later one in a layer wins, as for properties. Ruled an error anyway. Rejected: a warning under `onUnresolved`.
- **A read's fallback.** Rejected: the whole chain ending in the literal, longer at every read; a warning, which the plugin cannot give, since it cannot see which stylesheet declares what.
- **Placing a declaration between rest and parts.** `@contents`, from the Mixins draft, already in the polyfill. A recipe that re-pointed the custom property from a container was written into the specs and removed the same day, once the local property changed what a part re-points.
- **Named spellings.** `@custom-media` (stage 2) and `@custom-selector` (stage 1), written by a directive the author asks for, the mixins left on literal spellings.
- **A nested instance.** Confirmed in headless Chrome 155. A probe compared five shapes against eight cases: the current output; every group copying its own tokens (cuts the child channel); the outermost group copying all tokens, or only re-pointed ones (both bind the copy at the component, so a theme set between the component and its child no longer reaches the child); and the reset with `initial`, which passed all eight. Rejected: `@private`, because the polyfill renames a private property written in a nested rule only inside one mixin, so a part applied from its own mixin writes nothing, and the wrapper answer needs that.
- **Not built: `@property` shorthands** (a list of names, optional descriptors, an unquoted `syntax`; stage 2). They shorten hand-written CSS; generated output would only make consumers add a polyfill that writes the full form back.
- **Also found:** `@function` is polyfilled (`@csstools/postcss-custom-functions` 1.0.1) and native in Chromium 139; no need here yet. `if()` and `@when`/`@else` have no established polyfill.

## Ruled: where a re-pointed token is reset (13 October 2026, after the release)

Rebuilding the playground after 0.16.0 found no reset in any component: its namespace `tg` holds `tg.clear`, `clear` is a CSS property, so `tg` had a mixin and the rule "the highest group with a mixin" put every reset there. Ruled: a token is reset in its component, the group above the first part of a part token that re-points it, the outermost when several do; the Figma adapter's definition of a component. Rejected: marking `tg.clear` `css.write: false` in the playground, which fixes one system and leaves the flaw.

## Ruled: installable from the repository, and the library as a peer (17 October 2026)

A consumer linked the library and the plugin from a local checkout by absolute path, which breaks in a second worktree and on any hosted build. Publishing to npm was set aside for now; the packages install from the repository by git URL instead.

- **Each package builds itself.** Ruled: a `prepare` script runs the package's build, and `tsup` and `typescript` are the package's own dev dependencies, so a git install has a `dist/`. It replaces `prepublishOnly`, since `prepare` runs before a publish too. Found while trying it: pnpm 10 runs a git-hosted dependency's build only when the consumer allows it in `onlyBuiltDependencies`, and stops the install otherwise, naming the package. The guides say so.
- **The library is a peer of the plugin.** Ruled: `peerDependencies` `@toghen/lib` `^4.1.0`, and `workspace:*` as a dev dependency inside the repository. The reason is in the code: the plugin recognises the library's errors with `instanceof` (a token not found is skipped), and the consumer builds the system with its own copy, so a second copy's errors would go unrecognised and a missing token would stop the build. A git URL and a version range cannot be merged into one copy by pnpm, so a regular dependency would make two. Prior art: PostCSS plugins peer on `postcss`, ESLint plugins on `eslint`. Rejected: a real range as a regular dependency, which also needs an override in every consumer, since the range resolves against npm; re-exporting the library from the plugin, which makes the plugin the front door to the core.
- **pnpm only.** npm cannot install a package from a folder inside a repository. Stated in the guides, not worked around.
- **The repository is private.** A machine installing needs access: an SSH key, or credentials on a hosted build. Publishing to npm, or making the repository public, would lift it.

## Ruled: a group with parts and no rest (19 October 2026)

A consumer's components took their resting look from a recipe they compose and defined only their states. Such a group had no own tokens, so it got no mixin, and each state was applied by hand under its own selector. Two families had kept a token restating a semantic value only to give the parts a rest. Ruled: a group with no own tokens gets a mixin when it has parts. It writes `@contents`, then the parts in the vocabulary's order. A part token with no twin already sets its own property, so the recipe's value shows through until a part applies. A namespace with no parts, and a group with a key that is no property, still get none.

In the same round, two other issues turned out to be covered. A part that follows an ancestor's state is written with a spelling that holds `&` (`.card:where([data-variant='primary']) &`) on the group that follows, and the dead rule on the element came from spelling the axis for the element itself. The guide now shows the case. Rejected: a key naming the ancestor for an axis, which saves nothing, since each value is spelled once at the group either way.

## Ruled: the adapter asks the core (21 October 2026)

Commit `78a9cb1` moved several of the adapter's own answers to the core, and changed no doc of this package. The adapter now takes from the core the one-collection shorthand, the default mode, the tokens under a group, a part token's component and rest, the part a group is and the parts in precedence order, the references in a raw value and the link name. Deleted with it: the adapter's invented `${group}.x` child, its sort by the vocabulary's rank, its default-mode lookup, its prefix filter and its collection prepending. The cascade asks the core for the order modifiers win in, by name. The rulings are in the [lib's decisions](https://codeberg.org/Toghen/lib/src/branch/main/decisions.md).

This round finished the move:

- **A group's tokens come from `childrenOf()`.** The mixin of a group lists the tokens one level under it as the core gives them, not by filtering every path by prefix and depth. The order is the same, document order.
- **The groups that may declare a vocabulary come from `childrenOf()` too.** `@toghen spellings` walks the groups down from the root rather than slicing every token path. Same groups, same order.
- **One function finds the token that owns a member path.** Writing a value and following a reference in a chain asked the same question twice, in two spellings.
- **The default mode is asked directly.** A wrapper that only called `getDefaultMode()` was deleted.
- **Only the cascade uses the order modifiers win in.** The blocks and layers of `@toghen contexts` keep it, since a later block must win as the later modifier does. The `--when-` mixins and `@toghen spellings` only list, so they follow the order the document declares its modifiers, which is the core's contract for a list.
- **`bind: 'chain'` refuses a collection built by hand again.** Such a collection has no resolver, so it has no modifiers, and the refusal in the chain planner was never reached: the directive quietly wrote plain blocks. `@toghen contexts` now refuses before writing anything, with the same message, and the test deleted in `78a9cb1` is back.

## Ruled: rules with more parts come after rules with fewer (21 October 2026)

**Status:** ruled and built.

**The defect.** The core rules which token applies under a selection of part values: the one with more matching parts, then, on a tie, the one whose latest differing axis comes later in the vocabulary (see the [lib's decisions](https://codeberg.org/Toghen/lib/src/branch/main/decisions.md)). A component's mixin nested each part as a rule, and a part nested its own parts inside its rule. The CSS got "more parts win" only from the specificity nesting adds, and the tie from the order of the rules. An at-rule spelling adds no specificity, and neither does `:where()`. Reproduced with the vocabulary `variant: { primary: "[data-variant='primary']" }`, `state: { hover: ':hover' }`, `input: { fine: '@media (pointer: fine)' }` and the tokens `button.background`, `button.hover.background` and `button.primary.fine.background`. Under *primary, hover, fine*, `applies()` names `button.primary.fine.background`. The expanded CSS wrote `.b[data-variant='primary']` inside `@media (pointer: fine)` at the specificity of two classes, before `.b:hover`, also two classes, so hover won in the browser. The same with a `:where(.calm)` spelling.

**The ruling.** Write rules with more parts after rules with fewer, whatever their nesting, so the cascade gives the core's answer for at-rule and `:where()` spellings too.

**What changed in the output.** A group's mixin writes one rule for every part below it, at any depth, those with more parts after those with fewer. Between rules of as many parts, walking the axes from the last, at the first axis where two differ, the one with a value there comes later. Where both have a value of that axis, the value declared later comes later: the core is never asked that case, since a selection holds one value per axis, but a browser can match two at once, as `:hover` with `:active`. Each rule is the chain of spellings from the group down, each placed as before, and holds the part's own declarations in place of `@apply` of the part's mixin. A part's mixin keeps its name and holds its own declarations, then the rules of the parts below it, in the same order, so a part applied by hand under a wrapper still carries its own parts. In the running example only `button.selected.hover` moves: it was nested in the `selected` rule and is now a rule of its own, `&[aria-pressed='true'] { &:hover { … } }`, after every rule of one part. A test, `precedence.test.ts`, compares the cascade with `applies()` for every selection of the running example's `button` and `field`, and of a synthetic component with an at-rule axis and a `:where()` axis.

**The limit that remains.** Order decides only between rules of equal specificity. A rule still loses to a rival that outweighs it. A one-part `:hover` rule outweighs a one-part at-rule or `:where()` rule declared later in the vocabulary, and a spelling with an id, or an `:is()` with a heavier argument, outweighs a chain of lighter ones. The reference states it under *Part spellings*. Nothing is built for it.

**Considered and rejected.**

- *(b) A warning when a part token with two or more parts has an at-rule or `:where()` spelling.* The core's answer and the browser must agree. A warning leaves the stylesheet wrong and hands the author a fix the adapter can make.
- *(c) State the limit in the docs and pin it in a test.* The same reason: a note leaves the stylesheet wrong, and a test that pins a wrong answer keeps it.

## Ruled: start from token files, and theme by map (21 October 2026)

**Status:** ruled and documented.

The core's [loading chapter](https://codeberg.org/Toghen/lib/src/branch/main/decisions.md#ruled-the-loading-chapter-21-october-2026) lets `load()` read token files with no resolver document, and read a document under an overrides map. The adapter reads no files and is unchanged: it takes a built system, whatever `load()` was given.

What changed is where its docs start. *Set up the pipeline* in the guide builds the system from token files first, says they give the defaults only, and then names the resolver document as the form that brings modifiers and contexts. A new guide section, *Theme a system with a map*, builds the system twice, once with the example's `warm.overrides.json`, and runs the plugin once per system. The tutorial gains a last step that passes the map to `load()` and shows what moves. `origins` in the reference says that under a map the files named are the files read.

Two tests in `example.test.ts` hold the claims. The stylesheet built with the map differs from the plain one only in the values of `surface.accent`, of the three tokens that refer to it, and of the fallbacks that read them; every rule, mixin, selector and property is the same. And a list of token files gives the same `@toghen contexts` and `@toghen mixins` output as a one-set resolver document over the same files, though the collections are named differently.

## Ruled: the library's errors are recognised by class (21 October 2026)

**Status:** ruled and built.

`failure()` wrote the library's own sentence, `Cannot write the mixins of "…": …`, for any error whose constructor
was `Error`, which caught every other plain error too. The core now throws its parts errors as `InvalidTokenError`
and its spelling errors as `ResolverValidationError` (see the [lib's decisions](https://codeberg.org/Toghen/lib/src/branch/main/decisions.md#ruled-the-parts-and-spelling-errors-carry-a-class-21-october-2026)),
and `failure()` recognises those two classes with `instanceof`. Every message it writes is the same. A test in
`contexts.test.ts` holds the sentence for an `atRule` that does not start with `@`.

## Ruled: the adapter no longer normalizes a chain's values (21 October 2026)

**Status:** ruled and built.

The core now gives each step of a `$value` chain, and its base, in the shape it stores, for the token's own type in
the step's context (see the [lib's decisions](https://codeberg.org/Toghen/lib/src/branch/main/decisions.md#ruled-a-chains-values-come-in-their-stored-shape-21-october-2026)).
`chains()` no longer passes a step or the base through `normalizeTokenValue()`, and no longer imports it. It keeps the
type it reads for the token, which it needs to spell the value. The earlier ruling on raw step values, under *Open
questions*, is superseded in that respect: a step is no longer raw. Every golden file is the same. A test in
`chain.test.ts` holds a group-typed colour and dimension that a context writes as strings.

## Ruled: every part rule weighs the same (22 October 2026)

**Status:** ruled and built.

**The defect.** The last round wrote part rules in the order the core's `applies()` ranks them. But order decides only between rules of equal specificity, and each rule kept the weight of its spelling: `.b:hover` weighs two classes, while a rule inside `@media (pointer: fine)`, or with the spelling `:where(.calm)`, weighs one. So a one-part `:hover` rule still beat a one-part at-rule or `:where()` rule declared later in the vocabulary, where `applies()` picks the later one. The entry above stated this as the limit that remained.

**The ruling.** Every part rule gets one specificity, so only order decides, and the cascade equals `applies()` in every case.

**The mechanism.** Each part rule puts its spelling inside `:where()`, after `&`. An appended spelling `:hover` becomes `&:where(:hover)`. A spelling that places itself with `&` becomes `&:where(<spelling>)`: `:is(&:disabled, [aria-disabled='true'] &)` becomes `&:where(:is(&:disabled, [aria-disabled='true'] &))`, and `.card:where([data-variant='primary']) &` becomes `&:where(.card:where([data-variant='primary']) &)`. The inner `&` keeps its meaning, the enclosing selector. An at-rule spelling adds no selector and is unchanged. A chain of parts stays a chain of nested rules, each placed the same way, so `button.selected.hover` is `&:where([aria-pressed='true']) { &:where(:hover) { … } }`. Only `placed` in `mixins()` changed.

Every part rule then weighs exactly what `&` weighs, the rule that applies the mixin. That weight is needed, not only enough. The component's rule sets each re-pointed local property to `initial` and reads it; a part on the same element must beat those resets. Both sit in one mixin, the resets first, so at equal weight the part comes later and wins. A part's mixin applied by hand under a wrapper works the same way: its sub-part rules weigh what the wrapper's rule weighs, and come after its own declarations.

The matched elements are the same as before for every spelling whose subject is the element: `&:where(S)` matches what `S` matched (or `&S`, for an appended spelling), since each alternative in `S` already required the element to match `&`. No recipe in the guide and no test writes a spelling whose subject is another element, such as `& > .icon`; placed this way it would no longer reach that element. A spelling already says when a part applies to the element itself, and the guide styles a child with its own group, so the reference now says so rather than building a second form.

**Forms weighed.**

- *`&:where(<spelling>)` for every selector spelling, one nested rule per part (chosen).* One form for both kinds of selector spelling, the chain kept as nested rules, and a mixin that still reads as the vocabulary: each spelling appears whole, once.
- *One `:where()` holding the compound of a chain*, such as `&:where([aria-pressed='true']:hover)`. Shorter for two appended spellings, but it cannot hold an at-rule or a spelling with `&`, so the mixins would need two forms.
- *Zero specificity*, `:where(&:hover)`. It loses to the component's own resets on the same element.
- *Raising every rule to the heaviest spelling's weight*, by repeating a class or padding with `:not(#\#)`. It needs the adapter to compute specificity, and the selectors stop saying what they mean.
- *A cascade layer per number of parts.* A layer nested in a mixin is named for the whole stylesheet, and orders against the author's own layers.

**What changed in the output.** Only part selectors. The golden files `mixins.out.css`, `mixins-button-parts.out.css`, `mixins-field.out.css`, `field.out.css`, `tutorial.out.css`, `tutorial-button-hover.out.css`, `tutorial-button-all.out.css`, `typography-block.button-mixin.out.css`, `typography-font.button-mixin.out.css` and, under `tutorial/`, `hover/button.out.css`, `hover/mixins.out.css`, `hover/mixins-hover.out.css` and `warm/button.out.css` changed, each in its part rules alone. The spellings directive is unchanged: its custom selectors keep the literal spellings. An author's own rule that names a state, as `.button:hover` or `.toolbar .button:--state-hover`, now outweighs the part rule wherever it sits, where before it tied and order decided. In `toghen-ui` no hand-written rule in the component layer changes its outcome: the one that shares a property with a part on the same element, the row's rest shadow over its detail, already beat every part it meets, and still does. The plugin's own stylesheet is unlayered, and beats the layered parts as before. `precedence.test.ts` now compares the cascade with `applies()` for the case that failed, a one-part `:hover` against a one-part `:where()` and a one-part at-rule declared later, over every selection; the test cascade reads a part rule as `&:where(<spelling>)`.

**Also pinned.** Inside `@toghen contexts` or `@toghen mixins`, a token that interpolates a non-scalar into a string (`InvalidInterpolationError`, a kind of `InvalidTokenError`) is reported since the last round as `[@toghen/postcss] Cannot write the contexts of "<collection>": <the library's message>`, or `the mixins of "<top-level group>"`. The library's message names the token, as `token "ds.card.label"`. A test in `contexts.test.ts` holds the sentence for both directives.

**Considered and rejected.**

- *Document the limit.* A note leaves the stylesheet wrong, where the adapter can make it right.
- *A warning when a spelling outweighs a later rival.* The same: it hands the author a fix the adapter can make.

## Ruled: a colour outside sRGB is written in its own space (24 October 2026)

**Status:** ruled and built (ruling 4b of the [computed-values plan](https://codeberg.org/Toghen/lib/src/branch/main/.reference/plans/plan-2026-10-24-computed-values.md#rulings-24-october-2026)).

Lib now computes every value it can, so any `oklch()` string or `color-mix(in oklch, …)` can reach this adapter as a structured colour outside sRGB, where before it reached CSS as a string. Hex clamped it. A colour is now hex when it carries a `hex` or lies in sRGB (each channel within half a step of 0–255, so clamping changes no digit), and otherwise its own CSS function: `oklch(0.7 0.35 30)`, `color(display-p3 1 0 0)`, with ` / <alpha>` below 1. Only out-of-gamut output changed; no golden file did.

**What the build found.** Lib exports neither a gamut check nor its `spellCssColor`, and culori is lib's dependency, not this package's. The own-function spelling is written here from the DTCG space names, which are CSS's. The gamut check reads the unclamped channels through `normalizeColorToSRGB01`: 1% of the colour mixed into mid-grey in `srgb` stays inside the gamut, so the clamp does not touch it. If lib exports a gamut check, it replaces that. Also under `references: 'var'`, a doubled brace in the authored string, rewritten with `var()`, is now the literal brace (`literalText()`), in a `toghen()` value and in a chain's links; before, it was written doubled.

**Considered and rejected.** *Hex always* (a visible clamp for wide-gamut authors); *always the colour's own space* (every non-sRGB token's CSS changes, for no rendering gain inside sRGB).

## Moved: a repository of its own, numbered from 0.1.0 (25 October 2026)

**Status:** done.

**The change.** The package left the Toghen monorepo for its own repository, [`Toghen/postcss`](https://codeberg.org/Toghen/postcss) on Codeberg, in one first commit. Its history before the split is not carried over. Its version starts again at 0.1.0; the last version before the split was 0.21.0. Links that crossed into other packages now point at their repositories.

**Why.** Ruled by Egildo on 25 October 2026: one repository per package, and a [house](https://codeberg.org/Toghen/house) repository for what they share (the constitution, the speckit preset, the Biome config, the purity check). The plan is in house, `.reference/plans/workspace/plan-2026-10-25-tooling-codeberg.md`.

**With it.** Biome lints and formats the code, `pnpm check` runs every gate, and speckit with the house preset runs the rounds. The tests are type-checked, under `tsconfig.test.json`, and read the running example through `@toghen/lib`.

## Open questions

- *Moot since 13 October 2026.* **A single read in a state's scope, through a reference.** It now holds for a pin to a state too. A block in a
  state rule re-declares the reference closure; a single `toghen()` read in
  `.a:t(state=hover)` cannot, since it is one property's value, and writes the
  literal. One fix would add the closure's declarations to the read's own rule, at the cost of the element's descendants reading the state's values. Where the state's value is itself a reference to a token an ambient
  modifier changes, that literal pins the ambient default. Writing the state
  token's own step text (`var()` of its first hop) would fix it; not done until
  a system reads a state this way.
- *Moot since 13 October 2026.* **A pin that freezes a modifier the token depends on** (proposed 8 October
  2026, not ruled). A read under `@toghen mode` that names some modifiers pins
  the others at their defaults. A warning where the token depends (`dependsOn`)
  on a modifier the pin does not name would catch the case that matters and stay
  quiet otherwise.

Closed: **a block for a default context.** `@toghen contexts` now writes one for
every context with a spelling, and the parent context no longer has to be known.

- **A default context with no spelling.** It gets no block, and a subtree cannot
  return to it. Whether the plugin should require every context to be spelled
  once `contexts` is used, or the document should be able to say "this one is
  spelled by absence", is open. Today the document spells it or the author
  writes `declare … from …`.
- **Modifiers on different elements through a reference.** Complete blocks do not
  repair a fall-through across modifiers; `bind: 'chain'` does, built 6 October
  2026 (see *Chains*; the link names, which tokens are chained, block
  membership, the option shape, the conditional reference and raw step values
  were all ruled and are stated in the reference). Still open inside it:
  - *Which tokens a chain covers.* Lib could report the one-link-with-reference-base
    case so that the plugin does not recompute it.
  - *`$type` that varies across contexts.* The type is read from the resolved
    token; a type that changes between contexts is not handled.
- **Firefox and Safari.** The layer facts were measured in Chromium and WebKit
  as Playwright builds them. Firefox was not run, and Safari itself was not.
- *Moot since 13 October 2026.* **A pin pins every modifier.** *Narrowed 10 October 2026:* a pin naming only element states now keeps the ambient modifiers (see *Element states against selectors, layers and pins*); what follows holds for a pin naming an ambient modifier. A read under `@toghen mode` writes a literal,
  so the modifiers the scope does not name are pinned at their defaults. A pin
  that keeps the cascade for the other modifiers would need a `var()` read in a
  forced context, which CSS cannot say. The guide points to the context's own
  spelling on the element instead. The warning proposed above, for a pin that
  freezes a modifier the token depends on, is the one thing that could soften
  it. Revisit if a system pins often.
- *Moot since 13 October 2026.* **Several collections and `:toghen()`.** A modifier found in two collections is
  an error unless a base names the collection. If systems with a shared
  modifier name turn out to be common, the pseudo-class could take a collection
  (`:toghen(ds.theme=dark)`); not done until someone needs it.
- **A form per modifier.** `light-dark()` for a two-context colour modifier, as a
  field in the document beside `selector` and `atRule`, is kept for later; its
  evaluation at the consumer was measured, its document shape was not designed.
- **`var()` fallbacks inside the token layer.** `var(--surface-accent, #0066cc)`
  between token tiers would make a missing declaration fail soft, at the cost of
  hiding the mistake. Only the consumer side has a fallback now (see
  `tokenLayer`).
- **An undeclared target.** The plugin cannot know whether a `var()`'s target
  is declared in another stylesheet. When `declare` and `references: 'var'`
  run together it could warn about a target this run never declared. Not done;
  the demo's test checks it from outside instead.
