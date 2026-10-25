/**
 * Every DTCG type this adapter writes, in the structured shapes, through each
 * directive. The spelling a type gets is chosen where its shape cannot say it.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import postcss from 'postcss';
import { Resolver, type ResolverDocument } from '@toghen/lib';
import toghenPlugin, { type ToghenPluginOptions } from '../src/index.js';

const ms = (value: number) => ({ value, unit: 'ms' });
const px = (value: number) => ({ value, unit: 'px' });

const doc: ResolverDocument = {
  version: '2025-11-01',
  name: 'ds',
  sets: {
    base: {
      sources: [
        {
          num: { zero: { $type: 'number', $value: 0 } },
          weight: { bold: { $type: 'fontWeight', $value: 700 } },
          color: { line: { $type: 'color', $value: { colorSpace: 'srgb', components: [0, 0, 0], hex: '#000000' } } },
          ease: {
            $type: 'cubicBezier',
            enter: { $value: [0, 0, 0.58, 1] },
            tied: { $value: ['{num.zero}', 0, 0.58, 1] },
            alias: { $value: '{ease.enter}' },
          },
          motion: { fast: { $type: 'duration', $value: ms(200) } },
          stroke: {
            $type: 'strokeStyle',
            plain: { $value: 'dashed' },
            custom: { $value: { dashArray: [px(2), px(4)], lineCap: 'round' } },
          },
          border: { hairline: { $type: 'border', $value: { color: '{color.line}', width: px(1), style: 'solid' } } },
          transition: {
            enter: { $type: 'transition', $value: { duration: '{motion.fast}', delay: ms(0), timingFunction: '{ease.enter}' } },
          },
        },
      ],
    },
  },
  modifiers: {
    motion: {
      default: 'full',
      contexts: { full: [], reduced: [{ motion: { fast: { $value: ms(0) } } }] },
      $extensions: { 'com.toghen': { css: { atRule: '@media (prefers-reduced-motion: reduce)' } } },
    },
  },
  resolutionOrder: [{ $ref: '#/sets/base' }, { $ref: '#/modifiers/motion' }],
};

async function run(css: string, options: Partial<ToghenPluginOptions> = {}) {
  const system = new Resolver(doc).resolveContextsToDesignSystem();
  const result = await postcss([toghenPlugin({ system, onUnresolved: 'throw', ...options })]).process(css, { from: undefined });
  return result.css.replace(/\s+/g, ' ').trim();
}

describe('each DTCG type, written', () => {
  it('as a value, with toghen()', async () => {
    const cases: [string, string][] = [
      ['ds.ease.enter', 'cubic-bezier(0, 0, 0.58, 1)'],
      ['ds.ease.tied', 'cubic-bezier(0, 0, 0.58, 1)'],
      ['ds.ease.alias', 'cubic-bezier(0, 0, 0.58, 1)'],
      ['ds.motion.fast', '200ms'],
      ['ds.num.zero', '0'],
      ['ds.weight.bold', '700'],
      ['ds.stroke.plain', 'dashed'],
      ['ds.border.hairline', '1px solid #000000'],
      ['ds.transition.enter', '200ms cubic-bezier(0, 0, 0.58, 1) 0ms'],
      ['ds.transition.enter.timingFunction', 'cubic-bezier(0, 0, 0.58, 1)'],
    ];
    for (const [path, css] of cases) {
      assert.equal(await run(`a { x: toghen(${path} as value); }`), `a { x: ${css}; }`, path);
    }
  });

  it('keeps references as var() inside a function and a shorthand', async () => {
    const out = await run(':root { @toghen declare ds.ease; @toghen declare ds.border; @toghen declare ds.transition; }', {
      references: 'var',
    });
    assert.match(out, /--ease-tied: cubic-bezier\(var\(--num-zero\), 0, 0\.58, 1\);/);
    assert.match(out, /--ease-alias: var\(--ease-enter\);/);
    assert.match(out, /--border-hairline: 1px solid var\(--color-line\);/);
    assert.match(out, /--transition-enter: var\(--motion-fast\) var\(--ease-enter\) 0ms;/);
  });

  it('refuses a strokeStyle object, which has no CSS spelling', async () => {
    await assert.rejects(run('a { x: toghen(ds.stroke.custom); }'), /Cannot write token "ds\.stroke\.custom"/);
  });

  it('through @toghen contexts, one at-rule for the whole modifier: the default gets no block, and nothing is said', async () => {
    const system = new Resolver(doc).resolveContextsToDesignSystem();
    const result = await postcss([toghenPlugin({ system, onUnresolved: 'warn' })]).process('@toghen contexts ds.motion;', {
      from: undefined,
    });
    assert.equal(
      result.css.replace(/\s+/g, ' ').trim(),
      `:root { --motion-fast: 200ms } @media (prefers-reduced-motion: reduce) { :root { --motion-fast: 0ms } }`,
    );
    assert.deepEqual(result.warnings(), []);
  });

  it('through @toghen contexts, where a context changes a duration', async () => {
    const out = await run('@toghen contexts ds.motion; @toghen contexts ds.ease;');
    assert.equal(
      out,
      `:root { --motion-fast: 200ms } @media (prefers-reduced-motion: reduce) { :root { --motion-fast: 0ms } } :root { --ease-enter: cubic-bezier(0, 0, 0.58, 1); --ease-tied: cubic-bezier(0, 0, 0.58, 1); --ease-alias: cubic-bezier(0, 0, 0.58, 1) }`,
    );
  });
});
