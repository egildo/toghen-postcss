# Browser check of the CSS claims

Playwright 1.63.0 (`playwright-core`, installed in a scratch folder, see README.md), Node 25.6.1 (claims 1 to 7; claim 8 ran on Node 26.10.0). Run: `node run.mjs` (fixtures `c1.html` to `c7.html` in this folder); claim 8 runs from `c8/`, see README.md.

Engines: **Chromium 153.0.8010.12** and **WebKit 26.6** (Playwright's build, not Safari). Firefox is not installed in the Playwright cache (not downloaded), so it is **not measured**. Both engines gave identical results for every claim, in `colorScheme` light and dark (differences are noted per claim). The script reads values with `getComputedStyle`.

| # | Claim | Result | Fixture |
|---|---|---|---|
| 1 | Nested sublayer order beats specificity; unlayered beats layers | PASS | c1.html |
| 2 | `@media` / `@supports` inside a sublayer follows sublayer order | PASS | c2.html |
| 3 | Consumer `var(--surface, #fff)` inherits nearest ancestor; fallback when undeclared | PASS | c3.html |
| 4 | Compound and same-element selectors | PASS | c4.html |
| 5 | `light-dark()` in a custom property is evaluated at the consumer | PASS | c5.html |
| 6 | `--x: initial` makes `var(--x, fallback)` use the fallback | PASS | c6.html |
| 7 | Chain correct where plain blocks are wrong, axes on different elements | PASS | c7.html |
| 8 | `bind: 'chain'` output matches `Resolver.valueAt()` in every nesting, in every output form | PASS | c8/ |

## 1. Sublayer order over specificity (PASS)
`defaults` held `html:root[data-x]{--a:1}` (specificity 0,3,1); `theme` held `[data-theme=dark]{--a:2}` (0,1,0). Computed `--a` = `2` (both engines). Same with the dotted form `@layer tokens.defaults` / `tokens.theme` (`--c` = `2`). Unlayered `:where(:root){--u:unlayered}` (specificity 0) against `@layer tokens.theme{:root{--u:layered}}`: `--u` = `unlayered`.

Meaning: `tokenLayer` with sublayers in resolution order is sound; order, not selector weight, decides, and an unlayered consumer override always wins.

## 2. At-rules inside a sublayer (PASS)
Media dark in `theme`, plain in `defaults` (`--m1`): light `1`, dark `3`. Media dark in `defaults`, plain `:root` in `theme` (`--m2`): `2` in both schemes (the later layer wins even though the media rule matches). Media wrapping a `[data-k]` selector block in `theme` (`--m3` on body): light `1`, dark `3`. `@supports` wrapper (`--m4`) applies; a later `density` layer applies (`--m5`).

Meaning: an `atRule` context can live in its own sublayer; the sublayer order, not the at-rule, settles a clash with a plain selector context.

## 3. Consumer inheritance across layers (PASS)
Tokens in `@layer tokens`, consumer `color:var(--surface,#fff)` in `@layer components`. Outside the dark subtree: `rgb(255,255,255)`; inside `[data-theme=dark]` two levels down: `rgb(17,17,17)`. Undeclared `var(--undeclared,#abcdef)`: `rgb(171,205,239)`.

Meaning: `var(--x, default)` as the consumer read works across layers; the literal fallback is used only when the property is absent.

## 4. Selector forms (PASS)
`[data-theme=dark][data-density=compact] .card` (padding 11px) matches only when both attributes sit on one ancestor (#a, #c) and not when they sit on different elements (#d, 0px) or one is missing (#b). `.card[data-theme=dark]` (margin 7px) matches on the card itself (#c, #e), not on an ancestor (#a, #d).

Meaning: confirms a list in `:toghen()` is same-element only.

## 5. `light-dark()` in a custom property (PASS)
`:root{color-scheme:light dark; --s:light-dark(#fff,#000)}`, `.sub{color-scheme:dark}`, consumer `color:var(--s)`. With page scheme light: root consumer `rgb(255,255,255)`, consumer inside `.sub` `rgb(0,0,0)` (evaluated at the consumer, not the root). Page scheme dark: both `rgb(0,0,0)`. Same in both engines.

Meaning: the `light-dark()` form is valid for subtree scheme switching, provided the subtree sets `color-scheme`; it only covers a light/dark pair, so the document still has to choose it.

## 6. `--x: initial` (PASS)
`.p{--x:red}`, consumer `color:var(--x,blue)`: directly under `.p` `rgb(255,0,0)`; under a child with `--x:initial` `rgb(0,0,255)`.

Meaning: the chain's "return to a context not defining the link" move works; `--t-a: initial` is the right spelling.

## 7. Chain against plain blocks (PASS)
Token `t` = `#aa0000` under `a=dark`, otherwise follows `x`; `x` = `#222222` under `b=on`, else `#111111`. A on the outer element, B on the inner. Expected / plain blocks / chain:

| Case | Expected | Plain blocks | Chain |
|---|---|---|---|
| a=dark outer, b=on inner | `#aa0000` | `#222222` WRONG | `#aa0000` |
| b=on only | `#222222` | `#222222` | `#222222` |
| neither | `#111111` | `#111111` | `#111111` |
| a=dark, a=light inside it, b=on | `#222222` | `#222222` | `#222222` (needs `--t-a:initial` in the `a=light` block) |

Same in both engines and both page schemes.

Meaning: the gap in plain blocks is real in a browser (the inner `b` block overwrites `a`'s value) and the chain, including the `initial` reset, fixes it; chains were worth building, and were built, as the opt-in `bind: 'chain'` form (rule by rule in [reference.md](../reference.md#bind); claim 8 below is its acceptance check).

## 8. `bind: 'chain'` against `Resolver.valueAt()` in every nesting (PASS)

Run 6 October 2026 on the built plugin (`toghen-postcss/dist`) by [c8/run.mjs](./c8/run.mjs) over the documents in [c8/docs.mjs](./c8/docs.mjs), from a scratch copy outside the repository (README.md), Playwright 1.63.0, Node 26.10.0. Engines: **Chromium 153.0.8010.12** and **WebKit 26.6** (Playwright's build). **Firefox: UNAVAILABLE** (not in the Playwright cache; not downloaded).

The CSS is the plugin's own output with `bind: 'chain'`, `references: 'var'` and `tokenLayer: 'tokens'`, never a hand copy. For each document and output form, every sequence of up to three nested elements, each setting one `modifier=context`, has two consumers per token at the innermost element: `var(<head>)` and `toghen(path)` through `tokenLayer` (`var(<head>, <literal>)`). The hole's token has `var()` only.

The run compares the computed value with `Resolver.valueAt(path, input)`, `input` being the nearest ancestor's context per modifier and the default for a modifier no ancestor sets (a colour as `#rrggbb`, a dimension as `<n>px`; a hole as the consumer's own fallback). Nothing was skipped and the oracle was not loosened.

A nesting counts when **every** consumer in it matches. Each figure is over both page colour schemes (`colorScheme` light and dark): 85 nestings of two attribute-spelled modifiers of two contexts twice is 170; 259 nestings of three modifiers twice is 518.

In the `media-` forms `scheme=dark` is spelled `@media (prefers-color-scheme: dark)` alone, so the page chooses it and the nestings use the other modifiers only (15 or 85, twice).

Chromium and WebKit gave **identical** results in every row.

| Document | Layered | Flat | `@media` layered | `@media` flat |
|---|---|---|---|---|
| `twoAxes`: `tone.base`, `tone.alert` (one link, a reference base), `tone.copy` (pure alias) | 170/170 | 170/170 | 30/30 | 30/30 |
| `twoLinks`: `button.bg` (two literal links and a base), `button.pad` (the same, a dimension) | 170/170 | 170/170 | 30/30 | 30/30 |
| `conditional`: `tone.t` is `{tone.y}` under `scheme=dark` and a literal otherwise, `tone.y` varies on `contrast` (**the gate**) | 170/170 | 170/170 | 30/30 | 30/30 |
| `conditionalDefault`: the same, the reference under the default context | 170/170 | 170/170 | 30/30 | 30/30 |
| `hole`: `tone.x` has no value where `scheme=light` and `tone=neutral` | 170/170 | 170/170 | 30/30 | 30/30 |
| `threeModifiers`: three links, a conditional link, a pure alias, a one-link token following a token that depends on all three | 518/518 | 518/518 | 170/170 | 170/170 |

**The gate passed.** The conditional reference matches `valueAt` in every nesting, in both engines, layered and flat (and in the `@media` forms), so the flag form ships.

**Controls.** The checker does fail where it should:

- With `bind` left out (every other setting as above) the same documents give, in Chromium, `twoAxes` layered 142/170, `twoLinks` 128/170, `conditional` 156/170 (the plain blocks of today get 14 of its 170 nestings wrong), `hole` 124/170, `threeModifiers` 312/518.
- With the defaults not turning on the flag of a default context that has a defined step (the reference's "the defaults write none", read literally), `conditionalDefault` gives 140/170 layered and flat in both engines, and 15/30 in the `@media` forms: a nesting where nothing sets `scheme` reads the base, not the reference. The plugin writes that flag, and the row above is with it.

The reference's worked example is unaffected (its default context defines nothing).

**What was not measured.**

- Firefox.
- Safari proper (Playwright's WebKit is not Safari).
- A minifier (the empty-value hazard of `--m--c: ;` is documented, not measured).
- Consumers that read a member of a composite.

Output of the run, verbatim (per document and form: nestings that matched, and consumer readings that matched, over both page colour schemes):

```
== chromium 153.0.8010.12
twoAxes              layered        170/170 nestings (1020/1020 readings; both page colour schemes)
twoAxes              flat           170/170 nestings (1020/1020 readings; both page colour schemes)
twoAxes              media-layered  30/30 nestings (180/180 readings; both page colour schemes)
twoAxes              media-flat     30/30 nestings (180/180 readings; both page colour schemes)
twoLinks             layered        170/170 nestings (680/680 readings; both page colour schemes)
twoLinks             flat           170/170 nestings (680/680 readings; both page colour schemes)
twoLinks             media-layered  30/30 nestings (120/120 readings; both page colour schemes)
twoLinks             media-flat     30/30 nestings (120/120 readings; both page colour schemes)
conditional          layered        170/170 nestings (680/680 readings; both page colour schemes)
conditional          flat           170/170 nestings (680/680 readings; both page colour schemes)
conditional          media-layered  30/30 nestings (120/120 readings; both page colour schemes)
conditional          media-flat     30/30 nestings (120/120 readings; both page colour schemes)
conditionalDefault   layered        170/170 nestings (680/680 readings; both page colour schemes)
conditionalDefault   flat           170/170 nestings (680/680 readings; both page colour schemes)
conditionalDefault   media-layered  30/30 nestings (120/120 readings; both page colour schemes)
conditionalDefault   media-flat     30/30 nestings (120/120 readings; both page colour schemes)
hole                 layered        170/170 nestings (510/510 readings; both page colour schemes)
hole                 flat           170/170 nestings (510/510 readings; both page colour schemes)
hole                 media-layered  30/30 nestings (90/90 readings; both page colour schemes)
hole                 media-flat     30/30 nestings (90/90 readings; both page colour schemes)
threeModifiers       layered        518/518 nestings (5180/5180 readings; both page colour schemes)
threeModifiers       flat           518/518 nestings (5180/5180 readings; both page colour schemes)
threeModifiers       media-layered  170/170 nestings (1700/1700 readings; both page colour schemes)
threeModifiers       media-flat     170/170 nestings (1700/1700 readings; both page colour schemes)
== webkit 26.6
twoAxes              layered        170/170 nestings (1020/1020 readings; both page colour schemes)
twoAxes              flat           170/170 nestings (1020/1020 readings; both page colour schemes)
twoAxes              media-layered  30/30 nestings (180/180 readings; both page colour schemes)
twoAxes              media-flat     30/30 nestings (180/180 readings; both page colour schemes)
twoLinks             layered        170/170 nestings (680/680 readings; both page colour schemes)
twoLinks             flat           170/170 nestings (680/680 readings; both page colour schemes)
twoLinks             media-layered  30/30 nestings (120/120 readings; both page colour schemes)
twoLinks             media-flat     30/30 nestings (120/120 readings; both page colour schemes)
conditional          layered        170/170 nestings (680/680 readings; both page colour schemes)
conditional          flat           170/170 nestings (680/680 readings; both page colour schemes)
conditional          media-layered  30/30 nestings (120/120 readings; both page colour schemes)
conditional          media-flat     30/30 nestings (120/120 readings; both page colour schemes)
conditionalDefault   layered        170/170 nestings (680/680 readings; both page colour schemes)
conditionalDefault   flat           170/170 nestings (680/680 readings; both page colour schemes)
conditionalDefault   media-layered  30/30 nestings (120/120 readings; both page colour schemes)
conditionalDefault   media-flat     30/30 nestings (120/120 readings; both page colour schemes)
hole                 layered        170/170 nestings (510/510 readings; both page colour schemes)
hole                 flat           170/170 nestings (510/510 readings; both page colour schemes)
hole                 media-layered  30/30 nestings (90/90 readings; both page colour schemes)
hole                 media-flat     30/30 nestings (90/90 readings; both page colour schemes)
threeModifiers       layered        518/518 nestings (5180/5180 readings; both page colour schemes)
threeModifiers       flat           518/518 nestings (5180/5180 readings; both page colour schemes)
threeModifiers       media-layered  170/170 nestings (1700/1700 readings; both page colour schemes)
threeModifiers       media-flat     170/170 nestings (1700/1700 readings; both page colour schemes)
== firefox UNAVAILABLE browserType.launch: Executable doesn't exist at /Users/egildo/Library/Caches/ms-playwright/firefox-1543/firefox/Nightly.app/Contents/MacOS/firefox
ALL MATCH
```

## Overall for the sweep
All eight claims hold in Chromium and WebKit. Open: Firefox not run (UNAVAILABLE); Safari proper (not Playwright WebKit) not run.
