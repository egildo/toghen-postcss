import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { doc, run, warned } from './fixture-composites.js';

const EDGE = '#cccccc';
const FONT_LITERAL = '400 0.875rem/1.25 Inter, sans-serif';

describe('member properties: @toghen declare', () => {
  it("declares, beside a composite's own property, one per member that has a longhand", async () => {
    const out = await run(':root { @toghen declare ds.card.border; }');
    assert.equal(
      out.css,
      `:root { --card-border: 1px solid ${EDGE}; --card-border-color: ${EDGE}; --card-border-width: 1px; --card-border-style: solid }`,
    );
  });

  it('names the member by the property name of the member path', async () => {
    const out = await run(':root { @toghen declare ds.card.borderTop; }');
    assert.match(
      out.css,
      /--card-border-top: 1px solid #1a66e6; --card-border-top-color: #1a66e6; --card-border-top-width: 1px; --card-border-top-style: solid/,
    );
  });

  it("declares a transition's members, the timing function spelled by type", async () => {
    const out = await run(':root { @toghen declare ds.card.transition; }');
    assert.equal(
      out.css,
      ':root { --card-transition: 200ms cubic-bezier(0.4, 0, 0.2, 1) 0ms; --card-transition-duration: 200ms; --card-transition-delay: 0ms; --card-transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1) }',
    );
  });

  it("gives a shadow's members none: there is no longhand to read them", async () => {
    const out = await run(':root { @toghen declare ds.card.boxShadow; }');
    assert.equal(out.css, ':root { --card-box-shadow: 0px 4px 12px 0px #000000 }');
  });

  it('gives a primitive no members', async () => {
    const out = await run(':root { @toghen declare ds.card.pad; }');
    assert.equal(out.css, ':root { --card-pad: 16px }');
  });

  it("declares a typography token's members under typography: block, and no property of its own", async () => {
    const out = await run(':root { @toghen declare ds.type.body; }');
    assert.equal(
      out.css,
      ':root { --type-body-font-family: Inter, sans-serif; --type-body-font-size: 0.875rem; --type-body-font-weight: 400; --type-body-line-height: 1.25 }',
    );
  });

  it('keeps the font shorthand and the members it cannot carry under typography: font', async () => {
    const out = await run(':root { @toghen declare ds.type.body; }', { typography: 'font' });
    assert.equal(out.css, `:root { --type-body: ${FONT_LITERAL} }`);
  });

  it('keeps a member written as a reference as its var() under references: var', async () => {
    const out = await run(':root { @toghen declare ds.card.border; }', { references: 'var' });
    assert.equal(
      out.css,
      ':root { --card-border: 1px solid var(--color-edge); --card-border-color: var(--color-edge); --card-border-width: 1px; --card-border-style: solid }',
    );
  });

  it("declares a context block's members by the same comparison of resolved values", async () => {
    const out = await run(':root { @toghen declare ds.card.border, theme=dark; }');
    assert.equal(out.css, ':root { --card-border: 1px solid #4d4d4d; --card-border-color: #4d4d4d }');
  });

  it("writes the token, not the member, when a member's property name is a token's, and reports it once", async () => {
    const out = await warned(':root { @toghen declare ds.card; }');
    const clash = out.warnings.filter((w) => /--card-border-width/.test(w));
    assert.equal(clash.length, 1);
    assert.match(
      clash[0],
      /"ds.card.border" declares its member "width" as --card-border-width, which is also the property of the token "ds.card.border-width"/,
    );
    assert.equal((out.css.match(/--card-border-width:/g) ?? []).length, 1);
    assert.match(out.css, /--card-border-width: 2px/);
  });
});

describe('member properties: @toghen contexts', () => {
  it('writes a member in the blocks of the modifier that varies it', async () => {
    const out = await warned('@toghen contexts ds.card.border;', {}, doc());
    assert.deepEqual(out.warnings, []);
    assert.match(out.css, /:root \{[^}]*--card-border-color: #cccccc;/);
    assert.match(out.css, /\[data-theme='dark'\] \{[^}]*--card-border: 1px solid #4d4d4d; --card-border-color: #4d4d4d \}/);
    // width does not vary with the theme: only the defaults hold it
    assert.equal((out.css.match(/--card-border-width/g) ?? []).length, 1);
  });

  it("writes a typography token's members in a block that varies them", async () => {
    const out = await run('@toghen contexts ds.type;');
    assert.equal(
      out.css,
      ":root { --type-body-font-family: Inter, sans-serif; --type-body-font-size: 0.875rem; --type-body-font-weight: 400; --type-body-line-height: 1.25 } [data-theme='light'] { --type-body-font-weight: 400 } [data-theme='dark'] { --type-body-font-weight: 700 }",
    );
  });
});

describe('member properties: a plain toghen() read', () => {
  it('reads the property of a declared member, with the literal as the fallback', async () => {
    const out = await run('.a { color: toghen(ds.card.border.color); width: toghen(ds.card.border.width); }');
    assert.equal(out.css, `.a { color: var(--card-border-color, ${EDGE}); width: var(--card-border-width, 1px) }`);
  });

  it("does the same for a typography member under typography: block, and keeps a shadow's members literal", async () => {
    const out = await run('.a { size: toghen(ds.type.body.fontSize); blur: toghen(ds.card.boxShadow.blur); }');
    assert.equal(out.css, '.a { size: var(--type-body-font-size, 0.875rem); blur: 12px }');
  });

  it('writes the literal for an explicit mode, and reads the property wherever the declaration sits', async () => {
    assert.equal((await run('.a { color: toghen(ds.card.border.color, theme=dark); }')).css, '.a { color: #4d4d4d }');
    assert.equal(
      (await run('@layer tokens { .a { color: toghen(ds.card.border.color); } }')).css,
      `@layer tokens { .a { color: var(--card-border-color, ${EDGE}) } }`,
    );
    assert.equal((await run('.a { color: toghen(ds.card.border.color); }')).css, `.a { color: var(--card-border-color, ${EDGE}) }`);
  });
});
