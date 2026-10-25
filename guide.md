# @toghen/postcss — User guide

> The plugin writes a design system's tokens into a stylesheet at build time, as custom properties, mixins and cascade layers. Its words are the words of the [glossary](https://codeberg.org/Toghen/lib/src/branch/main/model.md#glossary), and the [component model](https://codeberg.org/Toghen/lib/src/branch/main/model.md) explains them. Start with the [tutorial](./tutorial.md); keep the [reference](./reference.md) open for every option and message.

Every example uses the running example, the document `ds` in [the example's folder](https://codeberg.org/Toghen/lib/src/branch/main/example/).

## Set up the pipeline

Install the plugin, the library and the mixins polyfill, which expands `@apply` in the browsers that do not yet read mixins:

```sh
pnpm add -D @toghen/postcss @toghen/lib @csstools/postcss-mixins postcss
```

The library is the plugin's peer, not its dependency: the plugin uses your copy, the one you build the system with below. One copy matters. The plugin recognises the library's errors by their class, and a second copy's errors would not be recognised, so a missing token that should be skipped would stop the build. To use a commit not yet released, install both from the repository by git URL, `…#main&path:/toghen-postcss` and `…#main&path:/toghen-lib`, as the [library's guide](https://codeberg.org/Toghen/lib/src/branch/main/guide.md#from-the-repository) shows, allowing both builds.

List Toghen first and the polyfill after it, in the same pipeline. Toghen writes the mixins before any plugin starts, so the polyfill finds them; listed after the polyfill, Toghen still writes them, but nothing expands them. The polyfill's `preserve: true` keeps each `@apply` beside what it expands to. Add a nesting polyfill after them only for a target without native CSS nesting. Toghen must see the whole sheet before any plugin that parses selectors or flattens nesting.

Build the system from your token files. `load()` merges them in the order given, and names the collection after their folder, here `tokens`:

```ts
// tokens/system.js
import { readFile } from 'node:fs/promises';
import { load, Resolver } from '@toghen/lib';

const { document } = await load(['tokens/roles.tokens.json', 'tokens/button.tokens.json'], {
  read: (path) => readFile(path, 'utf8'),
});
export const system = new Resolver(document).resolveContextsToDesignSystem();
```

Token files give the defaults only. There is no modifier, so `@toghen contexts` writes one block and there is no `--when-` mixin. For modifiers and their contexts, such as a dark theme, load a resolver document instead. It is the form every task below uses. `resolveContextsToDesignSystem()` makes every context of every modifier switchable on its own:

```ts
const { document } = await load('tokens/ds.resolver.json', {
  read: (path) => readFile(path, 'utf8'),
});
export const system = new Resolver(document).resolveContextsToDesignSystem();
```

The library's guide shows [both forms](https://codeberg.org/Toghen/lib/src/branch/main/guide.md#start-from-token-files).

Put both plugins in the PostCSS configuration:

```javascript
// postcss.config.js
import postcssMixins from '@csstools/postcss-mixins';
import toghenPlugin from '@toghen/postcss';
import { system } from './tokens/system.js';

export default {
  plugins: [toghenPlugin({ system }), postcssMixins({ preserve: true })],
};
```

With postcss-cli, run `postcss styles/input.css -o dist/output.css`. In Vite, the same two plugins go under `css.postcss.plugins`. A webpack `postcss-loader` takes them under `postcssOptions.plugins`. Run from code, the order is the same:

```ts
import postcss from 'postcss';
import postcssMixins from '@csstools/postcss-mixins';
import toghenPlugin from '@toghen/postcss';

const result = await postcss([toghenPlugin({ system }), postcssMixins({ preserve: true })])
  .process(css, { from: 'styles/input.css' });
```

## Declare the tokens and their modifiers

Write `@toghen contexts` inside a layer for your tokens:

```css
@layer tokens {
    @toghen contexts;
}
```

It writes the defaults under `:root`, then one block for every context of every modifier. Each block is complete, so an element can set any context and be right, however it is nested. The start of the output:

```css
@layer tokens {
    @layer defaults, theme, density;
    @layer defaults {
        :root {
```

Inside the layer, the defaults and each modifier get a sublayer, in the resolver's order, so a later modifier wins whatever the selectors. The density layer:

```css
    @layer density {
        [data-density='regular'] {
            --space-sm: 8px;
            --button-padding-block: 8px;
            --field-padding-block: 8px
        }
        [data-density='compact'] {
            --space-sm: 4px;
            --button-padding-block: 4px;
            --field-padding-block: 4px
        }
    }
}
```

The default context gets no block when the document gives it no selector, because the defaults already hold its values. Any other context with no selector is reported, since nothing says where its block goes.

**Register the properties.** Add `registerProperties: true` to write an `@property` for each token of a colour, a length in pixels, a duration or a number. Input and output:

```css
@layer tokens {
    @toghen contexts surface;
}
```

```css
    @property --surface-raised {
        syntax: '<color>';
        inherits: true;
        initial-value: #ffffff
    }
```

It is off by default. A registered property always has an initial value, so a `var()` fallback never applies to it. Chain links and flags are never registered, and neither are font families, shadows, typography tokens or `rem` and `em` dimensions.

## Write the mixins

Write `@toghen mixins;` at the top of the stylesheet, outside every rule and layer. A mixin has no place in the cascade, and the polyfill ignores one in a layer, so the directive is refused inside either.

```css
@toghen mixins;
```

It writes one mixin per group, named by its path, such as `--button-icon` for `button.icon`. It also writes a mixin for each part, for each typography token, and a `--when-` mixin for each context with a selector:

```css
@mixin --button-icon {
    color: var(--button-icon-color, #666666);
    @contents
}
```

The `@contents` line is where a block given to `@apply` lands; see [Place a declaration between the rest and the parts](#place-a-declaration-between-the-rest-and-the-parts). A mixin name is a path with the custom-property rule, so two paths can give one name, as `fact.strip` and `fact-strip`. The build then stops and names both, because the polyfill would drop both definitions.

```css
@mixin --when-theme-dark {
    &:where([data-theme='dark'], [data-theme='dark'] *) {
        @contents
    }
}
```

## Style a component

Apply a group's mixin in the rule that styles the component. `@apply` expands in place, so the rule gets the group's declarations, then its parts as nested rules:

```css
@layer tokens {
    @toghen contexts;
}

@toghen mixins;

.button {
    display: inline-flex;
    @apply --button;
}

.button-icon {
    @apply --button-icon;
}
```

```css
.button {
    display: inline-flex;
    --_button-background-color: initial;
    --_button-color: initial;
    background-color: var(--_button-background-color, var(--button-background-color, #ffffff));
    color: var(--_button-color, var(--button-color, #1a1a1a));
    padding-block: var(--button-padding-block, 8px);
    border-radius: var(--button-border-radius, 6px);
    font-family: var(--button-font-font-family, Inter, "Helvetica Neue", sans-serif);
    font-size: var(--button-font-font-size, 0.875rem);
    font-weight: var(--button-font-font-weight, 500);
    line-height: var(--button-font-line-height, 1.25);
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
}
.button-icon {
    color: var(--button-icon-color, #666666)
}
```

This is the expanded sheet, without the `@apply` lines. Each token that a part changes is read through a local property first: `var(--_button-background-color, var(--button-background-color, #ffffff))`. A part sets the local property, and the button resets it to `initial`, which in a custom property means no value, so the read falls back to the property the theme declares. The theme stays on `--button-background-color`, and the part stays on the element:

- A button inside a primary button starts from its own rest, because its rule resets the local property.
- A child group still receives its component's part by inheritance. A token such as `button.pressed.icon.color` reaches the icon inside a pressed button, because the reset of a token sits in the component whose parts change it, here the button.
- A token no part changes is read as before, `var(--button-padding-block, 8px)`.

With `preserve: true` the `@apply` lines stay beside the expansion. A child is a group of its own, so `.button-icon` applies `--button-icon`. The [tutorial](./tutorial.md) builds this page in a browser.

## Add a part to a component

A part is a subgroup whose key is a value of the vocabulary. Write the subgroup with the tokens it changes, and make sure the vocabulary names its key. The `hover` part of `button` and the vocabulary at the document root:

```json
    "hover": {
      "backgroundColor": {
        "$type": "color",
        "$value": "{surface.selected}"
      }
    },
```

```json
{
  "$extensions": {
    "com.toghen": {
      "css": {
        "parts": {
          "variant": {
            "primary": "[data-variant='primary']"
          },
          "state": {
            "hover": ":hover",
            "pressed": ":active",
            "disabled": ":is(:disabled, [aria-disabled='true'])"
          },
          "selection": {
            "selected": "[aria-pressed='true']"
          }
        }
      }
    }
  }
}
```

A part's tokens re-point the rest where the rest has a twin. The part sets the button's local property, `--_button-background-color`, which the rest reads before the theme's `--button-background-color`. `--button` writes the same declarations under `:hover`:

```css
@mixin --button-hover {
    --_button-background-color: var(--button-hover-background-color, #e0ebfc)
}
```

```css
    &:where(:hover) {
        --_button-background-color: var(--button-hover-background-color, #e0ebfc)
    }
```

A token with no twin at rest sets its own property. `field.disabled` has only `opacity`, so its mixin writes the property:

```css
@mixin --field-disabled {
    opacity: var(--field-disabled-opacity, 0.5)
}
```

A group can have parts and no rest of its own, when its rest comes from elsewhere, such as a recipe it composes. It still gets a mixin, with the parts in the vocabulary's order. A chip that defines only its hover and pressed backgrounds:

```css
@mixin --chip {
    @contents;
    &:where(:hover) {
        background-color: var(--chip-hover-background-color, #e0ebfc)
    }
    &:where(:active) {
        background-color: var(--chip-pressed-background-color, #1a66e6)
    }
}
```

Each part sets its own property, so the recipe's value shows until a part applies. Apply `--chip` after the recipe.

When two parts match at once, the token with more parts wins. On a tie, the one whose latest differing axis comes later in the vocabulary wins: the axes as declared, then the values of each axis as declared. This is the core's answer, [`applies()`](https://codeberg.org/Toghen/lib/src/branch/main/reference.md#appliescomponent-selection-mode-recordstring-string), and the mixin writes it into the order of its rules: rules with more parts come after rules with fewer, then in the tie order. Each rule puts its spelling inside `:where()`, so every part rule weighs the same as the rule that applies the mixin, and a spelling's weight never decides which part wins: not a `:hover` against an at-rule or a `:where()` later in the vocabulary, and not an id against a chain of lighter spellings. Two values of one axis can match at once in a browser, as `:hover` and `:active` do; the core is never asked that, and the value declared later wins. The key order in your document is not read. Declare the `variant` axis first and the state axes after. Nest a value's own state inside the value, so the value keeps its look under a state. The example does this for `selected`, which is a value of the selection axis: `button.selected.hover`, whose rule comes after every rule of one part.

## Give one component its own spelling of a part

A group reads the vocabulary of every holder above it. A holder below overrides one entry and keeps the rest. The field's `disabled` replaces the root's spelling with its own:

```json
    "$extensions": {
      "com.toghen": {
        "css": {
          "parts": {
            "state": {
              "disabled": ":has(> input:disabled)"
            }
          }
        }
      }
    },
```

```css
.field {
    background-color: var(--field-background-color, #ffffff);
    color: var(--field-color, #1a1a1a);
    padding-block: var(--field-padding-block, 8px);
    border-radius: var(--field-border-radius, 6px);
    &:where(:has(> input:disabled)) {
        opacity: var(--field-disabled-opacity, 0.5)
    }
}
```

The field keeps the `variant` and `selection` axes from the root.

## Key a part on an ancestor's state

Sometimes the attribute sits on an ancestor and the element inside follows it: a badge takes the variant of the card around it. The badge never carries `data-variant`, so the root's spelling `[data-variant='primary']`, appended to `.badge`, would never match. Spell the axis again on the badge's group, with `&` standing for the badge:

```json
  "badge": {
    "$extensions": {
      "com.toghen": {
        "css": {
          "parts": {
            "variant": {
              "primary": ".card:where([data-variant='primary']) &",
              "quiet": ".card:where([data-variant='quiet']) &"
            }
          }
        }
      }
    },
    "color": { "$type": "color", "$value": "{color.ink}" },
    "primary": { "color": { "$type": "color", "$value": "{color.accent}" } },
    "quiet": { "color": { "$type": "color", "$value": "{color.strong}" } }
  }
```

`@apply --badge;` is then the whole stylesheet. The parts land under the card, and no rule is left on the badge alone:

```css
.badge {
    --_badge-color: initial;
    color: var(--_badge-color, var(--badge-color, #1a1a1a));
    &:where(.card:where([data-variant='primary']) &) {
        --_badge-color: var(--badge-primary-color, #1a66e6)
    }
    &:where(.card:where([data-variant='quiet']) &) {
        --_badge-color: var(--badge-quiet-color, #144fbd)
    }
}
```

The spelling sits inside `:where()`, with its own `&` standing for the badge, so the rule weighs what `.badge` weighs, like every part rule, and the order of the rules decides between them. Writing these rules by hand, as `.card[data-variant='primary'] .badge { @apply --badge-primary; }`, works too. But if the axis is still spelled for the badge itself, `@apply --badge` also writes `&[data-variant='primary']` rules that never match.

The opposite case, a state that sits on a child, is the next section.

## Style a part that lives on a child

A field's states sit on its input, so `.field:hover` would never match. The wrapper writes the selector and applies the part's mixin:

```css
.field {
    @apply --field;
}

.field:has(> input:focus-visible) {
    @apply --field-focus;
}
```

```css
.field:has(> input:focus-visible) {
    outline-color: var(--field-focus-outline-color, #1a66e6)
}
```

`focus` is not a value of the vocabulary, so `field.focus` is a plain child group with a mixin of its own, `--field-focus`.

The same shape serves two cases that look different.

**A state read from a preceding sibling.** CSS reaches a later sibling only from the earlier one, so a switch's thumb that moves when its input is checked, or a label that dims after a disabled control, is written with the sibling combinator and the part's mixin:

```css
.input:checked ~ .thumb {
    @apply --switch-thumb-checked;
}

.input:disabled ~ .label {
    @apply --label-disabled;
}
```

**A native state that should look like a part you already have.** A checkbox's `:indeterminate` looks like `selected`, but `selected` is spelled for every component, and adding `:indeterminate` to that spelling would make every component selected on it. The component adds the selector itself, and applies the part's mixin:

```css
.input:indeterminate {
    @apply --checkbox-selected;
}
```

The document's spelling is unchanged, and the extra spelling lives in the component's stylesheet. The mixin writes the part's whole group, so no property is listed by hand.

## Place a declaration between the rest and the parts

A setting from outside the component, such as a container's control height, must beat the component's rest and lose to its parts. Written after `@apply`, it lands after the nested part rules. Give `@apply` a block instead. A group's mixin marks a place with `@contents`, after its own declarations and before its parts, and the block lands there:

```css
.button {
    @apply --button {
        height: var(--control-height);
    }
}
```

`@apply --button;` with no block inserts nothing. A part's mixin has no `@contents`: write what a part needs in your own rule for that part.

## Keep a lookup table out of the parts

A vocabulary on the document root reads every group as a possible component. A table of values that is no component can hold keys that are vocabulary values by chance. `hue.plain.solid.bg`, where `plain` and `solid` are both `variant` values, nests two parts of one axis. The group's mixins are left out and the build says which group and why:

```text
[@toghen/postcss] Cannot write the mixins of "hue": Path 'hue.plain.solid.bg' nests two parts of axis 'variant': 'plain' and 'solid'. Give the group "com.toghen": { "css": { "parts": false } }, or rename a key.
```

The other groups are written as usual. Give the table `parts: false`, and no key under it is a part:

```json
"hue": {
  "$extensions": { "com.toghen": { "css": { "parts": false } } },
  "plain": { "solid": { "bg": { "$type": "color", "$value": "{palette.orange.100}" } } }
}
```

A group lower down that declares a vocabulary of its own starts again from it.

## Use the spellings in your own rules

Write `@toghen spellings;` at the top of the stylesheet, outside every rule and layer, to name every spelling of the vocabulary and of the contexts. Your own rules can then use a state or a context by name, and stay in step with the document:

```css
@toghen spellings;

.toolbar .button:--state-hover { outline: 1px solid; }
:--theme-dark .logo { filter: invert(1); }
@media (--input-fine) { .button { min-height: 24px; } }
```

It writes `@custom-selector` for a selector spelling and `@custom-media` for a `@media` one:

```css
@custom-selector :--state-hover :hover;
@custom-selector :--theme-dark [data-theme='dark'];
@custom-media --input-fine (pointer: fine);
```

A value of the root vocabulary is named `--<axis>-<value>`, a value a group overrides `--<group>-<axis>-<value>`, and a context `--<modifier>-<context>`. A spelling with `&` and an `@supports` or `@container` spelling have no named form; the output says so in a comment. No browser reads these rules yet, so add the polyfills, after Toghen:

```sh
pnpm add -D postcss-custom-media postcss-custom-selectors
```

```javascript
plugins: [toghenPlugin({ system }), postcssMixins({ preserve: true }), postcssCustomMedia(), postcssCustomSelectors()]
```

The mixins keep the literal spellings, so a stylesheet that does not write `@toghen spellings` needs neither polyfill.

## Make a component differ in one context

A `--when-` mixin wraps its contents in a context's selector, with `:where()`, which adds no specificity to the rule:

```css
.card {
    background-color: t(surface.raised);
    @apply --when-theme-dark {
        border: 1px solid t(surface.accent);
    }
}
```

```css
.card {
    background-color: var(--surface-raised, #ffffff);
    &:where([data-theme='dark'], [data-theme='dark'] *) {
        border: 1px solid var(--surface-accent, #1a66e6)
    }
}
```

## Read one token in a rule

`t()` is the short form of `toghen()`, and the [reference](./reference.md) gives both. A read is written as the token's custom property, with the default's value as fallback:

```css
.label {
    color: t(text.default);
    background-color: t(surface.raised as value);
    border-color: t(surface.accent, theme=dark);
    font-size: t(type.label.fontSize);
}
```

```css
.label {
    color: var(--text-default, #1a1a1a);
    background-color: #ffffff;
    border-color: #5c9bff;
    font-size: var(--type-label-font-size, 0.875rem);
}
```

| Form | Written as |
|---|---|
| `t(text.default)` | `var(--text-default, #1a1a1a)`: the property, with the default's value |
| `t(surface.raised as value)` | the literal, `#ffffff` |
| `t(surface.accent, theme=dark)` | the literal of that context |
| `t(type.label.fontSize)` | a member of a composite, as the `var()` of its own property |

The fallback is the token's value as the [`references`](./reference.md#references) option writes it: the literal by default, and under `references: 'var'` the `var()` of the token it refers to, so `t(hue.soft.bg)` is `var(--hue-soft-bg, var(--palette-orange-100))`. A read of a group that `@toghen contexts` does not declare then still follows the palette and its theme. A token that a part changes is read through the component's local property first, as in its mixin: `t(button.backgroundColor)` is `var(--_button-background-color, var(--button-background-color, #ffffff))`, so a rule you write inside the component follows its parts.

## Write a text style

A typography token is one mixin. Under the default option, `block`, the mixin holds longhands. Under `typography: 'font'`, it holds the shorthand. With `@toghen mixins;` above it, a rule that applies the token gets these:

```css
.label {
    @apply --type-label;
}
```

```css
@mixin --type-label {
    font-family: var(--type-label-font-family, Inter, "Helvetica Neue", sans-serif);
    font-size: var(--type-label-font-size, 0.875rem);
    font-weight: var(--type-label-font-weight, 500);
    line-height: var(--type-label-line-height, 1.25)
}
```

```css
.label {
    font-family: var(--type-label-font-family, Inter, "Helvetica Neue", sans-serif);
    font-size: var(--type-label-font-size, 0.875rem);
    font-weight: var(--type-label-font-weight, 500);
    line-height: var(--type-label-line-height, 1.25)
}
```

With `typography: 'font'`, the token is one custom property, `--type-label`, and the mixin writes the shorthand:

```css
@mixin --type-label {
    font: var(--type-label, 500 0.875rem/1.25 Inter, "Helvetica Neue", sans-serif)
}
```

```css
.label {
    font: var(--type-label, 500 0.875rem/1.25 Inter, "Helvetica Neue", sans-serif)
}
```

A group with a typography key, such as `button.font`, writes the same choice. The longhands under `block`:

```css
    font-family: var(--button-font-font-family, Inter, "Helvetica Neue", sans-serif);
    font-size: var(--button-font-font-size, 0.875rem);
    font-weight: var(--button-font-font-weight, 500);
    line-height: var(--button-font-line-height, 1.25);
```

The shorthand under `font`:

```css
    font: var(--button-font, 500 0.875rem/1.25 Inter, "Helvetica Neue", sans-serif);
```

The shorthand cannot carry some members, such as letter spacing. Those are written beside it.

## Keep tiers as var() links

By default a reference is followed to its end, so every tier comes out as the same literal. With `references: 'var'`, each tier points at the tier below:

```css
:root {
    @toghen declare ds.button.primary;
}
```

```css
:root {
    --button-primary-background-color: var(--surface-accent);
    --button-primary-color: var(--text-on-accent);
}
```

## Declare tokens by hand

`@toghen declare` writes a group, a token collection or one token as custom properties, in a rule you write. Named with a context, it writes only what differs from the defaults. `from` names the context the rule sits in, and then the values written are the ones that differ from that context's:

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

## Keep the reasons in the output

`descriptions: 'comment'` writes each token's `$description` above its custom property, so the sheet explains its values. A context block repeats a description only when its text differs from the defaults' description. Input and output:

```css
@layer tokens {
    @toghen contexts surface;
}
```

```css
@layer tokens {
    @layer defaults, theme, density;
    @layer defaults {
        :root {
            /* Cards, menus and the face of a control: one step above the page. */
            --surface-raised: #ffffff;
            --surface-accent: #1a66e6;
            --surface-selected: #e0ebfc
        }
    }
    @layer theme {
        [data-theme='light'] {
            --surface-raised: #ffffff;
            --surface-accent: #1a66e6;
            --surface-selected: #e0ebfc
        }
        [data-theme='dark'] {
            --surface-raised: #2b2b2b;
            --surface-accent: #5c9bff;
            --surface-selected: #26364d
        }
    }
}
```

## Make a token follow two modifiers

A token can change under two modifiers. In the striped example, `surface.stripe` changes under `theme` and under `density`, and the defaults alone cannot hold both. Without the option, the build warns:

```css
@layer tokens {
    @toghen contexts surface.stripe;
}
```

```text
--surface-stripe changes under 'theme' and 'density'. Written as resolved values, the later block wins where both apply, which is right only if its value does not depend on both. Use references: 'var', or declare the combination yourself.
```

With `bind: 'chain'`, the token's property is composed from one link property per modifier. It needs a system built from a resolver document, as `resolveContextsToDesignSystem()` gives:

```css
@layer tokens {
    @toghen contexts surface.stripe;
}
```

```css
@layer tokens {
    @layer defaults, theme, density;
    @layer defaults {
        :root {
            --surface-stripe: var(--surface-stripe--density, var(--surface-stripe--theme, #f5f5f5))
        }
    }
    @layer theme {
        [data-theme='light'] {
            --surface-stripe--theme: initial;
            --surface-stripe: var(--surface-stripe--density, var(--surface-stripe--theme, #f5f5f5))
        }
        [data-theme='dark'] {
            --surface-stripe--theme: #242424;
            --surface-stripe: var(--surface-stripe--density, var(--surface-stripe--theme, #f5f5f5))
        }
    }
    @layer density {
        [data-density='regular'] {
            --surface-stripe--density: initial;
            --surface-stripe: var(--surface-stripe--density, var(--surface-stripe--theme, #f5f5f5))
        }
        [data-density='compact'] {
            --surface-stripe--density: #ececec;
            --surface-stripe: var(--surface-stripe--density, var(--surface-stripe--theme, #f5f5f5))
        }
    }
}
```

- `--surface-stripe` is what components read. `--surface-stripe--theme` and `--surface-stripe--density` are links, each written only by its modifier's blocks.
- `initial` says that a context defines no value, so a light element inside a dark one does not inherit the dark value.
- The chain's behaviour in nested elements is checked in browsers. See [the measurements](./measurements/RESULTS.md).

## Theme a system with a map

The same resolver document with another overrides map gives another stylesheet. The map sends a file reference, as the document writes it, to another file. The example's [warm.overrides.json](https://codeberg.org/Toghen/lib/src/branch/main/example/warm.overrides.json) reads `roles.warm.tokens.json` wherever the document says `roles.tokens.json`. Build the system twice, once with the map, and run the plugin once per system:

```ts
import { readFile, writeFile } from 'node:fs/promises';
import postcss from 'postcss';
import postcssMixins from '@csstools/postcss-mixins';
import toghenPlugin from '@toghen/postcss';
import { load, Resolver } from '@toghen/lib';

const read = (path) => readFile(path, 'utf8');
const stylesheet = async (out, overrides) => {
  const { document } = await load('tokens/ds.resolver.json', { read, overrides });
  const system = new Resolver(document).resolveContextsToDesignSystem();
  const result = await postcss([toghenPlugin({ system }), postcssMixins()])
    .process(await read('styles/app.css'), { from: 'styles/app.css', to: out });
  await writeFile(out, result.css);
};

await stylesheet('dist/app.css');
await stylesheet('dist/app.warm.css', JSON.parse(await read('tokens/warm.overrides.json')));
```

A bundler does the same with two entry points, each with its own PostCSS configuration and its own system.

What changes is the values. The warm file has another `surface.accent`, `#e6661a` for `#1a66e6`. Its custom property moves in the defaults and in the light theme. So does every token that refers to it, such as `--button-primary-background-color`, and so does every fallback that reads one of those tokens in a mixin. What does not change is the shape: every rule, every mixin, every selector and every property name is the same in both stylesheets. A component written against one theme works against the other. The dark theme still applies on top, from its own file, which the map leaves alone. The library's guide explains [the map](https://codeberg.org/Toghen/lib/src/branch/main/guide.md#theme-a-system-with-a-map).

## Move a stylesheet off the old directives

The plugin does not read the forms in this table. Each one stays in the output as it was written, and the message in the last column says what to write instead. The flag in the last row is not read, so it gives no message. This table is the only place these forms appear in this guide.

| Old form | New form | Message it now gets |
|---|---|---|
| `:toghen(theme=dark)` in a selector | `@apply --when-theme-dark { … }` with `@toghen mixins;`, see [Make a component differ in one context](#make-a-component-differ-in-one-context) | `Cannot use ".a:toghen(theme=dark)": the :toghen() and :t() selectors are retired: write the rule for a context with @apply --when-<modifier>-<context> { … } (with @toghen mixins), or select the context's own spelling. The rule is left as written.` |
| `:t(theme=dark)` in a selector | the same | `Cannot use ".a:t(theme=dark)": the :toghen() and :t() selectors are retired: write the rule for a context with @apply --when-<modifier>-<context> { … } (with @toghen mixins), or select the context's own spelling. The rule is left as written.` |
| `@toghen base button;` | the full path, `t(button.color)` | `Cannot use "@toghen base button": it is retired: write the path in full; the collection segment is optional when the system has one collection.` |
| `t(.button.color)`, a relative path after a base | the full path, `t(button.color)` | `Cannot resolve token ".button.color": Token '.button.color' not found in collection 'ds' for mode 'light/regular'.` |
| `@toghen mode theme=dark;` | `t(path, theme=dark)` on each read that needs one value | `Cannot use "@toghen mode theme=dark": it is retired: read a value in a context with t(path, mode); t(path) lets the cascade choose.` |
| `@toghen states via ':has(> input{state})';` | your own selector, with `@apply` of the part's mixin, see [Style a part that lives on a child](#style-a-part-that-lives-on-a-child) | `Cannot use "@toghen states via ':has(> input{state})'": it is retired: a part is nested in the mixin of its group, placed by the spelling of its vocabulary; place a wrapper's state in your own selector and @apply the part's mixin.` |
| `@toghen layer;` | nothing: a part sits in the rule of its group, in that rule's layer | `Cannot use "@toghen layer": it is retired: a part is nested in the rule that applies its group, in that rule's layer; there is no state layer.` |
| `@toghen layer states;` | nothing: the same | `Cannot use "@toghen layer states": it is retired: a part is nested in the rule that applies its group, in that rule's layer; there is no state layer.` |
| `@toghen ds.button;` in a rule | `@apply --button;` | `Cannot use "@toghen ds.button": it is retired: use @apply --button; with @toghen mixins.` |
| `@t text.default, theme=dark;` in a rule | `t(text.default, theme=dark)` for one value | `Cannot use "@t text.default, theme=dark": it is retired: use t(text.default, theme=dark) in a declaration.` |
| `t(surface.raised as var)` | `t(surface.raised)`, which already writes the `var()` | `Cannot read "surface.raised": "as var" is retired or unknown: t(path) already writes var(--name, literal); there is no form to ask for it.` |
| `t(button as longhands)` | `@apply --button;`, or the declarations written with `t()` | `Cannot read "button": "as longhands" is retired or unknown: write the declarations yourself with t(), or apply the group with @apply and @toghen mixins; the composites and typography options say how declare and contexts write a composite.` |
| `t(button as shorthand)` | the same | `Cannot read "button": "as shorthand" is retired or unknown: write the declarations yourself with t(), or apply the group with @apply and @toghen mixins; the composites and typography options say how declare and contexts write a composite.` |
| `t(surface.raised as rem)` | `t(surface.raised as value)`, the only form | `Cannot read "surface.raised": "as rem" is retired or unknown: the only form is value.` |
| `t(surface.raised as)` | `t(surface.raised as value)` | `Cannot read "surface.raised": as takes a form: the only form is value.` |
| `@toghen contexts ds as value;` | `@toghen contexts ds;`, with no form | `Cannot read "ds": contexts, mixins and declare take no form; the composites option says how a composite is declared.` |
| `@toghen declare ds.space as value;` | `@toghen declare ds.space;`, with no form | `Cannot read "ds.space": contexts, mixins and declare take no form; the composites option says how a composite is declared.` |
| `@layer tokens { @toghen mixins; }` | `@toghen mixins;` at the top, outside every layer | `Cannot write the mixins of "ds" inside a layer: a mixin has no cascade position of its own, and the mixins polyfill ignores one in a layer. Put @toghen mixins at the top of the stylesheet, outside any rule or layer.` |
| `.a { @toghen mixins; }` | the same | `Cannot write the mixins of "ds" inside a rule: a mixin is defined at the top of a stylesheet, and a rule cannot hold a definition. Put @toghen mixins at the top of the stylesheet, outside any rule or layer.` |
| `@toghen mixins ds.button;` | `@toghen mixins;`, which takes no argument when there is one token collection | `Cannot write the mixins of "ds.button": the argument is a collection, and may be left out when the system has one.` |
| The option `tokenLayer` | nothing: `t(path)` writes a `var()` in every layer | `The option "tokenLayer" is retired and ignored: nothing replaces it. t(path) writes var(--name, literal) everywhere, in any layer.` |
| The option `stateLayer` | nothing: a part sits in its group's rule and layer | `The option "stateLayer" is retired and ignored: nothing replaces it. A part is nested in the rule that applies its component, in that rule's layer.` |
| `"inherits": false` on an element-state modifier | a state in the vocabulary, see [Add a part to a component](#add-a-part-to-a-component) | No message: the flag is not read |

## Fail the build on a missing token

A token that cannot be resolved is reported, and its `t()` stays in the output. A browser ignores that text. With `onUnresolved: 'throw'` the build stops instead, and CI should use it:

```javascript
toghenPlugin({ system, onUnresolved: 'throw' })
```

With the default, `warn`, the build prints this message:

```text
Cannot resolve token "ds.nothing.color": Token 'nothing.color' not found in collection 'ds' for mode 'light/regular'.
```

## Troubleshoot

- **Every `@apply` stays in the output.** The polyfill is listed before Toghen. List Toghen first.
- **An `@apply` stays in the output, and no message says why.** The polyfill leaves an `@apply` of a name it does not know, and writes no warning. Check the name against the mixins that `@toghen mixins;` writes, since a group whose keys are not all CSS properties gets none.
- **The build stops over a mixin name.** Two paths give one name, as `fact.strip` and `fact-strip` both give `--fact-strip`: `"fact.strip" and "fact-strip" are both written as the mixin --fact-strip. Rename one of them, or give propertyName an injective rule.` The polyfill would drop both definitions, so this is always an error. Rename one.
- **The mixins are missing.** The directive sits in a layer, where it is refused with this message: `Cannot write the mixins of "ds" inside a layer: a mixin has no cascade position of its own, and the mixins polyfill ignores one in a layer. Put @toghen mixins at the top of the stylesheet, outside any rule or layer.`
- **An `@apply` does nothing.** `@apply` expands only in a style rule. Move it into the rule whose declarations you want.
- **A part's rule is missing.** The subgroup's key is not a vocabulary value at that group, so it is a child group with its own mixin. Check the spelling, and that the axis is in the vocabulary at the group or above it.
- **A group's mixins are missing, over two values of one axis.** `Cannot write the mixins of "button": Path 'button.hover.pressed.backgroundColor' nests two parts of axis 'state': 'hover' and 'pressed'. Give the group "com.toghen": { "css": { "parts": false } }, or rename a key.` One path holds one value of each axis, so split the path. If the group is no component, see [Keep a lookup table out of the parts](#keep-a-lookup-table-out-of-the-parts). The other groups are written.
- **A value is not the one you wrote.** Two tokens write one custom property, as `button.pad-x` and `button.pad.x` both write `--button-pad-x`. The plugin reports it, the later declaration wins, and you rename one of them.
- **A token is not written.** A path has a typo: `Cannot resolve token "ds.button.colour": Token 'button.colour' not found in collection 'ds' for mode 'light/regular'.`
- **The build says a collection is not found.** The system has two token collections, so a path needs its collection name: `Cannot resolve token "text.default": Collection 'text' not found.`
- **The build warns about a token that changes under two modifiers.** Use `bind: 'chain'`, or `references: 'var'` and the declarations you need. See [Make a token follow two modifiers](#make-a-token-follow-two-modifiers) for the message and the two fixes in context.
- **The linter flags an at-rule.** If the linter does not know `@toghen`, `@mixin`, `@apply`, `@contents`, `@custom-media` or `@custom-selector`, add them to its list of at-rules that it ignores.
- **The plugin does not run at all.** `postcss` is a peer dependency. Check that the configuration exports the plugin in the module format your build tool loads.

## See also

- [The component model](https://codeberg.org/Toghen/lib/src/branch/main/model.md): the words, and how a modifier and a part reach the CSS and Figma.
- [The tutorial](./tutorial.md): the running example, built step by step.
- [The reference](./reference.md): every option, function, at-rule and message.
- [The specs](./specs.md): why the output has this shape.
- [The measurements](./measurements/RESULTS.md): the browser checks.
