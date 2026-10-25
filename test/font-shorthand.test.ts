import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import postcss from 'postcss';
import { Resolver, type ResolverDocument } from '@toghen/lib';
import toghenPlugin, { type ToghenPluginOptions } from '../src/index.js';

// Text styles in the W3C structured shapes, one of them built from references.
const doc: ResolverDocument = {
  version: '2025-11-01',
  name: 'ds',
  sets: {
    base: {
      sources: [
        {
          font: {
            stack: { $type: 'fontFamily', $value: ['Inter', 'Helvetica Neue', '3Dumb Sans', 'sans-serif'] },
            size: { md: { $type: 'dimension', $value: { value: 1, unit: 'rem' } } },
          },
          text: {
            $type: 'typography',
            body: {
              $value: {
                fontFamily: ['Inter', 'sans-serif'],
                fontSize: { value: 1, unit: 'rem' },
                fontWeight: 400,
                lineHeight: 1.5,
              },
            },
            caption: {
              $value: {
                fontFamily: '{font.stack}',
                fontSize: '{font.size.md}',
                fontWeight: 600,
                fontStyle: 'italic',
                lineHeight: { value: 20, unit: 'px' },
                letterSpacing: { value: 0.5, unit: 'px' },
                textTransform: 'uppercase',
              },
            },
            alias: { $value: '{text.body}' },
          },
        },
      ],
    },
  },
  resolutionOrder: [{ $ref: '#/sets/base' }],
};

async function run(css: string, options: Partial<ToghenPluginOptions> = {}) {
  const system = new Resolver(doc).resolveAllToDesignSystem();
  return (
    await postcss([toghenPlugin({ system, typography: 'font', onUnresolved: 'throw', ...options })]).process(css, { from: undefined })
  ).css;
}

describe("typography: 'font'", () => {
  it('writes a text style as the font shorthand, in its order', async () => {
    assert.equal(await run('p { font: toghen(ds.text.body); }'), 'p { font: var(--text-body, 400 1rem/1.5 Inter, sans-serif); }');
    assert.equal(
      await run('p { font: toghen(ds.text.caption); }'),
      'p { font: var(--text-caption, italic 600 1rem/20px Inter, "Helvetica Neue", "3Dumb Sans", sans-serif); }',
    );
  });

  it('declares the shorthand, and each member it cannot carry beside it', async () => {
    assert.equal(
      await run(':root { @toghen declare ds.text; }'),
      ':root { --text-body: 400 1rem/1.5 Inter, sans-serif; --text-caption: italic 600 1rem/20px Inter, "Helvetica Neue", "3Dumb Sans", sans-serif; --text-caption-letter-spacing: 0.5px; --text-caption-text-transform: uppercase; --text-alias: 400 1rem/1.5 Inter, sans-serif; }',
    );
  });

  it('keeps a referenced member as its var() inside the shorthand', async () => {
    const out = await run(':root { @toghen declare ds.text; }', { references: 'var' });
    assert.match(out, /--text-caption: italic 600 var\(--font-size-md\)\/20px var\(--font-stack\);/);
    assert.match(out, /--text-alias: var\(--text-body\);/);
  });

  it('leaves the default alone: a text style is refused as a value', async () => {
    await assert.rejects(run('p { font: toghen(ds.text.body); }', { typography: 'block' }), /Cannot write token "ds\.text\.body"/);
    // A block has no property of its own, only its members (see "member properties" in test/members.test.ts).
    const declared = await run(':root { @toghen declare ds.text.body; }', { typography: 'block' });
    assert.equal(
      declared,
      ':root { --text-body-font-family: Inter, sans-serif; --text-body-font-size: 1rem; --text-body-font-weight: 400; --text-body-line-height: 1.5; }',
    );
  });
});
