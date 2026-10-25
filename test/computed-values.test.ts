/**
 * Values the core computes (lib's read gate, 24 October 2026), written as CSS. Under `references: 'resolve'`
 * a value written with a reference is written as the core computes it; under `'var'` the string as authored,
 * with each reference a `var()`. A colour is hex in sRGB and its own function outside it (ruling 4b).
 * See https://codeberg.org/Toghen/lib/src/branch/main/reference.md#token-values. Every token is synthetic, in the W3C structured shapes.
 */

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import postcss from 'postcss';
import { Resolver, type ResolverDocument } from '@toghen/lib';
import toghenPlugin, { type ToghenPluginOptions } from '../src/index.js';

const px = (value: number) => ({ value, unit: 'px' });
const mix = 'color-mix(in srgb, {ink} 5%, transparent)';

const doc: ResolverDocument = {
  version: '2025-11-01',
  name: 'ds',
  sets: {
    base: {
      sources: [
        {
          ink: { $type: 'color', $value: { colorSpace: 'srgb', components: [0.07, 0.13, 0.2] } },
          haze: { $type: 'color', $value: mix },
          hue: {
            $type: 'color',
            calm: { $value: { colorSpace: 'oklch', components: [0.7, 0.1, 200] } },
            vivid: { $value: { colorSpace: 'oklch', components: [0.7, 0.35, 30] } },
            veil: { $value: { colorSpace: 'oklch', components: [0.7, 0.35, 30], alpha: 0.5 } },
            muted: { $value: { colorSpace: 'display-p3', components: [0.5, 0.5, 0.5] } },
            wide: { $value: { colorSpace: 'display-p3', components: [1, 0, 0] } },
          },
          space: {
            $type: 'dimension',
            md: { $value: { value: 1, unit: 'rem' } },
            lg: { $value: 'calc({space.md} * 2)' },
            pair: { $value: '{space.md} {space.md}' },
          },
          lift: { $type: 'shadow', $value: { color: mix, offsetX: px(0), offsetY: px(2), blur: px(4) } },
          text: {
            $type: 'typography',
            $value: {
              fontFamily: ['Synthetic Sans', 'sans-serif'],
              fontSize: { value: 1, unit: 'rem' },
              fontWeight: 'bold',
              lineHeight: 1.5,
            },
          },
          area: { $value: '[{{start}}] {space.md}' },
        },
      ],
    },
  },
  resolutionOrder: [{ $ref: '#/sets/base' }],
};

const outputs: string[] = [];

async function run(css: string, options: Partial<ToghenPluginOptions> = {}, document = doc) {
  const system = new Resolver(document).resolveContextsToDesignSystem();
  const result = await postcss([toghenPlugin({ system, onUnresolved: 'throw', ...options })]).process(css, { from: undefined });
  outputs.push(result.css);
  return { css: result.css.replace(/\s+/g, ' ').trim(), warnings: result.warnings().map((w) => w.text) };
}
/** The value `t(path)` writes: the fallback of its `var()`, or the literal where the path has no property of its own (a member). */
async function value(path: string, options: Partial<ToghenPluginOptions> = {}) {
  const x = (await run(`a { x: t(${path}) }`, options)).css.slice('a { x: '.length, -' }'.length);
  return x.match(/^var\(--[\w-]+, (.*)\)$/)?.[1] ?? x;
}

