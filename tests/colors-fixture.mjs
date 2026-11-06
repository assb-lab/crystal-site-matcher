// Checks of the user's element colours (#74): the stored palette, the scene and the view-menu pickers.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

// a localStorage for the palette (the app reads it through the never-throwing wrapper)
const store = new Map();
globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };

const server = await createServer({ server: { middlewareMode: true }, logLevel: 'silent' });
try {
  const C = await server.ssrLoadModule('/src/lib/elementColors.ts');
  const { ELEMENTS, elementColor } = await server.ssrLoadModule('/src/lib/data.ts');
  const { docFromText, deriveBonds } = await server.ssrLoadModule('/src/lib/doc.ts');
  const sc = await server.ssrLoadModule('/src/lib/scene.ts');

  // hex ↔ RGB, clamped and rounded; anything but #rrggbb is rejected
  assert.equal(C.rgbHex([255, 0, 16]), '#ff0010');
  assert.equal(C.rgbHex([300, -4, 15.6]), '#ff0010');
  assert.deepEqual(C.hexRgb('#FF0010'), [255, 0, 16]);
  for (const bad of ['ff0010', '#f01', '#ff00zz', '', 'red']) assert.equal(C.hexRgb(bad), null, bad);

  // stored palette: valid entries survive a round trip, unknown elements / bad colours / junk are dropped
  assert.deepEqual(C.parseElementColors('{"Li":"#112233","Xx":"#000000","O":"blue","S":12,"Co":"#ABCDEF"}'), { Li: [17, 34, 51], Co: [171, 205, 239] });
  for (const junk of [null, '', '{', '[]', '"#112233"', 'null']) assert.deepEqual(C.parseElementColors(junk), {}, String(junk));
  const pal = { O: [1, 2, 3], Li: [250, 251, 252] };
  assert.equal(C.serializeElementColors(pal), '{"Li":"#fafbfc","O":"#010203"}');
  assert.deepEqual(C.parseElementColors(C.serializeElementColors(pal)), pal);
  C.saveElementColors(pal);
  assert.equal(store.get(C.ELEMENT_COLORS_KEY), '{"Li":"#fafbfc","O":"#010203"}');
  assert.deepEqual(C.loadElementColors(), pal);

  // elementColor: the user's choice first, the VESTA default otherwise
  assert.deepEqual(elementColor('Li', pal), [250, 251, 252]);
  assert.deepEqual(elementColor('Co', pal), ELEMENTS.Co.col);
  assert.deepEqual(elementColor('Co'), ELEMENTS.Co.col);

  // the scene: atoms, bonds and polyhedra follow the palette; mixed-site sectors too
  const lco = docFromText(await readFile('src/samples/LiCoO2.cif', 'utf8'), 'LiCoO2.cif', 0);
  const { bonds } = deriveBonds(lco.crystal, lco.ox, lco.bondSettings);
  const el = (a) => lco.crystal.sites[lco.crystal.positions[a.pos].main].element;
  const plain = sc.buildScene(lco.crystal, bonds, lco.view, null);
  const custom = sc.buildScene(lco.crystal, bonds, lco.view, null, { elementColors: { Co: [10, 20, 30] } });
  for (const a of plain.atoms) assert.deepEqual(a.color, ELEMENTS[el(a)].col);
  for (const a of custom.atoms) assert.deepEqual(a.color, el(a) === 'Co' ? [10, 20, 30] : ELEMENTS[el(a)].col);
  const centre = (p) => lco.crystal.sites[lco.crystal.positions[sc.parseAtomKey(p.centerKey).pos].main].element;
  const coPolys = custom.polys.filter((p) => centre(p) === 'Co');
  assert.ok(coPolys.length > 0 && coPolys.every((p) => p.color[0] === 10), 'CoO6 polyhedra in the new colour');
  assert.ok(custom.polys.filter((p) => centre(p) !== 'Co').every((p) => p.color[0] !== 10), 'other polyhedra keep their colour');
  assert.ok(custom.bonds.some((b) => b.ca[0] === 10 || b.cb[0] === 10), 'Co ends of bonds in the new colour');
  const argy = docFromText(await readFile('src/samples/Li6PS5Cl.cif', 'utf8'), 'Li6PS5Cl.cif', 0);
  const mixed = argy.crystal.positions.find((p) => sc.atomSectors(argy.crystal, p.index).some((x) => x.element === 'Cl') && sc.atomSectors(argy.crystal, p.index).length > 1).index; // S/Cl on 4a
  const sectors = sc.atomSectors(argy.crystal, mixed, { Cl: [0, 255, 0] });
  assert.deepEqual(sectors.find((s) => s.element === 'Cl').color, [0, 255, 0]);
  assert.deepEqual(sectors.find((s) => s.element === 'S').color, ELEMENTS.S.col);

  // the view menu: one picker per element of the structure, a reset only for changed ones, both languages
  const { I18nProvider } = await server.ssrLoadModule('/src/i18n/index.tsx');
  const { ElementColorsProvider } = await server.ssrLoadModule('/src/components/ElementColors.tsx');
  const { default: ViewControls } = await server.ssrLoadModule('/src/components/ViewControls.tsx');
  const render = (lang) =>
    renderToStaticMarkup(
      createElement(I18nProvider, { initial: lang }, createElement(ElementColorsProvider, null, createElement(ViewControls, { view: lco.view, setView: () => {}, onViewDir: () => {}, crystal: lco.crystal, ox: lco.ox, bonds }))),
    );
  C.saveElementColors({ Co: [10, 20, 30], Na: [1, 1, 1] }); // Na is not in LiCoO2
  const ja = render('ja');
  assert.match(ja, /元素の色/);
  for (const e of ['Li', 'Co', 'O']) assert.match(ja, new RegExp(`id="color-${e}" type="color"`));
  assert.match(ja, /id="color-Co" type="color"[^>]* value="#0a141e"/);
  assert.match(ja, new RegExp(`id="color-Li" type="color"[^>]* value="${C.rgbHex(ELEMENTS.Li.col)}"`));
  assert.match(ja, /id="color-reset-Co"/);
  assert.doesNotMatch(ja, /id="color-reset-(Li|O|Na)"/);
  assert.match(ja, /id="color-reset-all"/);
  assert.match(ja, /background:rgb\(10, 20, 30\)/, 'element chips use the custom colour');
  const en = render('en');
  assert.match(en, /Element colours/);
  assert.doesNotMatch(en, /[぀-ヿ一-鿿]/, 'untranslated Japanese text in the English view menu');
  C.saveElementColors({ Na: [1, 1, 1] });
  assert.doesNotMatch(render('ja'), /id="color-reset-all"/, 'nothing to reset for this structure');
} finally {
  await server.close();
}
