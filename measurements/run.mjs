import { chromium, webkit, firefox } from 'playwright-core';
import path from 'node:path';
const dir = path.resolve('.');
async function probe(page, f, items) {
  await page.goto(`file://${dir}/${f}`);
  return page.evaluate(
    (items) =>
      items.map(([sel, ps, vs]) => {
        const e = document.querySelector(sel);
        const cs = getComputedStyle(e);
        const o = { [sel]: {} };
        for (const p of ps) o[sel][p] = cs[p];
        for (const v of vs || []) o[sel][v] = cs.getPropertyValue(v);
        return o;
      }),
    items,
  );
}
const engines = { chromium, webkit, firefox };
for (const [name, eng] of Object.entries(engines)) {
  let b;
  try {
    b = await eng.launch();
  } catch (e) {
    console.log(name, 'UNAVAILABLE', e.message.split('\n')[0]);
    continue;
  }
  console.log('==', name, b.version());
  for (const scheme of ['light', 'dark']) {
    const ctx = await b.newContext({ colorScheme: scheme });
    const page = await ctx.newPage();
    console.log('-- scheme', scheme);
    const J = (x) => console.log(JSON.stringify(x));
    J(['c1', await probe(page, 'c1.html', [['html', [], ['--a', '--b', '--c', '--u']]])]);
    J([
      'c2',
      await probe(page, 'c2.html', [
        ['html', [], ['--m1', '--m2', '--m3', '--m4', '--m5']],
        ['body', [], ['--m3']],
      ]),
    ]);
    J([
      'c3',
      await probe(page, 'c3.html', [
        ['#c1', ['color']],
        ['#c2', ['color']],
        ['#c3', ['color']],
      ]),
    ]);
    J([
      'c4',
      await probe(
        page,
        'c4.html',
        ['#a', '#b', '#c', '#d', '#e'].map((s) => [s, ['paddingTop', 'marginTop']]),
      ),
    ]);
    J([
      'c5',
      await probe(page, 'c5.html', [
        ['#r', ['color']],
        ['#s', ['color']],
      ]),
    ]);
    J([
      'c6',
      await probe(page, 'c6.html', [
        ['#inh', ['color']],
        ['#ini', ['color']],
      ]),
    ]);
    J([
      'c7',
      await probe(
        page,
        'c7.html',
        ['f2_ab', 'f2_b', 'f2_none', 'f2_alb', 'f9_ab', 'f9_b', 'f9_none', 'f9_alb'].map((s) => [`#${s}`, ['color']]),
      ),
    ]);
    await ctx.close();
  }
  await b.close();
}
