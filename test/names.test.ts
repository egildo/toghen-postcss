import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import postcss from 'postcss';
import { Resolver, type ResolverDocument } from '@toghen/lib';
import toghenPlugin, { type ToghenPluginOptions } from '../src/index.js';

const px = (value: number) => ({ value, unit: 'px' });
const srgb = (v: number) => ({ colorSpace: 'srgb', components: [v, v, v] });

// Segments spelled the way CSS script spells properties, a capitalised one, and two paths that give one name.
function doc(extra: Record<string, unknown> = {}): ResolverDocument {
  return {
    version: '2025-11-01',
    name: 'ds',
    sets: {
      base: {
        sources: [
          {
            button: {
              backgroundColor: { $type: 'color', $value: srgb(1) },
              paddingBlock: { $type: 'dimension', $value: px(8) },
              'pad-x': { $type: 'dimension', $value: px(1) },
              pad: { x: { $type: 'dimension', $value: px(2) } },
              'background-color': { $type: 'color', $value: srgb(0) },
            },
            Colors: { Primary: { $type: 'color', $value: srgb(0.5) } },
            ...extra,
          },
        ],
      },
    },
    modifiers: {
      theme: {
        default: 'light',
        contexts: { light: [], dark: [{ Colors: { Primary: { $value: srgb(0.2) } } }] },
        $extensions: { 'com.toghen': { css: { selector: "[data-theme='{context}']" } } },
      },
    },
    resolutionOrder: [{ $ref: '#/sets/base' }, { $ref: '#/modifiers/theme' }],
  };
}

const flat = (css: string) => css.replace(/\s+/g, ' ').replace(/;\s*}/g, ' }').trim();

async function run(input: string, options: Partial<ToghenPluginOptions> = {}, document = doc()) {
  const system = new Resolver(document).resolveContextsToDesignSystem();
  const result = await postcss([toghenPlugin({ system, onUnresolved: 'throw', ...options })]).process(input, { from: undefined });
  return { css: flat(result.css), warnings: result.warnings().map((w) => w.text) };
}

describe('custom property names', () => {
  it('spell each segment by the CSSOM rule, in declare and in a var()', async () => {
    const out = await run('a { @toghen declare ds.Colors; b: toghen(ds.button.paddingBlock); c: toghen(ds.Colors.Primary) }');
    assert.equal(
      out.css,
      'a { --primary: #808080; b: var(--button-padding-block, 8px); c: var(--colors-primary, #808080) }'.replace(
        '--primary',
        '--colors-primary',
      ),
    );
  });

  it('write var() references by the same names', async () => {
    const out = await run(
      'a { @toghen declare ds.refs; }',
      { references: 'var' },
      doc({ refs: { tone: { $type: 'color', $value: '{button.backgroundColor}' } } }),
    );
    assert.equal(out.css, 'a { --refs-tone: var(--button-background-color) }');
  });
});

describe('two token paths with one custom property name', () => {
  it('are reported by declare, naming both paths and the name, and both are written', async () => {
    const out = await run('a { @toghen declare ds.button; }', { onUnresolved: 'warn' });
    assert.equal(
      out.css,
      'a { --button-background-color: #ffffff; --button-padding-block: 8px; --button-pad-x: 1px; --button-pad-x: 2px; --button-background-color: #000000 }',
    );
    assert.equal(out.warnings.length, 2);
    assert.equal(
      out.warnings[0],
      '[@toghen/postcss] "ds.button.backgroundColor" and "ds.button.background-color" are both written as --button-background-color, and the later declaration wins. Rename one of them, or give propertyName an injective rule.',
    );
    assert.match(out.warnings[1], /"ds.button.pad-x" and "ds.button.pad.x" are both written as --button-pad-x/);
  });

  it('stop the build under throw', async () => {
    await assert.rejects(run('a { @toghen declare ds.button; }'), /are both written as --button-background-color/);
  });

  it('are reported by contexts, once per name, though a block repeats the names', async () => {
    const out = await run('@toghen contexts ds;', { onUnresolved: 'warn' });
    assert.equal(out.warnings.length, 2);
    assert.match(out.css, /\[data-theme='dark'\] \{ --colors-primary: #333333 \}/);
  });

  it('are not reported for the same path repeated in a context block', async () => {
    const out = await run('@toghen contexts ds.Colors;', { onUnresolved: 'warn' });
    assert.deepEqual(out.warnings, []);
  });

  it('are checked on whatever a custom propertyName returns', async () => {
    const one = await run('a { @toghen declare ds.button; }', { onUnresolved: 'warn', propertyName: (p) => `--${p.split('.').length}` });
    assert.ok(one.warnings.some((w) => /are both written as --3/.test(w)));
  });

  it('are not reported across two directives', async () => {
    const out = await run('a { @toghen declare ds.button.pad; } b { @toghen declare ds.button.pad; }', { onUnresolved: 'warn' });
    assert.deepEqual(out.warnings, []);
  });
});
