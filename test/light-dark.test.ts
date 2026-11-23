import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import postcss from 'postcss';
import postcssMixins from '@csstools/postcss-mixins';
import { Resolver, type ResolverDocument } from '@toghen/lib';
import toghenPlugin, { type ToghenPluginOptions } from '../src/index.js';

const px = (value: number) => ({ value, unit: 'px' });
const srgb = (v: number) => {
  const byte = Math.round(v * 255)
    .toString(16)
    .padStart(2, '0');
  return { colorSpace: 'srgb', components: [v, v, v], hex: `#${byte}${byte}${byte}` };
};

const PAIR = { lightDark: { light: 'day', dark: 'night' } };
const DENSITY = { selector: "[data-density='{context}']" };
const ext = (css: Record<string, unknown>) => ({ $extensions: { 'com.toghen': { css } } });

// `theme` is a pair written with light-dark() (contexts day / night, so the names are read from the field);
// `density` is spelled by attribute. `tweak` adds to the night context, `compact` to density's, `extra` to the base.
function doc(
  tweak: Record<string, unknown> = {},
  compact: Record<string, unknown> = { space: { gap: { $value: px(4) } } },
  extra: Record<string, unknown> = {},
): ResolverDocument {
  return {
    version: '2025-11-01',
    name: 'ds',
    sets: {
      base: {
        sources: [
          {
            color: {
              $type: 'color',
              bg: { $value: srgb(1) },
              line: { $value: srgb(0.8) },
              same: { $value: srgb(0.5) },
              surface: { $value: '{color.bg}' },
            },
            space: { $type: 'dimension', gap: { $value: px(8) } },
            shadow: {
              raised: {
                $type: 'shadow',
                $value: { color: '{color.bg}', offsetX: px(0), offsetY: px(2), blur: px(4), spread: px(0) },
              },
            },
            ...extra,
          },
        ],
      },
    },
    modifiers: {
      theme: {
        default: 'day',
        description: 'Which scheme.',
        contexts: {
          day: [],
          night: [{ color: { bg: { $value: srgb(0) }, line: { $value: srgb(0.2) }, surface: { $value: '{color.line}' } }, ...tweak }],
        },
        ...ext(PAIR),
      },
      density: { default: 'cosy', contexts: { cosy: [], compact: [compact] }, ...ext(DENSITY) },
    },
    resolutionOrder: [{ $ref: '#/sets/base' }, { $ref: '#/modifiers/theme' }, { $ref: '#/modifiers/density' }],
  };
}

