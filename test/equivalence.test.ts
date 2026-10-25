import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import postcss from 'postcss';
import postcssMixins from '@csstools/postcss-mixins';
import { Resolver, type ResolverDocument } from '@toghen/lib';
import toghenPlugin, { type ToghenPluginOptions } from '../src/index.js';
import { flatten, used as cascade, type Flat } from './cascade.js';

/*
 * One synthetic component written twice, and the same behaviour asked of both.
 *
 *  (a) the dialect that retired: a component group, element states as modifiers marked "inherits": false
 *      (pointer, then availability), and a variant subgroup applied by hand under its attribute. Its output is
 *      frozen below as a string.
 *  (b) the standard form: the same values as parts of the group, named by a vocabulary. Built with
 *      `@toghen contexts`, `@toghen mixins` and `.button { @apply --button; }`, expanded by the mixins polyfill.
 *
 * Both are flattened (nesting resolved) and run through a small cascade: for every combination of the
 * component's states and variant, in each world (light, dark), the value every CSS property of the element
 * ends up with must be the same.
 *
 * How the order of the parts replaces the state layer: in (a) the state rules sit in `@layer states`, after the
 * components, so they win over the component's own rules whatever their specificity, and among themselves the
 * later modifier wins (availability after pointer). In (b) a part's rule is nested in the component's rule, in
 * the component's own layer, its spelling inside `:where()`, so every part weighs what the component's rule weighs, one
 * class; the later part wins, and the order of parts is the order of the vocabulary (the axes as declared, the
 * values of an axis as declared; the order of the keys of the group means nothing). So the state axis runs hover,
 * pressed, disabled (disabled after the pointer states, as availability came after pointer), and the variant axis
 * comes last (as the hand-written variant rule, one selector up, beat the rest). A vocabulary that puts the variant
 * first is a different choice, and its result is stated in the last tests. The cascade (./cascade.ts) ignores layers and
 * orders by specificity, then source order, which is enough for both because of that.
 */

const rem = (value: number) => ({ value, unit: 'rem' });
const srgb = (r: number, g: number, b: number) => ({ colorSpace: 'srgb', components: [r, g, b] });
const color = (value: unknown) => ({ $type: 'color', $value: value });
const text = (weight: number) => ({
  fontFamily: ['Inter', 'Helvetica Neue', 'sans-serif'],
  fontSize: rem(1),
  fontWeight: weight,
  lineHeight: 1.5,
});
const set = (v: unknown) => ({ $value: v });

const roles = {
  accent: color(srgb(0.1, 0.4, 0.9)),
  strong: color(srgb(0.08, 0.31, 0.74)),
  muted: color(srgb(0.8, 0.8, 0.8)),
  ink: color(srgb(0.1, 0.1, 0.1)),
  paper: color(srgb(1, 1, 1)),
};
// the world: a theme changes two roles, and so everything that reads them, however deep
const theme = {
  default: 'light',
  contexts: { light: [], dark: [{ color: { strong: set(srgb(0.5, 0.7, 1)), muted: set(srgb(0.3, 0.3, 0.3)) } }] },
  $extensions: { 'com.toghen': { css: { selector: "[data-theme='{context}']" } } },
};

const rest = {
  backgroundColor: color('{color.accent}'),
  color: color('{color.paper}'),
  paddingBlock: { $type: 'dimension', $value: rem(0.5) },
  font: { $type: 'typography', $value: text(400) },
};

/**
 * The standard form of the same component. The precedence between two parts that match at once is the order of the
 * vocabulary (later wins), never the order of the keys, which here put the variant first in both.
 * `variantFirst` puts the variant axis before the state axis in the vocabulary; `primary` overrides what the variant sets.
 */
function newWay({ variantFirst = false, primary = {} as Record<string, unknown> } = {}): ResolverDocument {
  const states = { hover: ':hover', pressed: ':active', disabled: ":is(:disabled, [aria-disabled='true'])" };
  const variants = { primary: "[data-variant='primary']" };
  return {
    version: '2025-11-01',
    name: 'ds',
    sets: {
      base: {
        sources: [
          {
            color: roles,
            button: {
              $extensions: {
                'com.toghen': {
                  css: { parts: variantFirst ? { variant: variants, state: states } : { state: states, variant: variants } },
                },
              },
              ...rest,
              primary: { backgroundColor: color('{color.strong}'), color: color('{color.paper}'), ...primary },
              hover: { backgroundColor: color('{color.strong}') },
              pressed: { backgroundColor: color('{color.strong}'), font: { $type: 'typography', $value: text(700) } },
              disabled: { backgroundColor: color('{color.muted}'), color: color('{color.ink}') },
            },
          },
        ],
      },
    },
    modifiers: { theme },
    resolutionOrder: [{ $ref: '#/sets/base' }, { $ref: '#/modifiers/theme' }],
  };
}

const OPTIONS: Partial<ToghenPluginOptions> = { references: 'var', typography: 'font', onUnresolved: 'throw' };

