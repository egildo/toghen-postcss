# @toghen/postcss — Technical Specifications

> **Audience:** developers, AI coding agents, and contributors.
> For the user manual and examples, see [guide.md](./guide.md).
> For the API surface, see [reference.md](./reference.md).
> For the rulings, the retired dialect and the open questions, see [decisions.md](./decisions.md).

---

## Purpose

`@toghen/postcss` is a PostCSS plugin that turns a stylesheet's token queries into standard CSS. It writes `t()` (long form `toghen()`) as a `var()` of the token's custom property, with the value as fallback, or as the literal value. It writes `@toghen contexts` as every context's custom properties, in cascade layers; `@toghen mixins` as the mixins a component applies; and `@toghen declare` as the custom properties of a group the author names. It is intentionally thin: all token semantics and resolution logic live in `@toghen/lib`; this package decides only how CSS spells what lib answers.

The plugin emits standard CSS and no dialect of its own. A component is written as [The component model, in standard CSS](#the-component-model-in-standard-css) describes.

---

## Architecture

### Plugin shape

Standard PostCSS plugin pattern:

```typescript
export default function toghenPlugin(options: ToghenPluginOptions): Plugin {
  return {
    postcssPlugin: '@toghen/postcss',
    Once(root, { result }) { /* the retired options, reported once per stylesheet */ },
    Rule(rule, { result }) { /* a retired selector: reported, and left as written */ },
    Declaration(decl, { result }) { /* toghen(path[ as value][, mode]) and t(…) in a value */ },
    AtRule: {
      toghen(atRule, { result }) { /* @toghen contexts | mixins | declare; anything else is reported and left in place */ },
      t(atRule, { result }) { /* the same, short form */ },
    },
  };
}
toghenPlugin.postcss = true;
```

The `Rule` visitor reads a selector only to report the retired ones. Any other selector is CSS the plugin does not read, so a pseudo-class written by hand passes through untouched.

### Directive handling

A call is found in a declaration value with one pattern, long and short form alike, only where a function name can start:

```regex
/(?<![\w-])(?:toghen|t)\(\s*([^,)]+?)(?:\s*,\s*([^)]+?))?\s*\)/g
```

**Capture groups:**
1. `path`: the token path, with ` as value` after it when given (e.g., `colors.primary.blue as value`)
2. `mode`: optional context (e.g., `theme=dark`)

Each match goes through one function, `read()`. It resolves the path, takes the context from the call or the default, and prints the value in the form the position and `as value` decide: a literal, a `var()` of the property, or, under `references: 'var'`, a `var()` of the first hop. `system.resolveValue()` is one step of it, never the whole.

Three at-rules are directives: `@toghen contexts`, `@toghen mixins` and `@toghen declare`. Any other `@toghen` at-rule is reported with one sentence naming its replacement, and stays in place.

### Short forms

`t()` is `toghen()`, and `@t` is `@toghen`, with everything after it unchanged: `@t contexts`, `@t mixins` and `@t declare`. They are aliases, not replacements. The long forms stay, because existing stylesheets and the documentation use them.

**`t(` is matched as a whole name.** CSS function names end in `t(` often (`inset(`, `rect(`, `repeat(`, `format(`), so `t(` counts only where a function name can start: at the beginning of a value or after whitespace, a comma, `(`, `/` or an operator, never after a letter, a digit, `-` or `_`. The same boundary applies to `toghen(`.

**A known risk, accepted.** Plain-named functions are CSS's too; CSS's own newer functions are plain (`if()`, `env()`), and author functions are dashed (`--name()`). A CSS `t()` is unlikely and not impossible. If one ships, the long form is unaffected and the alias is withdrawn.

### Resolution boundary

- The plugin receives a pre-built `DesignSystem` via options; it does **not** load tokens from disk
- No filesystem assumptions: the caller is responsible for token loading and resolver setup
- This keeps the plugin stateless and testable

### Error modes

Three different failures share this channel, and the message says which: the token
could not be **found**, the core could not **compute** its value (its sentence names the
token, the mode and the reason, such as a typed dimension that resolves to a list), or
it was found and its value has no CSS spelling.

| Mode | Behavior |
|---|---|
| `warn` (default) | Logs a PostCSS warning, leaves the original `toghen(...)` call intact |
| `throw` | Throws a PostCSS error, aborting the transform |
| `ignore` | Silently leaves the original `toghen(...)` call intact |

Leaving the directive intact is deliberate on the two non-throwing paths: an
unresolved `toghen(...)` in the output is visible, greppable, and caught by any
build step already checking that no directive shipped. It is the one failure
that cannot be mistaken for a value.

A warning is written through the `result` the visitor is given, never through `toResult()` of the root: that re-enters PostCSS's own walk and hangs the build without a message.

### Composite types — what this adapter can write

The core resolves composite types through its handlers; serialising them to CSS
is this package's job, and the two lists are not the same length.

A composite is one of two kinds (see the core's
[specs.md §Composite Value Interfaces](https://codeberg.org/Toghen/lib/src/branch/main/specs.md#composite-value-interfaces)).
A **list** is one property with several entries, and it is written as a value. A
**block** is several properties at once. `toghen()` works at value level and a
block is not a value, so `toghen()` refuses a block whole. `@toghen` writes it
as declarations, and `toghen()` can still write it member by member.

| `$type` | Kind | CSS | Status |
|---|---|---|---|
| `color`, `dimension`, `fontFamily` | — | hex for a colour that has one or lies in sRGB, its own CSS function (`oklch(…)`, `color(display-p3 …)`) outside it; `16px`; comma-joined list; `transparent` for exactly black at alpha 0; the stored `currentColor` as written | written. A family is read through lib's `fontFamilyNames()`, so a string with commas is a list (see lib's [Token values](https://codeberg.org/Toghen/lib/src/branch/main/specs.md#token-values)), and each name is quoted when it needs it (see [A family name is quoted when it has a space](#a-family-name-is-quoted-when-it-has-a-space)) |
| `duration` | — | `200ms`: `{ value, unit }`, the dimension spelling | written |
| `number`, `fontWeight` | — | the number; lib stores a `fontWeight` keyword as its number | written |
| `cubicBezier` | — | `cubic-bezier(0, 0, 0.58, 1)` | written, **chosen by `$type`**: a four-number array is otherwise a list, and a list is comma-joined, which no browser reads as an easing. A transition's `timingFunction` member is spelled the same way |
| `strokeStyle` | — | a keyword (`solid`, `dashed`) as written | **written as a keyword, refused as an object.** `{ dashArray, lineCap }` has no CSS spelling |
| `border` | — | `1px solid #000`, the `border` shorthand's order | written; refused if its `style` is a `strokeStyle` object |
| `transition` | — | `200ms cubic-bezier(…) 0ms`: duration, timing function, delay | written |
| `shadow` | list | `box-shadow` syntax, arrays comma-joined | written |
| `gradient` | list | — | **refused.** The DTCG value carries stops and no direction. There is no honest single spelling, and defaulting to `180deg` would be a decision this adapter is not entitled to make silently |
| `typography` | block | under `typography: 'block'` (the default), one longhand per member, each reading its own property; under `'font'`, the `font` shorthand, with the members it cannot carry beside it | **refused as a value by default.** It is several CSS properties (`letter-spacing` and `text-transform` have no place in the `font` shorthand), so no single declaration value is correct. `@toghen mixins`, `@toghen declare` and `@toghen contexts` write its members, and under `'font'` `toghen()` writes the shorthand |

**The `font` shorthand is an opt-in spelling, and does not contradict the refusal.** Under `typography: 'font'`, a typography token is written as the `font` shorthand of the five members it can carry, and `@toghen declare` declares the rest beside it, one property each.

The refusal stands for the token as a whole: no single value holds every member. The shorthand is a declared subset of it, and the subset is complete only together with the properties beside it. Systems that publish text styles as one property want exactly that, so a rule cannot pick a size and forget its line-height.

It is not the default because a stylesheet that writes `font: var(--text-body)` and nothing else silently drops letter-spacing, and that is a choice for the system to make, not this adapter.

**References inside a function stay `var()`.** Under `references: 'var'`, a
member of a `cubicBezier`, `border` or `transition` written as a reference is
its `var()` in place: `cubic-bezier(var(--ease-x1), 0, 0.58, 1)`. CSS
substitutes a `var()` anywhere in a value, inside a function included, so
nothing is written resolved for being inside one.

A member path works on any resolved value, not only a block: one layer's colour
is `toghen(elevation.raised.0.color)`. The core owns that rule; this adapter
needs no code for it, because each member's shape already has a spelling.

**A value is written as lib computes it.** A `color-mix()`, a `calc()` and a member written with a reference reach this adapter computed, in lib's stored shapes, so nothing here reads CSS functions; see lib's [Token values](https://codeberg.org/Toghen/lib/src/branch/main/reference.md#token-values).

**A typography token's further members are written beside `font`.** Lib accepts any member keyed by a CSS property in camelCase (`fontVariantNumeric`). The plugin writes each where it writes `letterSpacing`: a member property under `declare` and `contexts` (`--type-tag-font-variant-numeric`), a longhand under `@toghen mixins` and `typography: 'block'`, and beside `font` in a group under `typography: 'font'`. A member whose spelled key is not a property mdn-data knows is reported through `onUnresolved` and written anyway, as a group key is. A letter spacing in `em` is written as `0.08em`.

### A family name is quoted when it has a space

A family name is written bare only when it is a single CSS identifier or a generic family. Anything else is quoted, so `"Icon Sans"` and `"Helvetica Neue"` keep the quotes the author wrote, and a name that is a keyword as a whole (`inherit`, `initial`, `unset`, `revert`, `default`) is never read as one.

- **Quoted:** a name containing a space, a name that is not a single identifier (a digit first, punctuation), and a name that is a CSS-wide or reserved keyword (`inherit`, `initial`, `unset`, `revert`, `revert-layer`, `default`). Double quotes, a double quote inside the name escaped.
- **Bare:** a single identifier that is not a keyword (`Inter`), a generic family (`serif`, `sans-serif`, `monospace`, `cursive`, `fantasy`, `system-ui`, `ui-serif`, `ui-sans-serif`, `ui-monospace`, `ui-rounded`, `math`, `emoji`, `fangsong`), and a `var()`.
- **Everywhere a family is spelled:** the `font` shorthand, a `font-family` longhand, a single `toghen()` read of a `fontFamily` token, and a typography member's family. One function spells them.
- **Not chosen:** quoting only what is strictly needed (it leaves `Icon Sans` bare and loses the author's quotes), and quoting every non-generic family (`Inter` included), which moves the most output for no gain. Both spellings are valid CSS, so no rendering changes.

### References kept as `var()`

`references: 'resolve'`, the default, writes what a token **is**.
`references: 'var'` writes what it **says**: a reference stays a reference, as
a `var()` of its first hop. It is the CSS side of what the Figma adapter does
with aliases and bindings, and it reads the same thing, `referencesOf()`, over
the same thing, the resolved value. The resolved value gives the shape, which
`valueToCss` already knows how to spell; each reported reference replaces the
member at its address with a `var()`. An interpolated reference is rewritten in
the authored string instead. That is the one place CSS keeps more than Figma
does: Figma cannot bind to part of a string, and CSS can concatenate.

So `'var'` keeps the authored `color-mix(in srgb, var(--shadow-ink) 5%, transparent)` where `'resolve'` writes the colour lib computes ([Token values](https://codeberg.org/Toghen/lib/src/branch/main/reference.md#token-values)), and a doubled brace in the authored string is written as the literal brace, through lib's `literalText()`.

No reference grammar lives here. The adapter finds the text `{path}` to
replace from `referencesOf()`'s `to`, never by scanning.

**Only the first hop**, so each tier points at the tier directly below it and a
chain survives into the browser one link at a time. Writing the last hop would
be `'resolve'` with extra steps.

**The path is resolved first, always.** A missing token, a cycle and a dangling
reference fail in `resolveValue()` with the core's message, in either setting;
the `var()` path only runs for a path that resolves.

### Declaring a context

`@toghen declare` writes one custom property per token in a group, which closes the loop: every `var()` names a property the same function declared. It takes a path, an optional context after a comma, and `from`. The collection segment of the path may be left out when the document has one collection. A path that names no token is reported.

A declaration in a non-default context writes the tokens whose **resolved** value
differs from the default's, compared by their CSS spelling. Not the ones whose
written text differs. The reason is how CSS evaluates custom properties. This is
the dark context of the tutorial, from [tutorial.out.css](./test/example-output/tutorial.out.css):

```css
        [data-theme='dark'] {
            --surface-raised: #2b2b2b;
            --surface-accent: #5c9bff;
            --surface-selected: #26364d;
            --text-default: #f2f2f2;
            --text-muted: #a6a6a6;
            --button-background-color: #2b2b2b;
            --button-color: #f2f2f2;
            --button-icon-color: #a6a6a6;
            --button-primary-background-color: #5c9bff;
            --button-hover-background-color: #26364d;
            --button-pressed-background-color: #26364d;
            --button-pressed-color: #a6a6a6;
            --button-disabled-color: #a6a6a6;
            --button-selected-background-color: #26364d;
            --button-selected-hover-background-color: #5c9bff;
            --field-background-color: #2b2b2b;
            --field-color: #f2f2f2;
            --field-focus-outline-color: #5c9bff
        }
```

`--button-primary-background-color` is written here although its own source did not change: it depends on `surface.accent`. A `var()` in a custom property is substituted on the element where the property is declared, and descendants inherit the substituted value. Re-pointing one token is enough only when the context sits on the root element. A context on a subtree must re-declare what depends on the changed token too, and in `var` output the dependent's text is the same in both modes: `--button-fill` reads `var(--surface-accent)` either way. Comparing text would drop it. Comparing resolved values keeps it, and gives the right set in both places: exactly what changes at the root, the changed tokens plus their dependents in a subtree. At the root the dependents are redundant and harmless.

**The base is the parent context, and `from` names it.** Without it the
comparison is against the default context, which is right at the root and for a
subtree whose parent is the default. A context nested inside another one, a
light island in a dark panel, would otherwise miss the tokens its parent
changed and it does not. `@toghen declare ds, light from dark;` compares with
dark instead. The plugin cannot see the nesting of selectors, which is only
known in the browser, so the author says it. `@toghen contexts` does not need
`from`, because its blocks are complete (see *Writing every context*).

A `from` that names no context is refused. A mistyped base would fail every
comparison, and a failed comparison counts as a difference, so it would write
every token and look like it worked.

A typography token in a declared group is declared member by member under `typography: 'block'` (`--type-body-font-size`), and as its shorthand plus the members the shorthand cannot carry under `'font'`; it is never skipped.

### Writing every context

`@toghen contexts` writes what a stylesheet holding a system's custom properties
is mostly made of: the defaults, then a block for every context of every
modifier, each holding everything its modifier varies. The selector comes from
the resolver document (`$extensions["com.toghen"].css`, read by the core's
`getContextSelector`). The document carries the spelling so that adding a
context writes its block, and so that any other tool can read how a context
appears in code. The directive's grammar is in
[reference.md](./reference.md#toghen-contexts).
It is refused inside a rule, since the contexts are rules themselves.

**Why the blocks are complete.** A block that held only the tokens that differ from the defaults could not be placed by the plugin, which cannot see how selectors nest. A light island inside a dark panel needs the tokens the panel changed set back, and only the author knows that nesting. Each block therefore restates all that its modifier varies, so any element anywhere can set any context and be right, with no analysis of nesting and nothing for the author to say. The price is a few duplicated lines per modifier. It also leaves a scope wrapper (a directive that wraps rules and infers `from`) nothing to infer.

Varied is measured on the resolved values, the way `declare` measures a
difference (see *Declaring a context*), and for the same reason: a dependent of
a varied token must be in the block, or a subtree would keep the value bound
above it. A token is varied by a modifier when its CSS value is not the same in
all of that modifier's contexts, every other modifier at its default.

**A collection with no modifiers writes its defaults alone.** A small system, or the first draft of one, has a base set and no contexts yet. The defaults block goes under the root selector; inside a layer, the order statement is `@layer defaults;` and the block sits in `defaults`. Adding a context later grows the output by that context's block.

**A default context with no spelling gets no block, and no error.** The
defaults already hold its values, and an existing document that spells only the
contexts people switch to should not break when the default gets a block. A
non-default context with no spelling stays an error: the stylesheet claims to
write every context, and one it cannot place would be missing silently. A
document that wants the default switchable (a subtree returning to it) spells
it.

**A default context spelled the same as another context gets no block either.** A modifier may give one spelling for the whole modifier with no `{context}` in it: `@media (prefers-reduced-motion: reduce)`, or `.compact`. The default's block would take that same spelling, and written after the other context's block it would cancel it with no warning. One spelling for two contexts can only mean "this is how the non-default one is recognised", so for that modifier the default keeps no block: its values are the defaults'. Nothing is lost for a media query, which holds for the whole page; for a selector a subtree cannot return to the default, the author's own spelling already gave no way to say it.

Two *non-default* contexts spelled the same is a mistake: the plugin refuses it through `onUnresolved` with nothing written for that modifier.

**A token that changes under two modifiers is a warning under `'resolve'`.** The blocks are the sum of the contexts, not their product. A token built from two modifiers (a border taking its width from density and its colour from theme) is written into both modifiers' blocks with a fixed value each, and where both apply the later block's value wins whole, right only if it does not depend on the earlier modifier. Complete blocks do not change this: each is complete for its own modifier.

Under `references: 'var'` the same token is written as its `var()`s, which the browser substitutes on the element where both apply, so the combination comes out right and nothing is said.

It is a warning, not an error: a system may switch two modifiers on different elements, or never together. A fall-through that crosses modifiers is a harder case, and `var()` does not repair it; see [Chains](#chains), and `bind: 'chain'`.

#### Layers carry resolution order

Written flat, the blocks depend on the stylesheet's source order to make the
later modifier win, which holds only while every block has one specificity.
Cascade layers order whole blocks independently of specificity, and the resolver
orders its modifiers by `resolutionOrder`. Mapping the one onto the other makes
the document's order the cascade's order. Inside `@layer X`, the directive
writes `@layer defaults, <modifier>, …;` in resolution order and each block in
its own sublayer. This is the output for the tutorial, from [tutorial.out.css](./test/example-output/tutorial.out.css):

```css
@layer tokens {
    @layer defaults, theme, density;
    @layer defaults {
```

The order statement is written with no space before its semicolon, and it sets its spacing itself, so the output does not depend on PostCSS's default.

**The plugin reads the enclosing layer instead of taking an option.** Where the
author put the directive says where the tokens live; an option naming the layer
would say it a second time and could disagree. Outside any layer the output is
the flat form, since a layer there would be written without the author asking.
Anonymous layers cannot be addressed and are passed over.

**One order per layer.** Two `@toghen contexts` directives in one layer, for two collections, each write an order statement. If the two orders differ, CSS keeps the first and the second collection's later modifier silently loses. The plugin refuses, through `onUnresolved`, a directive whose order statement would differ from one already written in its layer; one with the same order passes, since a repeated statement changes nothing.

**Zero-specificity selectors are not used.** They were considered so that component rules could override token blocks. In layers the question does not arise: a component rule in a later layer, or none, beats a token block however strong the selectors, and the plugin leaves the selectors as the document spelled them.

Measured in a browser (Chromium 153 and WebKit 26.6, the builds Playwright 1.63 ships; Firefox and Safari not run). The fixtures, the script and the results are tracked in [measurements/](./measurements/RESULTS.md) (fixtures [c1](./measurements/c1.html), [c2](./measurements/c2.html) and [c3](./measurements/c3.html)). Each held in both engines and in both page colour schemes:

- A declaration in a later sublayer beats one in an earlier sublayer whatever
  their specificities: a `[data-theme=dark]` block (0,1,0) in `theme` beat an
  `html:root[data-x]` block (0,3,1) in `defaults`. The dotted form,
  `@layer tokens.defaults`, behaves the same.
- An unlayered declaration beats every layer, even a zero-specificity
  `:where(:root)` against a layered `:root`.
- An `@media` or `@supports` inside a sublayer still follows layer order: a
  matching media block in `defaults` lost to a plain block in `theme`. A
  media-spelled context can therefore live in its modifier's sublayer.
- A consumer `var(--x, fallback)` in one layer reads the nearest ancestor's
  declaration from another layer, and uses the fallback only when no ancestor
  declares the property.

A flat output keeps its `:root`-versus-attribute caveat: `:root`
and an attribute selector have equal specificity, so source order decides.
Layers are how a system avoids depending on that.

### Custom property names

The default name is lib's `cssPropertyName`. It spells each path segment by the CSSOM rule, as a group's keys are spelled, so `ds.button.backgroundColor` is `--button-background-color`. This adapter uses lib's `cssIdentifier` for property names as well, so the two spellings cannot drift. The rule and its edge cases are in lib's [specs](https://codeberg.org/Toghen/lib/src/branch/main/specs.md#one-css-name-for-two-adapters).

A `var()` written by hand must use this spelling. `toghen()` writes it for you.

**Two tokens with one name are reported.** A name is not injective: `button.pad-x` and `button.pad.x` both give `--button-pad-x`, and hyphenating capitals adds pairs (`backgroundColor` and `background-color`). Within the output of one `@toghen declare` or `@toghen contexts`, the plugin reports two token paths that give one name through `onUnresolved`, naming both paths and the name. Both are still written, so `warn` changes no output. The check stays within one directive: across directives one name repeated is the point, since a context block re-declares the defaults' names. A custom `propertyName` is checked the same way, on whatever it returns.

**A member property and a token with one name: the token wins, and it is reported.** A composite with longhands declares a property per member, and that name can be a token's too. A composite `border` declares a colour property for its colour member, and a token `borderColor` gives the same name. Both would be written in one block, the later in document order winning, with nothing said. The plugin reports it through `onUnresolved`, naming the composite, the member property and the token, and writes the token's declaration only. The token is the more specific statement: someone wrote that property on purpose, and the member property is a by-product of the composite. The Figma adapter's binding table rules the same way, `borderColor` over `border`.

This differs from two token paths with one name, where both are written: there neither is more specific, so the plugin does not choose. A member property read elsewhere reads the token's value, which is what the document says that property is.

### Descriptions as comments

`descriptions: 'comment'` writes `$description` beside what it explains,
because a generated sheet is also read by people who never open the JSON.

**A context block carries what differs.** What a context's own source wrote
cannot be told after the merge: a source that overrides only a token's
`$value` leaves the defaults' description on the merged token. So a block
writes a description only when it differs from the base's. That is the same
rule as the values: a block says what this context changes. Group descriptions
follow it too, which needs a group's attributes to be kept per context, as the
core does.

**Faithful text.** Line breaks are kept and nothing is re-wrapped; Markdown
stays Markdown. The only change is `*/`, written `*\/`, so a description cannot
end its comment early.

### How a query is printed

A query asks which token, in which context, and printed how. Three things decide the printed form: the option that governs a composite or a typography token, the position of the query, and `as value`.

- **A plain read** writes `var(--name, literal)`: the custom property the token is declared under, with the default context's literal as fallback. A token with no property of its own writes the literal, or under `references: 'var'` the `var()` of its first hop.
- **`as value`** writes the literal in any position. A context after the path writes the literal too, whatever `references` says: the author chose the value, and a `var()` would hand the choice back to the cascade. `as value` is the only form. A token path never holds a space, so a form cannot be mistaken for part of the path.
- **A composite member** has a property of its own when mdn-data lists a longhand for it: `border` has `border-width`, `border-style` and `border-color`. The plugin takes longhands from mdn-data, not from a table. `@toghen declare` and `@toghen contexts` declare those properties beside the composite's own, unless `composites: 'shorthand'` is set.
- **A typography token** is declared member by member under `typography: 'block'` (the default), and as `font` plus the members the shorthand cannot carry under `'font'`.

A value with no CSS spelling is refused, never written as text. The plugin reports the token and names its shape.

### Chains

The output is specified rule by rule in [reference.md](./reference.md#bind) and worked in the [guide](./guide.md#make-a-token-follow-two-modifiers). This section holds the reasons. It reads what `@toghen/lib` builds (`contextsOf`, `dependsOn`, `step`, `valueAt`; see [lib's specs.md](https://codeberg.org/Toghen/lib/src/branch/main/specs.md#querying-one-token-across-contexts)), and the tests are in `test/chain.test.ts`.

**Why chains.** Complete blocks add the modifiers up; they do not combine them. A token whose value in one modifier's context falls through to a reference that varies on another modifier is written in both modifiers' blocks, and where both apply the later block wins whole.

Measured in a browser (Chromium 153 and WebKit 26.6; [results](./measurements/RESULTS.md), fixtures [c6.html](./measurements/c6.html) and [c7.html](./measurements/c7.html)): with modifier `a` on an outer element and `b` on an inner one, a token `t` that is fixed under `a=dark` and otherwise follows `x`, which varies on `b`, came out as `x`'s value under plain blocks, even with `references: 'var'`.

With `references: 'var'`, the plain form writes a declaration in the inner modifier's block that overwrites the outer modifier's value on the inner element. A fall-through chain written with `var()` fallbacks gave the right value, and a block that returns a modifier to a context not defining the link sets the link's property to `initial`, which was measured to make `var(--t-a, fallback)` use the fallback.

The reason is how CSS binds, as described under *Declaring a context*: a `var()` in a custom property is substituted on the element where the property is declared and descendants inherit the result, so a value composed on the outer element cannot see a modifier set on an inner one. Only a property declared again, on the inner element, can. Re-declaring everything that depends on a modifier in that modifier's blocks is therefore the rule, and `dependsOn` says what depends. A chain is the form in which re-declaring is correct: the conditional parts (the links) are separate properties, each written only by its own modifier, and the unconditional composition (the head) is the same text in every block, so a block can re-declare it without knowing what any other modifier is set to.

**Why built from lib's factoring and not derived here.** Which tokens have links, which modifier is home to each, and what a context says is the factoring, and lib owns it. This package spells it. It does not read the document's sets or contexts, and it asks lib three things only: `contextsOf` (links, steps, base, holes, the report of tokens it cannot factor), `dependsOn` (which blocks a token belongs in) and, to read a value where lib answers early, `valueAt`.

**Why opt-in.** A chain is more custom properties and more declarations, and a system whose modifiers always sit on one element (the root) gets nothing from it. The default output stays what existing stylesheets were written against; `bind: 'chain'` is for a system that sets modifiers on different elements, which is what a theme on a panel inside a density on a page is. It is an option beside `references` because it is how the same tokens are bound, not what they are.

The option needs the `Resolver` as well as the `DesignSystem`, since the system holds flattened contexts and cannot say which modifier a token falls through to; it reads the resolver from the collection, which keeps the resolver that built it (`collection.resolver`, see lib's [specs](https://codeberg.org/Toghen/lib/src/branch/main/specs.md#the-sum-and-the-product)). There is no `resolver` option: a collection built by hand has no resolver, and the directive says so.

**What it costs.** One link property per link, and a head declared in the block of every modifier in `dependsOn`, direct or through. A token with one link and a literal base costs nothing: it is written as today. A token with *n* links costs *n* link properties, and *n* is the number of modifiers that define it. In lib's 40-token layered fixture one token had two links. The output grows by lines, not by selectors, and the heads are the same text everywhere. The head for a token that depends on a modifier only through a reference is also written in that modifier's blocks, which a comparison of resolved values could miss.

**Recorded, not hidden.** Three things the factoring left to this package, found by spelling a chain in CSS:

- *A one-link token can need a chain.* Lib folds the base into the last link, so the measured case, `t` fixed under one modifier and a reference to `x` otherwise, has **one** link (`a`) and a base that is the reference `{x}`. Counting links would leave it unchained and wrong. The rule here is two links, or one link and a base holding a reference, with a modifier reached only through the reference.
- *A context that carries the base is not distinguishable from one that defines it.* The last link's non-defining contexts are `{ value: base }`. The plugin treats a step equal to the base as sparse (`initial`), which gives the same value in every cell and keeps the generated variables to what the document says.
- *A conditional reference is repaired by a flag.* A link whose value refers to a token that varies on another modifier is declared where its own modifier is set and substituted there, so written plainly the other modifier's block cannot know that context: a prototype that is not tracked gave 14 of 85 nestings wrong for it. That is not a limit of custom properties but of that spelling. Each context declares a flag, a custom property whose value is empty (`--scheme--dark: ;`, valid CSS) in the context and `initial` (guaranteed-invalid) elsewhere; the link is written as the flag followed by the reference, and re-declared in the blocks of every modifier its reference depends on, so it is substituted at the inner element where both contexts are known.
  - Measured in the browser check: right in every one of the 85 nestings, layered and flat, in Chromium and WebKit, and in the `@media`-spelled form; Firefox not run.
  - When the default context of the link has a defined step, its flag must be on in the defaults too. Without it, an element under no block of that modifier falls through to the base (140 of 170 nestings failed without it).
  - Not measured: whether a minifier keeps the empty value; some have stripped one, so the guide says to check. If a minifier strips it, the way back is a warning and today's output for that token: a choice of spelling, not a limit.

**Why only a conditional link gets the flag form.** A flag per context and a guarded property per step is more CSS than a value per block, and the plain form is measured right for literal links on all 85 nestings. One form for every link was considered: one rule to explain and one code path, at the price of flags in every stylesheet that chains, and of the empty-value hazard reaching every consumer instead of only those with a conditional reference. The plain form stays where it is right; the flag form is written where the plain one is wrong.

**Considered and rejected.**

- *Lib's `~` in the name* (`--button-bg\~scheme`, escaped): legal CSS, but it does not read in a stylesheet or in a debugger, and it ties the CSS to a character lib may reserve differently.
- *`--t-a`-style names:* a path `t.a` has that name already.
- *A base property, `--t-b: var(--x)`:* the head is declared in every block that needs it, so the base can be its last fallback and one property is saved per token.
- *Chains for `@toghen declare`:* a hand-written block exists because the author knows the nesting, and chaining it would write a head the author did not ask for.

**What is not changed.** The default output: `t()` and `toghen()` in a value, `@toghen declare`, and the custom property each token reads. A chain changes only what `@toghen contexts` writes, and only with the option set.

---

## The component model, in standard CSS

The model is in [the component model](https://codeberg.org/Toghen/lib/src/branch/main/model.md): a component is a group, it supports its subgroups, a part re-points the group; worlds are everything above it. This section says what this package writes for it.

**The plugin emits standard CSS.** The target is CSS Mixins level 1 (`@mixin`, `@apply`, `@contents`; parsed behind a flag in Chromium 153, polyfilled by `@csstools/postcss-mixins` 1.1.0, cssdb stage 2) and CSS nesting. Toghen writes the standard form and depends on no polyfill. The consumer's pipeline lists Toghen first and the mixins polyfill after it, in one `postcss([...])` call, then a nesting polyfill only where a target lacks native nesting (see *One pipeline* under [The hand-over round](#the-hand-over-round-ruled-and-built-13-october-2026)). The polyfill's `preserve` option keeps `@apply` beside its expansion. The source does not change when browsers catch up.

*What the generator writes.*

- **`@toghen contexts ds;`**, in the author's `@layer`. With the option `registerProperties: true`, it also writes one `@property` per token whose type has one syntax: colour (`<color>`), a dimension in px (`<length>`), duration (`<time>`) and number (`<number>`). Each is `inherits: true`, with the default context's literal as its `initial-value`. The option is off by default. A registered property has an initial value, so a `var()` fallback never applies to it, and `--x: initial` gives that value, where a chain needs the guaranteed-invalid one. So a chain's links and flags are never registered. Font families, shadows, rem and em dimensions and typography tokens get none.
- **`@toghen mixins ds;`** at the top of the stylesheet, outside every rule and layer. The collection may be left out when the system has one. Inside a rule or a layer it is refused: a mixin has no cascade position of its own, and the polyfill ignores a `@mixin` in a layer. It writes these, in document order:
  - **A group's mixin**, named by the group's path with the custom-property rule (`--button`, `--button-icon`). It holds the group's own tokens as declarations, then `@contents`, then its parts. A group gets one only when all its own keys are CSS properties. A group with no own tokens gets one when it has parts: its rest comes from elsewhere, such as a recipe it composes, and its mixin writes `@contents` and the parts. A primitive scale, a namespace with no parts or a group with a key that is no property gets none.
  - **A part's mixin**, named the same way (`--button-primary`). It re-points each token of the part that has a twin at rest, through the twin's local property (see *A nested instance of a component starts again from its rest* below), so the rest property reads the part's token. A token with no twin sets its own property directly. The part's own parts nest in it. A part with nothing to write and no nested part gets none.
  - **A typography token's mixin**, named by its path (`--type-label`). Under `typography: 'block'`, it holds one longhand per member, each reading that member's own property. Under `'font'`, it holds the `font` shorthand reading the token's property, then the members the shorthand cannot carry. This is `--type-label` under `'block'`, from [typography-block.mixin.out.css](./test/example-output/typography-block.mixin.out.css):

    ```css
    @mixin --type-label {
        font-family: var(--type-label-font-family, Inter, "Helvetica Neue", sans-serif);
        font-size: var(--type-label-font-size, 0.875rem);
        font-weight: var(--type-label-font-weight, 500);
        line-height: var(--type-label-line-height, 1.25)
    }
    ```

  - **A `--when-<modifier>-<context>` mixin** for each context with a spelling (see below).

  A mixin body reads `var(--name, fallback)`: the token's custom property, with a fallback so a missing declaration does not leave the element without a value. The fallback is the token's value written as `references` writes it (see *A read's fallback follows `references`* under [The hand-over round](#the-hand-over-round-ruled-and-built-13-october-2026)).
- **Context mixins.** A selector spelling becomes `&:where(A, A *)`, one pair for each selector in it: the element itself or a descendant, at no added specificity. An at-rule spelling wraps the rule around `@contents`; a selector inside it stays inside the at-rule. A context with no spelling gets no mixin. The theme's dark context, from [mixins-when.out.css](./test/example-output/mixins-when.out.css):

  ```css
  @mixin --when-theme-dark {
      &:where([data-theme='dark'], [data-theme='dark'] *) {
          @contents
      }
  }
  ```

  An author applies one inside a component, as a block the mixin wraps. This form is checked by the tests for the text it writes and its expansion by the polyfill, not in a browser.

*Rules with more parts come after rules with fewer.* The core rules which token applies under a selection of part values: the one with more matching parts, then, on a tie, the one whose latest differing axis comes later in the vocabulary ([`applies()`](https://codeberg.org/Toghen/lib/src/branch/main/reference.md#appliescomponent-selection-mode-recordstring-string)). A group's mixin writes one rule for every part below it, at any depth, and orders them so the cascade gives the same answer: rules with more parts after rules with fewer, then, walking the axes from the last, at the first axis where two differ, the one with a value there later. Two values of one axis can both match in a browser (`:hover` with `:active`), a case the core is never asked: the value declared later comes later and wins. The order of the keys in the document carries no precedence. Each rule is the chain of spellings from the group down, each placed as `&:where(<spelling>)`, where a spelling's own `&` keeps standing for the enclosing selector, or wrapped as an at-rule. Its body is the part's own declarations. So every part rule weighs exactly what the rule that applies the mixin weighs: `:where()` adds nothing, and neither does an at-rule. The order alone decides between part rules, and the cascade equals `applies()` for every spelling. Equal weight is also what lets a part beat its own component: the component's rule sets the local properties to `initial` before its declarations, and the part rules come after, in the same mixin, at the same weight. A spelling must keep the element as its subject; one that selects another element, as `& > .icon` does, would no longer reach it once placed this way. The button's `--button` mixin, from [typography-block.button-mixin.out.css](./test/example-output/typography-block.button-mixin.out.css), shows the rules of one part in the vocabulary's order, the variant first, and the rule of two parts last:

```css
    &:where([data-variant='primary']) {
        --_button-background-color: var(--button-primary-background-color, #1a66e6);
        --_button-color: var(--button-primary-color, #ffffff)
    }
    &:where(:hover) {
        --_button-background-color: var(--button-hover-background-color, #e0ebfc)
    }
    &:where(:active) {
        --_button-background-color: var(--button-pressed-background-color, #e0ebfc);
        --_button-color: var(--button-pressed-color, #666666)
    }
    &:where(:is(:disabled, [aria-disabled='true'])) {
        --_button-color: var(--button-disabled-color, #666666)
    }
    &:where([aria-pressed='true']) {
        --_button-background-color: var(--button-selected-background-color, #e0ebfc)
    }
    &:where([aria-pressed='true']) {
        &:where(:hover) {
            --_button-background-color: var(--button-selected-hover-background-color, #1a66e6)
        }
    }
```

A part's own mixin, applied by hand under a wrapper's selector, holds its declarations and then the rules of the parts below it, in the same order.

*Wrappers.* A part whose state sits on a child is still placed by its spelling in the group's mixin. The field's disabled part, whose spelling is `:has(> input:disabled)`, is written so in [mixins-field.out.css](./test/example-output/mixins-field.out.css):

```css
@mixin --field {
    background-color: var(--field-background-color, #ffffff);
    color: var(--field-color, #1a1a1a);
    padding-block: var(--field-padding-block, 8px);
    border-radius: var(--field-border-radius, 6px);
    @contents;
    &:where(:has(> input:disabled)) {
        opacity: var(--field-disabled-opacity, 0.5)
    }
}
```

A child group's mixin is applied where the child sits. An author who needs the child's part on a wrapper writes the wrapper's selector and applies the mixin there, which repeats a spelling, by design: `.field:has(> input:focus-visible) { @apply --field-focus; }`.

*What a component stylesheet becomes.* An author writes `.button { display: inline-flex; @apply --button; }`. `@apply` is valid only in a style rule and expands in place. `&` becomes the applying rule's selector, so one mixin serves any selector. A child group under a part is a plain group with a mixin of its own. Its tokens with a twin at rest are re-pointed by the part's rule. Those without a twin are written only in the child's own mixin, and the author applies it where the child sits, for example `.button:active .button-icon { @apply --button-pressed-icon; }`.

*What a part rule writes.* A part token with a twin at rest re-points the twin's local property, `--_<name>`, which the rest reads before the twin's custom property. The rest declaration is written once, and anything inside that reads it follows. A part token with no twin sets its property directly in the part.

*Reading the cascade.* Three decisions stack on one element, in order. The modifier's block, in the author's layer, sets the roles. The component's rest rule reads its properties. The part's rule, on the same element, re-points a property, and wins there because it is declared there, while the modifier still reaches it because the part's value is itself a `var()` of a role. Between parts, a rule with more parts comes later, then the core's tie order decides, as above. A hand-written variant class outside the document is the author's to order.

*What stays.* `t(path)` writing `var(--name, literal)`; `t(path as value)` and `t(path, mode)` writing the literal; `@toghen declare`; the options `references`, `typography`, `composites`, `propertyName`, `descriptions`, `rootSelector`, `bind`, `registerProperties` and `onUnresolved`. Chains are untouched. The collection segment of a path is optional when the system has one collection.

*Retired forms.* A retired form is refused, not read. It is reported through `onUnresolved` with one sentence naming its replacement (`warn` by default; `ignore` says nothing), and stays in the output where it stood. A retired selector is reported and left as written, and the retired options are reported once per stylesheet. The forms and their replacements are in [reference.md](./reference.md#retired-forms), and the exact sentences are in [messages.txt](./test/example-output/messages.txt).

**Why.** The directives and selector forms that retired each answered where a state goes in a selector, and each answer patched one mismatch: a state modelled as a modifier. A nested rule relative to the applying selector is the browser's own answer to where a state goes, and the mixin is the standard form of a group written as a block. The emitted syntax follows a draft, so the churn is confined to the mixin lines; a component stylesheet is exposed in its `@apply` lines only. The alternatives the model rejected are in [decisions.md](./decisions.md#from-specsmd-the-component-model-in-standard-css).

**Open.** Whether `@toghen mixins` and `@toghen contexts` become one directive once the polyfill accepts a layered `@mixin`. Tested: the polyfill expands each spelling form, and the expanded sheet gives the same value per property as the component it replaces, in a simulated cascade. Not measured: the size of the expanded output on a large system, and the expanded sheet in a browser.

---

### Three consumer needs on top of the model (*ruled and built 13 October 2026*)

Issues from the second real consumer, ruled after the model landed.

- **A key that is a CSS property, written as something else** (*built*). A mixin writes a group's tokens as declarations, so a token keyed `scale` becomes `scale: 0.6`, though a component may want `transform: scale(0.6)` and read the token by hand. A token carries `$extensions["com.toghen"].css.write: false`: the group's mixin does not write it, `@toghen declare` still declares its custom property, and `t(path)` is unchanged. *Not chosen:* a subgroup with an invented name (still works, and is how a key that is not a property is kept out, see the guide), and a key that maps to another property, a larger design for one case.
- **A group from two source files says so** (*built*). A component group that shares its root with a semantic token (`input.background` in a palette beside `input.minHeight` in the component's file) writes both into one mixin, and nothing says so. The plugin takes an optional `origins` option, the map `load()` already returns (token path to the files that define it); the plugin reads no files itself. When `origins` is given, a group whose mixin holds rest tokens defined in more than one file is reported once, naming the group and the files: `[@toghen/postcss] The mixin "--input" mixes tokens from two files: "palette.tokens.json" defines background, "input.tokens.json" defines minHeight. Rename one, or give component groups a namespace.` It is always a warning, never an error whatever `onUnresolved` says, because the mixin is valid. A token's file is the first of its origins (the file that defines its rest value); a file that only overrides it in another context does not count. Without `origins` nothing is checked. More than two files read `from three files`, `from N files`. `write: false` also stops a part token with no twin from setting its CSS property directly; a token that re-points a twin's custom property is unchanged. A token with `write: false` is not counted as a source. A component and a semantic token that want the same root cannot both exist when one of them is a token and the other a group (a token cannot also be a group): rename one, or put component groups under a namespace of their own (`ui.input`). The guide says so.
- **A state placed by the wrapper, from a sibling or for a native state** (*documented only*). The model already answers both: the wrapper writes its selector and applies the part's mixin. `.input:checked ~ .thumb { @apply --switch-thumb-checked; }` reads a state from a preceding sibling, and `.input:indeterminate { @apply --checkbox-selected; }` gives a native state the values of an existing part without adding a spelling to the document. The guide shows both.

### The hand-over round (*ruled and built 13 October 2026*)

Eight issues from the second consumer, filed after the model landed. Read together they share one cause. The model hands work to others: the mixins polyfill expands what Toghen names, `@toghen contexts` declares the properties a read names, the cascade orders what a mixin nests. Toghen did not check the hand-over. Six items below check it or make it hold. One more, the error that stops every group, is the same habit seen from the vocabulary's side and has its lib half in [lib's specs](https://codeberg.org/Toghen/lib/src/branch/main/specs.md#worlds-and-parts). Two needs came from reading the CSS Mixins draft and cssdb during the ruling: `@contents` and named spellings.

- **One pipeline** (*built*). `postcss([toghen({ system }), postcssMixins()])` left every `@apply` unexpanded. The polyfill does all its work in its `Once` hook, and PostCSS runs every plugin's `Once` before any plugin's node visitors, so the polyfill read the stylesheet before Toghen's `AtRule` visitor had written a mixin. The plugin now writes the output of `@toghen mixins` (and `@t mixins`) in its own `Once`, which runs before the polyfill's because Toghen is listed first. Every other directive and `t()` stay in the visitors. Listed after the polyfill, Toghen still writes its mixins, and nothing expands them; the guide says the order. *Proof:* every test in `parts.test.ts` and `mixins.test.ts` that expands through the polyfill runs in one pipeline, and one test shows the two-pass form gives the same CSS. *Not chosen:* documenting two passes as the way. It works, but it re-parses Toghen's output, which is also where the trailing space below most likely comes from.
- **A trailing space in a copied custom property** (*built: a test only*). The consumer saw `--button-color: var(--t-text) ;` after the polyfill. Not reproduced here: neither Toghen's nodes nor the polyfill's copies carry one. PostCSS keeps the whitespace before a `;` or `}` in a custom property's value when it parses text, so a re-parse of formatted output can add it. One pipeline removes the re-parse. *Proof:* one test runs a formatted stylesheet through one pipeline and asserts that no custom property's value ends in whitespace. If the consumer still sees it, the issue asks for the input.
- **A mixin name written twice is an error** (*built*). Paths map to names with the custom-property rule, which is not injective: `fact.strip` and `fact-strip` are both `--fact-strip`. The polyfill then drops both definitions and leaves `@apply --fact-strip;` unexpanded, silently. `@toghen mixins` collects the name of every mixin it writes and, when two paths give one name, reports an error naming both, whatever `onUnresolved` says: `[@toghen/postcss] "fact.strip" and "fact-strip" are both written as the mixin --fact-strip. Rename one of them, or give propertyName an injective rule.` It writes neither definition. The `--when-<modifier>-<context>` mixins count, so a group named `when-theme-dark` collides with that context's mixin. *Why always an error:* the CSS Mixins draft (8 October 2026) gives two `@mixin` rules of one name the cascade's answer, the later one in a layer wins, as two declarations of one property. The ruling keeps the error anyway: a name written twice is never what the author meant, and today's polyfill breaks both. *Not chosen:* a warning under `onUnresolved`, as for two properties of one name.
- **A read's fallback follows `references`** (*built*). `t(path)` and every mixin body write `var(--name, fallback)`. The fallback was always the literal of the default context. It is now the token's value as `references` writes it: the literal under `'resolve'` (unchanged), and under `'var'` the reference as a `var()` of its first hop, as `@toghen contexts` writes the token's own declaration. `t(hue.marigold.soft.bg)`, where the token is `{prism.orange.100}`, writes `var(--hue-marigold-soft-bg, var(--prism-orange-100))` under `'var'`. A token whose value is no reference writes its literal either way. *Why:* a group that is only read, never put into `@toghen contexts`, has properties nothing declares; with a literal fallback it rendered, but lost the palette step and its theming. Toghen cannot see which stylesheet declares what, so it cannot warn. Under `'var'` the author has already accepted that a referenced token is declared. *Not chosen:* the whole chain ending in the literal (`var(--a, var(--b, #fce7d8))`), which never breaks but lengthens every read by one level per alias; a warning, which Toghen has no way to give. *Proof:* tests in the W3C structured shapes under both settings, and the plugin's own stylesheet rebuilt with no `[object Object]` and no unresolved `toghen(`.
- **An error in one group stays in that group** (*built*). A vocabulary on the document root reads every group as possible parts, so a lookup table whose path happens to nest two values of one axis (`hue.plain.solid`, both `variant` values) made lib's `partsOf` throw, and the whole `@toghen mixins` stopped. The directive now writes each top-level group on its own: an error inside one is reported through `onUnresolved` naming the group and lib's sentence, that group's mixins are left out, and every other group is written. `[@toghen/postcss] Cannot write the mixins of "hue": Path 'hue.plain.solid.bg' nests two parts of axis 'variant': 'plain' and 'solid'. Give the group "com.toghen": { "css": { "parts": false } }, or rename a key.` The lib half, `parts: false`, is in [lib's specs](https://codeberg.org/Toghen/lib/src/branch/main/specs.md#worlds-and-parts).
- **`@contents` between the rest and the parts** (*built*). A container's setting that must beat a component's rest and lose to its parts had no place: written after `@apply`, it lands after the nested part rules. CSS Mixins already has the answer: a mixin marks a place with `@contents`, and a block given to `@apply` lands there. A group's mixin writes `@contents` after its own declarations and before its parts:

  ```css
  .button { @apply --button { height: var(--control-height); } }
  ```

  The block lands between the rest and the parts. `@apply --button;` with no block inserts nothing. The polyfill does this today (checked on 1.1.0). A part's mixin gets none: what a caller adds to a part is written in the caller's own rule. The guide shows it.
- **Named spellings: `@toghen spellings;`** (*built*). A new directive, written at the top of a stylesheet like `@toghen mixins`, that names every spelling of the vocabulary and of the contexts, so an author's own rules can use the same spelling by name. It writes `@custom-media` ([Media Queries 5](https://www.w3.org/TR/mediaqueries-5/#at-ruledef-custom-media), cssdb stage 2, polyfilled by `postcss-custom-media`) for each spelling that is one `@media` rule, and `@custom-selector` ([CSS Extensions](https://drafts.csswg.org/css-extensions/#custom-selectors), stage 1, polyfilled by `postcss-custom-selectors`) for each selector spelling:

  ```css
  @custom-selector :--state-hover :hover;
  @custom-selector :--theme-dark [data-theme='dark'];
  @custom-media --input-fine (pointer: fine);
  ```

  - *Names.* A value of the root vocabulary is `--<axis>-<value>`. A value a group overrides is `--<group path>-<axis>-<value>` with the custom-property rule (`--ui-checkbox-state-pressed`). A context is `--<modifier>-<context>`, as the `--when-` mixins. A selector name takes the `:--` prefix. Two spellings of one name are an error, as two mixins.
  - *Left out, with a comment in the output saying why:* a spelling holding `&` (a custom selector is a selector, and `&` places a part relative to a rule), and an at-rule spelling other than `@media` (`@supports` and `@container` have no named form).
  - *What does not change:* the mixins keep the literal spellings. A stylesheet that never writes `@toghen spellings` gets nothing new and needs no polyfill; one that does needs the two polyfills only where its own rules use the names, and a browser ignores the definitions otherwise.
  - *Why a directive:* the author asks for the names by writing it, as for contexts and mixins, and an option would change every stylesheet's output.
- **A nested instance of a component starts again from its rest** (*built*). A part re-points the group's custom property on the element, and custom properties inherit: a plain card inside a primary card rendered primary (confirmed in headless Chrome 155). The same inheritance is how a part reaches a child group's element (`button.pressed.pin.color` read on the pin), so the fix cuts the first and keeps the second. The shape, probed in Chrome 155 through the polyfill against eight cases (nested instance; child channel; child channel across a nested instance; a theme on a subtree and on the element; the wrapper answer; a child mixin applied alone; `&` and at-rule spellings; plain custom properties only), all passing:
  - A token is *re-pointed* when some part token has it as its twin at rest. Only re-pointed tokens change; every other read is as before.
  - A re-pointed token gets a local property, `--_` followed by its custom-property name without the leading `--` (`--_ui-button-background`). The leading underscore is the common convention for a custom property that is not part of a public surface.
  - A part re-points the local property, not the token's own.
  - Every read of a re-pointed token, in a mixin of any group and in `t()`, is `var(--_x, var(--x, fallback))`: the local if a part set it, else the token's property as the contexts declare it, else the fallback.
  - Each re-pointed token is reset, `--_x: initial`, at the start of the mixin of *its component*, before the declarations. `initial` on an unregistered custom property is the guaranteed-invalid value, so the read falls through to the token's property: a nested instance starts again from its rest, and a theme on any element between still reaches it, because nothing is copied.
  - *Its component* is the component of the parts that re-point it. A part token's component is the group directly above the first part in its path, the definition the Figma adapter already uses ([Parts](https://codeberg.org/Toghen/figma/src/branch/main/specs.md#parts-axes-from-subgroups-folded-into-modes-or-one-variable-each)): `button.pressed.pin.color` belongs to `button`. When parts of more than one component re-point one token, the outermost of them resets it. So `button.pin.color`, re-pointed by `button.pressed`, is reset at `button`, and the pin receives the button's part by inheritance; a token only the pin's own parts re-point is reset at the pin.
  - A component group with no mixin of its own writes no reset: its parts are applied only by wrappers, and their tokens read as before.
  - *Ruled 13 October 2026, after the release:* the first rule placed every reset at the highest group with a mixin. A namespace that holds one token named like a CSS property (`tg.clear`, and `clear` is a property) has a mixin by that rule, so it took every reset, nothing applied it, and no component reset. Whether a group has a mixin says nothing about whether it is a component; a part does.

  ```css
  @mixin --ui-button { --_ui-button-background: initial; --_ui-button-pin-color: initial;
      background: var(--_ui-button-background, var(--ui-button-background, #1a66e6)); color: var(--ui-button-color, #ffffff);
      &[data-state=pressed] { @apply --ui-button-pressed } }
  @mixin --ui-button-pressed { --_ui-button-background: var(--ui-button-pressed-background, #aa0000);
      --_ui-button-pin-color: var(--ui-button-pressed-pin-color, #000000) }
  @mixin --ui-button-pin { color: var(--_ui-button-pin-color, var(--ui-button-pin-color, #ffffff)) }
  ```

  *Costs and limits.* About twice the name's length plus 25 characters per re-pointed token at rest, and a few per part token; nothing for a token no part touches (the probe's mixins grew from 1829 to 2202 characters). A token that both a component's parts and a child group's own parts re-point is reset only at the component, so a child nested inside another instance of itself still inherits that one token: resetting it at the child would cut the component's channel, since both write one local property. A theme set on an element between a pressed button and its pin no longer overrides the pressed pin colour: the part's value is bound where the part is declared, as every `var()` in a custom property is (see *Declaring a context*). `registerProperties` registers only the tokens' own properties, never a local one. *Not chosen:* `@private` (CSS Mixins), because the polyfill renames a private property written in a nested rule only inside one mixin, so a part applied from its own mixin, as the wrapper answer requires, would write nothing; a local copy of the token's value at the outermost group (`--_x: var(--x)`), which passes every case but one, a theme set between the component and its child, because the copy is bound at the component; every group copying its own tokens, which cuts the child channel.
- **Not built: `@property` shorthands.** A list of names in one `@property`, optional descriptors and an unquoted `syntax` are cssdb stage 2 and polyfilled. They shorten hand-written CSS; `registerProperties` generates the full form every browser reads, and a list only merges properties that share one initial value. Writing them would make every consumer add a polyfill that writes the full form back.

## Integration contract

### Input expectations

The plugin consumes a resolved `DesignSystem` from `@toghen/lib`. For multi-theme or multi-context documents, the expected pipeline is:

```
resolver.json
    │
    ▼
Resolver (@toghen/lib)
    │ resolveContextsToDesignSystem()
    ▼
DesignSystem
    │
    ▼
@toghen/postcss
```

### Relationship with other packages

- **`@toghen/lib`** provides the `DesignSystem`, resolution behavior, and type semantics.
- **`@toghen/figma`**'s build is this package's consumer in the workspace: it writes the plugin's stylesheet from `toghen-ui`'s tokens.
- **`@toghen/figma`** shares the same upstream token model but targets Figma instead of CSS.

---

## Internal flow

**A value**

```
1. PostCSS calls Declaration(decl) for each declaration whose value holds toghen( or t(
2. For each match, read(): split the path, the form after `as` and the context
3. Resolve the path through lib's resolveValue() first, so a bad path fails with lib's message
4. Print it: the literal when `as value` is given or a context is passed; otherwise var() of the token's
   property with the literal as fallback, unless the declaration is that property (a cycle); otherwise,
   under references: 'var', var() of the first hop; otherwise the literal
5. On error, apply the error mode (warn, throw, ignore)
```

**A directive: `@toghen contexts`, `@toghen mixins`, `@toghen declare`**

```
1. PostCSS calls AtRule.toghen(atRule) for each @toghen (and AtRule.t, its alias)
2. contexts and mixins take an optional collection and no form; declare takes a path, an optional
   context and `from`. A form is refused
3. mixins is refused inside a rule or a layer. contexts is refused inside a rule, and writes into the
   layer it stands in, with an order statement in resolution order
4. contexts writes the defaults, then one complete block per context of each modifier. A block holds
   every token its modifier varies, measured on resolved values. registerProperties adds the @property rules
5. mixins walks the groups and typography tokens of the collection in document order, then writes the
   --when- mixins of the contexts
6. A failure goes through onUnresolved. On warn and ignore the at-rule stays in the output
7. Any other @toghen at-rule is reported with the sentence for its replacement, and stays where it is
8. Once reports the retired options; Rule reports a retired selector and leaves it as written
```

---

## Key directories

```
src/
└── index.ts                      # Plugin implementation (single file)

test/
├── example/                      # The running example's tokens and resolver (inputs)
├── example-output/               # Golden outputs of the running example
├── example.test.ts               # The golden outputs, checked byte for byte
├── fixture-composites.ts         # The shared synthetic document, in the W3C structured shapes
├── chain.test.ts                 # bind: 'chain', rule by rule
├── contexts.test.ts              # @toghen contexts, flat and layered
├── descriptions.test.ts          # descriptions: 'comment'
├── equivalence.test.ts           # a component's mixins and its plain rules, in a simulated cascade
├── family-quoting.test.ts        # a family name is quoted when it has a space
├── fixes.test.ts                 # regressions, one test each: font lists, layer order, composites: 'shorthand'
├── font-shorthand.test.ts        # typography: 'font'
├── forms.test.ts                 # as value, and the forms and directives that are refused
├── keywords-and-members.test.ts  # colour keywords, typography members, a token in one context only
├── layers.test.ts                # @toghen contexts in a layer, and t() in any layer
├── letter-spacing.test.ts        # letterSpacing tokens
├── members.test.ts               # member properties through declare, contexts and reads
├── mixins.test.ts                # @toghen mixins: groups, typography, --when- mixins, placement
├── names.test.ts                 # propertyName, and two paths with one name
├── parts.test.ts                 # a group's mixin nests its parts, a part's mixin, the expansion
├── plugin.test.ts                # t() values, composite values, error modes
├── property.test.ts              # @property with registerProperties, and reads of the property
├── short-forms.test.ts           # t() and @t
└── types.test.ts                 # what valueToCss writes and refuses, each DTCG type
```

---

## Build & testing

- **Module format:** ESM (`"type": "module"`)
- **Bundler:** tsup
- **Test runner:** Node's test runner with tsx as its loader, `node --import tsx/esm --test`
- **Commands:**
  - `pnpm --filter @toghen/postcss build`
  - `pnpm --filter @toghen/postcss test`

---

## Roadmap

- [ ] **Watch Mode Integration:** better document integration with `postcss-cli --watch`
- [ ] **Improved Diagnostics:** enhanced reporting for unresolved or invalid token lookups at build time