async function run(css: string, document: ResolverDocument, options: Partial<ToghenPluginOptions> = {}, mixins = false) {
  const system = new Resolver(document).resolveContextsToDesignSystem();
  const plugins = [toghenPlugin({ system, onUnresolved: 'throw', ...options }), ...(mixins ? [postcssMixins()] : [])];
  const result = await postcss(plugins).process(css, { from: undefined });
  const out = result.css.replace(/\s+/g, ' ').trim();
  assert.doesNotMatch(out, /\[object Object\]|toghen\(/);
  return out;
}

describe('a modifier written with light-dark()', () => {
  it('puts the pair in the defaults, and writes no block for the modifier', async () => {
    const out = await run('@toghen contexts ds.color;', doc());
    // `same` does not differ: a plain value. No @media, and no block for `theme`.
    assert.equal(
      out,
      ':root { --color-bg: light-dark(#ffffff, #000000); --color-line: light-dark(#cccccc, #333333); --color-same: #808080; --color-surface: light-dark(#ffffff, #333333) }',
    );
  });

  it('writes the other modifier as it always did', async () => {
    const out = await run('@toghen contexts ds.space;', doc());
    assert.equal(
      out,
      ":root { --space-gap: 8px } [data-density='cosy'] { --space-gap: 8px } [data-density='compact'] { --space-gap: 4px }",
    );
  });

  it("under references: 'var', each side is what a block would have written", async () => {
    const out = await run('@toghen contexts ds.color;', doc(), { references: 'var' });
    assert.equal(
      out,
      ':root { --color-bg: light-dark(#ffffff, #000000); --color-line: light-dark(#cccccc, #333333); --color-same: #808080; --color-surface: light-dark(var(--color-bg), var(--color-line)) }',
    );
  });

  it("needs no pair for a shadow that only reads a themed colour under references: 'var'", async () => {
    const out = await run('@toghen contexts ds.shadow;', doc(), { references: 'var' });
    assert.doesNotMatch(out, /light-dark/);
    assert.match(out, /--shadow-raised: 0px 2px 4px 0px var\(--color-bg\)/);
  });

  it("refuses a shadow that holds the themed colour resolved, under references: 'resolve'", async () => {
    await assert.rejects(
      run('@toghen contexts ds.shadow;', doc(), { references: 'resolve' }),
      /Cannot write modifier 'theme' with light-dark\(\): 'ds.shadow.raised' is a shadow, and light-dark\(\) takes only colours\. Write the modifier with a selector or an at-rule, or vary only colours in it\./,
    );
  });

  it('refuses a dimension the theme varies', async () => {
    await assert.rejects(
      run('@toghen contexts ds.space;', doc({ space: { gap: { $value: px(6) } } })),
      /Cannot write modifier 'theme' with light-dark\(\): 'ds.space.gap' is a dimension, and light-dark\(\) takes only colours\./,
    );
  });

  it('names the type of the token a member belongs to, when it refuses the member', async () => {
    const text = (fontWeight: number) => ({ fontFamily: ['Inter', 'sans-serif'], fontSize: px(14), fontWeight, lineHeight: 1.25 });
    const bold = doc({ type: { body: { $value: text(700) } } }, undefined, { type: { body: { $type: 'typography', $value: text(400) } } });
    await assert.rejects(
      run('@toghen contexts ds.type;', bold),
      /Cannot write modifier 'theme' with light-dark\(\): 'ds\.type\.body\.fontWeight' is a typography member, and light-dark\(\) takes only colours\./,
    );
  });

  it('writes nothing for the modifier when the error is only a warning', async () => {
    const out = await run('@toghen contexts ds.space;', doc({ space: { gap: { $value: px(6) } } }), { onUnresolved: 'ignore' });
    assert.doesNotMatch(out, /light-dark/);
  });

  it('reports a token with a value on the dark side only, which no pair can hold, and writes the other pairs', async () => {
    const glow = doc({ accent: { glow: { $type: 'color', $value: srgb(0.4) } } });
    await assert.rejects(
      run('@toghen contexts ds;', glow, { references: 'var' }),
      /Cannot write 'ds\.accent\.glow' with light-dark\(\) for modifier 'theme': it has a value in context 'night' only, and light-dark\(\) takes one for each side\. Give it a value in 'day' too, or write the modifier with a selector or an at-rule\./,
    );
    const out = await run('@toghen contexts ds;', glow, { references: 'var', onUnresolved: 'ignore' });
    assert.match(out, /--color-bg: light-dark\(#ffffff, #000000\)/);
    assert.doesNotMatch(out, /--accent-glow/);
  });

  it('refuses a colour another modifier varies too, naming both and the token', async () => {
    await assert.rejects(
      run('@toghen contexts ds.color;', doc({}, { color: { line: { $value: srgb(0.1) } } })),
      /Cannot write modifier 'density' beside 'theme': both vary 'ds.color.line', and the block of 'density' would replace the light-dark\(\) pair of 'theme' with a plain value\./,
    );
  });

  it("refuses bind: 'chain'", async () => {
    await assert.rejects(
      run('@toghen contexts ds.color;', doc(), { bind: 'chain' }),
      /Cannot chain modifier 'theme': it is written with light-dark\(\), which has no blocks to chain\. Leave out bind: 'chain', or spell the modifier with a selector or an at-rule\./,
    );
  });

  it('keeps the modifier in the layer order and writes no sublayer for it', async () => {
    const out = await run('@layer tokens { @toghen contexts ds.color; }', doc());
    assert.match(out, /@layer defaults, theme, density;/);
    assert.doesNotMatch(out, /@layer theme \{/);
    assert.match(out, /@layer defaults \{ :root \{ --color-bg: light-dark\(#ffffff, #000000\)/);
  });

  it('leaves the pair out of the mixins, with a comment saying so, and keeps the other modifier', async () => {
    const out = await run('@toghen mixins;', doc());
    assert.doesNotMatch(out, /@mixin --when-theme/);
    assert.match(
      out,
      /--when-theme-day is left out: modifier 'theme' is written with light-dark\(\); set color-scheme on the element instead\./,
    );
    assert.match(out, /--when-theme-night is left out/);
    assert.match(out, /@mixin --when-density-compact/);
  });

  it('leaves the pair out of the spellings, with a comment each', async () => {
    const out = await run('@toghen spellings;', doc());
    assert.doesNotMatch(out, /@custom-selector :--theme/);
    assert.match(out, /:--theme-day and --theme-day are left out: modifier 'theme' is written with light-dark\(\)/);
    assert.match(out, /:--theme-night and --theme-night are left out/);
    assert.match(out, /@custom-selector :--density-compact/);
  });

  it('registers no paired colour, so color-scheme on a subtree still switches it, and registers a plain one', async () => {
    // A property registered as <color> computes light-dark() where it is declared, and a descendant inherits that one colour.
    const out = await run('@toghen contexts ds.color;', doc(), { registerProperties: true });
    assert.doesNotMatch(out, /@property --color-(?:bg|line|surface) /);
    assert.match(out, /--color-bg: light-dark\(#ffffff, #000000\)/);
    assert.match(out, /@property --color-same \{ syntax: '<color>'; inherits: true; initial-value: #808080 \}/);
  });

  it('writes the modifier description before the first pair under descriptions: comment', async () => {
    const out = await run('@toghen contexts ds.color;', doc(), { descriptions: 'comment' });
    assert.match(out, /:root \{ \/\* Which scheme\. \*\/ --color-bg: light-dark/);
  });
});
