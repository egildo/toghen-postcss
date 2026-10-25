import type { AtRule, ChildProps, Declaration, Node, Plugin, Result } from 'postcss';
import {
  type DesignSystem,
  PathNotFoundError,
  CollectionNotFoundError,
  InvalidTokenError,
  ResolverValidationError,
  getContextSelector,
  cssPropertyName,
  cssIdentifier,
  normalizeColorToSRGB01,
  fontFamilyNames,
  referencesIn,
  literalText,
  referencePath,
  cssLinkName,
  type Collection,
  type ModeModifier,
  type Step,
  type TokenContexts,
  type TokenReference,
} from '@toghen/lib';
import { createRequire } from 'node:module';

/**
 * MDN's machine-readable CSS data (`mdn-data`, CC0). It says which names are CSS properties, and each
 * shorthand's longhands (`computed`, a list for a shorthand and a keyword for the rest). Read as JSON
 * through `require`, which works the same from the built package and from the sources.
 */
const properties: Record<string, { computed?: string | string[] }> = createRequire(import.meta.url)('mdn-data/css/properties.json');

/** Whether a name is a CSS property (or a custom property, which any `--name` is). */
function isProperty(name: string): boolean {
  return name.startsWith('--') || Object.hasOwn(properties, name);
}

/** The longhands of a shorthand property, or none. */
function longhandsOf(name: string): string[] {
  const computed = Object.hasOwn(properties, name) ? properties[name].computed : undefined;
  return Array.isArray(computed) ? computed : [];
}

/**
 * The longhand that member `member` of a composite at `key` is written at. `key-member` when mdn-data lists
 * it among the key's longhands (`border` and `width` → `border-width`; `borderTop` → `border-top-width`);
 * otherwise a typography member at its own spelling (`fontSize` → `font-size`), wherever the typography
 * token sits; one that is no property mdn-data knows is reported where it is written. Anything else has none: a member's own spelling is a property
 * often enough (`color`, `width`) that taking it for any composite would write the wrong one.
 */
function longhandOf(key: string, type: string | undefined, member: string): string | undefined {
  const property = cssIdentifier(key);
  const own = cssIdentifier(member);
  if (longhandsOf(property).includes(`${property}-${own}`)) return `${property}-${own}`;
  return type === 'typography' ? own : undefined;
}

/**
 * Serialises a resolved token value into a CSS-ready string.
 *
 * `DesignSystem.resolveValue()` returns the token's raw `$value` (with references
 * expanded) — for primitive scalars that is already a CSS-usable string/number, but
 * for the W3C structured shapes it is a plain object. Without this step those objects
 * stringify to `"[object Object]"`. CSS formatting is environment-specific, so it
 * lives here in the adapter rather than in the format-agnostic core.
 *
 * Handled shapes:
 *   - `string` / `number`                  → passed through verbatim
 *   - structured color `{ colorSpace, components, alpha? }` → `#rrggbb` (or `#rrggbbaa`), or its own CSS function outside sRGB
 *   - dimension `{ value, unit }`           → `"16px"`, `"0.5rem"`, …
 *   - shadow `{ color, offsetX, offsetY, blur, spread?, inset? }` → `box-shadow` syntax
 *   - border `{ color, width, style }`     → `1px solid #000000`
 *   - transition `{ duration, delay?, timingFunction }` → `200ms cubic-bezier(…) 0ms`
 *   - arrays (e.g. `fontFamily` lists, multiple shadows) → comma-joined
 *
 * A `cubicBezier` is an array too, and is told apart by its type, not here:
 * the plugin spells it `cubic-bezier(…)` before this is reached.
 *
 * And one shape it refuses: **anything else**.
 *
 * This function used to end in `return String(value)`, which turned every
 * composite type the core supports and this adapter does not — `shadow` until
 * now, `gradient` and `typography` still — into the literal text
 * `[object Object]`, in a stylesheet, silently. That is the same defect the
 * structured-colour serialisation had before this file existed, and a fallback
 * that produces plausible-looking CSS is how it survived being noticed.
 *
 * An unserialisable value now throws {@link UnserializableValueError}, which the
 * plugin reports through `onUnresolved` and leaves the original `toghen(…)` call
 * in place — visible, greppable, and caught by any build step already checking
 * that no directive shipped unresolved. A stylesheet that says it could not
 * write a value is strictly better than one that writes something false.
 */
export function valueToCss(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);

  if (Array.isArray(value)) {
    return value.map((item) => valueToCss(item)).join(', ');
  }

  if (value !== null && typeof value === 'object') {
    const obj = value as Record<string, unknown>;

    // Dimension: { value: number, unit: string } → "16px"
    if (typeof obj.value === 'number' && typeof obj.unit === 'string') {
      return `${obj.value}${obj.unit}`;
    }

    // Color: W3C structured { colorSpace, components, alpha? } → hex, or its own function outside sRGB
    if ('colorSpace' in obj && 'components' in obj) {
      return colorToCss(value as ColorValue);
    }

    // Shadow: { color, offsetX, offsetY, blur, spread?, inset? } → CSS box-shadow.
    // The four required members are the ones the core's own validator demands.
    if ('color' in obj && 'offsetX' in obj && 'offsetY' in obj && 'blur' in obj) {
      return shadowToCss(obj);
    }

    // Border: { color, width, style } → `1px solid #000`, the `border` shorthand's order.
    // An object `style` (dashArray, lineCap) has no CSS spelling and is refused below.
    if ('color' in obj && 'width' in obj && 'style' in obj) {
      return `${valueToCss(obj.width)} ${valueToCss(obj.style)} ${valueToCss(obj.color)}`;
    }

    // Transition: { duration, delay, timingFunction } → `200ms cubic-bezier(…) 0ms`.
    if ('duration' in obj && 'timingFunction' in obj) {
      const delay = obj.delay === undefined ? '' : ` ${valueToCss(obj.delay)}`;
      return `${valueToCss(obj.duration)} ${cubicBezierToCss(obj.timingFunction)}${delay}`;
    }
  }

  throw new UnserializableValueError(value);
}

/**
 * Thrown when a resolved value has no CSS spelling this adapter knows.
 *
 * Carries the shape rather than only the type name, because the useful question
 * when this appears is «what did the token document actually contain».
 */
export class UnserializableValueError extends Error {
  readonly value: unknown;

  constructor(value: unknown) {
    const shape =
      value !== null && typeof value === 'object' && !Array.isArray(value)
        ? `{ ${Object.keys(value as object).join(', ')} }`
        : String(value);
    super(
      `No CSS serialisation for a value of shape ${shape}. ` +
        `Composite types the core resolves but this adapter cannot yet write are ` +
        `\`gradient\` (the DTCG value carries stops but no direction) and ` +
        `\`typography\` (a block of several CSS properties, not one value: ` +
        `write its members instead, \`toghen(path.fontSize)\`, \`toghen(path.lineHeight)\` and so on, ` +
        `or set \`typography: 'font'\`), and a \`strokeStyle\` object (\`dashArray\`, \`lineCap\`: CSS has no dash pattern). ` +
        `See toghen-postcss/specs.md §Composite types.`,
    );
    this.name = 'UnserializableValueError';
    this.value = value;
  }
}

/**
 * `{ color, offsetX, offsetY, blur, spread?, inset? }` → `0 4px 12px 0 #0000004d`.
 *
 * Order is CSS's, not the object's: `inset` first when present, then the
 * offsets, blur and spread, then the colour last. `spread` is optional in DTCG
 * and omitted here when absent rather than written as `0` — a shorthand with
 * three lengths and one with four mean the same thing, and writing the shorter
 * one keeps the output closer to what the author typed.
 *
 * Several shadows are an array, which the caller already comma-joins — the same
 * branch that joins a `fontFamily` list, and the same separator `box-shadow`
 * wants.
 */
function shadowToCss(shadow: Record<string, unknown>): string {
  const parts: string[] = [];
  if (shadow.inset === true) parts.push('inset');
  parts.push(valueToCss(shadow.offsetX), valueToCss(shadow.offsetY), valueToCss(shadow.blur));
  if (shadow.spread !== undefined) parts.push(valueToCss(shadow.spread));
  parts.push(valueToCss(shadow.color));
  return parts.join(' ');
}

/**
 * A cubicBezier value, `[x1, y1, x2, y2]`, → `cubic-bezier(x1, y1, x2, y2)`. Its
 * spelling is chosen by type: as an array it is indistinguishable from a list,
 * which is comma-joined. A member kept as `var()` stays one inside it, and a
 * string is a whole reference, already a `var()`.
 */
function cubicBezierToCss(value: unknown): string {
  return Array.isArray(value) ? `cubic-bezier(${value.map((n) => valueToCss(n)).join(', ')})` : valueToCss(value);
}

/**
 * The type of a composite's member, where its spelling depends on it and its
 * shape cannot say: a transition's `timingFunction` is a cubicBezier.
 */
const MEMBER_TYPES: Record<string, Record<string, string>> = {
  transition: { timingFunction: 'cubicBezier' },
  typography: { fontFamily: 'fontFamily' },
};

/**
 * A typography value → the `font` shorthand: `italic 400 1rem/1.5 Inter, sans-serif`.
 *
 * Only the members the shorthand carries, in its order. The core requires
 * `fontWeight`, `fontSize`, `lineHeight` and `fontFamily`, so only `fontStyle`
 * is ever absent. A string is a reference to another text style, kept as its
 * `var()`.
 */
function fontShorthand(value: unknown): string {
  if (typeof value === 'string') return value;
  const v = value as Record<string, unknown>;
  const style = v.fontStyle === undefined ? [] : [valueToCss(v.fontStyle)];
  return [...style, valueToCss(v.fontWeight), `${valueToCss(v.fontSize)}/${valueToCss(v.lineHeight)}`, fontFamilyList(v.fontFamily)].join(
    ' ',
  );
}

/** The generic families, which are keywords and stay bare. */
const GENERIC_FAMILIES = new Set([
  'serif',
  'sans-serif',
  'monospace',
  'cursive',
  'fantasy',
  'system-ui',
  'ui-serif',
  'ui-sans-serif',
  'ui-monospace',
  'ui-rounded',
  'math',
  'emoji',
  'fangsong',
]);

/** Keywords that would mean something else if a family were named by them bare. */
const RESERVED_FAMILY_NAMES = new Set(['inherit', 'initial', 'unset', 'revert', 'revert-layer', 'default']);

/** A single CSS identifier: no space, no leading digit, no punctuation (non-ASCII letters allowed). */
const CSS_IDENTIFIER = /^-?(?:[_a-zA-Z]|[^\x00-\x7f])(?:[\w-]|[^\x00-\x7f])*$/;

/**
 * One family name as CSS. Bare: a `var()`, a generic family, and a single
 * identifier that is no reserved keyword. Everything else is quoted (a name with a
 * space, a digit first, punctuation, a keyword as a whole), with a double quote
 * inside it escaped. Every place that spells a family goes through here.
 */
function familyName(name: string): string {
  const lower = name.toLowerCase();
  if (name.startsWith('var(') || GENERIC_FAMILIES.has(lower)) return name;
  if (CSS_IDENTIFIER.test(name) && !RESERVED_FAMILY_NAMES.has(lower)) return name;
  return `"${name.replace(/"/g, '\\"')}"`;
}

/** A font-family value as a comma-joined list of {@link familyName}s; a whole `var()` is left alone. */
function fontFamilyList(family: unknown): string {
  if (typeof family === 'string' && family.startsWith('var(')) return family;
  const names = typeof family === 'string' || Array.isArray(family) ? fontFamilyNames(family) : [family];
  return names.map((name) => familyName(String(name))).join(', ');
}

/** The typography members the `font` shorthand carries. The rest are declared beside it. */
const FONT_MEMBERS = new Set(['fontStyle', 'fontWeight', 'fontSize', 'lineHeight', 'fontFamily']);

type ColorValue = Exclude<Parameters<typeof normalizeColorToSRGB01>[0], string>;