/**
 * What the retired dialect wrote for this component, frozen: a component group, element states as modifiers marked
 * "inherits": false (pointer, then availability) and a variant rule applied by hand, built with `@toghen contexts ds;`,
 * `@toghen ds.button;`, and the options `references: 'var'`, `typography: 'font'`, `tokenLayer: 'tokens'`,
 * `stateLayer: 'states'`. The directives are gone; the output stays as the standard to meet.
 */
const OLD = `@layer tokens, components, states;
         @layer tokens { @layer defaults, theme; @layer defaults {
  :root { --color-accent: #1a66e6; --color-strong: #144fbd; --color-muted: #cccccc; --color-ink: #1a1a1a; --color-paper: #ffffff; --button-background-color: var(--color-accent); --button-color: var(--color-paper); --button-padding-block: 0.5rem; --button-font: 400 1rem/1.5 Inter, "Helvetica Neue", sans-serif; --button-primary-background-color: var(--color-strong); --button-primary-color: var(--color-paper); } } @layer theme {
  [data-theme='light'] { --color-strong: #144fbd; --color-muted: #cccccc; --button-primary-background-color: var(--color-strong); }
  [data-theme='dark'] { --color-strong: #80b3ff; --color-muted: #4d4d4d; --button-primary-background-color: var(--color-strong); } } }
         @layer components {
           .button { display: inline-flex; background-color: var(--button-background-color, #1a66e6); color: var(--button-color, #ffffff); padding-block: var(--button-padding-block, 0.5rem); font: var(--button-font, 400 1rem/1.5 Inter, "Helvetica Neue", sans-serif); }
           .button[data-variant='primary'] { background-color: var(--button-primary-background-color, #144fbd); color: var(--button-primary-color, #ffffff); }
         }
         @layer states{
 .button:hover { --button-background-color: var(--color-strong); }
 .button:active { --button-background-color: var(--color-strong); --button-font: 700 1rem/1.5 Inter, "Helvetica Neue", sans-serif; }
 .button:is(:disabled, [aria-disabled='true']) { --button-background-color: var(--color-muted); --button-color: var(--color-ink); } }`;

const buildOld = async () => OLD;

async function buildNew(document: ResolverDocument = newWay(), options: Partial<ToghenPluginOptions> = {}) {
  // one pipeline: the plugin, then the polyfill
  const system = new Resolver(document).resolveContextsToDesignSystem();
  const input = `@toghen mixins;
         @layer tokens, components;
         @layer tokens { @toghen contexts; }
         @layer components { .button { display: inline-flex; @apply --button; } }`;
  return (await postcss([toghenPlugin({ system, ...OPTIONS, ...options }), postcssMixins()]).process(input, { from: undefined })).css;
}

// ---- the cascade (./cascade.ts), for this component ----

const SPELLINGS = {
  hover: ':hover',
  pressed: ':active',
  disabled: ":is(:disabled, [aria-disabled='true'])",
  primary: "[data-variant='primary']",
};

/** What every CSS property of `.button` ends up with, in a world and with some conditions true. */
const used = (rules: Flat[], world: 'light' | 'dark', on: Set<string>) =>
  cascade(rules, { root: '.button', spellings: SPELLINGS, world: [':root', `[data-theme='${world}']`] }, on);

const ELEMENTS = ['hover', 'pressed', 'disabled', 'primary'];
const COMBINATIONS = Array.from({ length: 1 << ELEMENTS.length }, (_, bits) => new Set(ELEMENTS.filter((_, i) => bits & (1 << i))));

