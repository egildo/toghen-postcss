import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import postcss from 'postcss';
import { Resolver, type ResolverDocument } from '@toghen/lib';
import toghenPlugin, { type ToghenPluginOptions } from '../src/index.js';

// A read's fallback follows `references`: the literal under 'resolve', the first hop as a var() under 'var'.
const px = (value: number) => ({ value, unit: 'px' });
const srgb = (r: number, g: number, b: number) => ({ colorSpace: 'srgb', components: [r, g, b] });
const ORANGE = srgb(0.98, 0.91, 0.85); // #fae8d9
const INK = srgb(0.1, 0.1, 0.1); // #1a1a1a

function doc(): ResolverDocument {
  return {
    version: '2025-11-01',
    name: 'ds',
    sets: {
      base: {
        sources: [
          {
            prism: { orange: { 100: { $type: 'color', $value: ORANGE } } },
            hue: { marigold: { soft: { bg: { $type: 'color', $value: '{prism.orange.100}' }, ink: { $type: 'color', $value: INK } } } },
            card: {
              background: { $type: 'color', $value: '{hue.marigold.soft.bg}' },
              color: { $type: 'color', $value: INK },
              paddingBlock: { $type: 'dimension', $value: px(8) },
              boxShadow: {
                $type: 'shadow',
                $value: { color: '{hue.marigold.soft.ink}', offsetX: px(0), offsetY: px(2), blur: px(4), spread: px(0) },
              },
            },
          },
        ],
      },
    },
    modifiers: {},
    resolutionOrder: [{ $ref: '#/sets/base' }],
  };
}

async function run(css: string, options: Partial<ToghenPluginOptions> = {}) {
  const system = new Resolver(doc()).resolveContextsToDesignSystem();
  return (await postcss([toghenPlugin({ system, ...options })]).process(css, { from: undefined })).css.replace(/\s+/g, ' ').trim();
}

describe('the fallback of a read follows references', () => {
  it('is the literal under resolve, as before', async () => {
    assert.equal(
      await run('a { color: t(hue.marigold.soft.bg); }', { references: 'resolve' }),
      'a { color: var(--hue-marigold-soft-bg, #fae8d9); }',
    );
  });

  it('is the reference as a var() of its first hop under var, not the whole chain', async () => {
    const css = await run('a { color: t(hue.marigold.soft.bg); background: t(card.background); }', { references: 'var' });
    assert.equal(
      css,
      'a { color: var(--hue-marigold-soft-bg, var(--prism-orange-100)); background: var(--card-background, var(--hue-marigold-soft-bg)); }',
    );
  });

  it('is the literal where the token is no reference, under either setting', async () => {
    for (const references of ['resolve', 'var'] as const) {
      assert.equal(
        await run('a { color: t(hue.marigold.soft.ink); }', { references }),
        'a { color: var(--hue-marigold-soft-ink, #1a1a1a); }',
      );
    }
  });

  it('reaches the body of a mixin, so a group only read, never declared, keeps its palette step', async () => {
    const css = await run('@toghen mixins;', { references: 'var' });
    assert.match(
      css,
      /@mixin --card \{[^}]*background: var\(--card-background, var\(--hue-marigold-soft-bg\)\);[^}]*color: var\(--card-color, #1a1a1a\);[^}]*padding-block: var\(--card-padding-block, 8px\)/,
    );
    const resolved = await run('@toghen mixins;', { references: 'resolve' });
    assert.match(resolved, /background: var\(--card-background, #fae8d9\)/);
  });

  it('writes a reference inside a shadow, in the structured shape', async () => {
    assert.equal(
      await run('a { box-shadow: t(card.boxShadow); }', { references: 'var' }),
      'a { box-shadow: var(--card-box-shadow, 0px 2px 4px 0px var(--hue-marigold-soft-ink)); }',
    );
  });
});