/**
 * A structured colour as CSS (ruling 4b of 24 October 2026): hex when it carries a `hex` or lies in sRGB,
 * with the alpha byte when alpha < 1 and exactly black at alpha 0 as `transparent`; otherwise its own CSS
 * function, so a wide-gamut colour is not clamped.
 */
function colorToCss(value: ColorValue): string {
  if (value.hex === undefined && !inSRGB(value)) return ownFunction(value);
  const { r, g, b, a } = normalizeColorToSRGB01(value);
  const channel = (n: number) =>
    Math.round(n * 255)
      .toString(16)
      .padStart(2, '0');
  const base = `#${channel(r)}${channel(g)}${channel(b)}`;
  if (a === 0 && base === '#000000') return 'transparent';
  return a < 1 ? `${base}${channel(a)}` : base;
}

/** CSS Color 4's functions named after their space; every other DTCG space is written `color(<space> …)`. */
const COLOR_FUNCTIONS = new Set(['lab', 'lch', 'oklab', 'oklch']);

/** A structured colour in its own space, in CSS Color 4 syntax. The DTCG space names are CSS's. */
function ownFunction(value: ColorValue, alpha = value.alpha ?? 1): string {
  const c = value.components.map(String);
  const space = value.colorSpace;
  // hsl and hwb store saturation, lightness, whiteness and blackness 0–100, as CSS writes them in %.
  const channels =
    space === 'hsl' || space === 'hwb' ? [c[0], ...c.slice(1).map((n) => (n === 'none' ? n : `${n}%`))].join(' ') : c.join(' ');
  const a = alpha < 1 ? ` / ${alpha}` : '';
  return COLOR_FUNCTIONS.has(space) || space === 'hsl' || space === 'hwb' ? `${space}(${channels}${a})` : `color(${space} ${channels}${a})`;
}

/**
 * Whether a colour lies in sRGB: each channel, unclamped, within half a step of 0–255, so clamping changes no hex digit.
 * `normalizeColorToSRGB01` clamps, so the channels are read through a mix the core computes: 1% of the colour
 * (opaque) into mid-grey, in `srgb`, lands well inside the gamut, and 100 · mix − 49.5 is the unclamped channel.
 * ponytail: the core exports no gamut check and postcss has no culori; if lib exports one, use it here.
 */
function inSRGB(value: ColorValue): boolean {
  const { r, g, b } = normalizeColorToSRGB01(`color-mix(in srgb, ${ownFunction(value, 1)} 1%, color(srgb 0.5 0.5 0.5))`);
  const step = 0.5 / 255;
  return [r, g, b].every((m) => {
    const n = 100 * m - 49.5;
    return n >= -step && n <= 1 + step;
  });
}

/**
 * Options for the Toghen PostCSS plugin.
 */
export interface ToghenPluginOptions {
  /**
   * A fully configured DesignSystem instance containing the token collections
   * to resolve against. The plugin does not load tokens — that is the caller's
   * responsibility, keeping the plugin free of any file-system concerns.
   */
  system: DesignSystem;

  /**
   * Default mode to use when none is specified in the `toghen()` call.
   * Defaults to the collection's default mode: every modifier at its declared default.
   */
  defaultMode?: string;

  /**
   * How to handle unresolvable token references:
   * - `'warn'`   — log a warning and leave the original `toghen(...)` call intact (default)
   * - `'throw'`  — throw an error and abort the PostCSS transform
   * - `'ignore'` — silently leave the original `toghen(...)` call intact
   */
  onUnresolved?: 'warn' | 'throw' | 'ignore';

  /**
   * How a reference in a token's value is written:
   * - `'resolve'` — followed to the end of its chain and written as a value (default)
   * - `'var'`     — written as `var(--<first-hop target>)`, so a layered stylesheet
   *                 keeps each tier pointing at the tier directly below it
   */
  references?: 'resolve' | 'var';

  /**
   * The custom-property name for a token's lookup path. Used for every `var()`
   * that `references: 'var'` writes and for every property `@toghen declare`
   * declares, so the two cannot disagree. Defaults to the core's
   * `cssPropertyName`, which the Figma adapter's code syntax uses too; a
   * custom function gives that agreement up.
   */
  propertyName?: (lookupPath: string) => string;

  /**
   * How a `typography` token is written:
   * - `'block'` — refused as a value; `@toghen mixins` writes a mixin of one longhand per member (default)
   * - `'font'`  — written as the `font` shorthand of the members it can carry.
   *               `@toghen declare` writes that as `--<name>` and each remaining
   *               member as `--<name>-<property>`, so nothing is lost
   */
  typography?: 'block' | 'font';

  /**
   * How a composite (a border, a transition) is declared and read:
   * - `'longhands'` — `@toghen declare` and `@toghen contexts` write the composite's own
   *                   property and one per member that has a longhand (`--card-border-width`) (default)
   * - `'shorthand'` — the composite's own property alone. A longhand read then writes
   *                   the literal, since no property exists to read. Typography follows `typography`.
   */
  composites?: 'longhands' | 'shorthand';

  /**
   * The selector `@toghen contexts` writes the defaults under, and the one a
   * context's block uses when its spelling is an at-rule alone. Defaults to `:root`.
   */
  rootSelector?: string;

  /**
   * Whether `@toghen declare` and `@toghen contexts` write descriptions:
   * - `'none'`    — no comments (default)
   * - `'comment'` — a group's `$description` above its first declaration, a
   *                 token's directly above its own, and a modifier's above its
   *                 first context block. A context block carries only the
   *                 descriptions that differ from the defaults'
   */
  descriptions?: 'none' | 'comment';

  /**
   * Where each token is defined: the `origins` map `load()` of `@toghen/lib` returns (a collection-relative token
   * path to the files that define it). When given, `@toghen mixins` warns once about a group whose mixin
   * holds tokens defined in more than one file (the token's file is the first of its origins). Always a
   * warning, whatever `onUnresolved` says. The plugin reads no file itself; without it nothing is checked.
   */
  origins?: Map<string, string[]>;

  /**
   * Whether `@toghen contexts` registers the custom properties of typed tokens with an `@property` rule,
   * for the types that have one syntax (color, a px dimension, duration, number). Off by default: a registered
   * property has an initial value, so it never takes the fallback of a `var()` and `--x: initial` gives
   * the initial value, not the guaranteed-invalid value `bind: 'chain'` relies on. Even on, the link and flag
   * properties of a chain are not registered, only a token's own property.
   */
  registerProperties?: boolean;

  /**
   * How `@toghen contexts` writes a token that falls through across modifiers.
   * `'chain'` writes one link property per link and a head that composes them,
   * so modifiers set on different elements combine as the resolver's would.
   * It reads the resolver from `collection.resolver`. Unset by default.
   */
  bind?: 'chain';
}

/**
 * Matches `toghen(path)` or `toghen(path, mode)`, and their short form `t(…)`, anywhere
 * inside a declaration value. The name is matched whole: `t(` counts only where a CSS
 * function name can start, never after a letter, a digit, `-` or `_`, so `inset(`,
 * `rect(`, `repeat(` and `format(` are left alone. `toghen(` follows the same boundary.
 *
 * Capture groups:
 *   1 — token path, with `as value` after it if there is one (e.g. `colors.primary.blue as value`)
 *   2 — mode        (e.g. `dark`, optional)
 */
