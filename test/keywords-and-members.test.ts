import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import postcss from 'postcss';
import { Resolver, type ResolverDocument } from '@toghen/lib';
import toghenPlugin, { type ToghenPluginOptions } from '../src/index.js';

const px = (value: number) => ({ value, unit: 'px' });
const srgb = (r: number, g: number, b: number, alpha?: number) => ({
  colorSpace: 'srgb',
  components: [r, g, b],
  ...(alpha === undefined ? {} : { alpha }),
});
const flat = (css: string) => css.replace(/\s+/g, ' ').trim();

// Colour keywords, a text style with an `em` letter spacing and members the format does not name, and
// tokens that only one context defines. Every value in the W3C structured shape.
const doc: ResolverDocument = {
  version: '2025-11-01',
  name: 'ds',
  sets: {
    base: {
      sources: [
        {
          ink: {
            $type: 'color',
            clear: { $value: 'transparent' },
            follow: { $value: 'currentColor' },
            black: { $value: srgb(0, 0, 0) },
            ghost: { $value: srgb(0, 0, 0, 0) },
            ghostRed: { $value: srgb(1, 0, 0, 0) },
            half: { $value: srgb(0, 0, 0, 0.5) },
            viaAlias: { $value: '{ink.follow}' },
          },
          type: {
            $type: 'typography',
            font: {
              $value: {
                fontFamily: ['Inter', 'sans-serif'],
                fontSize: px(12),
                fontWeight: 500,
                lineHeight: 1.5,
                letterSpacing: { value: 0.08, unit: 'em' },
                fontVariantNumeric: 'tabular-nums',
                tabSize: 4,
              },
            },
            word: {
              $value: {
                fontFamily: ['Inter'],
                fontSize: px(12),
                fontWeight: 400,
                lineHeight: 1.5,
                letterSpacing: '0.1em',
                fontFeatureSettings: '"tnum" 1',
                notAProperty: 'x',
              },
            },
          },
          button: { $type: 'color', rest: { $value: srgb(1, 1, 1) }, edge: { $value: srgb(0, 0, 0) } },
        },
      ],
    },
  },
  modifiers: {
    state: {
      default: 'rest',
      contexts: {
        rest: [],
        pressed: [
          {
            button: {
              edge: { $value: srgb(0.2, 0.2, 0.2) },
              pin: { color: { $type: 'color', $value: srgb(1, 0, 0) }, ring: { $type: 'color', $value: '{button.rest}' } },
            },
          },
        ],
      },
      $extensions: { 'com.toghen': { css: { selector: ':{context}', contexts: { pressed: { selector: ':active' } } } } },
    },
  },
  resolutionOrder: [{ $ref: '#/sets/base' }, { $ref: '#/modifiers/state' }],
};

async function run(css: string, options: Partial<ToghenPluginOptions> = {}) {
  const system = new Resolver(doc).resolveContextsToDesignSystem();
  const result = await postcss([toghenPlugin({ system, onUnresolved: 'warn', ...options })]).process(css, { from: undefined });
  return { css: flat(result.css), warnings: result.warnings().map((w) => w.text) };
}

