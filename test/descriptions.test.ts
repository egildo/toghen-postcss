import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import postcss from 'postcss';
import { Resolver, type ResolverDocument } from '@toghen/lib';
import toghenPlugin, { type ToghenPluginOptions } from '../src/index.js';

const px = (value: number) => ({ value, unit: 'px' });

const doc: ResolverDocument = {
  version: '2025-11-01',
  name: 'ds',
  sets: {
    base: {
      sources: [
        {
          control: {
            $description: 'Control sizes.',
            $type: 'dimension',
            height: { $value: px(34), $description: '34, not 32: the label needs\ntwo pixels of air on each side.' },
            gap: { $value: px(8), $description: 'Between controls.' },
          },
          ring: { width: { $type: 'dimension', $value: px(2), $description: 'Thin on purpose */ not a typo.' } },
        },
      ],
    },
  },
  modifiers: {
    density: {
      default: 'cosy',
      description: 'How much room controls take.',
      contexts: {
        cosy: [],
        compact: [
          {
            control: {
              $description: 'Control sizes, compact.',
              height: { $value: px(28), $description: '28 keeps a 44px touch target with padding.' },
              gap: { $value: px(4) },
            },
          },
        ],
      },
      $extensions: { 'com.toghen': { css: { selector: '.compact' } } },
    },
  },
  resolutionOrder: [{ $ref: '#/sets/base' }, { $ref: '#/modifiers/density' }],
};

async function run(css: string, options: Partial<ToghenPluginOptions> = {}) {
  const system = new Resolver(doc).resolveContextsToDesignSystem();
  return (
    await postcss([toghenPlugin({ system, onUnresolved: 'throw', descriptions: 'comment', ...options })]).process(css, { from: undefined })
  ).css;
}
const flat = (css: string) => css.replace(/\s+/g, ' ').trim();

describe("descriptions: 'comment'", () => {
  it("writes a group's description above its first declaration, and a token's above its own", async () => {
    assert.equal(
      flat(await run(':root { @toghen declare ds; }')),
      ':root { /* Control sizes. */ /* 34, not 32: the label needs two pixels of air on each side. */ --control-height: 34px; /* Between controls. */ --control-gap: 8px; ' +
        '/* Thin on purpose *\\/ not a typo. */ --ring-width: 2px; }',
    );
  });

  it('keeps line breaks, and escapes */ so the comment cannot close early', async () => {
    const css = await run(':root { @toghen declare ds; }');
    assert.match(css, /\/\* 34, not 32: the label needs\ntwo pixels of air on each side\. \*\//);
    assert.equal(css.match(/\*\//g)!.length, 4, 'one close per comment');
  });

  it("writes only the descriptions a context changes, and the modifier's above its first block", async () => {
    assert.equal(
      flat(await run('@toghen contexts ds;')),
      `:root { /* Control sizes. */ /* 34, not 32: the label needs two pixels of air on each side. */ --control-height: 34px; /* Between controls. */ --control-gap: 8px; /* Thin on purpose *\\/ not a typo. */ --ring-width: 2px } /* How much room controls take. */ .compact { /* Control sizes, compact. */ /* 28 keeps a 44px touch target with padding. */ --control-height: 28px; --control-gap: 4px }`,
    );
  });

  it('writes one selector for the whole modifier once, for the context that is not the default, and says nothing', async () => {
    const system = new Resolver(doc).resolveContextsToDesignSystem();
    const result = await postcss([toghenPlugin({ system, onUnresolved: 'warn' })]).process('@toghen contexts ds.control;', {
      from: undefined,
    });
    assert.equal(
      flat(result.css),
      `:root { --control-height: 34px; --control-gap: 8px } .compact { --control-height: 28px; --control-gap: 4px }`,
    );
    assert.deepEqual(result.warnings(), []);
  });

  it("writes a token's own description, but none for the groups above what is declared", async () => {
    assert.equal(flat(await run('a { @toghen declare ds.control.gap; }')), 'a { /* Between controls. */ --control-gap: 8px; }');
    assert.match(flat(await run('a { @toghen declare ds.control; }')), /^a \{ \/\* Control sizes\. \*\//);
  });

  it('writes no comments when off, the default', async () => {
    assert.doesNotMatch(await run('@toghen contexts ds;', { descriptions: undefined }), /\/\*/);
  });
});
