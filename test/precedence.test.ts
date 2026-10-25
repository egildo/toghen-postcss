import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import postcss from 'postcss';
import postcssMixins from '@csstools/postcss-mixins';
import { load, Resolver, type Collection, type ResolverDocument } from '@toghen/lib';
import toghenPlugin, { type ToghenPluginOptions } from '../src/index.js';
import { flatten, evaluate, used, worldScope, type Flat } from './cascade.js';

/*
 * The core answers which token applies under a selection of part values: more matching parts, then the latest
 * differing axis (`Collection.applies()`). The stylesheet must give the element the same: for every selection, one
 * value or none per axis, the value the cascade gives each property is the value of the token the core names.
 * A spelling's weight must not decide it: every part rule weighs what the component's rule weighs, whatever its
 * spelling, so the order of the rules alone decides.
 */

const EXAMPLE = `${dirname(fileURLToPath(import.meta.resolve('@toghen/lib/example/ds.resolver.json')))}/`;
const read = (file: string) => readFile(file, 'utf8');

const px = (value: number) => ({ value, unit: 'px' });
const rem = (value: number) => ({ value, unit: 'rem' });
const srgb = (r: number, g: number, b: number) => ({ colorSpace: 'srgb', components: [r, g, b] });
const color = (value: unknown) => ({ $type: 'color', $value: value });
const dimension = (value: unknown) => ({ $type: 'dimension', $value: value });
const family = (...names: string[]) => ({ $type: 'fontFamily', $value: names });

const OPTIONS: Partial<ToghenPluginOptions> = { typography: 'font', onUnresolved: 'throw' };
const kebab = (key: string) => key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

/** A document with one collection, its vocabulary on the root, and a theme world. */
function synthetic(vocabulary: Record<string, Record<string, string>>, component: Record<string, unknown>): ResolverDocument {
  return {
    version: '2025-11-01',
    name: 'ds',
    sets: {
      base: {
        sources: [
          {
            $extensions: { 'com.toghen': { css: { parts: vocabulary } } },
            color: { accent: color(srgb(0.1, 0.4, 0.9)), paper: color(srgb(1, 1, 1)), ink: color(srgb(0.1, 0.1, 0.1)) },
            box: component,
          } as Record<string, unknown>,
        ],
      },
    },
    modifiers: {
      theme: {
        default: 'light',
        contexts: { light: [], dark: [{ color: { accent: { $value: srgb(0.36, 0.61, 1) }, paper: { $value: srgb(0.17, 0.17, 0.17) } } }] },
        $extensions: { 'com.toghen': { css: { selector: "[data-theme='{context}']" } } },
      },
    },
    resolutionOrder: [{ $ref: '#/sets/base' }, { $ref: '#/modifiers/theme' }],
  };
}

/**
 * The component's element under the stylesheet the plugin writes for it, and a probe rule per token of the
 * component reading it with `t()`: the token's value as the plugin writes it.
 */
async function built(document: ResolverDocument, component: string) {
  const system = new Resolver(document).resolveContextsToDesignSystem();
  const collection: Collection = system.getCollection(system.getCollectionNames()[0])!;
  const paths = collection.getAllPaths(undefined, component);
  const probes = paths.map((path, i) => `.probe-${i} { ${kebab(path.split('.').pop()!)}: t(${path}); }`).join('\n');
  const input = `@toghen mixins;
        @layer tokens { @toghen contexts; }
        @layer components { .${component} { @apply --${component}; } }
        ${probes}`;
  const css = (await postcss([toghenPlugin({ system, ...OPTIONS }), postcssMixins()]).process(input, { from: undefined })).css;
  return { collection, rules: flatten(css), probe: (path: string) => `.probe-${paths.indexOf(path)}` };
}

/** Every selection of part values: one value or none per axis the component uses. */
function selections(collection: Collection, component: string): Record<string, string>[] {
  return collection
    .axesOf(component)
    .reduce<Record<string, string>[]>(
      (all, { axis, values }) => all.flatMap((s) => [s, ...values.map((value) => ({ ...s, [axis]: value }))]),
      [{}],
    );
}

