# @toghen/postcss — API reference

This page lists what the plugin takes, reads and writes: its options, the forms it reads, the names it generates and every message it reports. For tasks, see the [guide](./guide.md). For the model and its glossary, see the [component model](https://codeberg.org/Toghen/lib/src/branch/main/model.md). For why it is built this way, see [specs.md](./specs.md).

On this page, a **mode** is lib's mode: one context chosen for each modifier, written `theme=dark`, or a declared mode name such as `light/regular`.

---

## Default export

```typescript
import toghenPlugin from '@toghen/postcss';

function toghenPlugin(options: ToghenPluginOptions): Plugin;
```

Call it with the options. It returns a PostCSS plugin named `@toghen/postcss`. It reads a built `DesignSystem` and touches no file.

The function carries `toghenPlugin.postcss = true`. PostCSS calls such a function with no arguments when it is listed bare, and then the plugin fails because it has no options. Always call it.

---

## Options

```typescript
interface ToghenPluginOptions {
  system: DesignSystem;
  defaultMode?: string;
  onUnresolved?: 'warn' | 'throw' | 'ignore';
  references?: 'resolve' | 'var';
  propertyName?: (lookupPath: string) => string;
  typography?: 'block' | 'font';
  composites?: 'longhands' | 'shorthand';
  rootSelector?: string;
  descriptions?: 'none' | 'comment';
  registerProperties?: boolean;
  origins?: Map<string, string[]>;
  bind?: 'chain';
}
```

| Option | Default | Decides |
|---|---|---|
| `system` | required | The collections the plugin reads |
| `defaultMode` | the collection's default mode | The mode of a read with no mode, and of the fallback literal in a `var()` |
| `onUnresolved` | `'warn'` | What a failure does to the build |
| `references` | `'resolve'` | How a reference inside a value is written |
| `propertyName` | lib's `cssPropertyName` | The custom property name of a path |
| `typography` | `'block'` | Whether a typography token is written as members or as `font` |
| `composites` | `'longhands'` | Whether a composite's members get properties of their own |
| `rootSelector` | `':root'` | The selector the defaults are written under |
| `descriptions` | `'none'` | Whether descriptions are written as comments |
| `registerProperties` | `false` | Whether typed custom properties get an `@property` rule |
| `origins` | unset | The map `load()` returns, token path to the files that define it; with it, a mixin that mixes tokens from more than one file is reported |
| `bind` | unset | Whether a token that two modifiers change is written as a chain |

### `system`

A `DesignSystem` holding the collections to read. Build it with lib's [`Resolver`](https://codeberg.org/Toghen/lib/src/branch/main/reference.md#resolver). Use `resolveContextsToDesignSystem()` for the defaults and each context. A combination such as `theme=dark density=compact` must be built too, by naming it in that call's combinations argument. A read of a mode the system does not hold fails with lib's `InvalidModeError`.

### `defaultMode`

The mode that a read uses when it names none. It is also the mode of the fallback literal that a read writes, in `t()` and in mixin bodies. `@toghen declare` uses it as its comparison base when there is no `from`. `@toghen contexts` ignores it: each modifier's own default holds the defaults.

### `onUnresolved`

| Value | Effect |
|---|---|
| `'warn'` | Adds a warning. The call or declaration stays as written. **Default.** |
| `'throw'` | Stops the build at that node with a PostCSS error (see [Errors](#errors)). |
| `'ignore'` | Leaves the call or declaration as written, with no message. |

Two warnings ignore this option and are always warnings: the warning that a property changes under two modifiers, and the chain notes. See [Messages](#messages).

### `references`

| Value | Effect |
|---|---|
| `'resolve'` | A reference is followed to the end of its chain and written as its value. **Default.** |
| `'var'` | A reference is written as the `var()` of its first hop. |

With `'var'`, each tier points at the tier directly below it. A token that refers to another is written as a `var()` of that token, so a chain of three tokens keeps three tiers. The mode chooses the target: a reference is written as the target it has in that mode. A reference is written in place in a whole value, a member, or a part of a string. For `ds.button.primary.backgroundColor` that is `{surface.accent}`:

```css
--button-primary-background-color: var(--surface-accent);
```

The option changes the values that `@toghen declare`, `@toghen contexts` and mixin bodies write, the fallback of every read that has a property, and the literal of a read that has no property of its own. See [the references section of the specs](./specs.md#references-kept-as-var).

### `propertyName`

A function from a lookup path to a custom property name, `--` included. Default: lib's [`cssPropertyName`](https://codeberg.org/Toghen/lib/src/branch/main/reference.md#csspropertyname). It names every custom property that `@toghen declare` and `@toghen contexts` write, every `var()` that `references: 'var'` writes, and every mixin and chain name. Two paths that get one name in one directive's output are reported. See [Generated names](#generated-names).

### `typography`

| Value | Effect |
|---|---|
| `'block'` | A typography token has no property of its own. Each of its members gets a property, and its mixin writes one longhand per member. **Default.** |
| `'font'` | A typography token is written as the `font` shorthand. Its members the shorthand cannot carry get a property beside it. |

Under `'font'`, the shorthand writes its members in this order: the font style when present, the weight, the size with the line height, and the family. A declaration of the example's `type.label` gives:

```css
--type-label: 500 0.875rem/1.25 Inter, "Helvetica Neue", sans-serif
```

A family name is quoted when it has a space, starts with a digit, holds punctuation, or is a CSS-wide keyword such as `inherit`. A generic family (`serif`, `sans-serif`, `monospace` and the other CSS generic names) and a single identifier stay bare. A family written as one string with commas is split by lib's [`fontFamilyNames`](https://codeberg.org/Toghen/lib/src/branch/main/reference.md#fontfamilynames), and each name is quoted on its own.

### `composites`

| Value | Effect |
|---|---|
| `'longhands'` | A composite such as a border or a transition gets its own property and one per member that has a CSS longhand, such as `--card-border-width`. **Default.** |
| `'shorthand'` | A composite gets its own property only. A read of one of its members writes the literal, because no property holds it. |

Typography follows `typography`, not this option.

### `rootSelector`

The selector that `@toghen contexts` writes the defaults under. It also holds a context whose spelling is an at-rule alone. Default: `':root'`.

### `descriptions`

| Value | Effect |
|---|---|
| `'none'` | No comments. **Default.** |
| `'comment'` | A group's description goes above the first declaration it precedes, a token's above its own declaration, and a modifier's above its first context block. A context block repeats only the descriptions that differ from the defaults. |

### `origins`

```typescript
origins?: Map<string, string[]>   // default: unset
```

The map lib's `load()` returns. Under an overrides map, the files it names are the files read, not the ones the document writes. The plugin reads no files, so it cannot know where a token was defined unless it is told. With it, a group whose mixin holds rest tokens defined in more than one file is reported once, always as a warning whatever `onUnresolved` says, because the mixin is valid:

```
[@toghen/postcss] The mixin "--input" mixes tokens from two files: "palette.tokens.json" defines background, "input.tokens.json" defines minHeight. Rename one, or give component groups a namespace.
```

A token's file is the first of its origins, the file that defines its rest value; a file that only overrides it in another context does not count, and neither does a token marked `css.write: false`. More than two files read `from three files`, `from N files`. Without `origins` nothing is checked.

### `css.write`

`$extensions["com.toghen"].css.write: false` on a token keeps it out of its group's mixin: the mixin does not write it as a declaration, `@toghen declare` still declares its custom property, and `t(path)` reads it as before. For a key that is a CSS property used for something else (a token keyed `scale`, read by hand for `transform: scale(…)`). A part token with no twin and `write: false` is not set directly either. A key that is not a property at all goes in a subgroup instead.

### `registerProperties`

With `true`, `@toghen contexts` writes an `@property` rule before the defaults for each typed token, when its type has one syntax:

| Type | Syntax |
|---|---|
| `color` | `<color>` |
| `dimension` in `px` | `<length>` |
| `duration` | `<time>` |
| `number` | `<number>` |

Each rule has `inherits: true` and an `initial-value` of the default's literal. A dimension in `rem` or `em` gets no rule. Chain links and chain flags never get one. The reason is that a registered property always has a value, so a `var()` never takes its fallback, and `initial` gives the registered value instead of the invalid value that chains rely on.

```css
@property --surface-raised {
    syntax: '<color>';
    inherits: true;
    initial-value: #ffffff
}
```

Default: `false`.

### `bind`

With `'chain'`, `@toghen contexts` writes a token that more than one modifier changes as a chain. Each modifier that changes it gets a link property, and the token's own property composes the links, so that modifiers set on different elements combine as the resolver combines them. The collection must be built from a resolver document. A token that changes under one modifier only needs no chain, and is written as before. A token the plugin cannot chain is written as resolved values, with a warning that says why. Without the option, and with `references: 'resolve'`, a token that two modifiers change is written as resolved values, and the plugin warns. Default: unset.

---

## Paths

- A lookup path is the collection's name, then the token's path: `ds.surface.accent`.
- With exactly one collection, the collection name may be left out: `surface.accent`.
- A path may go into a token: one member (`ds.type.label.fontSize`) or one array index (`ds.elevation.raised.0.color`). A path that passes through a reference continues in its target.
- The mode argument is a declared mode name (`light/regular`), or pairs of modifier and context (`theme=dark density=compact`). Names in pairs match regardless of case. A modifier left out takes its default context.
- A leading dot does not make a relative path. The path is looked up as written, and is not found.

---

## Reading a token: `t()` and `toghen()`

A read appears in a declaration value. Its forms:

| Written | Writes | Literal in |
|---|---|---|
| `t(path)` | `var(--name, fallback)` when the path has a property, else the literal. The fallback is the value as `references` writes it. A token that a part re-points reads its local property first: `var(--_name, var(--name, fallback))` | the default mode |
| `t(path as value)` | the literal | the default mode |
| `t(path, mode)` | the literal | the mode |
| `t(path as value, mode)` | the literal | the mode |

A path has a property when it is a whole token other than a typography token under `typography: 'block'`, or a member of a composite that has a longhand. A member with no property (a shadow's member, for one) is written as its literal.

A declaration that would read its own property gets the literal, so `--a: t(a)` cannot point at itself.

The fallback of `var(--name, fallback)` is the token's value as [`references`](#references) writes it: the literal under `'resolve'`, and under `'var'` the `var()` of the reference's first hop, `var(--hue-soft-bg, var(--palette-orange-100))`. A token whose value is no reference gets its literal either way.

For these four declarations, `t(text.default)`, `t(surface.raised as value)`, `t(surface.accent, theme=dark)` and `t(type.label.fontSize)`, the plugin writes:

```css
.label {
    color: var(--text-default, #1a1a1a);
    background-color: #ffffff;
    border-color: #5c9bff;
    font-size: var(--type-label-font-size, 0.875rem);
}
```

A failed read goes through `onUnresolved`. See [Messages for reads](#messages-for-reads).

---

## Directives

### `@toghen contexts`

```css
@toghen contexts path;
```

Placed at the top of the stylesheet, or inside a named `@layer`. Inside a rule it is refused. It writes:

1. The defaults: every token under the path, under `rootSelector`. Each modifier is at its default.
2. For each modifier, in resolution order, one block per context that has a selector or an at-rule. The block holds the tokens that modifier changes, with that context's value. The default context gets a block too, unless it shares its spelling with another context. A context block with nothing to change is left out.

A modifier's spelling comes from its `$extensions["com.toghen"].css` member: a `selector` with `{context}` in it, or an `atRule`, or one of those per context. See [lib's `getContextSelector`](https://codeberg.org/Toghen/lib/src/branch/main/reference.md#getcontextselectormodifier-context-contextselector--undefined).

Inside a named layer, the plugin writes an order statement first, naming the layers `defaults`, then each modifier's name, in resolution order. Each block then sits in a sublayer named for its modifier, and the defaults in the `defaults` sublayer. CSS keeps the first order statement of a layer, so a second `@toghen contexts` in the same layer must give the same order. An anonymous layer is written flat, like the top level.

A modifier written with `light-dark()` (a `lightDark` member in its CSS spelling; see [lib's `getLightDark`](https://codeberg.org/Toghen/lib/src/branch/main/reference.md#getlightdarkmodifier-lightdark--undefined) for the shape) gets no block, no sublayer and no error for a missing spelling. Each token it varies is written in the defaults as `light-dark(<value in the light context>, <value in the dark context>)`; a token that is the same text in both stays plain. Only colours can be paired. The plugin writes no `color-scheme`: the app sets it, and without one the light side shows. Under `descriptions: 'comment'` the modifier's description is written before the first pair. The modifier keeps its place in the layer order statement. A token it varies must not be varied by another modifier's block, and `bind: 'chain'` is refused with it; see [Messages for contexts](#messages-for-contexts).

Where two modifiers change one property and `references` is `'resolve'`, the plugin warns that the later block's value wins whole. With `'var'`, the browser combines the two.

Forms are refused. See [Messages for forms](#messages-for-forms).

### `@toghen mixins`

```css
@toghen mixins;
@toghen mixins collection;
```

Placed at the top of the stylesheet, outside any rule and any layer. It takes a collection name or nothing. It writes CSS Mixins level 1 definitions, for a mixins polyfill to expand with `@apply`. The plugin does not write the `@apply`s. It writes:

| Mixin | Written for | Body |
|---|---|---|
| `--<path>` | A group whose direct tokens all have a CSS property name, or a group with no direct tokens and at least one part | First `--_<name>: initial` for every re-pointed token whose component it is (see below). Then one declaration per direct token, reading that token's property; a re-pointed token reads `var(--_<name>, var(--<name>, fallback))`. A typography token contributes its longhands (`'block'`) or its shorthand (`'font'`). Then `@contents`. Then the part mixins, in vocabulary order. |
| `--<path>` | A part (a subgroup whose key is a vocabulary value) | For each token of the part: where the twin at rest is a token, the twin's local property `--_<name>` is set to the part's property. Where there is no twin, a token directly in the part sets its own property. Then the parts nested in it. No `@contents`. |
| `--<path>` | A typography token | Its longhands (`'block'`) or its `font` shorthand (`'font'`). |
| `--when-<modifier>-<context>` | Each context that has a selector or an at-rule; not for a modifier written with `light-dark()`, which gets a comment instead | Wraps `@contents` in the context's spelling. |

A group's mixin is written in document order, the group before its children. The `--when-` mixins come last, the modifiers in the order the document declares them, each one's contexts as declared. See [Messages for mixins](#messages-for-mixins).

- **Re-pointed token.** A token that some part token has as its twin at rest.
- **Local property.** `--_` followed by the token's property name without its `--`, as `--_button-background-color`. Only a re-pointed token has one.
- **A re-pointed token's component.** The group directly above the first part in the path of a part token that re-points it (`button.pressed.pin.color` belongs to `button`); when parts of several components re-point one token, the outermost. The reset there makes a nested instance start from its rest, and a child element still receives its component's part by inheritance. A component group with no mixin writes no reset.
- **`@contents`.** A block given to `@apply --<group> { … }` lands after the group's declarations and before its parts; with no block, nothing. See the [CSS Mixins draft](https://drafts.csswg.org/css-mixins-1/).
- **Two paths, one name.** Two paths that give one mixin name, or a group whose name is a `--when-` mixin's, stop the build whatever `onUnresolved` says, and neither is written.
- **An error inside one group.** A lib error while writing one top-level group goes through `onUnresolved` naming that group, its mixins are left out, and the other groups are written.
- **Order in a pipeline.** The plugin writes this directive in its `Once` hook, so a mixins polyfill listed after it finds the definitions.

The when-mixin for the example's `theme` context `dark` is:

```css
@mixin --when-theme-dark {
    &:where([data-theme='dark'], [data-theme='dark'] *) {
        @contents
    }
}
```

The `&:where(S, S *)` form matches the element and its descendants and adds no specificity. It was not checked in a browser.

Forms are refused. See [Messages for forms](#messages-for-forms).

#### Part spellings

A group's mixin writes one rule for every part below it, at any depth, holding that part's own declarations. A part's spelling in the vocabulary places its rule:

| Spelling | Placed as |
|---|---|
| No `&`, not an at-rule (`:hover`) | `&`, then the spelling inside `:where()`, as a nested rule (`&:where(:hover) { … }`) |
| With `&` (`.card:where([data-variant='primary']) &`) | `&`, then the spelling inside `:where()`, where its own `&` still stands for the rule's selector (`&:where(.card:where([data-variant='primary']) &) { … }`) |
| An at-rule (`@media (…)`) | Wraps the declarations in that at-rule |

Every part rule therefore weighs what the rule that applies the mixin weighs: `:where()` adds nothing, and neither does an at-rule. A spelling says when the part applies to the element itself; one whose subject is another element, such as `& > .icon`, would no longer reach that element once placed this way. Style a child with its own group, as in the [guide](./guide.md#style-a-part-that-lives-on-a-child). A part nested in a part is the chain of their spellings, the outer first: `button.selected.hover` is written `&:where([aria-pressed='true']) { &:where(:hover) { … } }`. A part's own mixin holds its declarations, then the rules of the parts below it.

**Precedence.** Under a selection of part values, the core says which token applies: the one with more matching parts, then, on a tie, the one whose latest differing axis comes later in the vocabulary ([`applies()`](https://codeberg.org/Toghen/lib/src/branch/main/reference.md#appliescomponent-selection-mode-recordstring-string)). The mixin carries this in the order of its rules: rules with more parts come after rules with fewer; between rules of as many parts, walking the axes from the last, at the first axis where two differ, the one with a value there comes later. Every part rule weighs the same, so the order alone decides, and the cascade gives the core's answer whatever the spellings are: an at-rule, a `:where()`, an id or an `:is()` with a heavy argument. Two values of one axis can match at once in a browser, as `:hover` and `:active` do; the core is never asked that, and the value declared later comes later and wins. A group's key order carries no meaning. Declare the variant axis first and the state axes after. A variant that must keep its look under a state nests its own value, such as `button.primary.hover`. The vocabulary's shape is in [lib's reference](https://codeberg.org/Toghen/lib/src/branch/main/reference.md#parts).

### `@toghen spellings`

```css
@toghen spellings;
@toghen spellings collection;
```

Placed at the top of the stylesheet, outside any rule and any layer, like `@toghen mixins`. It names every spelling of the parts vocabulary and of the contexts, for an author's own rules:

| Spelling | Written as | Name |
|---|---|---|
| A selector of a vocabulary value on the root | `@custom-selector :--<axis>-<value> <selector>;` | `:--state-hover` |
| A selector of a value a group declares or overrides | `@custom-selector :--<group>-<axis>-<value> <selector>;` | `:--ui-checkbox-state-pressed` |
| A context's selector | `@custom-selector :--<modifier>-<context> <selector>;` | `:--theme-dark` |
| A context of a modifier written with `light-dark()` | a comment saying why it is left out (no selector or media query to name) | |
| One `@media` rule, of a value or a context | `@custom-media --<name> <query>;` | `--input-fine` |
| A spelling holding `&`, or an at-rule other than `@media` | a comment saying why it is left out | |

Names follow `propertyName` for a group's path; axis, value, modifier and context names are written as identifiers. Selectors come first, then media, then the comments. Within each, the vocabulary comes before the contexts, and the contexts follow the order the document declares its modifiers. Two spellings of one name stop the build whatever `onUnresolved` says. The mixins keep the literal spellings. `@custom-media` ([Media Queries 5](https://www.w3.org/TR/mediaqueries-5/#at-ruledef-custom-media)) and `@custom-selector` ([CSS Extensions](https://drafts.csswg.org/css-extensions/#custom-selectors)) are read by no browser yet: `postcss-custom-media` and `postcss-custom-selectors` expand them, listed after this plugin.

### `@toghen declare`

```css
@toghen declare path;
@toghen declare path, mode;
@toghen declare path, mode from base;
```

Placed inside a rule. It writes one custom property per token under the path: a whole collection, a group, or one token. Each property is named by `propertyName`, and its value is the one a read of that token writes.

- With no mode, or the default mode, and no `from`, it writes every token.
- With another mode, it writes only the tokens whose resolved CSS differs from the base's. The base is the `from` mode, else `defaultMode`, else the collection's default.
- A typography token follows `typography`. A composite follows `composites`.

```css
.card {
    @toghen declare ds.space;
}

[data-density='compact'] .card {
    @toghen declare ds.space, density=compact;
}

[data-theme='dark'] .panel {
    @toghen declare ds.text, theme=light from theme=dark;
}
```

The plugin writes:

```css
.card {
    --space-sm: 8px;
}

[data-density='compact'] .card {
    --space-sm: 4px;
}

[data-theme='dark'] .panel {
    --text-default: #1a1a1a;
    --text-muted: #666666;
}
```

The comparison also catches a token whose `var()` text stays the same while its value changes. See [declaring a context in the specs](./specs.md#declaring-a-context).

Forms are refused. See [Messages for forms](#messages-for-forms).

---

## Short forms

| Long form | Short form |
|---|---|
| `toghen(…)` | `t(…)` |
| `@toghen …` | `@t …` |

Both forms give the same output. A short form is recognised only where a function name can start: never after a letter, a digit, `-` or `_`. So `inset(`, `rect(`, `repeat(` and `format(` are left alone.

---

## Generated names

| Name | Written for | Example |
|---|---|---|
| The custom property | Each token, and each member with a property | `ds.surface.accent` → `--surface-accent`; `ds.button.primary.backgroundColor` → `--button-primary-background-color` |
| The mixin of a group | `@toghen mixins` | `--button`; a child group `--button-icon` |
| The mixin of a part | `@toghen mixins` | `--button-primary`, `--button-selected-hover` |
| The mixin of a typography token | `@toghen mixins` | `--type-label` |
| The when-mixin | `@toghen mixins` | `--when-theme-dark` |
| The local property | `@toghen mixins` and `t()`, for a re-pointed token | `--_button-background-color` |
| The custom selector | `@toghen spellings` | `:--state-hover`, `:--ui-checkbox-state-pressed`, `:--theme-dark` |
| The custom media | `@toghen spellings` | `--input-fine` |
| The layers | `@toghen contexts` in a named layer | `defaults`, then each modifier's name: `theme`, `density` |
| The chain head | `bind: 'chain'` | `--surface-stripe`, which composes the links |
| The chain link | `bind: 'chain'`, one per modifier that changes the token | `--surface-stripe--theme` |
| The chain flag | `bind: 'chain'`, where a link depends on another modifier | `--theme--dark` |
| The guarded step | `bind: 'chain'`, the step of a conditional link in one context | `--surface-stripe--theme--dark` |

Custom property names, mixin names, chain heads and chain links are built with `propertyName`. Chain flags and when-mixins are built from the modifier and context names, which a custom function does not change. A guarded step extends its link, so it follows `propertyName` too. A name with a space is written with a hyphen in place of the space. Other characters an identifier cannot hold are escaped.

---

## Retired forms

The plugin does not read these forms. It reports each one and leaves it in the output as written. To move a stylesheet, see [the guide's migration section](./guide.md#move-a-stylesheet-off-the-old-directives).

| Form | Replacement | Message |
|---|---|---|
| `:toghen(…)` and `:t(…)` selector | `@apply --when-<modifier>-<context>;` with `@toghen mixins`, or the context's own spelling | `[@toghen/postcss] Cannot use "<selector>": the :toghen() and :t() selectors are retired: write the rule for a context with @apply --when-<modifier>-<context> { … } (with @toghen mixins), or select the context's own spelling. The rule is left as written.` |
| `@toghen base <path>` | The path written in full | `[@toghen/postcss] Cannot use "<directive>": it is retired: write the path in full; the collection segment is optional when the system has one collection.` |
| `@toghen mode <pairs>` | `t(path, mode)` for a value in a mode. `t(path)` lets the cascade choose. | `[@toghen/postcss] Cannot use "<directive>": it is retired: read a value in a context with t(path, mode); t(path) lets the cascade choose.` |
| `@toghen states via <spelling>` | A part in the mixin of its group, placed by the vocabulary's spelling | `[@toghen/postcss] Cannot use "<directive>": it is retired: a part is nested in the mixin of its group, placed by the spelling of its vocabulary; place a wrapper's state in your own selector and @apply the part's mixin.` |
| `@toghen layer` and `@toghen layer states` | A part nested in its rule, in that rule's layer | `[@toghen/postcss] Cannot use "<directive>": it is retired: a part is nested in the rule that applies its group, in that rule's layer; there is no state layer.` |
| `@toghen <path>;` or `@t <path>;` for a token | `t(<path>)` in a declaration | `[@toghen/postcss] Cannot use "@t text.default, theme=dark": it is retired: use t(text.default, theme=dark) in a declaration.` |
| `@toghen <path>;` or `@t <path>;` for a group or a typography token | `@apply --<name>;` with `@toghen mixins` | `[@toghen/postcss] Cannot use "@toghen ds.button": it is retired: use @apply --button; with @toghen mixins.` (the name is the path's mixin) |
| `t(path as var)` | Nothing: `t(path)` already writes `var()` | `[@toghen/postcss] Cannot read "<path>": "as var" is retired or unknown: t(path) already writes var(--name, literal); there is no form to ask for it.` |
| `t(path as longhands)` and `t(path as shorthand)` | Write the declarations with `t()`, or apply the group with `@apply` and `@toghen mixins` | `[@toghen/postcss] Cannot read "<path>": "as <form>" is retired or unknown: write the declarations yourself with t(), or apply the group with @apply and @toghen mixins; the composites and typography options say how declare and contexts write a composite.` |
| Option `tokenLayer` | Nothing. `t(path)` writes `var(--name, literal)` in any layer. | `[@toghen/postcss] The option "tokenLayer" is retired and ignored: nothing replaces it. t(path) writes var(--name, literal) everywhere, in any layer.` |
| Option `stateLayer` | Nothing. A part is nested in the rule that applies its component. | `[@toghen/postcss] The option "stateLayer" is retired and ignored: nothing replaces it. A part is nested in the rule that applies its component, in that rule's layer.` |

The option messages come once per stylesheet. A `:toghen()` selector rule is left as written.

---

## Messages

Plugin messages start with `[@toghen/postcss]`. Lib's text and the class text follow a colon inside them. Names in angle brackets stand for what is in the reader's file. Messages come through `onUnresolved` unless the table says it is always a warning. The messages for retired forms are in [Retired forms](#retired-forms).

A mixin body or a typography mixin that cannot be read is left out with no message. A group with one direct token that has no CSS spelling gets no mixin at all.

### Messages for reads

| Message | Cause | Fix |
|---|---|---|
| `Cannot resolve token "<path>" (mode: <mode>): <lib message>`, with the mode part left out when neither the call nor the options name a mode | The path does not exist, the collection does not exist, or the mode is not built. The lib message is `Token '<rest>' not found in collection '<name>' for mode '<mode>'.`, `Collection '<name>' not found.`, or `InvalidModeError: Mode '<mode>' was not built in collection '<name>'. …` | Correct the path: start it with the collection name, or leave the name out when the system has one collection. Build the mode. |
| `Cannot write token "<path>" (mode: <mode>): No CSS serialisation for a value of shape <keys>. …` | The token exists, and its value has no CSS spelling. Typically a typography token read whole under `'block'`, a gradient, or a stroke style. | Read its members (`t(<path>.fontSize)`), or set `typography: 'font'`. The full text of the class message is below. |
| `Cannot read "<path>": as takes a form: the only form is value.` | `as` is followed by nothing. | Write `as value`, or remove `as`. |
| `Cannot read "<path>": "as <form>" is retired or unknown: the only form is value.` | `as` is followed by a form other than `value`. | Write `as value`, or remove `as`. |

The full text of the class message, which the plugin repeats after the colon for a value with no CSS spelling:

```text
No CSS serialisation for a value of shape <keys>. Composite types the core resolves but this adapter cannot yet write are `gradient` (the DTCG value carries stops but no direction) and `typography` (a block of several CSS properties, not one value: write its members instead, `toghen(path.fontSize)`, `toghen(path.lineHeight)` and so on, or set `typography: 'font'`), and a `strokeStyle` object (`dashArray`, `lineCap`: CSS has no dash pattern). See toghen-postcss/specs.md §Composite types.
```

### Messages for forms

| Message | Cause | Fix |
|---|---|---|
| `Cannot read "<path>": contexts, mixins and declare take no form; the composites option says how a composite is declared.` | A form follows the path of `@toghen contexts`, `@toghen mixins` or `@toghen declare`. | Remove the form. Choose a composite's spelling with `composites`. |

### Messages for contexts

| Message | Cause | Fix |
|---|---|---|
| `Cannot write the contexts of "<path>" inside a rule: they are rules themselves. Put @toghen contexts at the top of the stylesheet.` | The directive sits in a rule. | Move it to the top level or into a named layer. |
| `Cannot write the contexts of "<path>": it names no token.` | The path matches no token. | Correct the path. |
| `Cannot write the contexts of "<path>" in a layer: modifier 'defaults' collides with the layer of the defaults.` | A modifier is called `defaults` and the directive is in a named layer. | Rename the modifier. |
| `Cannot write the contexts of "<path>" in layer '<layer>': its order would be "<order>", and the layer already has "<before>". CSS keeps the first order statement of a layer. Put the collections in different layers, or give them the same modifiers in the same order.` | A second `@toghen contexts` in the same layer gives another order. | Use a different layer, or the same modifiers in the same order. |
| `Cannot write the contexts of modifier '<modifier>': contexts '<first>' and '<clash>' have the same CSS spelling, so neither block could be told from the other. Give each its own selector or at-rule.` | Two non-default contexts share a spelling. | Give each context its own selector or at-rule. |
| `Cannot write context '<context>' of modifier '<modifier>': the resolver document gives it no CSS selector. Add $extensions["com.toghen"].css to the modifier.` | A context other than the default has no spelling. | Add the spelling to the modifier. |
| `Cannot write modifier '<modifier>' with light-dark(): '<token>' is a <type>, and light-dark() takes only colours. Write the modifier with a selector or an at-rule, or vary only colours in it.` | A modifier written with `light-dark()` varies a token that is not a colour (in the text written: under `references: 'var'` a shadow that only reads a themed colour is the same on both sides and is no error). Nothing is written for that modifier. | Spell the modifier with a selector or an at-rule, or vary only colours in it. |
| `Cannot write modifier '<modifier>' beside '<paired>': both vary '<token>', and the block of '<modifier>' would replace the light-dark() pair of '<paired>' with a plain value. Spell one of them with a selector or an at-rule, or vary different tokens in each.` | A token is varied by a `light-dark()` modifier and by another modifier's block. | Spell one of them with a selector or an at-rule, or vary different tokens in each. |
| `Cannot chain modifier '<modifier>': it is written with light-dark(), which has no blocks to chain. Leave out bind: 'chain', or spell the modifier with a selector or an at-rule.` | `bind: 'chain'` and a modifier written with `light-dark()`. | Leave out `bind: 'chain'`, or spell the modifier with a selector or an at-rule. |
| `Cannot write the contexts of "<path>": <lib message>` | Lib raised an error while writing the directive. | Read the lib message. |
| Warning, always a warning: `<prop> changes under '<modifier>' and '<modifier>'. Written as resolved values, the later block wins where both apply, which is right only if its value does not depend on both. Use references: 'var', or declare the combination yourself.` | A property changes under two modifiers and `references` is `'resolve'`. | Use `references: 'var'`, or declare the combination yourself. |

### Messages for chains

These appear only with `bind: 'chain'`.

| Message | Cause | Fix |
|---|---|---|
| `Cannot write chains for "<path>": collection '<name>' was not built from a resolver document, so it cannot say which modifier a token falls through to. Build it with resolveContextsToDesignSystem(), or leave out bind: 'chain'.` | The collection was not built from a resolver document. | Build it with `resolveContextsToDesignSystem()`, or drop the option. |
| `Cannot write the chain of "<token>": its <owner> property <prop> is also the property of <holder>. Rename one of them, or give propertyName an injective rule.` | A link, flag or guarded step has the same name as another property. | Rename a token, or give `propertyName` an injective rule. |
| Warning, always a warning: `Cannot chain "<token>" ($value): <detail> Modifiers: …. Contexts: …. Written as resolved values, bound early: the later block wins whole where its modifiers are set on different elements.` | The resolver cannot factor the token's value by modifier. | Accept the early binding, or give each modifier its own token. |
| Warning, always a warning: `Cannot chain "<token>": it refers to "<collection>.<target>", which depends on <modifiers>, and references: 'resolve' writes that value bound early. Use references: 'var'.` | The token refers to a token that another modifier changes, under `'resolve'`. | Use `references: 'var'`. |
| Warning, always a warning: `"<token>" has no value where <modifier>=<context>. The head is written without a final fallback there.` | The token has no value in a context. | Give it a value in the default, or accept the missing fallback. |

### Messages for mixins

| Message | Cause | Fix |
|---|---|---|
| `Cannot write the mixins of "<path>" inside a rule: a mixin is defined at the top of a stylesheet, and a rule cannot hold a definition. Put @toghen mixins at the top of the stylesheet, outside any rule or layer.` | The directive sits in a rule. | Move it to the top level. |
| `Cannot write the mixins of "<path>" inside a layer: a mixin has no cascade position of its own, and the mixins polyfill ignores one in a layer. Put @toghen mixins at the top of the stylesheet, outside any rule or layer.` | The directive sits in a named layer. | Move it to the top level. |
| `Cannot write the mixins of "<path>": the argument is a collection, and may be left out when the system has one.` | A path was given where a collection name is expected. | Name the collection, or leave the argument out. |
| `Cannot write the mixins of "<path>": it names no token.` | The collection holds no token. | Check the collection. |
| `Cannot write the mixins of "<group>": <lib message>` | A path in that top-level group has two values of one axis, for example `Path 'button.hover.pressed.backgroundColor' nests two parts of axis 'state': 'hover' and 'pressed'. Give the group "com.toghen": { "css": { "parts": false } }, or rename a key.` The group's mixins are left out; the others are written. | Remove one of the two parts from the path, or give a group that is no component `parts: false`. |
| Error, always: `"<a>" and "<b>" are both written as the mixin <name>. Rename one of them, or give propertyName an injective rule.` A when-mixin is named by its context, as `theme=dark`. | Two paths, or a path and a context, give one mixin name. | Rename one, or give `propertyName` an injective rule. |

### Messages for spellings

| Message | Cause | Fix |
|---|---|---|
| `Cannot write the spellings of "<path>" inside a rule: a name is defined at the top of a stylesheet, and a rule cannot hold a definition. Put @toghen spellings at the top of the stylesheet, outside any rule or layer.` | The directive sits in a rule. | Move it to the top level. |
| `Cannot write the spellings of "<path>" inside a layer: the polyfills ignore a definition in a layer. Put @toghen spellings at the top of the stylesheet, outside any rule or layer.` | The directive sits in a named layer. | Move it to the top level. |
| `Cannot write the spellings of "<path>": the argument is a collection, and may be left out when the system has one.` | A path was given where a collection name is expected. | Name the collection, or leave the argument out. |
| Error, always: `<a> and <b> are both written as @custom-selector <name>. Rename one of them, or give propertyName an injective rule.` (or `@custom-media`) | Two spellings give one name. | Rename an axis, a value, a modifier or a context. |

### Messages for declare

| Message | Cause | Fix |
|---|---|---|
| `Cannot declare "<path>" here: custom properties are declarations, and declarations need a rule to live in. Put @toghen declare inside a rule.` | The directive sits outside any rule. | Put it inside a rule. |
| `Cannot declare "<path>" (mode: <mode>): it names no token.` The mode part is left out when the call names none. | The path matches no token. | Correct the path. |
| `Cannot resolve token "<path>" (mode: <mode>): <lib message>` | The `from` mode, or the declared mode, is not built. | Build the mode, or correct its name. See [Messages for reads](#messages-for-reads). |

### Messages shared by the directives

| Message | Cause | Fix |
|---|---|---|
| `"<a>" and "<b>" are both written as <prop>, and the later declaration wins. Rename one of them, or give propertyName an injective rule.` | Two paths give one property name within one directive's output. | Rename one of the tokens, or give `propertyName` an injective rule. |
| `"<member>" is written as "<name>", which is not a CSS property mdn-data knows. It is written anyway: the data may lag CSS.` | A typography member's key is not a CSS property in the data the plugin has. | Nothing, if the property is current CSS. Otherwise rename the key. |
| `"<token>" declares its member "<member>" as <prop>, which is also the property of the token "<holder>". The token wins; the member property is not written.` | A composite's member and a token of the same name give one property. | Rename the token or the member. |

---

## Errors

| Error | Where it comes from | What you see |
|---|---|---|
| `Error`, with the text below | The plugin function, when it is called with no options or with options that have no `system` | The build fails when the configuration loads. |
| `UnserializableValueError` | Exported. `valueToCss` throws it for a value with no CSS spelling. | Reported as a `Cannot write token` message, through `onUnresolved`. |
| `CssSyntaxError` | PostCSS, when `onUnresolved` is `'throw'`. | The build stops at that node, with the message. |
| `PathNotFoundError`, `CollectionNotFoundError`, `InvalidModeError` | Lib, from reads and mode names. | Their text, inside the plugin's message. They are not thrown to you. |

The no-options error is thrown, not reported. Its text, verbatim:

```text
@toghen/postcss needs its options: it has no design system to read. Pass { system } at least, e.g. toghenPlugin({ system }); listed bare in a PostCSS config it cannot run.
```

Fix: call the plugin with `{ system }`, as `toghenPlugin({ system })`. PostCSS calls the plugin with no arguments when it is listed bare, so that throws it too.

`UnserializableValueError` carries the value that could not be written, in its `value` member.

A failure has two kinds, and the message says which. **Cannot resolve** means the path, the collection or the mode was not found: look for a typo or a mode that is not built. **Cannot write** means the path was found and the value has no CSS form: look at the token's type.

---

## TypeScript types

```typescript
import type { Plugin } from 'postcss';
import type { DesignSystem } from '@toghen/lib';
```

The package exports the plugin as its default, and beside it:

```typescript
import toghenPlugin, { valueToCss, UnserializableValueError } from '@toghen/postcss';
import type { ToghenPluginOptions } from '@toghen/postcss';
```

`valueToCss(value: unknown): string` writes one resolved value the way the plugin does: a string or a number as it is, a list comma-joined, a colour as hex when it has one or lies in sRGB (`transparent` for black at alpha 0), otherwise as its own CSS function (`oklch(…)`, `color(display-p3 …)`), a dimension as its number and unit, a shadow, a border and a transition in shorthand order. It does not know types. A `cubicBezier`, a font family list and a `typography` token need the plugin, which spells them by type. It throws `UnserializableValueError` for anything else.

---

## Examples

### postcss.config.js

```javascript
import toghenPlugin from '@toghen/postcss';
import { system } from './tokens/system.js';

export default {
  plugins: [toghenPlugin({ system, onUnresolved: 'throw' })]
};
```

Build your mixins polyfill and nesting polyfill after the plugin. The [guide](./guide.md) gives the order.

### Programmatic use

```javascript
import { readFile } from 'node:fs/promises';
import postcss from 'postcss';
import { load, Resolver } from '@toghen/lib';
import toghenPlugin from '@toghen/postcss';

const { document } = await load('./tokens/ds.resolver.json', { read: (file) => readFile(file, 'utf8') });
const system = new Resolver(document).resolveContextsToDesignSystem();

const input = '.label { color: t(surface.raised); }';
const { css } = await postcss([toghenPlugin({ system, onUnresolved: 'warn' })])
  .process(input, { from: undefined });
```

From token files, only the `load()` call changes. The system then has the defaults only, in a collection named after the files' folder:

```javascript
const { document } = await load(['./tokens/roles.tokens.json', './tokens/button.tokens.json'], { read: (file) => readFile(file, 'utf8') });
```
