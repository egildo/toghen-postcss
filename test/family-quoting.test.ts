import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import postcss from 'postcss';
import { Resolver, type ResolverDocument } from '@toghen/lib';
import toghenPlugin, { type ToghenPluginOptions } from '../src/index.js';

// A family name is quoted when it has a space, is not one identifier, or is a reserved keyword.
// Synthetic names, in the three shapes a family is written in: a string, an array, a comma string.

const rem = (n: number) => ({ value: n, unit: 'rem' });
const text = (fontFamily: unknown) => ({ fontFamily, fontSize: rem(1), fontWeight: 400, lineHeight: 1.5 });

const doc: ResolverDocument = {
  version: '2025-11-01',
  name: 'ds',
  sets: {
    base: {
      sources: [
        {
          font: {
            $type: 'fontFamily',
            single: { $value: 'Zeta' },
            spaced: { $value: 'Alpha Beta' },
            array: { $value: ['Alpha Beta', 'Zeta', 'sans-serif'] },
            commas: { $value: "Alpha Beta, 'Gamma Delta', Zeta, serif" },
            generics: {
              $value: [
                'serif',
                'sans-serif',
                'monospace',
                'cursive',
                'fantasy',
                'system-ui',
                'ui-serif',
                'ui-sans-serif',
                'ui-monospace',
                'ui-rounded',
                'math',
                'emoji',
                'fangsong',
              ],
            },
            odd: { $value: ['3Dumb', 'Dot.Name', 'Say "Hi"', 'Zeta'] },
            keywords: { $value: ['inherit', 'initial', 'unset', 'revert', 'revert-layer', 'default', 'Zeta'] },
            alias: { $value: '{font.spaced}' },
          },
          text: {
            $type: 'typography',
            spaced: { $value: text('Alpha Beta') },
            list: { $value: text(['Alpha Beta', 'Zeta', 'sans-serif']) },
            plain: { $value: text(['Zeta', 'sans-serif']) },
            ref: { $value: text('{font.array}') },
          },
        },
      ],
    },
  },
  resolutionOrder: [{ $ref: '#/sets/base' }],
};

async function run(css: string, options: Partial<ToghenPluginOptions> = {}) {
  const system = new Resolver(doc).resolveAllToDesignSystem();
  return (await postcss([toghenPlugin({ system, onUnresolved: 'throw', ...options })]).process(css, { from: undefined })).css
    .replace(/\s*\n\s*/g, ' ')
    .trim();
}

const fontFamily = async (path: string) =>
  (await run(`p { font-family: toghen(${path}); }`)).replace(/^p \{ font-family: (.*?);? \}$/, '$1');

describe('a family name is quoted when it has a space', () => {
  it('quotes a name with a space, whatever shape the family is written in', async () => {
    assert.equal(await fontFamily('ds.font.spaced'), 'var(--font-spaced, "Alpha Beta")');
    assert.equal(await fontFamily('ds.font.array'), 'var(--font-array, "Alpha Beta", Zeta, sans-serif)');
    assert.equal(await fontFamily('ds.font.commas'), 'var(--font-commas, "Alpha Beta", "Gamma Delta", Zeta, serif)');
  });

  it('leaves a single identifier and every generic family as it was', async () => {
    assert.equal(await fontFamily('ds.font.single'), 'var(--font-single, Zeta)');
    assert.equal(
      await fontFamily('ds.font.generics'),
      'var(--font-generics, serif, sans-serif, monospace, cursive, fantasy, system-ui, ui-serif, ui-sans-serif, ui-monospace, ui-rounded, math, emoji, fangsong)',
    );
    assert.equal(await fontFamily('ds.text.plain.fontFamily'), 'var(--text-plain-font-family, Zeta, sans-serif)');
  });

  it('quotes a name that is not an identifier, and escapes a double quote in it', async () => {
    assert.equal(await fontFamily('ds.font.odd'), 'var(--font-odd, "3Dumb", "Dot.Name", "Say \\"Hi\\"", Zeta)');
  });

  it('quotes a reserved keyword taken as a whole name', async () => {
    assert.equal(
      await fontFamily('ds.font.keywords'),
      'var(--font-keywords, "inherit", "initial", "unset", "revert", "revert-layer", "default", Zeta)',
    );
  });

  it('spells a reference to a family the same way', async () => {
    assert.equal(await fontFamily('ds.font.alias'), 'var(--font-alias, "Alpha Beta")');
  });
});

describe('the same spelling in every place a family is written', () => {
  it('a typography member read on its own', async () => {
    assert.equal(await fontFamily('ds.text.list.fontFamily'), 'var(--text-list-font-family, "Alpha Beta", Zeta, sans-serif)');
    assert.equal(await fontFamily('ds.text.ref.fontFamily'), 'var(--text-ref-font-family, "Alpha Beta", Zeta, sans-serif)');
  });

  it('the font shorthand, read and declared', async () => {
    assert.equal(
      await run('p { font: toghen(ds.text.list); }', { typography: 'font' }),
      'p { font: var(--text-list, 400 1rem/1.5 "Alpha Beta", Zeta, sans-serif); }',
    );
    assert.equal(
      await run('p { font: toghen(ds.text.plain); }', { typography: 'font' }),
      'p { font: var(--text-plain, 400 1rem/1.5 Zeta, sans-serif); }',
    );
    assert.equal(
      await run(':root { @toghen declare ds.text.spaced; }', { typography: 'font' }),
      ':root { --text-spaced: 400 1rem/1.5 "Alpha Beta"; }',
    );
  });

  it('the longhand a typography mixin writes, and a declared family token', async () => {
    const mixin = (await run('@toghen mixins;')).match(/@mixin --text-list \{ (.*?) \}/)?.[1];
    assert.equal(
      mixin,
      'font-family: var(--text-list-font-family, "Alpha Beta", Zeta, sans-serif); font-size: var(--text-list-font-size, 1rem); font-weight: var(--text-list-font-weight, 400); line-height: var(--text-list-line-height, 1.5)',
    );
    assert.equal(
      await run(':root { @toghen declare ds.font.commas; }'),
      ':root { --font-commas: "Alpha Beta", "Gamma Delta", Zeta, serif; }',
    );
  });

  it('a family kept as a reference stays a var()', async () => {
    assert.equal(
      await run('p { font-family: toghen(ds.font.alias); }', { references: 'var' }),
      'p { font-family: var(--font-alias, var(--font-spaced)); }',
    );
  });
});