describe('colour keywords', () => {
  it('writes exactly black at alpha 0 as transparent, and currentColor as written', async () => {
    const out = await run(
      'p { color: toghen(ds.ink.clear); background: toghen(ds.ink.follow); border-color: toghen(ds.ink.ghost); outline-color: toghen(ds.ink.viaAlias); }',
    );
    assert.equal(
      out.css,
      'p { color: var(--ink-clear, transparent); background: var(--ink-follow, currentColor); border-color: var(--ink-ghost, transparent); outline-color: var(--ink-via-alias, currentColor); }',
    );
    assert.deepEqual(out.warnings, []);
  });

  it('keeps every other colour a hex: black, translucent black, and a colour at alpha 0', async () => {
    const out = await run('p { color: toghen(ds.ink.black); background: toghen(ds.ink.half); border-color: toghen(ds.ink.ghostRed); }');
    assert.equal(
      out.css,
      'p { color: var(--ink-black, #000000); background: var(--ink-half, #00000080); border-color: var(--ink-ghost-red, #ff000000); }',
    );
  });

  it('declares them as custom properties', async () => {
    const out = await run(':root { @toghen declare ds.ink; }');
    assert.match(out.css, /--ink-clear: transparent; --ink-follow: currentColor; --ink-black: #000000; --ink-ghost: transparent;/);
    assert.doesNotMatch(out.css, /\[object Object\]/);
  });
});

describe("a typography token's further members", () => {
  const MEMBERS = {
    block:
      '--type-font-font-family: Inter, sans-serif; --type-font-font-size: 12px; --type-font-font-weight: 500; --type-font-line-height: 1.5; --type-font-letter-spacing: 0.08em; --type-font-font-variant-numeric: tabular-nums; --type-font-tab-size: 4;',
    font: '--type-font: 500 12px/1.5 Inter, sans-serif; --type-font-letter-spacing: 0.08em; --type-font-font-variant-numeric: tabular-nums; --type-font-tab-size: 4;',
  };

  for (const typography of ['block', 'font'] as const) {
    describe(`under typography: '${typography}'`, () => {
      it('declares each member as a custom property, an em letter spacing as 0.08em', async () => {
        const out = await run(':root { @toghen declare ds.type.font; }', { typography });
        assert.equal(out.css, `:root { ${MEMBERS[typography]} }`);
        assert.deepEqual(out.warnings, []);
      });

      it("writes them as the longhands of the typography token's mixin", async () => {
        const out = await run('@toghen mixins;', { typography });
        const mixin = out.css.match(/@mixin --type-font \{ (.*?) \}/)?.[1];
        // Under 'font' the shorthand carries the four, reading the token's property; under 'block' each has a property.
        const members =
          typography === 'block'
            ? 'font-family: var(--type-font-font-family, Inter, sans-serif); font-size: var(--type-font-font-size, 12px); font-weight: var(--type-font-font-weight, 500); line-height: var(--type-font-line-height, 1.5);'
            : 'font: var(--type-font, 500 12px/1.5 Inter, sans-serif);';
        assert.equal(
          mixin,
          `${members} letter-spacing: var(--type-font-letter-spacing, 0.08em); font-variant-numeric: var(--type-font-font-variant-numeric, tabular-nums); tab-size: var(--type-font-tab-size, 4)`,
        );
        assert.deepEqual(out.warnings, []);
      });

      it('reads a member as a value', async () => {
        const out = await run(
          'p { letter-spacing: toghen(ds.type.word.letterSpacing); font-variant-numeric: toghen(ds.type.font.fontVariantNumeric); }',
          { typography },
        );
        assert.equal(
          out.css,
          'p { letter-spacing: var(--type-word-letter-spacing, 0.1em); font-variant-numeric: var(--type-font-font-variant-numeric, tabular-nums); }',
        );
      });

      it('reports a member that is no property mdn-data knows, and writes it anyway', async () => {
        const declared = await run(':root { @toghen declare ds.type.word; }', { typography });
        assert.match(declared.css, /--type-word-not-a-property: x;/);
        assert.match(declared.css, /--type-word-letter-spacing: 0.1em; --type-word-font-feature-settings: "tnum" 1;/);
        assert.equal(declared.warnings.length, 1);
        assert.match(
          declared.warnings[0],
          /"ds\.type\.word\.notAProperty" is written as "not-a-property", which is not a CSS property mdn-data knows/,
        );

        // the mixin of the token writes it anyway, as the group of a mixin writes only keys that are properties
        const mixin = (await run('@toghen mixins;', { typography })).css.match(/@mixin --type-word \{ (.*?) \}/)?.[1];
        assert.match(mixin!, /not-a-property: var\(--type-word-not-a-property, x\)/);
      });
    });
  }

  it('throws a member that is no property under onUnresolved: throw', async () => {
    await assert.rejects(run(':root { @toghen declare ds.type.word; }', { typography: 'block', onUnresolved: 'throw' }), /not-a-property/);
  });
});

describe('a token defined in one context only', () => {
  it('fails to be read at rest as any missing path does', async () => {
    const out = await run('p { color: toghen(ds.button.pin.color); }');
    assert.equal(out.css, 'p { color: toghen(ds.button.pin.color); }');
    assert.match(out.warnings[0], /Cannot resolve token "ds\.button\.pin\.color"/);
  });
});
