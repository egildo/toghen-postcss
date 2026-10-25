import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import postcss from 'postcss';
import { Resolver, type ResolverDocument } from '@toghen/lib';
import toghenPlugin, { type ToghenPluginOptions } from '../src/index.js';

const px = (value: number) => ({ value, unit: 'px' });
const srgb = (v: number) => ({ colorSpace: 'srgb', components: [v, v, v] });
const GREY = 26 / 255; // #1a1a1a

const ATTR = (name: string) => ({ $extensions: { 'com.toghen': { css: { selector: `[data-${name}='{context}']` } } } });

// Two modifiers, theme and density, each spelled as an attribute. `card.surface` varies
// with theme, `card.pad` with density. The tokens carry the W3C structured shapes.
function doc(extra: Record<string, unknown> = {}): ResolverDocument {
  return {
    version: '2025-11-01',
    name: 'ds',
    sets: {
      base: {
        sources: [
          {
            color: { $type: 'color', blue: { $value: { colorSpace: 'srgb', components: [0, 0, 1] } } },
            surface: { $type: 'color', accent: { $value: '{color.blue}' } },
            card: {
              surface: { $type: 'color', $value: srgb(1) },
              pad: { $type: 'dimension', $value: px(16) },
            },
            face: { $type: 'fontFamily', $value: ['Inter', 'sans-serif'] },
            elevation: {
              raised: { $type: 'shadow', $value: { color: srgb(0), offsetX: px(0), offsetY: px(4), blur: px(12), spread: px(0) } },
            },
            type: {
              body: {
                $type: 'typography',
                $value: { fontFamily: ['Inter', 'sans-serif'], fontSize: { value: 1, unit: 'rem' }, fontWeight: 400, lineHeight: 1.5 },
              },
            },
          },
        ],
      },
    },
    modifiers: {
      theme: { default: 'light', contexts: { light: [], dark: [{ card: { surface: { $value: srgb(GREY) } } }] }, ...ATTR('theme') },
      density: { default: 'regular', contexts: { regular: [], compact: [{ card: { pad: { $value: px(8) } } }] }, ...ATTR('density') },
      ...extra,
    },
    resolutionOrder: [
      { $ref: '#/sets/base' },
      { $ref: '#/modifiers/theme' },
      { $ref: '#/modifiers/density' },
      ...(extra.calm ? [{ $ref: '#/modifiers/calm' }] : []),
    ],
  };
}

async function run(css: string, document: ResolverDocument = doc(), options: Partial<ToghenPluginOptions> = {}) {
  const system = new Resolver(document).resolveContextsToDesignSystem();
  const result = await postcss([toghenPlugin({ system, onUnresolved: 'throw', ...options })]).process(css, { from: undefined });
  return { css: flat(result.css), warnings: result.warnings().map((w) => w.text) };
}

/** Whitespace collapsed, and no `;` before a `}`: what a block says, not how it is laid out. */
const flat = (css: string) => css.replace(/\s+/g, ' ').replace(/;\s*}/g, ' }').replace(/\s+/g, ' ').trim();

const TOKENS = [
  '@layer tokens {',
  '@layer defaults, theme, density;',
  '@layer defaults { :root { --card-surface: #ffffff; --card-pad: 16px } }',
  "@layer theme { [data-theme='light'] { --card-surface: #ffffff } [data-theme='dark'] { --card-surface: #1a1a1a } }",
  "@layer density { [data-density='regular'] { --card-pad: 16px } [data-density='compact'] { --card-pad: 8px } }",
  '}',
].join(' ');

const ONLY_CARD = (path: string) => `@toghen contexts ${path};`;

