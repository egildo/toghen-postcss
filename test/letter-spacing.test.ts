/**
 * A letterSpacing token, written where a dimension is: as authored, `em` kept.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import postcss from 'postcss';
import { Resolver, type ResolverDocument } from '@toghen/lib';
import toghenPlugin, { type ToghenPluginOptions } from '../src/index.js';

const doc: ResolverDocument = {
  version: '2025-11-01',
  name: 'ds',
  sets: {
    base: {
      sources: [
        {
          track: {
            $type: 'letterSpacing',
            tight: { $value: '-0.021em' },
            wide: { $value: { value: 0.08, unit: 'em' } },
            fixed: { $value: { value: 1, unit: 'px' } },
            roomy: { $value: { value: 0.05, unit: 'rem' } },
            alias: { $value: '{track.wide}' },
          },
          label: {
            $type: 'typography',
            $value: {
              fontFamily: ['Inter'],
              fontSize: { value: 12, unit: 'px' },
              fontWeight: 500,
              lineHeight: 1.5,
              letterSpacing: '{track.wide}',
            },
          },
        },
      ],
    },
  },
  resolutionOrder: [{ $ref: '#/sets/base' }],
};

async function run(css: string, options: Partial<ToghenPluginOptions> = {}) {
  const system = new Resolver(doc).resolveContextsToDesignSystem();
  const result = await postcss([toghenPlugin({ system, onUnresolved: 'throw', ...options })]).process(css, { from: undefined });
  return result.css.replace(/\s+/g, ' ').trim();
}

describe('a letterSpacing token, written', () => {
  it('with toghen(), as authored: em kept, from a string or the structured form', async () => {
    const cases: [string, string][] = [
      ['ds.track.tight', '-0.021em'],
      ['ds.track.wide', '0.08em'],
      ['ds.track.fixed', '1px'],
      ['ds.track.roomy', '0.05rem'],
      ['ds.track.alias', '0.08em'],
      ['ds.label.letterSpacing', '0.08em'],
    ];
    for (const [path, css] of cases) {
      assert.equal(await run(`a { x: toghen(${path} as value); }`), `a { x: ${css}; }`, path);
    }
  });

  it('with @toghen declare, as a custom property, leaking nothing unresolved', async () => {
    const out = await run(':root { @toghen declare ds.track; }');
    assert.match(out, /--track-tight: -0\.021em;/);
    assert.match(out, /--track-wide: 0\.08em;/);
    assert.match(out, /--track-fixed: 1px;/);
    assert.doesNotMatch(out, /object Object|toghen\(/);
  });
});