describe('the component model, written the old way and the standard way', () => {
  it('writes the same declarations at rest, exactly', async () => {
    const [old, standard] = await Promise.all([buildOld(), buildNew()]);
    const restOf = (css: string) => flatten(css).find((r) => r.selector === '.button')?.decls;
    assert.ok(restOf(old));
    // the standard form also starts every token a part re-points again from its rest, and reads it through the local property
    const resets = restOf(standard)!
      .filter(([prop, value]) => prop.startsWith('--_') && value === 'initial')
      .map(([prop]) => prop);
    assert.deepEqual(resets, ['--_button-background-color', '--_button-color', '--_button-font']);
    const plain = restOf(standard)!
      .filter(([prop]) => !resets.includes(prop))
      .map(([prop, value]) => [prop, value.replace(/^var\(--_[a-z-]+, (var\(.*\))\)$/, '$1')]);
    // the old output is frozen with literal fallbacks; the standard form's fallback is the first hop of the reference
    const bare = (decls: string[][]) => decls.map(([prop, value]) => [prop, value.replace(/^var\((--[\w-]+), .*\)$/, 'var($1)')]);
    assert.deepEqual(bare(plain), bare(restOf(old)!));
    assert.ok(
      plain.some(([prop, value]) => prop === 'background-color' && value === 'var(--button-background-color, var(--color-accent))'),
    );
    // and reads the custom properties, with the literal as a fallback
    assert.ok(
      restOf(old)!.some(([prop, value]) => prop === 'background-color' && /^var\(--button-background-color, #[0-9a-f]{6}\)$/.test(value)),
    );
  });

  it('leaves nothing of the standard form in the output of the polyfill', async () => {
    assert.doesNotMatch(await buildNew(), /@apply|@mixin|@contents/);
  });

  it('gives the element the same value for every property, in each world, in each combination of states and variant', async () => {
    const [old, standard] = await Promise.all([buildOld(), buildNew()]);
    const [a, b] = [flatten(old), flatten(standard)];
    for (const world of ['light', 'dark'] as const) {
      for (const on of COMBINATIONS) {
        assert.deepEqual(used(b, world, on), used(a, world, on), `${world} with ${[...on].join(' + ') || 'nothing'}`);
      }
    }
  });

  it('is not vacuous: the states, the variant and the world each change something, and the later part wins where two overlap', async () => {
    const rules = flatten(await buildNew());
    const at = (world: 'light' | 'dark', ...on: string[]) => used(rules, world, new Set(on));
    assert.notEqual(at('light')['background-color'], at('light', 'hover')['background-color']);
    assert.notEqual(at('light', 'hover')['background-color'], at('dark', 'hover')['background-color']);
    // hover and disabled overlap: disabled is later in the vocabulary and wins, as availability after pointer did
    assert.equal(at('light', 'hover', 'disabled')['background-color'], at('light', 'disabled')['background-color']);
    assert.notEqual(at('light', 'disabled')['background-color'], at('light', 'hover')['background-color']);
    // the variant axis is last: it wins over a state
    assert.equal(at('light', 'primary', 'disabled')['background-color'], at('light', 'primary')['background-color']);
    // a typography token is re-pointed as a whole
    assert.match(at('light', 'pressed').font, /^700 1rem\/1\.5 Inter, "Helvetica Neue", sans-serif$/);
    assert.match(at('light').font, /^400 1rem\/1\.5 Inter, "Helvetica Neue", sans-serif$/);
  });
});

describe("the typography key under typography: 'block'", () => {
  it('is longhands that read the member properties, and a part re-points them member by member', async () => {
    const rules = flatten(await buildNew(newWay(), { typography: 'block' }));
    const at = (world: 'light' | 'dark', ...on: string[]) =>
      pick(used(rules, world, new Set(on)), ['font', 'font-family', 'font-size', 'font-weight', 'line-height']);
    const base = { 'font-family': 'Inter, "Helvetica Neue", sans-serif', 'font-size': '1rem', 'font-weight': '400', 'line-height': '1.5' };
    for (const world of ['light', 'dark'] as const) {
      assert.deepEqual(at(world), base, `${world} at rest`);
      assert.deepEqual(at(world, 'pressed'), { ...base, 'font-weight': '700' }, `${world} pressed`);
      assert.deepEqual(at(world, 'pressed', 'primary'), { ...base, 'font-weight': '700' }, `${world} pressed primary`);
    }
  });
});

describe('the variant axis first in the vocabulary: a different choice, stated', () => {
  it("is the old output everywhere the variant and a state do not overlap, and the state's value where they do", async () => {
    const a = flatten(await buildOld());
    const b = flatten(await buildNew(newWay({ variantFirst: true })));
    for (const world of ['light', 'dark'] as const) {
      for (const on of COMBINATIONS) {
        const states = [...on].filter((c) => c !== 'primary');
        const before = used(a, world, on);
        // what the state sets wins over what the variant sets: the old output without the variant, for the properties both set
        const expected =
          on.has('primary') && states.length > 0
            ? { ...before, ...pick(used(a, world, new Set(states)), ['background-color', 'color']) }
            : before;
        assert.deepEqual(used(b, world, on), expected, `${world} with ${[...on].join(' + ') || 'nothing'}`);
      }
    }
  });

  it('lets a generic hover apply on primary:hover, unless button.primary.hover defines it', async () => {
    const distinct = { backgroundColor: color('{color.ink}') };
    const at = (rules: Flat[], ...on: string[]) => used(rules, 'light', new Set(on))['background-color'];
    const last = flatten(await buildNew(newWay({ primary: distinct })));
    const first = flatten(await buildNew(newWay({ variantFirst: true, primary: distinct })));
    // variant last: the variant's own value wins over hover, as it always did
    assert.equal(at(last, 'primary', 'hover'), at(last, 'primary'));
    // variant first: hover's value applies to a primary button
    assert.notEqual(at(first, 'primary', 'hover'), at(first, 'primary'));
    assert.equal(at(first, 'primary', 'hover'), at(first, 'hover'));
    // a value for the combination is the most specific rule, and wins in either order
    const own = { backgroundColor: color('{color.ink}'), hover: { backgroundColor: color('{color.paper}') } };
    const combined = flatten(await buildNew(newWay({ variantFirst: true, primary: own })));
    assert.notEqual(at(combined, 'primary', 'hover'), at(combined, 'hover'));
    assert.equal(at(combined, 'primary', 'hover'), '#ffffff');
    assert.equal(at(flatten(await buildNew(newWay({ primary: own }))), 'primary', 'hover'), '#ffffff');
  });
});

function pick(from: Record<string, string>, keys: string[]): Record<string, string> {
  return Object.fromEntries(keys.filter((k) => k in from).map((k) => [k, from[k]]));
}