const TOGHEN_RE = /(?<![\w-])(?:toghen|t)\(\s*([^,)]+?)(?:\s*,\s*([^)]+?))?\s*\)/g;
const MIXINS_DIRECTIVE = /^(?:mixins|spellings)(?:\s|$)/;
const RETIRED_SELECTOR = /:(?:toghen|t)\(/;
const HAS_CALL = /(?<![\w-])(?:toghen|t)\(/;

/**
 * A PostCSS plugin that writes a design system as standard CSS.
 *
 * It receives a pre-built {@link DesignSystem} and touches no file. Four things in a stylesheet are its input:
 *
 * - `toghen(path)` (short `t(path)`) in a declaration value: `var(--name, literal)`, the custom property with the
 *   token's value as fallback; `t(path as value)` and `t(path, mode)` write the literal.
 * - `@toghen contexts [ds];` — the custom properties of every token under the defaults and under each context
 *   (with an `@property` for the types that have a syntax), in the author's `@layer` if there is one.
 * - `@toghen mixins [ds];` — at the top level, the CSS Mixins level 1 definitions a component applies:
 *   `@mixin` per group, per part and per typography token, and `--when-<modifier>-<context>` per context.
 * - `@toghen declare path;` inside a rule — the custom properties of a group, for a scope of your own.
 *
 * @example
 * ```css
 * @toghen mixins;
 * @layer tokens { @toghen contexts; }
 * .button { @apply --button; color: t(color.ink); }
 * ```
 *
 * @example
 * ```js
 * // postcss.config.js
 * import toghenPlugin from '@toghen/postcss';
 * import { system } from './tokens/system.js';
 *
 * export default {
 *   plugins: [toghenPlugin({ system }), mixinsPolyfill()]
 * };
 * ```
 */
export default function toghenPlugin(options: ToghenPluginOptions): Plugin {
  if (!options?.system) {
    throw new Error(
      '@toghen/postcss needs its options: it has no design system to read. Pass { system } at least, e.g. toghenPlugin({ system }); listed bare in a PostCSS config it cannot run.',
    );
  }
  const {
    system,
    defaultMode,
    onUnresolved = 'warn',
    references = 'resolve',
    propertyName = cssPropertyName,
    typography = 'block',
    composites = 'longhands',
    rootSelector = ':root',
    registerProperties = false,
    descriptions = 'none',
    origins,
    bind,
  } = options;

  /** For each stylesheet, the order statement already written in each layer, by the layer's full name. */
  const orders = new WeakMap<Node, Map<string, string>>();
  /** What each directive has reported, by message: a context block asks again for every context. */
  const reported = new WeakMap<Node, Set<string>>();
  /** The custom properties a part re-points, by the lookup of the token at rest (see {@link repointed}). */
  let repoints: Map<string, { twin: string; component: string }> | undefined;

  return {
    postcssPlugin: '@toghen/postcss',

    /**
     * The options that retired are said once per stylesheet; they change nothing. Then `@toghen mixins;`, written here and
     * not by a visitor: PostCSS runs every plugin's `Once` before any plugin's node visitors, so the mixins exist when a
     * polyfill listed after this plugin reads the stylesheet in its own `Once`.
     */
    Once(root, { result }) {
      const given = options as unknown as Record<string, unknown>;
      if (given.tokenLayer !== undefined) {
        report(
          root,
          result,
          '[@toghen/postcss] The option "tokenLayer" is retired and ignored: nothing replaces it. t(path) writes var(--name, literal) everywhere, in any layer.',
        );
      }
      if (given.stateLayer !== undefined) {
        report(
          root,
          result,
          '[@toghen/postcss] The option "stateLayer" is retired and ignored: nothing replaces it. A part is nested in the rule that applies its component, in that rule\'s layer.',
        );
      }
      root.walkAtRules(/^(?:toghen|t)$/, (atRule) => {
        if (MIXINS_DIRECTIVE.test(atRule.params.trim())) atRuleDirective(atRule, { result });
      });
    },

    /** A `:toghen(…)` or `:t(…)` selector is not the plugin's any more. */
    Rule(rule, { result }) {
      if (!RETIRED_SELECTOR.test(rule.selector)) return;
      report(
        rule,
        result,
        `[@toghen/postcss] Cannot use "${rule.selector}": the :toghen() and :t() selectors are retired: write the rule for a context with @apply --when-<modifier>-<context> { … } (with @toghen mixins), or select the context's own spelling. The rule is left as written.`,
      );
    },

    /**
     * Walk every CSS declaration. If the value contains at least one `toghen()`
     * call, replace each match with what it reads.
     *
     * `result` is taken from the visitor's second argument and NOT from
     * `decl.root().toResult()`. The two look interchangeable and are not:
     * `toResult()` on a root that is mid-walk re-enters PostCSS's own lazy
     * processing, which waits for the walk that is calling it. The build does
     * not fail — it **hangs**, with no output and no timeout, forever.
     *
     * That was the behaviour of `onUnresolved: 'warn'`, which is the DEFAULT,
     * for as long as this plugin has existed. It was never noticed because no
     * test ever passed `'warn'` as a value: the string appears in the test file
     * only inside the helper's type. Every consumer that took the default and
     * mistyped one token path got a build that stopped and never said why.
     */
    Declaration(decl, { result }) {
      if (!HAS_CALL.test(decl.value)) return;
      decl.value = directives(decl.value, decl, result);
    },

    /** `@toghen …;` and its alias `@t …;`: one handler. */
    AtRule: {
      toghen: visited,
      t: visited,
    },
  };

  /** `mixins` and `spellings` were handled in `Once`; one left in the tree was refused there, and has been said. */
  function visited(atRule: AtRule, helpers: { result: Result }): void {
    if (!MIXINS_DIRECTIVE.test(atRule.params.trim())) atRuleDirective(atRule, helpers);
  }

  function atRuleDirective(atRule: AtRule, { result }: { result: Result }): void {
    const params = atRule.params.trim();
    const members = composites === 'longhands';
    const contexting = /^(?:contexts|mixins|spellings)(?:\s|$)/.test(params);
    if (contexting) {
      const word = params.startsWith('mixins') ? 'mixins' : params.startsWith('spellings') ? 'spellings' : 'contexts';
      const writing = word === 'mixins' ? mixins : word === 'spellings' ? spellings : undefined;
      let path = params.replace(/^(?:contexts|mixins|spellings)\s*/, '');
      let outcome: ReturnType<typeof contexts>;
      try {
        path = inCollection(noForm(path));
        outcome = writing ? writing(atRule, result, path) : contexts(atRule, result, path, members);
      } catch (err) {
        if ((err as Error)?.name === 'CssSyntaxError') throw err;
        outcome = failure(path, undefined, err, word);
      }
      if (typeof outcome === 'string') report(atRule, result, outcome);
      else atRule.replaceWith(...outcome);
      return;
    }
    if (!/^declare\s+/.test(params)) {
      report(atRule, result, retired(atRule, params));
      return;
    }

    const [declaring, from] = params
      .replace(/^declare\s+/, '')
      .split(/\s+from\s+/, 2)
      .map((s) => s.trim());
    const [written, rawMode] = declaring.split(',', 2).map((s) => s.trim());
    const mode = rawMode || defaultMode;

    let path = written;
    let outcome: ChildProps[] | string | undefined;
    try {
      path = inCollection(noForm(written));
      outcome = declare(atRule, result, path, rawMode, from, members);
    } catch (err) {
      // A declaration that `declare` wrote has already been reported, and thrown on 'throw'.
      if ((err as Error)?.name === 'CssSyntaxError') throw err;
      outcome = failure(path, mode, err);
    }

    if (typeof outcome === 'string') report(atRule, result, outcome);
    else if (outcome.length === 0) atRule.remove();
    else atRule.replaceWith(...outcome);
  }

  /** A path with no form after it: `contexts`, `mixins` and `declare` take none. */
  function noForm(written: string): string {
    const { path, form } = splitForm(written);
    if (form)
      throw new BaseError(
        `Cannot read "${path}": contexts, mixins and declare take no form; the composites option says how a composite is declared.`,
      );
    return path;
  }

  /** The sentence for a `@toghen` directive that retired, or is none: it names what replaces it. */
  function retired(atRule: AtRule, params: string): string {
    const name = `@${atRule.name} ${params}`;
    const word = /^(\w+)(?:\s|$)/.exec(params)?.[1];
    const instead =
      word === 'base'
        ? 'write the path in full; the collection segment is optional when the system has one collection'
        : word === 'mode'
          ? 'read a value in a context with t(path, mode); t(path) lets the cascade choose'
          : word === 'states'
            ? "a part is nested in the mixin of its group, placed by the spelling of its vocabulary; place a wrapper's state in your own selector and @apply the part's mixin"
            : word === 'layer'
              ? "a part is nested in the rule that applies its group, in that rule's layer; there is no state layer"
              : (() => {
                  // `@toghen ds.button;` and `@toghen ds.button, mode;`: the group directive. A group or a typography token is
                  // replaced by its mixin; a token that is neither has no mixin, and is read with t().
                  const [written, ...mode] = params.split(',').map((part) => part.trim());
                  let mixin = '--name';
                  try {
                    const path = inCollection(splitForm(written).path);
                    mixin = propertyName(path);
                    const token = system.resolveToken(path, defaultMode);
                    if (token && token.$type !== 'typography') return `use t(${[written, ...mode].join(', ')}) in a declaration`;
                  } catch {
                    /* the sentence stays general */
                  }
                  return `use @apply ${mixin}; with @toghen mixins`;
                })();
    return `[@toghen/postcss] Cannot use "${name}": it is retired: ${instead}.`;
  }

  /**
   * Replaces every `toghen(path[, mode])` in a declaration value. A call that
   * fails goes through `onUnresolved` and, on 'warn' and 'ignore', stays as it
   * was.
   */
  function directives(value: string, node: Node, result: Result): string {
    return value.replace(TOGHEN_RE, (original, written: string, rawMode?: string) => {
      let path = written.trim();
      const given = rawMode?.trim();
      const mode = given ?? defaultMode;

      let shown = path;
      try {
        const split = splitForm(path);
        path = inCollection(split.path);
        // A leading dot is reported as written, not as `ds..x`.
        shown = split.path.startsWith('.') ? split.path : path;
        return read(node, path, given, split.form);
      } catch (err) {
        report(node, result, failure(shown, mode, err));
        return original;
      }
    });
  }

  /**
   * What `toghen(path[, mode])` writes at a node: the property read, with the default as its fallback, unless the
   * call asks for the value (`as value`, or a mode of its own). Throws; the caller reports.
   */
  function read(node: Node, path: string, rawMode: string | undefined, form?: 'value', entry?: Entry): string {
    collectionOf(path);
    const mode = rawMode ?? defaultMode;
    // Resolved first, so a bad path fails with the core's message either way.
    system.resolveValue(path, mode);
    const literal = write(path, mode, false);
    // The value, as asked: the property holds the value of the context it is read in, which a mode of the call is not.
    if (form === 'value' || rawMode !== undefined) return literal;
    // An entry says which property it reads (a member's), or that it has none; a plain read of a declared member reads that member's.
    const property = entry && entry.own !== undefined ? entry.own : (propertyOf(path, mode) ?? null);
    // A declaration of the very property it would read (`--a: t(a)`) is not given a `var()` of itself: that is a cycle.
    if (property && (node as Declaration).prop !== property) {
      // The fallback is the token's value as `references` writes it: under 'var', the reference as a var() of its first hop.
      const plain = `var(${property}, ${write(path, defaultMode)})`;
      // A token a part re-points is read through the local property the part sets, and falls through to its own.
      return repointed().has(property) ? `var(${local(property)}, ${plain})` : plain;
    }
    return references === 'var' ? write(path, mode, true) : literal;
  }

  /**
   * The custom properties some part re-points: the twin at rest of every part token, by the lookup it is the twin of, and the
   * component that resets it. A part token's component is the group directly above the first part in its path; when parts of
   * several components re-point one token, the outermost of them. Built once, from every collection in its default mode.
   * A path that cannot be split into parts (lib throws) has none.
   */
  function repointed(): Map<string, { twin: string; component: string }> {
    if (!repoints) {
      repoints = new Map();
      for (const name of system.getCollectionNames()) {
        const collection = system.getCollection(name)!;
        const mode = collection.getDefaultMode();
        for (const path of collection.getAllPaths(mode)) {
          try {
            const { rest, restExists, component: at } = collection.partsOf(path, mode);
            if (at === null || !restExists) continue;
            const component = `${name}.${at}`;
            for (const [, to, twin] of twinsOf(`${name}.${path}`, `${name}.${rest}`, mode)) {
              const known = repoints.get(to);
              if (!known || component.split('.').length < known.component.split('.').length) repoints.set(to, { twin, component });
            }
          } catch {
            // a group lib cannot split is reported where it is written
          }
        }
      }
    }
    return repoints;
  }

  /**
   * What a part token re-points at rest, as [the token's lookup, the twin's custom property, the twin's lookup]: the twin of
   * the token itself, then the twin of each member a typography token declares. The caller has asked the core that the rest is there.
   */
  function twinsOf(lookup: string, twinLookup: string, mode: string | undefined): [string, string, string][] {
    const out: [string, string, string][] = [];
    const own = propertyOf(lookup, mode);
    const twinOwn = propertyOf(twinLookup, mode);
    if (own && twinOwn) out.push([lookup, twinOwn, twinLookup]);
    if (system.resolveToken(lookup, mode)?.$type === 'typography') {
      const twinMembers = declaredMembers(twinLookup, mode);
      for (const member of declaredMembers(lookup, mode).filter((m) => twinMembers.includes(m))) {
        out.push([`${lookup}.${member}`, propertyName(`${twinLookup}.${member}`), `${twinLookup}.${member}`]);
      }
    }
    return out;
  }

  /** The custom property `@toghen declare` gives a path, or `undefined`: a whole token, or a member of a composite that has a longhand. */
  function propertyOf(path: string, mode: string | undefined): string | undefined {
    if (declarable(path, mode)) return propertyName(path);
    const { owner, rest } = ownerOf(path);
    return rest.length === 1 && declaredMembers(owner, mode).includes(rest[0]) ? propertyName(path) : undefined;
  }

  /** The value `@toghen declare` and `@toghen contexts` write for a path in a mode of their own. */
  function declared(node: Node, result: Result, path: string, mode: string): string {
    try {
      const literal = write(path, mode, false);
      return references === 'var' ? write(path, mode, true) : literal;
    } catch (err) {
      report(node, result, failure(path, mode, err));
      return `toghen(${path}, ${mode})`;
    }
  }

  /** The CSS for the value at a lookup path, a token or a member of one. */
  function write(path: string, mode: string | undefined, kept = references === 'var'): string {
    // Always resolved first: a missing path, a cycle or a dangling reference
    // fails here with the core's message, in either setting.
    const resolved = system.resolveValue(path, mode);
    return spellAs(typeAt(path, mode), kept ? withVars(path, mode) : resolved);
  }

  /** Whether `@toghen declare` gives this path a property of its own: a whole token, a typography one only as the `font` shorthand. */
  function declarable(path: string, mode: string | undefined): boolean {
    const type = system.resolveToken(path, mode)?.$type;
    return type !== undefined && (!BLOCK_TYPES.has(type) || typography === 'font');
  }

  /**
   * A value's CSS, where the type decides what the shape cannot: a cubicBezier
   * is a function, and under `typography: 'font'` a typography token is the
   * `font` shorthand.
   */
  function spell(path: string, mode: string | undefined, value: unknown): string {
    return spellAs(typeAt(path, mode), value);
  }

  function spellAs(type: string | undefined, value: unknown, font = typography === 'font'): string {
    if (type === 'cubicBezier') return cubicBezierToCss(value);
    if (type === 'fontFamily') return fontFamilyList(value);
    if (type === 'typography' && font) return fontShorthand(value);
    return valueToCss(value);
  }

  /** The type at a lookup path: a token's, or a member's where `MEMBER_TYPES` knows it. */
  function typeAt(path: string, mode: string | undefined): string | undefined {
    const token = system.resolveToken(path, mode);
    if (token) return token.$type;
    const { owner, rest } = ownerOf(path);
    return rest.length === 1 ? MEMBER_TYPES[system.resolveToken(owner, mode)?.$type ?? '']?.[rest[0]] : undefined;
  }

  /**
   * The value at a lookup path with its references kept, each written as
   * `var(--<first hop>)`. The resolved value supplies the shape, and
   * `referencesOf` says which members were written as references. This is the
   * same overlay the Figma adapter makes for aliases and bindings.
   *
   * A path that walks through a reference continues in its target: in
   * `ds.button.shadow.0.color`, where `button.shadow` is `{elevation.raised}`,
   * the member lives in `elevation.raised`, and that is where its reference
   * is read.
   */
  function withVars(path: string, mode: string | undefined): unknown {
    const { owner, rest } = ownerOf(path);
    const refs = system.referencesOf(owner, mode);

    for (let k = 0; k < rest.length; k++) {
      const at = rest.slice(0, k).join('.');
      const through = refs.find((r) => r.at === at && !r.interpolated);
      if (through) return withVars([through.to, ...rest.slice(k)].join('.'), mode);
    }

    let value: any = overlay(owner, mode, refs);
    for (const key of rest) value = value?.[key];
    return value;
  }

  /** A token's resolved value with each reference in it written as a `var()`. */
  function overlay(owner: string, mode: string | undefined, refs: TokenReference[]): unknown {
    let value: unknown = structuredClone(system.resolveToken(owner, mode)!.$value);

    for (const ref of refs.filter((r) => !r.interpolated)) {
      value = setAt(value, ref.at, `var(${propertyName(ref.to)})`);
    }

    // An interpolated reference is part of a string, so it is rewritten in
    // the string as authored: `0 2px {color.shade}` → `0 2px var(--color-shade)`.
    const interpolated = refs.filter((r) => r.interpolated);
    if (interpolated.length > 0) {
      const raw = rawValue(owner, mode);
      for (const at of new Set(interpolated.map((r) => r.at))) {
        let text = getAt(raw, at) as string;
        for (const ref of interpolated.filter((r) => r.at === at)) {
          text = text.split(ref.written).join(`var(${propertyName(ref.to)})`);
        }
        // An authored doubled brace is the literal brace, as resolution writes it.
        value = setAt(value, at, literalText(text));
      }
    }
    return value;
  }

  /** The token's `$value` as authored, in the mode asked for. */
  function rawValue(owner: string, mode: string | undefined): unknown {
    const [name, ...tokenPath] = owner.split('.');
    const collection = system.getCollection(name)!;
    return collection.getToken(tokenPath.join('.'), mode ?? collection.getDefaultMode())!.$value;
  }

  /** Splits a lookup path into the token that owns it and the member path inside that token. */
  function ownerOf(path: string): { owner: string; rest: string[] } {
    const segments = path.split('.');
    const collection = system.getCollection(segments[0])!;
    const i = segments.findIndex((_, k) => k > 0 && collection.getNodeKind(segments.slice(1, k + 1).join('.')) === 'token');
    // Unreachable after resolveValue succeeded; kept so a change there fails loudly.
    if (i < 0) throw new PathNotFoundError(`No token owns "${path}".`);
    return { owner: segments.slice(0, i + 1).join('.'), rest: segments.slice(i + 1) };
  }

  /**
   * `@toghen declare path[, mode][ from base];` — one custom property per
   * token under a group (or one token), named by `propertyName` and written as
   * `toghen()` would write it.
   *
   * Named with a mode other than its base, it writes only the tokens whose
   * resolved value differs from the base's. The base is the context the rule
   * sits inside: the default mode unless `from` names another. CSS substitutes a `var()` where
   * the custom property is declared, not where it is used, so a context scoped
   * to a subtree must re-declare what depends on a changed token too, and its
   * written `var()` does not change. Comparing resolved values finds exactly
   * that set. See specs.md §Declaring a context.
   */
  function declare(
    atRule: Node,
    result: Result,
    path: string,
    rawMode: string | undefined,
    from: string | undefined,
    members: boolean,
  ): ChildProps[] | string {
    const where = ruleOf(
      atRule,
      `Cannot declare "${path}" here: custom properties are declarations, and declarations need a rule to live in. Put @toghen declare inside a rule.`,
    );
    if (where) return where;

    const collection = collectionOf(path);
    // Either spelling of a mode, its name or `modifier=context`, is one mode.
    // A mistyped base throws here: it would fail every comparison and quietly write every token.
    const mode = collection.modeNamed(rawMode ?? defaultMode ?? collection.getDefaultMode());
    const base = collection.modeNamed(from ?? defaultMode ?? collection.getDefaultMode());
    // With no `from` and the default mode, this is the root declaration: everything.
    const onlyChanged = from !== undefined || mode !== base;

    const written = declarations(atRule, result, path, mode, onlyChanged ? base : undefined, undefined, undefined, undefined, members);
    collisions(atRule, result, written);
    return written.length === 0 && !someToken(path, mode)
      ? `[@toghen/postcss] Cannot declare "${path}"${rawMode ? ` (mode: ${rawMode})` : ''}: it names no token.`
      : commented(written, path, mode, onlyChanged ? base : undefined);
  }

  /**
   * Reports two token paths that give one property name within one directive's
   * output. A name is not injective (`button.pad-x` and `button.pad.x` are both
   * `--button-pad-x`), and the later declaration wins in the sheet without a
   * word. Both are still written; a context block repeating a name for the same
   * path is the point of a block, and is not a collision.
   */
  function collisions(atRule: Node, result: Result, written: Written[]): void {
    const holders = new Map<string, string[]>();
    for (const { prop, who, chained } of written) {
      if (chained || who === undefined) continue;
      const held = holders.get(prop) ?? [];
      if (!held.includes(who)) holders.set(prop, [...held, who]);
    }
    for (const [prop, who] of holders) {
      if (who.length > 1) {
        report(
          atRule,
          result,
          `[@toghen/postcss] ${who.map((w) => `"${w}"`).join(' and ')} are both written as ${prop}, and the later declaration wins. Rename one of them, or give propertyName an injective rule.`,
        );
      }
    }
  }

  /**
   * A path as the core reads it: with exactly one collection, a path may leave out its collection (the core's
   * one-collection shorthand). A path the core cannot place is kept as written, for the error that names it.
   */
  function inCollection(path: string): string {
    try {
      return system.lookupPath(path);
    } catch {
      return path;
    }
  }

  /** The collection a lookup path starts with. */
  function collectionOf(path: string) {
    const name = path.split('.')[0];
    const collection = system.getCollection(name);
    if (!collection) throw new CollectionNotFoundError(`Collection '${name}' not found.`);
    return collection;
  }

  /** The token paths under a lookup path (a collection, a group or one token), lookup paths themselves. */
  function tokensUnder(path: string, mode: string): string[] {
    const collection = collectionOf(path);
    return collection.getAllPaths(mode, referencePath(path)).map((p) => `${collection.name}.${p}`);
  }

  function someToken(path: string, mode: string): boolean {
    return tokensUnder(path, mode).length > 0;
  }

  /**
   * The custom properties for the tokens under `path` in `mode`: all of them,
   * or, given a `base`, those whose resolved value differs from the base's.
   */
  function declarations(
    atRule: Node,
    result: Result,
    path: string,
    mode: string,
    base: string | undefined,
    only?: (lookup: string) => boolean,
    chained?: (lookup: string) => Written[] | undefined,
    lookups = tokensUnder(path, mode),
    members = true,
  ): Written[] {
    const present = new Set(tokensUnder(path, mode));
    const onlyChanged = base !== undefined;
    // A token's own property is the more specific statement: it wins over a composite's member property of the same name.
    const owned = new Map([...present].filter((lookup) => declarable(lookup, mode)).map((lookup) => [propertyName(lookup), lookup]));

    return lookups.flatMap((lookup): Written[] => {
      // A chained token is written by `chained`, wherever it is (`[]` writes nothing); a hole can leave it out of this mode.
      const chain = chained?.(lookup);
      if (!chain && !present.has(lookup)) return [];
      const token = present.has(lookup) ? system.resolveToken(lookup, mode) : undefined;
      // The token's own property, unless it is a block: that is several properties and has no custom-property form
      // (its mixin writes the members), except as the `font` shorthand. Then the members that have a property of their own.
      const tuples: [string, string, string?][] = [];
      if (!chain && token && (!BLOCK_TYPES.has(token.$type ?? '') || typography === 'font'))
        tuples.push([propertyName(lookup), lookup, lookup]);
      // A typography token's members are the properties the shorthand cannot carry, so they are written beside it.
      if (token && (members || token.$type === 'typography'))
        tuples.push(...memberProperties(lookup, mode).map((m): [string, string] => [propertyName(`${lookup}.${m}`), `${lookup}.${m}`]));
      return [
        ...(chain ?? []),
        ...tuples
          .filter(([prop, member, own]) => {
            const holder = own === undefined ? owned.get(prop) : undefined;
            if (own === undefined && token?.$type === 'typography' && !isProperty(cssIdentifier(member.slice(lookup.length + 1)))) {
              reportOnce(
                atRule,
                result,
                `[@toghen/postcss] "${member}" is written as "${cssIdentifier(member.slice(lookup.length + 1))}", which is not a CSS property mdn-data knows. It is written anyway: the data may lag CSS.`,
              );
            }
            if (holder !== undefined) {
              reportOnce(
                atRule,
                result,
                `[@toghen/postcss] "${lookup}" declares its member "${member.slice(lookup.length + 1)}" as ${prop}, which is also the property of the token "${holder}". The token wins; the member property is not written.`,
              );
            }
            return holder === undefined;
          })
          .filter(([, member]) => (!onlyChanged || !sameIn(member, mode, base!)) && (!only || only(member)))
          .map(([prop, member, token]) => ({
            prop,
            value: declared(atRule, result, member, mode),
            token,
            who: member,
          })),
      ];
    });
  }

  /**
   * The members of a token that get a custom property of their own, beside its. A composite's members that have
   * a longhand (`--card-border-width`); under `typography: 'block'` those of a typography token; under
   * `'font'` the ones the `font` shorthand cannot carry. A shadow's have none: there is no longhand to read them.
   * What reads go by: under `composites: 'shorthand'` a composite's have none, whatever a directive's form wrote.
   */
  function declaredMembers(lookup: string, mode: string | undefined): string[] {
    return composites === 'shorthand' && system.resolveToken(lookup, mode)?.$type !== 'typography' ? [] : memberProperties(lookup, mode);
  }

  /** The members a directive may give a property of their own, whichever form it is written in. */
  function memberProperties(lookup: string, mode: string | undefined): string[] {
    const token = system.resolveToken(lookup, mode);
    if (!token) return [];
    if (token.$type === 'typography' && typography === 'font') {
      return Object.keys(token.$value).filter((m) => !FONT_MEMBERS.has(m) && token.$value[m] !== undefined);
    }
    return longhands(lookup, mode).map(({ member }) => member);
  }

  /** The members of a composite token that are written at a longhand, with the property each goes to. */
  function longhands(lookup: string, mode: string | undefined): { member: string; property: string }[] {
    const token = system.resolveToken(lookup, mode);
    const value = token?.$value;
    if (!token || value === null || typeof value !== 'object' || Array.isArray(value)) return [];
    const key = lookup.split('.').pop()!;
    return Object.keys(value).flatMap((member) => {
      const property = value[member] === undefined ? undefined : longhandOf(key, token.$type, member);
      return property ? [{ member, property }] : [];
    });
  }

  /**
   * The declarations as nodes, each preceded, under `descriptions: 'comment'`,
   * by the descriptions it is the first to need: those of the groups it is
   * the first declaration of, at or below `path`, outermost first, then its
   * token's. Given a `base`, only descriptions that differ from the base's.
   */
  function commented(written: Written[], path: string, mode: string, base: string | undefined): ChildProps[] {
    if (descriptions !== 'comment') return written.map(({ prop, value }) => ({ prop, value }));

    const collection = collectionOf(path);
    const scope = path.split('.').length - 1;
    const described = new Set<string>();
    const out: ChildProps[] = [];
    const say = (text: unknown, before: unknown) => {
      if (typeof text === 'string' && text !== '' && text !== before) out.push(comment(text));
    };

    for (const { prop, value, token, groupsOf = token } of written) {
      if (groupsOf) {
        const parts = groupsOf.split('.').slice(1);
        for (let i = Math.max(scope, 1); i < parts.length; i++) {
          const group = parts.slice(0, i).join('.');
          if (described.has(group)) continue;
          described.add(group);
          say(
            collection.getGroupAttribute(group, '$description', mode),
            base === undefined ? undefined : collection.getGroupAttribute(group, '$description', base),
          );
        }
      }
      if (token) {
        const tokenPath = token.split('.').slice(1).join('.');
        say(
          collection.getToken(tokenPath, mode)?.$description,
          base === undefined ? undefined : collection.getToken(tokenPath, base)?.$description,
        );
      }
      out.push({ prop, value });
    }
    return out;
  }

  /**
   * `@toghen contexts path;` — the defaults under the root selector, then one
   * block per context that is not a default, under the selector its modifier
   * gives it, holding the tokens that differ from the defaults. Blocks follow
   * resolution order, so where two apply the later wins, as in the resolver.
   * See specs.md §Writing every context.
   */
  function contexts(atRule: Node, result: Result, path: string, members: boolean): ChildProps[] | string {
    let parent = atRule.parent;
    while (parent && parent.type !== 'rule') parent = parent.parent;
    if (parent)
      return `[@toghen/postcss] Cannot write the contexts of "${path}" inside a rule: they are rules themselves. Put @toghen contexts at the top of the stylesheet.`;

    const collection = collectionOf(path);
    if (bind === 'chain' && !collection.resolver) {
      return `[@toghen/postcss] Cannot write chains for "${path}": collection '${collection.name}' was not built from a resolver document, so it cannot say which modifier a token falls through to. Build it with resolveContextsToDesignSystem(), or leave out bind: 'chain'.`;
    }
    // In the order modifiers win (lib's precedence order), so a later block or layer wins in the cascade as the
    // later modifier does in the resolver; none for a collection built by hand.
    const modifiers = collection.resolver?.getModifiers('precedence') ?? [];
    const defaults = collection.getDefaultMode();
    if (!someToken(path, defaults)) return `[@toghen/postcss] Cannot write the contexts of "${path}": it names no token.`;

    // Inside a named layer the blocks go in sublayers, in resolution order; anywhere else, flat.
    const layered = enclosingLayers(atRule).length > 0;
    if (layered && modifiers.some((m) => m.name === 'defaults')) {
      return `[@toghen/postcss] Cannot write the contexts of "${path}" in a layer: modifier 'defaults' collides with the layer of the defaults.`;
    }
    const sublayer = (name: string, nodes: ChildProps[]): ChildProps[] =>
      layered && nodes.length > 0 ? [{ name: 'layer', params: name, nodes, raws: { between: ' ' } }] : nodes;

    // CSS keeps a layer's first order statement, so a second that differs would be ignored without a word.
    // One that is the same changes nothing, and is written again, so each directive's output stands alone.
    const order = ['defaults', ...modifiers.map((m) => m.name)].join(', ');
    const layer = enclosingLayers(atRule).join('.');
    const root = raw(atRule.root());
    const layerOrders = orders.get(root) ?? new Map<string, string>();
    const before = layerOrders.get(layer);
    if (layered && before !== undefined && before !== order) {
      return `[@toghen/postcss] Cannot write the contexts of "${path}" in layer '${layer}': its order would be "${order}", and the layer already has "${before}". CSS keeps the first order statement of a layer. Put the collections in different layers, or give them the same modifiers in the same order.`;
    }
    const plan =
      bind === 'chain' && modifiers.length > 0
        ? chains(atRule, result, path, collection, modifiers, [
            defaults,
            ...modifiers.flatMap((m) => m.contexts.map((c) => collection.modeNamed(`${m.name}=${c}`))),
          ])
        : undefined;
    if (typeof plan === 'string') return plan;

    // The statement sets its own spacing: left to PostCSS it takes the neighbours', and `defaults, theme ;` results.
    const blocks: ChildProps[] = layered ? [{ name: 'layer', params: order, raws: { afterName: ' ', between: '' } }] : [];
    const inDefaults =
      plan && declarations(atRule, result, path, defaults, undefined, undefined, (lookup) => plan.write(lookup), plan.lookups, members);
    const flagged = plan?.flags() ?? [];
    const inRoot = inDefaults
      ? [...flagged, ...inDefaults]
      : declarations(atRule, result, path, defaults, undefined, undefined, undefined, undefined, members);
    const everything: Written[] = [...inRoot];
    blocks.push(...registrations(inRoot, defaults));
    blocks.push(
      ...sublayer('defaults', [{ selector: rootSelector, nodes: commented(inRoot, path, defaults, undefined), raws: { between: ' ' } }]),
    );
    const changedBy = new Map<string, string[]>();

    for (const modifier of modifiers) {
      // The tokens this modifier varies: not the same CSS in all its contexts, the others at their defaults.
      const modes = modifier.contexts.map((context) => collection.modeNamed(`${modifier.name}=${context}`));
      const compared = (lookup: string) => modes.some((m) => !sameIn(lookup, m, modes[0]));
      // With chains and `var()`, a token is in the blocks of every modifier it depends on, which the comparison can miss.
      const varied = (lookup: string) => {
        const depends = references === 'var' ? plan?.dependsOn(lookup) : undefined;
        return depends ? depends.includes(modifier.name) : compared(lookup);
      };
      let introduced = false;
      const own: ChildProps[] = [];
      // One spelling for two contexts: with the default, it names the other one, and the default
      // keeps no block (its values are the defaults'); between two non-defaults, it is a mistake.
      const spellingOf = (context: string) => {
        const s = getContextSelector(modifier, context);
        return s && `${s.selector ?? ''}\0${s.atRule ?? ''}`;
      };
      const others = modifier.contexts.filter((c) => c !== modifier.default);
      const clash = others.find((c, i) => spellingOf(c) && others.slice(0, i).some((o) => spellingOf(o) === spellingOf(c)));
      if (clash) {
        const first = others.find((o) => spellingOf(o) === spellingOf(clash))!;
        report(
          atRule,
          result,
          `[@toghen/postcss] Cannot write the contexts of modifier '${modifier.name}': contexts '${first}' and '${clash}' have the same CSS spelling, so neither block could be told from the other. Give each its own selector or at-rule.`,
        );
        continue;
      }
      for (const context of modifier.contexts) {
        if (context === modifier.default && spellingOf(context) && others.some((o) => spellingOf(o) === spellingOf(context))) continue;
        const spelling = getContextSelector(modifier, context);
        if (!spelling) {
          // A default with no spelling needs no block: the defaults hold its values.
          if (context !== modifier.default) {
            report(
              atRule,
              result,
              `[@toghen/postcss] Cannot write context '${context}' of modifier '${modifier.name}': the resolver document gives it no CSS selector. Add $extensions["com.toghen"].css to the modifier.`,
            );
          }
          continue;
        }
        const mode = collection.modeNamed(`${modifier.name}=${context}`);
        const written = declarations(
          atRule,
          result,
          path,
          mode,
          undefined,
          varied,
          plan && ((lookup) => plan.write(lookup, modifier.name, context)),
          plan?.lookups,
          members,
        );
        if (written.length === 0) continue;
        everything.push(...written);
        if (plan) written.unshift(...plan.flags(modifier.name, context));
        for (const { prop, token, chained } of written) {
          if (!chained && !(token && plan?.early.has(token)))
            changedBy.set(prop, [...new Set([...(changedBy.get(prop) ?? []), modifier.name])]);
        }

        if (!introduced && descriptions === 'comment' && modifier.description) own.push(comment(modifier.description));
        introduced = true;
        const rule = {
          selector: spelling.selector ?? rootSelector,
          nodes: commented(written, path, mode, defaults),
          raws: { between: ' ' },
        };
        const [, name, params = ''] = /^@(\S+)\s*(.*)$/.exec(spelling.atRule ?? '') ?? [];
        own.push(name ? { name, params, nodes: [rule] } : rule);
      }
      blocks.push(...sublayer(modifier.name, own));
    }

    // Resolved values are fixed per block: where two modifiers' blocks apply
    // at once, the later one's value wins whole. That is right only if the
    // token does not depend on both. With `var()`, the browser combines them.
    if (references === 'resolve') {
      for (const [prop, by] of changedBy) {
        if (by.length > 1) {
          atRule.warn(
            result,
            `[@toghen/postcss] ${prop} changes under ${by.map((m) => `'${m}'`).join(' and ')}. Written as resolved values, the later block wins where both apply, which is right only if its value does not depend on both. Use references: 'var', or declare the combination yourself.`,
          );
        }
      }
    }
    collisions(atRule, result, everything);
    if (layered) orders.set(root, layerOrders.set(layer, order));
    return blocks;
  }

  /**
   * With `registerProperties`, one `@property` per typed token among the defaults' declarations, where the type has one syntax; the
   * default's literal is its `initial-value`. A dimension only in px: rem and em are not computationally
   * independent, so an initial-value in them is invalid. Any other type has none.
   */
  function registrations(written: Written[], mode: string): ChildProps[] {
    if (!registerProperties) return [];
    const seen = new Set<string>();
    return written.flatMap(({ prop, token }): ChildProps[] => {
      if (!token || seen.has(prop)) return [];
      seen.add(prop);
      const type = system.resolveToken(token, mode)?.$type;
      // A chained token a hole leaves out of the defaults has no value to register.
      if (!type) return [];
      const literal = write(token, mode, false);
      const syntax =
        type === 'color'
          ? '<color>'
          : type === 'dimension' && /px$/.test(literal)
            ? '<length>'
            : type === 'duration'
              ? '<time>'
              : type === 'number'
                ? '<number>'
                : undefined;
      return syntax
        ? [
            {
              name: 'property',
              params: prop,
              raws: { between: ' ' },
              nodes: [
                { prop: 'syntax', value: `'${syntax}'` },
                { prop: 'inherits', value: 'true' },
                { prop: 'initial-value', value: literal },
              ],
            } as ChildProps,
          ]
        : [];
    });
  }

  /**
   * `@toghen mixins [collection];` — at the top level: one `@mixin` per group whose tokens one level down all
   * have a CSS property for a key (its own tokens, then a rule for every part below it, those with more parts after those
   * with fewer, then in the core's tie order), one per part (it re-points the twin of each of its tokens at rest, sets the
   * property of a token that has none, then writes the rules of the parts below it, in the same order), one per typography
   * token (its longhands), and one
   * `--when-<modifier>-<context>` per context with a spelling, wrapping `@contents`.
   * See specs.md §The component model, in standard CSS.
   */
  function mixins(atRule: AtRule, result: Result, path: string): ChildProps[] | string {
    for (let p: Node | undefined = atRule.parent; p; p = p.parent) {
      if (p.type === 'rule' || (p.type === 'atrule' && (p as AtRule).name === 'layer')) {
        return p.type === 'rule'
          ? `[@toghen/postcss] Cannot write the mixins of "${path}" inside a rule: a mixin is defined at the top of a stylesheet, and a rule cannot hold a definition. Put @toghen mixins at the top of the stylesheet, outside any rule or layer.`
          : `[@toghen/postcss] Cannot write the mixins of "${path}" inside a layer: a mixin has no cascade position of its own, and the mixins polyfill ignores one in a layer. Put @toghen mixins at the top of the stylesheet, outside any rule or layer.`;
      }
    }
    const collection = collectionOf(path);
    if (path !== collection.name)
      return `[@toghen/postcss] Cannot write the mixins of "${path}": the argument is a collection, and may be left out when the system has one.`;
    const mode = collection.getDefaultMode();
    // The reads below are made at a node of their own, so that nothing around the directive can matter to them.
    const reading = atRule.clone();
    const lookups = tokensUnder(path, mode);
    if (lookups.length === 0) return `[@toghen/postcss] Cannot write the mixins of "${path}": it names no token.`;
    const rel = (lookup: string) => lookup.slice(collection.name.length + 1);
    const full = (at: string) => `${collection.name}.${at}`;
    const relTokens = lookups.map(rel);
    const body = (entries: Entry[]): ChildProps[] | undefined => {
      try {
        return entries.map((e) => ({ prop: e.prop, value: read(reading, e.lookup, undefined, undefined, e) }));
      } catch {
        return undefined;
      }
    };

    // A group is a part when its key is a value of an axis in the vocabulary at its parent group (lib's `partAt`).
    const partAt = (g: string) => collection.partAt(g, mode) ?? undefined;
    // The part groups directly under a group, in precedence order (lib's `axesOf`): the order of the keys in the document carries none.
    const partChildren = (g: string) =>
      collection
        .axesOf(g, mode)
        .flatMap(({ values }) => values.map((value) => `${g}.${value}`))
        .filter((c) => collection.getNodeKind(c) === 'group' && partAt(c));
    // A part's spelling places a rule: as an at-rule around it, or as a selector inside `:where()` after `&`, so every
    // part rule weighs what the rule that applies the mixin weighs, and order alone decides between them. A spelling
    // with `&` keeps it inside, where it still stands for the enclosing selector; one without is the element's own state.
    const placed = (c: string, nodes: ChildProps[]): ChildProps => {
      const { spelling } = partAt(c)!;
      const [, name, params = ''] = /^@(\S+)\s*(.*)$/.exec(spelling) ?? [];
      if (spelling.startsWith('@')) return { name, params, nodes } as ChildProps;
      return { selector: `&:where(${spelling})`, nodes, raws: { between: ' ' } } as ChildProps;
    };
    // Every part group below a group, reached through parts alone, each as the chain of parts from the group down to it.
    const chainsBelow = (g: string, above: string[] = []): string[][] =>
      partChildren(g).flatMap((c) => [[...above, c], ...chainsBelow(c, [...above, c])]);
    // The group whose parts these are: a part's group with its parts removed.
    const componentOf = (g: string): string => (partAt(g) ? componentOf(g.slice(0, g.lastIndexOf('.'))) : g);
    // The part rules under a group, in the order the core's `applies()` ranks them: fewer parts first, then, walking the
    // axes from the last, the first where two differ: the one with a value there comes later, and of two values the one
    // declared later (both can match at once in a browser, as `:hover` with `:active`). Every part rule weighs the same
    // (see `placed`), so this order is the cascade's.
    const partRules = (g: string): ChildProps[] => {
      const axes = collection.axesOf(componentOf(g), mode);
      const rank = (chain: string[]) =>
        axes
          .map(({ axis, values }) => {
            const part = chain.map((c) => partAt(c)!).find((p) => p.axis === axis);
            return part ? values.indexOf(part.key) + 1 : 0;
          })
          .reverse();
      const later = (a: string[], b: string[]) => {
        if (a.length !== b.length) return a.length - b.length;
        const [ra, rb] = [rank(a), rank(b)];
        const i = ra.findIndex((r, j) => r !== rb[j]);
        return i < 0 ? 0 : ra[i] - rb[i];
      };
      return chainsBelow(g)
        .sort(later)
        .flatMap((chain) => {
          const own = ownOf(chain[chain.length - 1]);
          return own.length > 0 ? [chain.reduceRight<ChildProps[]>((nodes, c) => [placed(c, nodes)], own)[0]] : [];
        });
    };

    // What a token of a part writes: it re-points its twin at rest (the path with every part segment removed), or
    // where it has none and sits directly in the part, sets its own property. A token in a child group with no twin is that group's own.
    const pointed = (t: string, twin: string, twinExists: boolean, part: string): ChildProps[] => {
      const lookup = full(t);
      const out: ChildProps[] = [];
      try {
        if (twinExists) {
          for (const [member, to] of twinsOf(lookup, full(twin), mode)) {
            out.push({ prop: local(to), value: read(reading, member, undefined, undefined) });
          }
        } else if (t.slice(0, t.lastIndexOf('.')) === part) {
          const prop = cssIdentifier(t.slice(part.length + 1));
          if (isProperty(prop) && !unwritten(lookup, mode))
            out.push({ prop, value: read(reading, lookup, undefined, undefined, { prop, lookup }) });
        }
      } catch {
        // A token that cannot be written here is left out, as in a group.
      }
      return out;
    };

    // A mixin that holds tokens defined in more than one file is valid, and says so once.
    const mixed = (g: string) => {
      if (!origins) return;
      const byFile = new Map<string, string[]>();
      for (const t of relTokens.filter((t) => t.startsWith(`${g}.`) && !t.slice(g.length + 1).includes('.') && !unwritten(full(t), mode))) {
        const file = origins.get(t)?.[0];
        if (file !== undefined) byFile.set(file, [...(byFile.get(file) ?? []), t.slice(g.length + 1)]);
      }
      if (byFile.size < 2) return;
      const count = byFile.size === 2 ? 'two' : byFile.size === 3 ? 'three' : String(byFile.size);
      const files = [...byFile].map(([file, keys]) => `"${file}" defines ${keys.join(', ')}`).join(', ');
      atRule.warn(
        result,
        `[@toghen/postcss] The mixin "${propertyName(full(g))}" mixes tokens from ${count} files: ${files}. Rename one, or give component groups a namespace.`,
      );
    };

    // A group that is no part, whose tokens one level down all have a CSS property for a key: what it writes of its own.
    const ownMemo = new Map<string, ChildProps[] | undefined>();
    const own = (g: string): ChildProps[] | undefined => {
      if (!ownMemo.has(g)) {
        const entries = group(full(g), mode);
        const written = entries.length === 0 || !entries.every((e) => isProperty(e.prop)) ? undefined : body(entries);
        ownMemo.set(g, written && written.length > 0 ? written : undefined);
      }
      return ownMemo.get(g);
    };
    // A component starts every token its parts re-point again from its rest (`--_x: initial`), so an instance nested in a part
    // does not inherit the part. A component with no mixin of its own writes none.
    const resets = (g: string): ChildProps[] => {
      // In the order of the tokens at rest, a typography member at its token's place.
      const at = (twin: string) => {
        const k = relTokens.indexOf(rel(twin));
        return k >= 0 ? k : relTokens.findIndex((t) => rel(twin).startsWith(`${t}.`));
      };
      return [...repointed()]
        .filter(([, { component }]) => component === full(g))
        .sort(([, a], [, b]) => at(a.twin) - at(b.twin))
        .map(([to]) => ({ prop: local(to), value: 'initial' }));
    };

    // What a part writes of its own: its own tokens, not those of a part nested in it.
    const ownOf = (g: string): ChildProps[] => {
      const depth = collection.partsOf(g, mode).parts.length + 1;
      return relTokens
        .filter((t) => t.startsWith(`${g}.`))
        .flatMap((t) => {
          const { parts, rest, restExists } = collection.partsOf(t, mode);
          return parts.length === depth ? pointed(t, rest, restExists, g) : [];
        });
    };

    const memo = new Map<string, ChildProps[] | undefined>();
    const built = (g: string): ChildProps[] | undefined => {
      if (!memo.has(g)) {
        const mine: ChildProps[] = [];
        if (partAt(g)) {
          // A part applied by hand carries its own sub-parts, in the same order.
          mine.push(...ownOf(g), ...partRules(g));
        } else {
          // A group with no rest of its own (its rest comes from elsewhere) still writes its parts, when it has any.
          const written = own(g) ?? (group(full(g), mode).length === 0 ? [] : undefined);
          const parts = written ? partRules(g) : [];
          if (written && written.length + parts.length > 0) {
            // `@contents` marks where a block given to `@apply` lands: after the rest, before the parts.
            mine.push(...resets(g), ...written, { name: 'contents', params: '' } as ChildProps, ...parts);
            mixed(g);
          }
        }
        memo.set(g, mine.length > 0 ? mine : undefined);
      }
      return memo.get(g);
    };

    // Document order: a group at its first token, outermost first; a typography token at its own place.
    const wanted = new Set<string>();
    // Every mixin written, with the path it is named from: two paths can give one name. `top` is the top-level group
    // it belongs to: an error in one group leaves that group out and writes the others.
    const written: { name: string; at: string; top: string; node: ChildProps }[] = [];
    const failed = new Set<string>();
    const put = (top: string, name: string, at: string, nodes: ChildProps[]) => {
      written.push({ name, at, top, node: { name: 'mixin', params: name, nodes } as ChildProps });
    };
    for (const lookup of lookups) {
      const segments = rel(lookup).split('.');
      const top = segments.length > 1 ? segments[0] : rel(lookup);
      if (failed.has(top)) continue;
      try {
        for (let i = 1; i < segments.length; i++) {
          const g = segments.slice(0, i).join('.');
          if (wanted.has(g)) continue;
          wanted.add(g);
          const nodes = built(g);
          if (nodes) put(top, propertyName(full(g)), g, nodes);
        }
        if (system.resolveToken(lookup, mode)?.$type === 'typography') {
          const nodes = body(typographyEntries(lookup, mode));
          if (nodes && nodes.length > 0) put(top, propertyName(lookup), rel(lookup), nodes);
        }
      } catch (err) {
        if ((err as Error)?.name === 'CssSyntaxError') throw err;
        failed.add(top);
        report(atRule, result, failure(top, undefined, err, 'mixins'));
      }
    }
    const out: ChildProps[] = [];
    const kept = written.filter((w) => !failed.has(w.top));
    out.push(...kept.map((w) => w.node));

    // The document's spelling around `@contents`: a selector matches the element or any descendant, at no added specificity.
    for (const modifier of collection.resolver?.getModifiers() ?? []) {
      for (const context of modifier.contexts) {
        const spelling = getContextSelector(modifier, context);
        if (!spelling) continue;
        const contents = { name: 'contents', params: '' } as ChildProps;
        const inner =
          spelling.selector === undefined
            ? contents
            : ({
                selector: `&:where(${splitSelector(spelling.selector)
                  .map((s) => s.trim())
                  .flatMap((s) => [s, `${s} *`])
                  .join(', ')})`,
                nodes: [contents],
                raws: { between: ' ' },
              } as ChildProps);
        const [, name, params = ''] = /^@(\S+)\s*(.*)$/.exec(spelling.atRule ?? '') ?? [];
        const mixinName = `--when-${ident(modifier.name)}-${ident(context)}`;
        const node = { name: 'mixin', params: mixinName, nodes: [name ? { name, params, nodes: [inner] } : inner] } as ChildProps;
        out.push(node);
        kept.push({ name: mixinName, at: `${modifier.name}=${context}`, top: '', node });
      }
    }

    // A name written twice would be dropped by the polyfill, both definitions and silently. It is an error, always.
    for (const [i, a] of kept.entries()) {
      const b = kept.slice(0, i).find((w) => w.name === a.name);
      if (b)
        throw atRule.error(
          `[@toghen/postcss] "${b.at}" and "${a.at}" are both written as the mixin ${a.name}. Rename one of them, or give propertyName an injective rule.`,
        );
    }
    return out;
  }

  /**
   * `@toghen spellings [collection];` — at the top level: a name for every spelling of the vocabulary and of the contexts,
   * as `@custom-selector :--axis-value <selector>;` for a selector and `@custom-media --axis-value <condition>;` for a
   * `@media` spelling. A spelling holding `&`, and an at-rule other than `@media`, have no named form: each is left out,
   * with a comment saying why. Two spellings of one name (of one kind) are an error.
   * See specs.md §The hand-over round.
   */
  function spellings(atRule: AtRule, _result: Result, path: string): ChildProps[] | string {
    for (let p: Node | undefined = atRule.parent; p; p = p.parent) {
      if (p.type === 'rule' || (p.type === 'atrule' && (p as AtRule).name === 'layer')) {
        return p.type === 'rule'
          ? `[@toghen/postcss] Cannot write the spellings of "${path}" inside a rule: a name is defined at the top of a stylesheet, and a rule cannot hold a definition. Put @toghen spellings at the top of the stylesheet, outside any rule or layer.`
          : `[@toghen/postcss] Cannot write the spellings of "${path}" inside a layer: the polyfills ignore a definition in a layer. Put @toghen spellings at the top of the stylesheet, outside any rule or layer.`;
      }
    }
    const collection = collectionOf(path);
    if (path !== collection.name)
      return `[@toghen/postcss] Cannot write the spellings of "${path}": the argument is a collection, and may be left out when the system has one.`;
    const mode = collection.getDefaultMode();

    const named: { kind: 'selector' | 'media'; name: string; value: string; at: string }[] = [];
    const omitted: ChildProps[] = [];
    const put = (name: string, at: string, spelling: string) => {
      if (spelling.startsWith('@')) {
        const [, rule, params = ''] = /^@(\S+)\s*(.*)$/.exec(spelling) ?? [];
        if (rule === 'media') named.push({ kind: 'media', name, value: params, at });
        else omitted.push(comment(` ${name} is left out: ${at} is an @${rule} spelling, and @${rule} has no named form. `));
      } else if (spelling.includes('&')) {
        omitted.push(
          comment(
            ` :${name} is left out: ${at} holds "&", and a custom selector is a selector, with no place for a part to stand relative to a rule. `,
          ),
        );
      } else {
        named.push({ kind: 'selector', name: `:${name}`, value: spelling, at });
      }
    };

    // The vocabulary: every value a group declares that is new there or differs from the vocabulary above it, the root first.
    const groups: string[] = [];
    const walk = (g: string) => {
      groups.push(g);
      for (const child of collection.childrenOf(g, mode)) if (child.kind === 'group') walk(child.path);
    };
    walk('');
    for (const g of groups) {
      const declared = collection.getGroupAttribute(g, '$extensions', mode)?.['com.toghen']?.css?.parts;
      if (!declared || typeof declared !== 'object') continue;
      const above = g === '' ? {} : collection.vocabularyAt(g.includes('.') ? g.slice(0, g.lastIndexOf('.')) : '', mode);
      const base = g === '' ? '-' : propertyName(`${collection.name}.${g}`);
      for (const [axis, values] of Object.entries(declared as Record<string, Record<string, string>>)) {
        for (const [value, spelling] of Object.entries(values)) {
          if (above[axis]?.[value] === spelling) continue;
          put(`${base}-${ident(axis)}-${ident(value)}`, `the ${axis} "${value}"${g === '' ? '' : ` of "${g}"`}`, spelling);
        }
      }
    }
    // The contexts: a selector and an at-rule of one context each get their own name.
    for (const modifier of collection.resolver?.getModifiers() ?? []) {
      for (const context of modifier.contexts) {
        const spelling = getContextSelector(modifier, context);
        if (!spelling) continue;
        const name = `--${ident(modifier.name)}-${ident(context)}`;
        const at = `the ${modifier.name} "${context}"`;
        if (spelling.selector !== undefined) put(name, at, spelling.selector);
        if (spelling.atRule !== undefined) put(name, at, spelling.atRule);
      }
    }

    for (const [i, a] of named.entries()) {
      const b = named.slice(0, i).find((n) => n.kind === a.kind && n.name === a.name);
      if (b)
        throw atRule.error(
          `[@toghen/postcss] ${b.at} and ${a.at} are both written as ${a.kind === 'media' ? '@custom-media' : '@custom-selector'} ${a.name}. Rename one of them, or give propertyName an injective rule.`,
        );
    }
    const rule = (n: (typeof named)[number]) =>
      n.kind === 'media'
        ? ({ name: 'custom-media', params: `${n.name} ${n.value}` } as ChildProps)
        : ({ name: 'custom-selector', params: `${n.name} ${n.value}` } as ChildProps);
    return [...named.filter((n) => n.kind === 'selector').map(rule), ...named.filter((n) => n.kind === 'media').map(rule), ...omitted];
  }

  /**
   * `bind: 'chain'`: reads the resolver's account of every token under `path` and decides which tokens are
   * written as chains, with what, and which are written as without the option (and why). Returns the plan,
   * or the sentence for an error. Warnings are raised here, once per directive, after the errors.
   * See reference.md §bind (option).
   */
  function chains(
    atRule: Node,
    result: Result,
    path: string,
    collection: Collection,
    modifiers: ModeModifier[],
    modes: string[],
  ): ChainPlan | string {
    // `contexts()` refuses a collection with no resolver before it asks for chains.
    const resolver = collection.resolver!;
    const lookups = [...new Set(modes.flatMap((mode) => tokensUnder(path, mode)))];
    const defaultOf = (name: string) => modifiers.find((m) => m.name === name)?.default;
    const contextsOf = (name: string) => modifiers.find((m) => m.name === name)?.contexts ?? [];
    const typeOf = (lookup: string) => modes.map((mode) => system.resolveToken(lookup, mode)?.$type).find((type) => type);
    const refsIn = (value: unknown): string[] => referencesIn(value).map((r) => r.to);
    // A reference may name a member of a token; what varies is the token.
    // One that names no token is asked about as written.
    const ownerOfRef = (ref: string) => {
      try {
        return ownerOf(`${collection.name}.${ref}`).owner.slice(collection.name.length + 1);
      } catch {
        return ref;
      }
    };
    const dependsOf = (ref: string) => {
      const { direct, through } = resolver.dependsOn(ownerOfRef(ref));
      return [...direct, ...through];
    };

    const depends = new Map<string, string[]>();
    const early = new Set<string>();
    const chained = new Map<string, ChainedToken>();
    const notes: string[] = [];
    const names = new Map<string, string>([...lookups].map((lookup) => [propertyName(lookup), `"${lookup}"`]));
    let clash: string | undefined;
    // One property, claimed by whatever writes it; the same claim twice (a flag is shared) is not a clash.
    const claim = (prop: string, who: string, owner: string, lookup: string) => {
      const held = names.get(prop);
      if (held !== undefined && held !== who)
        clash ??= `[@toghen/postcss] Cannot write the chain of "${lookup}": its ${owner} property ${prop} is also the property of ${held}. Rename one of them, or give propertyName an injective rule.`;
      names.set(prop, who);
    };
    const flagOf = (modifier: string, context: string) => `--${ident(modifier)}--${ident(context)}`;

    for (const lookup of lookups) {
      const ref = referencePath(lookup);
      let about: TokenContexts;
      let on: string[];
      try {
        about = resolver.contextsOf(ref);
        on = dependsOf(ref);
      } catch (err) {
        // Not a token of the resolver's document (one added by hand): nothing to say about it.
        if (err instanceof PathNotFoundError) continue;
        throw err;
      }
      depends.set(lookup, on);
      const type = typeOf(lookup);
      if (BLOCK_TYPES.has(type ?? '')) continue;

      const unfactored = about.nonFactorable.find((n) => n.property === '$value');
      if (unfactored) {
        const contexts = unfactored.involved.filter((i) => i.context !== undefined);
        notes.push(
          `[@toghen/postcss] Cannot chain "${lookup}" ($value): ${unfactored.detail} Modifiers: ${[...new Set(contexts.map((i) => i.entry))].join(', ')}. Contexts: ${contexts.map((i) => `${i.entry}=${i.context}`).join(', ')}. Written as resolved values, bound early: the later block wins whole where its modifiers are set on different elements.`,
        );
        early.add(lookup);
        continue;
      }
      const chain = about.chains.$value && { ...about.chains.$value, links: about.chains.$value.links };
      if (!chain || chain.links.length === 0) continue;

      // A step that says something: a step that only carries the base says nothing.
      const defined = (_: number, step: Step): step is { value: unknown } => 'value' in step && !step.base;
      const definedValues = chain.links.flatMap((link, i) =>
        Object.values(link.steps)
          .filter((step) => defined(i, step))
          .map((step) => (step as { value: unknown }).value),
      );
      const moving =
        references === 'resolve' ? [...definedValues, chain.base].flatMap(refsIn).find((r) => dependsOf(r).length > 0) : undefined;
      if (moving !== undefined) {
        notes.push(
          `[@toghen/postcss] Cannot chain "${lookup}": it refers to "${collection.name}.${moving}", which depends on ${dependsOf(moving).join(', ')}, and references: 'resolve' writes that value bound early. Use references: 'var'.`,
        );
        early.add(lookup);
        continue;
      }

      // A reference in a value is the first hop under 'var', and the target's value under 'resolve' (which is not moving here).
      const refText = (target: string) =>
        references === 'var'
          ? `var(${propertyName(`${collection.name}.${target}`)})`
          : write(`${collection.name}.${target}`, modes[0], false);
      const substitute = (value: unknown): unknown =>
        typeof value === 'string'
          ? literalText(referencesIn(value).reduce((text, r) => text.split(r.written).join(refText(r.to)), value))
          : Array.isArray(value)
            ? value.map(substitute)
            : value && typeof value === 'object'
              ? Object.fromEntries(Object.entries(value).map(([key, member]) => [key, substitute(member)]))
              : value;
      const text = (value: unknown) => spellAs(type, substitute(value));

      // What each link says, by context, and whether it is conditional: a value of it follows a token that another modifier varies.
      const says = chain.links.map((link, i) =>
        contextsOf(link.modifier).flatMap((context): [string, unknown][] => {
          const step = link.steps[context];
          return step && defined(i, step) ? [[context, step.value]] : [];
        }),
      );
      const conditional = says.map((steps, i) =>
        steps.flatMap(([, value]) => refsIn(value)).some((r) => dependsOf(r).some((m) => m !== chain.links[i].modifier)),
      );
      // Two links, or one that a reference makes depend on another modifier: in its own link, or in the base.
      // (A one-link token whose link is conditional is chained too: the reference's worked example is one.)
      if (!(chain.links.length >= 2 || conditional[0] || (refsIn(chain.base).length > 0 && resolver.dependsOn(ref).through.length > 0)))
        continue;

      const head = propertyName(lookup);
      try {
        const links = chain.links.map(
          (link, i): ChainedLink => ({
            modifier: link.modifier,
            prop: cssLinkName(head, link.modifier),
            steps: new Map(says[i].map(([context, value]) => [context, text(value)])),
            conditional: conditional[i],
          }),
        );
        let value = chain.base === undefined ? undefined : text(chain.base);
        for (const link of [...links].reverse()) value = `var(${link.prop}${value === undefined ? '' : `, ${value}`})`;
        chained.set(lookup, { head, links, value: value!, modifiers: on });
        for (const link of links) {
          claim(link.prop, `the link '${link.modifier}' of "${lookup}"`, 'link', lookup);
          if (!link.conditional) continue;
          for (const context of link.steps.keys()) {
            claim(flagOf(link.modifier, context), `the flag '${context}' of modifier '${link.modifier}'`, 'flag', lookup);
            claim(
              `${link.prop}--${ident(context)}`,
              `the guarded step '${context}' of the link '${link.modifier}' of "${lookup}"`,
              'guarded step',
              lookup,
            );
          }
        }
      } catch (err) {
        if (!(err instanceof UnserializableValueError)) throw err;
        return failure(lookup, undefined, err);
      }
      for (const hole of chain.holes) {
        const where = modifiers.filter((m) => m.name in hole).map((m) => `${m.name}=${hole[m.name]}`);
        notes.push(
          `[@toghen/postcss] "${lookup}" has no value where ${where.join(' and ')}. The head is written without a final fallback there.`,
        );
      }
    }
    if (clash) return clash;
    for (const note of notes) atRule.warn(result, note);

    // A modifier whose context is the one a conditional link has a value in, at the defaults: its flag is on there.
    const conditional = new Set([...chained.values()].flatMap((t) => t.links.filter((l) => l.conditional).map((l) => l.modifier)));
    const onByDefault = [...conditional].filter((m) =>
      [...chained.values()].some((t) =>
        t.links.some((l) => l.conditional && l.modifier === m && defaultOf(m) !== undefined && l.steps.has(defaultOf(m)!)),
      ),
    );
    const out = (prop: string, value: string): Written => ({ prop, value, chained: true });

    return {
      lookups,
      early,
      dependsOn: (lookup) => (early.has(lookup) ? undefined : depends.get(lookup)),
      flags: (modifier, context) =>
        modifier === undefined
          ? onByDefault.map((m) => out(flagOf(m, defaultOf(m)!), ''))
          : conditional.has(modifier)
            ? contextsOf(modifier).map((c) => (c === context ? out(flagOf(modifier, c), '') : out(flagOf(modifier, c), 'initial')))
            : [],
      write(lookup, modifier, context) {
        const token = chained.get(lookup);
        if (!token) return undefined;
        if (modifier !== undefined && !token.modifiers.includes(modifier)) return [];
        const written: Written[] = [];
        for (const link of token.links) {
          if (link.conditional) {
            // The same text wherever the head is written.
            for (const [c, text] of link.steps) written.push(out(`${link.prop}--${ident(c)}`, `var(${flagOf(link.modifier, c)}) ${text}`));
            const guards = [...link.steps.keys()].map((c) => `${link.prop}--${ident(c)}`);
            written.push(
              out(
                link.prop,
                guards.reduceRight<string | undefined>((rest, g) => `var(${g}${rest === undefined ? '' : `, ${rest}`})`, undefined)!,
              ),
            );
          } else if (modifier === undefined) {
            const own = defaultOf(link.modifier);
            if (own !== undefined && link.steps.has(own)) written.push(out(link.prop, link.steps.get(own)!));
          } else if (link.modifier === modifier) {
            // A step that says nothing resets the link, so a subtree can return the modifier to it.
            written.push(out(link.prop, link.steps.get(context!) ?? 'initial'));
          }
        }
        // The head carries the token's description; the groups' go above the first thing written for the token.
        written.push({ prop: token.head, value: token.value, token: lookup, chained: true });
        written[0].groupsOf = lookup;
        return written;
      },
    };
  }

  /** Whether a token writes the same resolved CSS in two modes. Anything that fails to compare is a difference. */
  function sameIn(lookup: string, a: string, b: string): boolean {
    try {
      return spell(lookup, a, system.resolveValue(lookup, a)) === spell(lookup, b, system.resolveValue(lookup, b));
    } catch {
      return false;
    }
  }

  /**
   * What a typography token's mixin writes. Under `'block'`, one longhand per member, the key spelled as the property
   * (`fontSize` → `font-size`), each reading the member's own property. Under `'font'`, the `font` shorthand reading the
   * token's property, then the members the shorthand cannot carry at their own.
   */
  function typographyEntries(path: string, mode: string | undefined): Entry[] {
    const declaredHere = declaredMembers(path, mode);
    if (typography === 'font') {
      return [
        { prop: 'font', lookup: path },
        ...declaredHere.map((name) => ({ prop: cssIdentifier(name), lookup: `${path}.${name}`, own: propertyName(`${path}.${name}`) })),
      ];
    }
    return Object.entries(system.resolveToken(path, mode)!.$value as Record<string, unknown>)
      .filter(([, value]) => value !== undefined)
      .map(([name]) => ({
        prop: cssIdentifier(name),
        lookup: `${path}.${name}`,
        // The member's own custom property, when `@toghen declare` gives it one.
        own: declaredHere.includes(name) ? propertyName(`${path}.${name}`) : null,
      }));
  }

  /** Whether a token asks its group's mixin not to write it (`$extensions["com.toghen"].css.write: false`). */
  function unwritten(lookup: string, mode: string | undefined): boolean {
    const [name, ...rest] = lookup.split('.');
    return system.getCollection(name)?.getToken(rest.join('.'), mode)?.$extensions?.['com.toghen']?.css?.write === false;
  }

  /** A group as a mixin body: one declaration per token one level down, the key spelled as the property. */
  function group(path: string, mode: string | undefined): Entry[] {
    const collection = collectionOf(path);
    const keys = collection
      .childrenOf(path.split('.').slice(1).join('.'), mode ?? collection.getDefaultMode())
      .filter((c) => c.kind === 'token')
      .map((c) => c.key);
    // A typography key is its longhands under `'block'`; under `'font'` it is the key's own property, then the
    // members the shorthand cannot carry.
    return keys.flatMap((key): Entry[] => {
      const lookup = `${path}.${key}`;
      if (unwritten(lookup, mode)) return [];
      const isTypography = system.resolveToken(lookup, mode)?.$type === 'typography';
      // (only a key that is itself a property, `font`: a group of named styles is no mixin, each style has its own)
      if (isTypography && typography === 'block' && isProperty(cssIdentifier(key))) return typographyEntries(lookup, mode);
      const beside = typography === 'font' && isTypography ? declaredMembers(lookup, mode) : [];
      return [
        { prop: cssIdentifier(key), lookup },
        ...beside.map((name) => ({ prop: cssIdentifier(name), lookup: `${lookup}.${name}`, own: propertyName(`${lookup}.${name}`) })),
      ];
    });
  }

  /** The refusal for a directive outside any rule, or nothing when a rule encloses it. */
  function ruleOf(atRule: Node, refusal: string): string | undefined {
    let parent = atRule.parent;
    while (parent && parent.type !== 'rule') parent = parent.parent;
    return parent ? undefined : `[@toghen/postcss] ${refusal}`;
  }

  /** {@link report}, once per directive and message. */
  function reportOnce(node: Node, result: Result, message: string): void {
    const said = reported.get(raw(node)) ?? new Set<string>();
    if (said.has(message)) return;
    reported.set(raw(node), said.add(message));
    report(node, result, message);
  }

  /** Applies `onUnresolved` to one failure. Returns only when it did not throw. */
  function report(node: Node, result: Result, message: string): void {
    if (onUnresolved === 'throw') {
      throw node.error(message);
    }

    if (onUnresolved === 'warn') {
      node.warn(result, message);
    }
  }
}

/**
 * The message for a path that failed to resolve or to write.
 *
 * Two different failures arrive here and the message must say which: the token
 * could not be FOUND, or it was found and has no CSS spelling. Reporting the
 * second as «cannot resolve» sends the reader to look for a typo in a path that
 * is correct.
 */
function failure(path: string, mode: string | undefined, err: unknown, writing?: string): string {
  if (err instanceof BaseError) return `[@toghen/postcss] ${err.message}`;
  // The library's own sentence, said of what is being written, not as `Error: …` of a token.
  if (writing && (err instanceof InvalidTokenError || err instanceof ResolverValidationError))
    return `[@toghen/postcss] Cannot write the ${writing} of "${path}": ${err.message}`;
  const isKnown = err instanceof PathNotFoundError || err instanceof CollectionNotFoundError;
  const isShape = err instanceof UnserializableValueError;
  const what = isShape ? 'Cannot write token' : 'Cannot resolve token';
  return `[@toghen/postcss] ${what} "${path}"${mode ? ` (mode: ${mode})` : ''}: ${isKnown || isShape ? (err as Error).message : err}`;
}

/**
 * Which composite types are blocks, several properties at once: they have no custom property of their own
 * (unless written as the `font` shorthand), only their members do.
 *
 * ponytail: the kind belongs to the type, not to this adapter. It moves to the
 * core's type handlers when a second adapter needs it.
 */
const BLOCK_TYPES = new Set(['typography']);

/**
 * A declaration `declarations` writes, and the token whose description goes above it, if any.
 * `groupsOf` names the token whose groups' descriptions go above it, where that is earlier than
 * its description; `chained` marks what `bind: 'chain'` wrote; `who` is the lookup path of the
 * token or member the property was written for, which `collisions` compares.
 */
type Written = { prop: string; value: string; token?: string; groupsOf?: string; chained?: true; who?: string };

/**
 * One declaration a mixin writes: the property, the path it reads, and what it reads there. `own` is the
 * custom property the value is read from (`null`: it has none; absent: the path's own).
 */
interface Entry {
  prop: string;
  lookup: string;
  own?: string | null;
}

/** What `bind: 'chain'` writes for one token: its head, its links (one per modifier that defines it) and the head's value. */
interface ChainedToken {
  head: string;
  links: ChainedLink[];
  /** `var(P1, var(P2, … <base>))`: the same text wherever it is written. */
  value: string;
  /** The modifiers whose blocks carry the token: `dependsOn()`'s `direct` and `through`. */
  modifiers: string[];
}

/** A link: its property, its modifier, the text of each defined step by context, and whether it needs flags. */
interface ChainedLink {
  modifier: string;
  prop: string;
  steps: Map<string, string>;
  conditional: boolean;
}

/** What `bind: 'chain'` decided for the tokens under one `@toghen contexts` path. */
interface ChainPlan {
  /** Every token under the path, in any context: a hole can leave one out of the default's. */
  lookups: string[];
  /** Tokens written as without the option, with a warning. */
  early: Set<string>;
  /** The modifiers a token depends on, or `undefined` when the plan has nothing to say about it. */
  dependsOn(lookup: string): string[] | undefined;
  /** A chained token's declarations in the defaults (no modifier) or in a context's block; `undefined` for any other token. */
  write(lookup: string, modifier?: string, context?: string): Written[] | undefined;
  /** The flags of conditional links: in the block of a context, or in the defaults. */
  flags(modifier?: string, context?: string): Written[];
}

/** The local property a part sets for a token's own: `--_` and the name without its `--`. */
function local(property: string): string {
  return property.replace(/^--/, '--_');
}

/** A name as a custom-property identifier: whitespace as `-`, anything an identifier cannot hold escaped. */
function ident(name: string): string {
  return name.replace(/\s+/g, '-').replace(/[^\w\u0080-\uffff-]/g, (c) => `\\${c}`);
}

/** The names of the `@layer`s a node sits in, outermost first. An anonymous layer adds none. */
function enclosingLayers(node: Node): string[] {
  const names: string[] = [];
  for (let p = node.parent; p; p = p.parent) {
    if (p.type === 'atrule' && (p as AtRule).name === 'layer' && (p as AtRule).params.trim()) names.unshift((p as AtRule).params.trim());
  }
  return names;
}

/** A refusal that carries the whole sentence. */
class BaseError extends Error {}

/**
 * A path as written, split at its `as value`: a path has no space before the `as`, so nothing that parses
 * without a form changes meaning. The forms that retired, and any other, are refused with the sentence for what replaces them.
 */
function splitForm(written: string): { path: string; form?: 'value' } {
  const match = /^([\s\S]*?)\s+as(?:\s+(\S+))?$/.exec(written.trim());
  if (!match) return { path: written.trim() };
  const [, path, form] = match;
  if (form === 'value') return { path, form };
  const instead =
    form === 'var'
      ? 't(path) already writes var(--name, literal); there is no form to ask for it'
      : form === 'longhands' || form === 'shorthand'
        ? 'write the declarations yourself with t(), or apply the group with @apply and @toghen mixins; the composites and typography options say how declare and contexts write a composite'
        : 'the only form is value';
  throw new BaseError(
    `Cannot read "${path}": ${form === undefined ? 'as takes a form' : `"as ${form}" is retired or unknown`}: ${instead}.`,
  );
}

/** A visitor is handed a proxy of the node, and the tree holds the node itself: the maps are keyed by the latter. */
const raw = <N extends Node>(node: N): N => (node as N & { proxyOf: N }).proxyOf;

/** A selector split on its top-level commas, quotes, brackets and parentheses respected. */
function splitSelector(selector: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let from = 0;
  scan(selector, (i, c) => {
    if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth--;
    else if (c === ',' && depth === 0) {
      parts.push(selector.slice(from, i));
      from = i + 1;
    }
  });
  parts.push(selector.slice(from));
  return parts;
}

/** Calls `visit` for every character of a selector that is not inside a quoted string. */
function scan(selector: string, visit: (i: number, c: string) => void): void {
  let quote = '';
  for (let i = 0; i < selector.length; i++) {
    const c = selector[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = '';
    } else if (c === '"' || c === "'") quote = c;
    else visit(i, c);
  }
}

/** A description as a comment, written as authored; `*\/` is escaped so it cannot close the comment early. */
function comment(text: string): ChildProps {
  return { text: text.split('*/').join('*\\/') };
}

/** The member at a dotted address (`'0.color'`), `''` being the value itself. */
function getAt(value: unknown, at: string): unknown {
  return at === '' ? value : at.split('.').reduce<any>((v, key) => v?.[key], value);
}

/** Sets the member at a dotted address in place and returns the value; `''` replaces it. */
function setAt(value: unknown, at: string, member: unknown): unknown {
  if (at === '') return member;
  const keys = at.split('.');
  (getAt(value, keys.slice(0, -1).join('.')) as any)[keys[keys.length - 1]] = member;
  return value;
}

// Required by PostCSS to recognise this as a plugin object, not a factory.
toghenPlugin.postcss = true;
