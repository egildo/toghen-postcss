# @toghen/postcss

The CSS adapter for [Toghen](https://codeberg.org/Toghen). At build time it turns a stylesheet's token reads into values, and its token document into layers, custom properties and mixins.

It reads four things in a stylesheet:

| Directive | What it writes |
|---|---|
| `t()` (the long form, `toghen()`, is the same) | A token's value in a rule, as a `var()` with the value as fallback |
| `@toghen contexts` | The custom properties of every context, one block per context, in a layer |
| `@toghen mixins` | One mixin per component, with its parts, for `@apply` |
| `@toghen declare` | The custom properties of one group |

Three of them in one stylesheet:

```css
@layer tokens {
    @toghen contexts;
}

@toghen mixins;

.button {
    display: inline-flex;
    @apply --button;
}
```

## Install

```sh
pnpm add -D @toghen/postcss @toghen/lib @csstools/postcss-mixins postcss
```

`@toghen/lib` is a peer: the plugin uses your copy. To use a commit not yet released, install both from the repository by git URL with pnpm; see [installing from the repository](https://codeberg.org/Toghen/lib/src/branch/main/guide.md#from-the-repository).

`@csstools/postcss-mixins` is your dependency, not the plugin's: the plugin does not depend on it, and you run it after the plugin.

## Use

```js
// postcss.config.js
import toghenPlugin from '@toghen/postcss';
import postcssMixins from '@csstools/postcss-mixins';
import { system } from './tokens/system.js';

export default {
  plugins: [toghenPlugin({ system }), postcssMixins()]
};
```

The plugin reads a design system from `@toghen/lib`. Building one from a resolver document is shown in the tutorial.

## Documentation

- **[tutorial.md](https://codeberg.org/Toghen/postcss/src/branch/main/tutorial.md)**: build a button with worlds and parts, one step at a time
- **[guide.md](https://codeberg.org/Toghen/postcss/src/branch/main/guide.md)**: setup, the directives as tasks, build integration
- **[reference.md](https://codeberg.org/Toghen/postcss/src/branch/main/reference.md)**: options, directive syntax, messages
- **[model.md](https://codeberg.org/Toghen/lib/src/branch/main/model.md)**: modifiers, components, parts and the glossary

## License

MIT. See [LICENSE](https://codeberg.org/Toghen/postcss/src/branch/main/LICENSE).