describe('@toghen contexts in a layer', () => {
  it('writes the order statement, a sublayer for the defaults and one per modifier', async () => {
    const out = await run('@layer tokens { @toghen contexts ds.card; }');
    assert.equal(out.css, TOKENS);
  });

  it('writes the plain form outside any layer', async () => {
    const out = await run(ONLY_CARD('ds.card'));
    assert.doesNotMatch(out.css, /@layer/);
    assert.equal(
      out.css,
      ":root { --card-surface: #ffffff; --card-pad: 16px } [data-theme='light'] { --card-surface: #ffffff } [data-theme='dark'] { --card-surface: #1a1a1a } [data-density='regular'] { --card-pad: 16px } [data-density='compact'] { --card-pad: 8px }",
    );
  });

  it('uses the nearest named layer, nested or dotted, and passes over an anonymous one', async () => {
    const nested = await run('@layer outer { @layer tokens { @toghen contexts ds.card; } }');
    assert.equal(
      nested.css,
      `@layer outer { @layer tokens { @layer defaults, theme, density; @layer defaults { :root { --card-surface: #ffffff; --card-pad: 16px } } @layer theme { [data-theme='light'] { --card-surface: #ffffff } [data-theme='dark'] { --card-surface: #1a1a1a } } @layer density { [data-density='regular'] { --card-pad: 16px } [data-density='compact'] { --card-pad: 8px } } } }`,
    );

    const dotted = await run('@layer ds.tokens { @toghen contexts ds.card; }');
    assert.equal(dotted.css, TOKENS.replace('@layer tokens {', '@layer ds.tokens {'));

    const anonymous = await run('@layer tokens { @layer { @toghen contexts ds.card; } }');
    assert.match(anonymous.css, /^@layer tokens \{ @layer \{ @layer defaults, theme, density; @layer defaults \{ :root/);
    const bare = await run('@layer { @toghen contexts ds.card; }');
    assert.doesNotMatch(bare.css, /@layer defaults/);
  });

  it('still names a modifier that varies nothing, and gives it no sublayer', async () => {
    const d = doc({ calm: { default: 'on', contexts: { on: [], off: [] }, ...ATTR('calm') } });
    const out = await run('@layer tokens { @toghen contexts ds.card; }', d);
    assert.match(out.css, /@layer defaults, theme, density, calm;/);
    assert.doesNotMatch(out.css, /@layer calm \{|data-calm/);
  });

  it('refuses a modifier named defaults, in a layer only', async () => {
    const d = doc({ defaults: { default: 'a', contexts: { a: [], b: [] }, ...ATTR('defaults') } });
    await assert.rejects(
      run('@layer tokens { @toghen contexts ds; }', d),
      /Cannot write the contexts of "ds" in a layer: modifier 'defaults' collides with the layer of the defaults\./,
    );
    const out = await run(ONLY_CARD('ds.card'), d);
    assert.match(out.css, /^:root/);
    // reported, not thrown, on warn: the directive stays as written
    const warned = await run('@layer tokens { @toghen contexts ds; }', d, { onUnresolved: 'warn' });
    assert.match(warned.css, /@toghen contexts ds/);
    assert.match(warned.warnings[0], /collides with the layer of the defaults/);
  });

  it('writes the W3C structured shapes: colour, dimension, fontFamily array and shadow', async () => {
    const out = await run('@layer tokens { @toghen contexts ds; }', doc());
    assert.match(out.css, /@layer defaults \{ :root \{[^}]*--face: Inter, sans-serif/);
    assert.match(out.css, /--elevation-raised: 0px 4px 12px 0px #000000/);
    assert.match(out.css, /--card-pad: 16px/);
    assert.match(out.css, /--card-surface: #ffffff/);
    assert.doesNotMatch(out.css, /object Object|toghen\(/);
  });

  it('refuses a second directive in the layer whose order differs, and passes one whose order is the same', async () => {
    const system = new Resolver(doc()).resolveContextsToDesignSystem();
    new Resolver(doc()).resolveContextsToDesignSystem([], system, 'same');
    const reversed = doc();
    reversed.resolutionOrder = [{ $ref: '#/sets/base' }, { $ref: '#/modifiers/density' }, { $ref: '#/modifiers/theme' }];
    new Resolver(reversed).resolveContextsToDesignSystem([], system, 'other');
    const process = async (css: string) => {
      const result = await postcss([toghenPlugin({ system, onUnresolved: 'warn' })]).process(css, { from: undefined });
      return { css: flat(result.css), warnings: result.warnings().map((w) => w.text) };
    };

    const differs = await process('@layer tokens { @toghen contexts ds.card; @toghen contexts other.card; }');
    assert.deepEqual(differs.warnings, [
      `[@toghen/postcss] Cannot write the contexts of "other.card" in layer 'tokens': its order would be "defaults, density, theme", and the layer already has "defaults, theme, density". CSS keeps the first order statement of a layer. Put the collections in different layers, or give them the same modifiers in the same order.`,
    ]);
    assert.equal(differs.css.match(/@layer defaults, /g)!.length, 1);
    assert.match(differs.css, /@toghen contexts other\.card/);

    const same = await process('@layer tokens { @toghen contexts ds.card; @toghen contexts same.card; }');
    assert.deepEqual(same.warnings, []);
    assert.equal(same.css.match(/@layer defaults, theme, density;/g)!.length, 2);

    const apart = await process('@layer a { @toghen contexts ds.card; } @layer b { @toghen contexts other.card; }');
    assert.deepEqual(apart.warnings, []);
  });

  it('writes an at-rule-spelled context inside its modifier sublayer', async () => {
    const d = doc();
    (d.modifiers as any).theme.$extensions = {
      'com.toghen': { css: { contexts: { dark: { atRule: '@media (prefers-color-scheme: dark)' } } } },
    };
    const out = await run('@layer tokens { @toghen contexts ds.card; }', d);
    assert.match(out.css, /@layer theme \{ @media \(prefers-color-scheme: dark\) \{ :root \{ --card-surface: #1a1a1a \} \} \}/);
  });
});

describe('t() reads the same in any layer', () => {
  const read = async (position: string, options: Partial<ToghenPluginOptions> = {}, source = 'ds.card.surface') =>
    (await run(`${position.replace('§', `.a { color: toghen(${source}); }`)}`, doc(), options)).css;

  it('writes var() with the default literal as fallback', async () => {
    assert.equal(await read('@layer components { § }'), '@layer components { .a { color: var(--card-surface, #ffffff) } }');
    assert.equal(
      await read('@layer components { § }', { defaultMode: 'theme=dark' }),
      '@layer components { .a { color: var(--card-surface, #1a1a1a) } }',
    );
  });

  it('does not care where the declaration sits', async () => {
    const reads = '.a { color: var(--card-surface, #ffffff) }';
    for (const position of [
      '@layer tokens { § }',
      '@layer tokens.theme { § }',
      '@layer tokens { @layer theme { § } }',
      '@layer tokens { @layer { § } }',
      '@layer other { § }',
      '@layer { § }',
      '§',
    ]) {
      assert.equal(await read(position), position.replace('§', reads), position);
    }
  });

  it('writes the literal for an explicit mode argument, whatever references says', async () => {
    assert.equal(await read('@layer components { § }', {}, 'ds.card.surface, theme=dark'), '@layer components { .a { color: #1a1a1a } }');
    assert.equal(
      await read('@layer components { § }', { references: 'var' }, 'ds.surface.accent, theme=dark'),
      '@layer components { .a { color: #0000ff } }',
    );
  });

  it('reads the property for a whole token of any structured shape', async () => {
    assert.equal(await read('§', {}, 'ds.card.pad'), '.a { color: var(--card-pad, 16px) }');
    assert.equal(await read('§', {}, 'ds.face'), '.a { color: var(--face, Inter, sans-serif) }');
    assert.equal(await read('§', {}, 'ds.elevation.raised'), '.a { color: var(--elevation-raised, 0px 4px 12px 0px #000000) }');
  });

  it('keeps a member that has no property of its own literal, and reads the property of one that has', async () => {
    assert.equal(await read('§', {}, 'ds.elevation.raised.blur'), '.a { color: 12px }');
    assert.equal(await read('§', {}, 'ds.type.body.fontSize'), '.a { color: var(--type-body-font-size, 1rem) }');
  });

  it('with references: var, writes the reference of the first hop as the fallback', async () => {
    const system = '@layer tokens { @toghen contexts ds.surface; } @layer components { .a { color: toghen(ds.surface.accent); } }';
    const out = await run(system, doc(), { references: 'var' });
    assert.match(out.css, /--surface-accent: var\(--color-blue\)/);
    assert.match(out.css, /\.a \{ color: var\(--surface-accent, var\(--color-blue\)\) \}/);
    const inside = await run('@layer tokens { .a { color: toghen(ds.surface.accent); } }', doc(), { references: 'var' });
    assert.equal(inside.css, '@layer tokens { .a { color: var(--surface-accent, var(--color-blue)) } }');
  });
});