describe('values the core computes, written', () => {
  it("writes a color-mix() colour computed under 'resolve', as authored with var() under 'var'", async () => {
    assert.equal(await value('ds.haze'), '#1221330d');
    assert.equal(await value('ds.haze', { references: 'var' }), 'color-mix(in srgb, var(--ink) 5%, transparent)');
  });

  it('writes a colour in sRGB as hex, and one outside it as its own CSS function', async () => {
    assert.equal(await value('ds.hue.calm'), '#40b1b7');
    assert.equal(await value('ds.hue.muted'), '#808080');
    assert.equal(await value('ds.hue.vivid'), 'oklch(0.7 0.35 30)');
    assert.equal(await value('ds.hue.veil'), 'oklch(0.7 0.35 30 / 0.5)');
    assert.equal(await value('ds.hue.wide'), 'color(display-p3 1 0 0)');
  });

  it('writes a calc() length as its computed length, and as authored under var', async () => {
    assert.equal(await value('ds.space.lg'), '2rem');
    assert.equal(await value('ds.space.lg', { references: 'var' }), 'calc(var(--space-md) * 2)');
  });

  it('writes a shadow whose colour mixes a reference, whole and by its member', async () => {
    assert.equal(await value('ds.lift'), '0px 2px 4px #1221330d');
    assert.equal(await value('ds.lift.color'), '#1221330d');
    assert.equal(await value('ds.lift', { references: 'var' }), '0px 2px 4px color-mix(in srgb, var(--ink) 5%, transparent)');
    assert.equal(await value('ds.lift.color', { references: 'var' }), 'color-mix(in srgb, var(--ink) 5%, transparent)');
  });

  it('writes a typography fontWeight keyword as its number', async () => {
    assert.equal(await value('ds.text.fontWeight'), '700');
    assert.equal(await value('ds.text', { typography: 'font' }), '700 1rem/1.5 "Synthetic Sans", sans-serif');
  });

  it('writes an authored doubled brace as the literal brace, in either setting', async () => {
    assert.equal(await value('ds.area'), '[{start}] 1rem');
    assert.equal(await value('ds.area', { references: 'var' }), '[{start}] var(--space-md)');
  });

  it("writes an authored doubled brace as the literal brace in a chain's links", async () => {
    const modifier = (name: string, def: string, other: string, area: string) => ({
      default: def,
      contexts: { [def]: [], [other]: [{ area: { $value: area } }] },
      $extensions: { 'com.toghen': { css: { selector: `[data-${name}='{context}']` } } },
    });
    const chained = {
      version: '2025-11-01',
      name: 'ds',
      sets: { base: { sources: [{ gap: { $type: 'dimension', $value: px(4) }, area: { $value: '{{a}} {gap}' } }] } },
      modifiers: {
        scheme: modifier('scheme', 'light', 'dark', '{{b}} {gap}'),
        tone: modifier('tone', 'neutral', 'primary', '{{c}} {gap}'),
      },
      resolutionOrder: [{ $ref: '#/sets/base' }, { $ref: '#/modifiers/scheme' }, { $ref: '#/modifiers/tone' }],
    } as ResolverDocument;
    const { css } = await run('@toghen contexts ds;', { references: 'var', bind: 'chain' }, chained);
    assert.match(css, /--area: var\(--area--tone, var\(--area--scheme, \{a\} var\(--gap\)\)\)/);
    assert.match(css, /\{b\} var\(--gap\)/);
    assert.match(css, /\{c\} var\(--gap\)/);
    assert.doesNotMatch(css, /\{\{/);
  });

  it('leaves a token the core cannot compute as written, with its sentence', async () => {
    for (const references of ['resolve', 'var'] as const) {
      const { css, warnings } = await run('a { padding: t(ds.space.pair) }', { onUnresolved: 'warn', references });
      assert.equal(css, 'a { padding: t(ds.space.pair) }');
      assert.equal(warnings.length, 1);
      assert.match(
        warnings[0],
        /Token "ds\.space\.pair" \(mode "default"\): '1rem 1rem' cannot be computed: it is a list of values, not one dimension; leave the token untyped/,
      );
    }
  });

  after(() => {
    for (const css of outputs) {
      assert.doesNotMatch(css, /\[object Object\]/);
      assert.doesNotMatch(css, /#0000000000/);
      if (!css.includes('t(ds.space.pair)')) assert.doesNotMatch(css, /(?<![\w-])(?:toghen|t)\(/);
    }
  });
});
