# Build a button with worlds and parts

You build one button from the running example, and see the CSS at each step. Terms such as modifier and part are defined in the [component model](https://codeberg.org/Toghen/lib/src/branch/main/model.md).

The output blocks are golden files from [test/example-output](./test/example-output/), where the test writes them. Each one is a whole file, copied as it is. The test tidies the whitespace of the expanded CSS, so the spacing in those files is not the spacing your build writes. The input blocks come from the example's files.

## 1. Load the start document

Copy the files of [the running example](https://codeberg.org/Toghen/lib/src/branch/main/example/) into `tokens/`. The tutorial starts from [tutorial/start.resolver.json](https://codeberg.org/Toghen/lib/src/branch/main/example/tutorial/start.resolver.json): a button with no parts, and a vocabulary with no axes. Load it as the example test does.

```js
// tokens/system.js
import { readFile } from 'node:fs/promises';
import { load, Resolver } from '@toghen/lib';

const { document } = await load('tokens/tutorial/start.resolver.json', {
  read: (path) => readFile(path, 'utf8'),
});
export const system = new Resolver(document).resolveContextsToDesignSystem();
```

## 2. Set up the build

Toghen writes the mixins that the polyfill expands, so Toghen comes first. `@csstools/postcss-mixins` is your dependency, not the plugin's: the plugin does not depend on it, so you list it yourself.

```sh
pnpm add -D @toghen/postcss @toghen/lib @csstools/postcss-mixins postcss
```

```js
// postcss.config.js
import toghenPlugin from '@toghen/postcss';
import postcssMixins from '@csstools/postcss-mixins';
import { system } from './tokens/system.js';

export default {
  plugins: [toghenPlugin({ system }), postcssMixins()]
};
```

Build `styles/app.css` into `dist/app.css`. The output keeps native CSS nesting, which current browsers read.

```sh
postcss styles/app.css -o dist/app.css
```

## 3. Declare the modifiers

Put `@toghen contexts` in a layer of your own, in `styles/app.css`.

```css
@layer tokens {
    @toghen contexts;
}
```

Toghen writes one block per context. The `dark` block changes the surfaces and text, and the `compact` block changes the spacing.

```css
@layer tokens {
    @layer defaults, theme, density;
    @layer defaults {
        :root {
            --surface-raised: #ffffff;
            --surface-accent: #1a66e6;
            --surface-selected: #e0ebfc;
            --text-default: #1a1a1a;
            --text-on-accent: #ffffff;
            --text-muted: #666666;
            --space-sm: 8px;
            --radius-md: 6px;
            --type-label-font-family: Inter, "Helvetica Neue", sans-serif;
            --type-label-font-size: 0.875rem;
            --type-label-font-weight: 500;
            --type-label-line-height: 1.25;
            --button-background-color: #ffffff;
            --button-color: #1a1a1a;
            --button-padding-block: 8px;
            --button-border-radius: 6px;
            --button-font-font-family: Inter, "Helvetica Neue", sans-serif;
            --button-font-font-size: 0.875rem;
            --button-font-font-weight: 500;
            --button-font-line-height: 1.25;
            --button-icon-color: #666666
        }
    }
    @layer theme {
        [data-theme='light'] {
            --surface-raised: #ffffff;
            --surface-accent: #1a66e6;
            --surface-selected: #e0ebfc;
            --text-default: #1a1a1a;
            --text-muted: #666666;
            --button-background-color: #ffffff;
            --button-color: #1a1a1a;
            --button-icon-color: #666666
        }
        [data-theme='dark'] {
            --surface-raised: #2b2b2b;
            --surface-accent: #5c9bff;
            --surface-selected: #26364d;
            --text-default: #f2f2f2;
            --text-muted: #a6a6a6;
            --button-background-color: #2b2b2b;
            --button-color: #f2f2f2;
            --button-icon-color: #a6a6a6
        }
    }
    @layer density {
        [data-density='regular'] {
            --space-sm: 8px;
            --button-padding-block: 8px
        }
        [data-density='compact'] {
            --space-sm: 4px;
            --button-padding-block: 4px
        }
    }
}
```

## 4. Write the mixins

Put `@toghen mixins;` at the top of the stylesheet, outside any layer. A mixin has no place in the cascade, and the polyfill ignores one inside a layer.

```css
@toghen mixins;
```

Toghen writes one `@mixin` per group, named after the group's path. The `@contents` line in a group's mixin is where a block given to `@apply` lands, between the group's declarations and its parts; the [guide](./guide.md#place-a-declaration-between-the-rest-and-the-parts) shows it.

```css
@mixin --type-label {
    font-family: var(--type-label-font-family, Inter, "Helvetica Neue", sans-serif);
    font-size: var(--type-label-font-size, 0.875rem);
    font-weight: var(--type-label-font-weight, 500);
    line-height: var(--type-label-line-height, 1.25)
}
@mixin --button {
    background-color: var(--button-background-color, #ffffff);
    color: var(--button-color, #1a1a1a);
    padding-block: var(--button-padding-block, 8px);
    border-radius: var(--button-border-radius, 6px);
    font-family: var(--button-font-font-family, Inter, "Helvetica Neue", sans-serif);
    font-size: var(--button-font-font-size, 0.875rem);
    font-weight: var(--button-font-font-weight, 500);
    line-height: var(--button-font-line-height, 1.25);
    @contents
}
@mixin --button-font {
    font-family: var(--button-font-font-family, Inter, "Helvetica Neue", sans-serif);
    font-size: var(--button-font-font-size, 0.875rem);
    font-weight: var(--button-font-font-weight, 500);
    line-height: var(--button-font-line-height, 1.25)
}
@mixin --button-icon {
    color: var(--button-icon-color, #666666);
    @contents
}
@mixin --when-theme-light {
    &:where([data-theme='light'], [data-theme='light'] *) {
        @contents
    }
}
@mixin --when-theme-dark {
    &:where([data-theme='dark'], [data-theme='dark'] *) {
        @contents
    }
}
@mixin --when-density-regular {
    &:where([data-density='regular'], [data-density='regular'] *) {
        @contents
    }
}
@mixin --when-density-compact {
    &:where([data-density='compact'], [data-density='compact'] *) {
        @contents
    }
}
```

## 5. Style the button

Apply the mixins in the rules of the button and its icon, in `styles/app.css` below the other two directives.

```css
.button {
    display: inline-flex;
    @apply --button;
}

.button-icon {
    @apply --button-icon;
}
```

The polyfill replaces each `@apply` with the mixin's declarations. The start button has no parts, so its rule reads only the rest tokens.

```css
.button {
    display: inline-flex;
    background-color: var(--button-background-color, #ffffff);
    color: var(--button-color, #1a1a1a);
    padding-block: var(--button-padding-block, 8px);
    border-radius: var(--button-border-radius, 6px);
    font-family: var(--button-font-font-family, Inter, "Helvetica Neue", sans-serif);
    font-size: var(--button-font-font-size, 0.875rem);
    font-weight: var(--button-font-font-weight, 500);
    line-height: var(--button-font-line-height, 1.25)
}
```

Toghen also writes the icon rule, `.button-icon`, which is the same in every later step.

## 6. Put part of the page in the dark theme

Copy [tutorial.html](./test/example-output/tutorial.html) into `dist/`, beside `app.css`. Its second section sets `data-theme='dark'`, so every button inside it follows the dark theme. The buttons with `data-variant`, `aria-pressed` or `disabled` look plain until step 8, because the start button has no parts.

```html
<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <title>Buttons</title>
    <link rel="stylesheet" href="app.css">
</head>
<body>
    <button class="button"><span class="button-icon">★</span> Save</button>
    <button class="button" data-variant="primary">Save</button>
    <button class="button" aria-pressed="true">Save</button>
    <button class="button" disabled>Save</button>

    <section data-theme="dark">
        <button class="button"><span class="button-icon">★</span> Save</button>
        <button class="button" data-variant="primary">Save</button>
        <button class="button" aria-pressed="true">Save</button>
        <button class="button" disabled>Save</button>
    </section>
</body>
</html>
```

Open the page in a browser. In the dark section the button's background changes from `#ffffff` to `#2b2b2b`, and its text from `#1a1a1a` to `#f2f2f2`.

## 7. Add the hover part

Replace the content of `vocabulary.start.tokens.json` with the vocabulary below. It has one axis, `state`, with one value, `hover`, and the spelling `:hover` says when the part applies.

```json
{
  "$extensions": {
    "com.toghen": {
      "css": {
        "parts": {
          "state": {
            "hover": ":hover"
          }
        }
      }
    }
  }
}
```

Add the `hover` group below to `button.start.tokens.json`, beside `icon`. It holds the one token the part changes.

```json
{
  "hover": {
    "backgroundColor": {
      "$type": "color",
      "$value": "{surface.selected}"
    }
  }
}
```

The button gains one hover rule. It does not change `--button-background-color`, the property the theme declares. It sets a local property, `--_button-background-color`, which the background reads first. The button resets the local property to `initial`, which in a custom property means no value, so the background falls back to the theme's property until the button is hovered. A button nested inside a hovered one starts from its own rest.

```css
.button {
    display: inline-flex;
    --_button-background-color: initial;
    background-color: var(--_button-background-color, var(--button-background-color, #ffffff));
    color: var(--button-color, #1a1a1a);
    padding-block: var(--button-padding-block, 8px);
    border-radius: var(--button-border-radius, 6px);
    font-family: var(--button-font-font-family, Inter, "Helvetica Neue", sans-serif);
    font-size: var(--button-font-font-size, 0.875rem);
    font-weight: var(--button-font-font-weight, 500);
    line-height: var(--button-font-line-height, 1.25);
    &:where(:hover) {
        --_button-background-color: var(--button-hover-background-color, #e0ebfc)
    }
}
```

Toghen writes the icon rule as before. Hover a button in each section. The hover background is `#e0ebfc` in the light section and `#26364d` in the dark one, because the dark theme redefines `surface.selected`.

## 8. Add the other parts

In `tokens/system.js`, change the path to `tokens/ds.resolver.json`, the full example. It has `primary`, `pressed`, `disabled` and `selected`, with their vocabulary, and the button now has every part. The rules with one part come first, in the vocabulary's order. The rule for `selected` with `hover`, which has two parts, comes last, so it wins over the plain hover rule.

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

## 9. Theme the button without touching the base

You copied [warm.overrides.json](https://codeberg.org/Toghen/lib/src/branch/main/example/warm.overrides.json) into `tokens/` in step 1. It is a map: wherever a document refers to `roles.tokens.json`, `load()` reads `roles.warm.tokens.json` instead. The warm file has another accent.

```json
{
  "roles.tokens.json": "roles.warm.tokens.json"
}
```

In `tokens/system.js`, read the map and pass it to `load()` as `overrides`. Nothing else changes: not the document, not the token files, not `styles/app.css`.

```js
// tokens/system.js
import { readFile } from 'node:fs/promises';
import { load, Resolver } from '@toghen/lib';

const read = (path) => readFile(path, 'utf8');
const overrides = JSON.parse(await read('tokens/warm.overrides.json'));
const { document } = await load('tokens/ds.resolver.json', { read, overrides });
export const system = new Resolver(document).resolveContextsToDesignSystem();
```

Build again. The accent moves from `#1a66e6` to `#e6661a`. So do the three tokens that refer to it: `--button-primary-background-color`, `--button-selected-hover-background-color` and `--field-focus-outline-color`. This is the defaults block of the `tokens` layer. The `light` block moves the same four properties. The `dark` block does not move, because the dark accent, `#5c9bff`, comes from the dark theme's own file.

```css
@layer defaults {
    :root {
        --surface-raised: #ffffff;
        --surface-accent: #e6661a;
        --surface-selected: #e0ebfc;
        --text-default: #1a1a1a;
        --text-on-accent: #ffffff;
        --text-muted: #666666;
        --space-sm: 8px;
        --radius-md: 6px;
        --type-label-font-family: Inter, "Helvetica Neue", sans-serif;
        --type-label-font-size: 0.875rem;
        --type-label-font-weight: 500;
        --type-label-line-height: 1.25;
        --button-background-color: #ffffff;
        --button-color: #1a1a1a;
        --button-padding-block: 8px;
        --button-border-radius: 6px;
        --button-font-font-family: Inter, "Helvetica Neue", sans-serif;
        --button-font-font-size: 0.875rem;
        --button-font-font-weight: 500;
        --button-font-line-height: 1.25;
        --button-icon-color: #666666;
        --button-primary-background-color: #e6661a;
        --button-primary-color: #ffffff;
        --button-hover-background-color: #e0ebfc;
        --button-pressed-background-color: #e0ebfc;
        --button-pressed-color: #666666;
        --button-disabled-color: #666666;
        --button-selected-background-color: #e0ebfc;
        --button-selected-hover-background-color: #e6661a;
        --field-background-color: #ffffff;
        --field-color: #1a1a1a;
        --field-padding-block: 8px;
        --field-border-radius: 6px;
        --field-focus-outline-color: #e6661a;
        --field-disabled-opacity: 0.5
    }
}
```

The button rule keeps every selector and every property of step 8. Only two fallbacks move, in the primary part and in the selected part's hover, both from `#1a66e6` to `#e6661a`.

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
        --_button-background-color: var(--button-primary-background-color, #e6661a);
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
            --_button-background-color: var(--button-selected-hover-background-color, #e6661a)
        }
    }
}
```

Open the page again. The primary button in the light section is now orange. In the dark section it keeps the dark accent. To ship both themes, build once with the map and once without; the [guide](./guide.md#theme-a-system-with-a-map) shows how.

## Next steps

The [sync drill](https://codeberg.org/Toghen/figma/src/branch/main/guide.md#from-the-repository-to-figma) sends the same tokens to a Figma file. The [postcss guide](./guide.md) covers the other directives and the build options.
