import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import postcss from 'postcss';
import { Resolver, type ResolverDocument } from '@toghen/lib';
import toghenPlugin, { type ToghenPluginOptions } from '../src/index.js';

const px = (value: number) => ({ value, unit: 'px' });
const srgb = (v: number) => ({ colorSpace: 'srgb', components: [v, v, v] });
const ATTR = (name: string) => ({ $extensions: { 'com.toghen': { css: { selector: `[data-${name}='{context}']` } } } });

// `card.surface` varies with theme; `card.pad` with density. Structured shapes throughout.
function doc(): ResolverDocument {
  return {
    version: '2025-11-01',
    name: 'ds',
    sets: {
      base: {
        sources: [
          {
            card: {
              surface: { $type: 'color', $value: srgb(1) },
              pad: { $type: 'dimension', $value: px(16) },
              face: { $type: 'fontFamily', $value: ['Inter', 'sans-serif'] },
              title: {
                $type: 'typography',
                $value: { fontFamily: ['Inter', 'sans-serif'], fontSize: { value: 1, unit: 'rem' }, fontWeight: 400, lineHeight: 1.5 },
              },
            },
          },
        ],
      },
    },
    modifiers: {
      theme: { default: 'light', contexts: { light: [], dark: [{ card: { surface: { $value: srgb(26 / 255) } } }] }, ...ATTR('theme') },
    },
    resolutionOrder: [{ $ref: '#/sets/base' }, { $ref: '#/modifiers/theme' }],
  };
}

const flat = (css: string) => css.replace(/\s+/g, ' ').replace(/;\s*}/g, ' }').trim();

async function run(input: string, options: Partial<ToghenPluginOptions> = {}) {
  const system = new Resolver(doc()).resolveContextsToDesignSystem();
  const result = await postcss([toghenPlugin({ system, onUnresolved: 'throw', ...options })]).process(input, { from: undefined });
  return { css: flat(result.css), warnings: result.warnings().map((w) => w.text) };
}

describe('t() is toghen()', () => {
  it('reads a token, with or without a mode', async () => {
    assert.equal(
      (await run('a { padding: t(ds.card.pad); color: t(ds.card.surface, dark); }')).css,
      'a { padding: var(--card-pad, 16px); color: #1a1a1a }',
    );
  });

  it('stands wherever a function name can start', async () => {
    const out = await run(
      'a { margin: t(ds.card.pad) t(ds.card.pad); padding: calc(t(ds.card.pad)*2); font: 1rem/t(ds.card.pad); gap: min(1px,t(ds.card.pad)); width: calc(1px + t(ds.card.pad)); }',
    );
    assert.equal(
      out.css,
      'a { margin: var(--card-pad, 16px) var(--card-pad, 16px); padding: calc(var(--card-pad, 16px)*2); font: 1rem/var(--card-pad, 16px); gap: min(1px,var(--card-pad, 16px)); width: calc(1px + var(--card-pad, 16px)) }',
    );
  });

  it('is matched as a whole name: a CSS function ending in t( is left alone', async () => {
    const css =
      'a { clip-path: inset(0 1px); clip: rect(0, 1px, 2px, 0); grid-template-columns: repeat(2, 1fr); src: format("woff"); width: --x-t(1); height: my_t(1); top: h2t(1) }';
    assert.equal((await run(css)).css, css.replace(/\s+/g, ' ').replace(/;\s*}/g, ' }'));
  });

  it('applies the same boundary to toghen(', async () => {
    const css = 'a { width: my-toghen(ds.card.pad); height: xtoghen(ds.card.pad) }';
    assert.equal((await run(css)).css, 'a { width: my-toghen(ds.card.pad); height: xtoghen(ds.card.pad) }');
  });

  it('fails like toghen() does, and leaves the call as written', async () => {
    const out = await run('a { color: t(ds.card.nope) }', { onUnresolved: 'warn' });
    assert.equal(out.css, 'a { color: t(ds.card.nope) }');
    assert.equal(out.warnings.length, 1);
    assert.match(out.warnings[0], /Cannot resolve token "ds.card.nope"/);
  });
});

describe('@t is @toghen', () => {
  it('writes the mixins', async () => {
    assert.match(
      (await run('@t mixins;')).css,
      /@mixin --card-title \{ font-family: var\(--card-title-font-family, Inter, sans-serif\); font-size: var\(--card-title-font-size, 1rem\)/,
    );
  });

  it('declares and writes contexts', async () => {
    assert.equal((await run('a { @t declare ds.card.pad; }')).css, 'a { --card-pad: 16px }');
    assert.match(
      (await run('@t contexts ds;')).css,
      /^:root \{ --card-surface: #ffffff;.*\} \[data-theme='dark'\] \{ --card-surface: #1a1a1a \}$/,
    );
  });
});