/** The value of each key the core says applies, as the plugin writes the token, in a world. */
function expected(
  rules: Flat[],
  collection: Collection,
  component: string,
  selection: Record<string, string>,
  world: string[],
  probe: (path: string) => string,
) {
  const scope = worldScope(rules, world);
  const out: Record<string, string> = {};
  for (const [key, path] of Object.entries(collection.applies(component, selection))) {
    const rule = rules.find((r) => r.chain.length === 1 && r.chain[0] === probe(path));
    assert.ok(rule, `no probe for ${path}`);
    out[kebab(key)] = evaluate(rule.decls[0][1], scope).trim();
  }
  return Object.fromEntries(Object.entries(out).sort());
}

async function agrees(document: ResolverDocument, component: string, worlds: string[][]) {
  const { collection, rules, probe } = await built(document, component);
  const vocabulary = collection.vocabularyAt(component);
  const spellings = Object.fromEntries(Object.values(vocabulary).flatMap((values) => Object.entries(values)));
  const all = selections(collection, component);
  assert.ok(all.length > 1, 'the component has parts');
  for (const world of worlds) {
    for (const selection of all) {
      const on = new Set(Object.values(selection));
      assert.deepEqual(
        used(rules, { root: `.${component}`, spellings, world }, on),
        expected(rules, collection, component, selection, world, probe),
        `${component} in ${world.join(' ')} with ${JSON.stringify(selection)}`,
      );
    }
  }
}

const VOCABULARY = {
  variant: { primary: "[data-variant='primary']" },
  state: { hover: ':hover', pressed: ':active' },
  mood: { calm: ':where(.calm)' },
  input: { fine: '@media (pointer: fine)' },
};

describe('the cascade agrees with the core on which token applies', () => {
  const LIGHT = [':root', "[data-theme='light']"];
  const DARK = [':root', "[data-theme='dark']"];

  it("for every selection of the running example's button and field", async () => {
    const document = (await load(`${EXAMPLE}ds.resolver.json`, { read })).document;
    const compact = [...DARK, "[data-density='compact']"];
    await agrees(document, 'button', [LIGHT, DARK, compact]);
    await agrees(document, 'field', [LIGHT, DARK, compact]);
  });

  it('for every selection of a component with an at-rule axis and a :where() axis, and tokens of two parts across them', async () => {
    // `hover`, `calm` and `fine` each give the background, so a one-part `:hover` rule meets one-part rules that
    // weigh less as written, declared later in the vocabulary.
    const box = {
      background: color('{color.paper}'),
      color: color('{color.ink}'),
      paddingBlock: dimension(px(8)),
      fontFamily: family('Inter', 'Helvetica Neue', 'sans-serif'),
      primary: {
        background: color('{color.accent}'),
        fine: { background: color(srgb(0, 0.2, 0.6)) },
        calm: { background: color(srgb(0, 0.5, 0.5)), color: color('{color.paper}') },
      },
      hover: {
        background: color(srgb(0.9, 0.9, 0.9)),
        fine: { background: color(srgb(0.6, 0.6, 0.6)), paddingBlock: dimension(rem(0.25)) },
      },
      pressed: { background: color(srgb(0.8, 0.8, 0.8)), calm: { color: color('{color.accent}') } },
      calm: {
        background: color(srgb(0.85, 0.95, 0.9)),
        color: color(srgb(0.4, 0.4, 0.4)),
        fontFamily: family('Georgia', 'serif'),
        fine: { fontFamily: family('Iowan Old Style', 'serif') },
      },
      fine: { background: color(srgb(0.95, 0.9, 0.8)), paddingBlock: dimension(px(6)), fontFamily: family('system-ui', 'sans-serif') },
    };
    await agrees(synthetic(VOCABULARY, box), 'box', [LIGHT, DARK]);
  });
});

describe('a rule with more parts comes after rules with fewer, whatever its spellings weigh', () => {
  // The defect: the two-part token was nested in the variant's rule, at the specificity of one class and one attribute,
  // before the hover rule of the same weight, so hover won in the browser while the core named the two-part token.
  const reproduced = (spelling: string, key: string) =>
    synthetic(
      {
        variant: { primary: "[data-variant='primary']" },
        state: { hover: ':hover' },
        [key === 'fine' ? 'input' : 'mood']: { [key]: spelling },
      },
      {
        background: color('{color.paper}'),
        hover: { background: color('{color.ink}') },
        primary: { [key]: { background: color('{color.accent}') } },
      },
    );

  for (const [spelling, key, axis] of [
    ['@media (pointer: fine)', 'fine', 'input'],
    [':where(.calm)', 'calm', 'mood'],
  ] as const) {
    it(`gives the two-part token with the spelling ${spelling} over the one-part hover`, async () => {
      const { collection, rules, probe } = await built(reproduced(spelling, key), 'box');
      const selection = { variant: 'primary', state: 'hover', [axis]: key };
      assert.equal(collection.applies('box', selection).background, `box.primary.${key}.background`);
      const world = [':root'];
      const spellings = { primary: "[data-variant='primary']", hover: ':hover', [key]: spelling };
      const got = used(rules, { root: '.box', spellings, world }, new Set(Object.values(selection)));
      assert.deepEqual(got, expected(rules, collection, 'box', selection, world, probe));
      assert.equal(got.background, '#1a66e6');
    });
  }
});

describe('every part rule weighs the same, so a heavier spelling declared earlier does not win', () => {
  // The defect: `.box:hover` weighs two classes; `.box` inside `@media (pointer: fine)`, or `.box:where(.calm)`, weighs
  // one. Under hover with fine, or hover with calm, the core names the later axis, and the browser gave hover.
  const box = {
    background: color('{color.paper}'),
    paddingBlock: dimension({ value: 8, unit: 'px' }),
    fontFamily: family('Inter', 'sans-serif'),
    hover: { background: color(srgb(0.9, 0.9, 0.9)), paddingBlock: dimension(rem(0.75)), fontFamily: family('Georgia', 'serif') },
    calm: { background: color(srgb(0, 0.5, 0.5)), fontFamily: family('Iowan Old Style', 'serif') },
    fine: { background: color(srgb(0, 0.2, 0.6)), paddingBlock: dimension(px(6)) },
  };
  const vocabulary = { state: { hover: ':hover' }, mood: { calm: ':where(.calm)' }, input: { fine: '@media (pointer: fine)' } };

  it('for every selection of one-part rules: :hover, then a :where() spelling, then an at-rule spelling', async () => {
    await agrees(synthetic(vocabulary, box), 'box', [
      [':root', "[data-theme='light']"],
      [':root', "[data-theme='dark']"],
    ]);
  });

  it('writes every part rule as `&` with its spelling inside :where(), or inside its at-rule', async () => {
    const { rules } = await built(synthetic(vocabulary, box), 'box');
    const chains = rules.filter((r) => r.chain[0] === '.box').map((r) => r.chain.slice(1).join(' > '));
    assert.deepEqual(chains, ['', '&:where(:hover)', '&:where(:where(.calm))', '@media (pointer: fine)']);
  });

  it('gives the later axis under hover, as the core does', async () => {
    const { collection, rules, probe } = await built(synthetic(vocabulary, box), 'box');
    const spellings = Object.fromEntries(Object.values(collection.vocabularyAt('box')).flatMap((values) => Object.entries(values)));
    for (const [selection, background] of [
      [{ state: 'hover', input: 'fine' }, '#003399'],
      [{ state: 'hover', mood: 'calm' }, '#008080'],
    ] as const) {
      assert.equal(collection.applies('box', selection).background, `box.${Object.values(selection)[1]}.background`);
      const got = used(rules, { root: '.box', spellings, world: [':root'] }, new Set(Object.values(selection)));
      assert.deepEqual(got, expected(rules, collection, 'box', selection, [':root'], probe));
      assert.equal(got.background, background);
    }
  });
});
