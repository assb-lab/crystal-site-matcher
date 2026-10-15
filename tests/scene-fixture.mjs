// Checks of the 3D scene builder (src/lib/scene.ts), loaded through vite like chart-fixture.mjs.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'vite';
import { Color } from 'three';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';

const server = await createServer({ server: { middlewareMode: true }, logLevel: 'silent' });
try {
  const { docFromText, deriveBonds } = await server.ssrLoadModule('/src/lib/doc.ts');
  const sc = await server.ssrLoadModule('/src/lib/scene.ts');
  const open = async (f) => {
    const doc = docFromText(await readFile(`src/samples/${f}.cif`, 'utf8'), `${f}.cif`, 0);
    return { doc, bonds: deriveBonds(doc.crystal, doc.ox, doc.bondSettings).bonds };
  };
  const centres = (doc, spec) => spec.polys.map((p) => doc.crystal.sites[doc.crystal.positions[sc.parseAtomKey(p.centerKey).pos].main].element);

  // anion-centred polyhedra (#19)
  for (const [f, anion, cn] of [['LiCoO2', 'O', 6], ['Li3N', 'N', 8], ['SrTiO3', 'O', 6], ['LiFePO4', 'O', 4]]) {
    const { doc, bonds } = await open(f);
    assert.equal(doc.view.polyCenter, 'cation', `${f}: cation-centred by default`);
    const cations = sc.buildScene(doc.crystal, bonds, doc.view, null);
    assert.ok(cations.polys.length > 0 && centres(doc, cations).every((el) => el !== anion), `${f}: cation centres`);
    assert.deepEqual(sc.polyCenterElements(doc.crystal, doc.ox, 'anion'), [anion]);
    assert.deepEqual(sc.defaultPolyElements(doc.crystal, doc.ox, bonds, 'anion'), [anion]);
    const view = { ...doc.view, polyCenter: 'anion', polyElements: sc.defaultPolyElements(doc.crystal, doc.ox, bonds, 'anion') };
    const anions = sc.buildScene(doc.crystal, bonds, view, null);
    assert.ok(anions.polys.length > 0, `${f}: anion polyhedra drawn`);
    assert.ok(centres(doc, anions).every((el) => el === anion), `${f}: only ${anion} centres`);
    // vertices are the bonded cations: NLi₈ in Li₃N, OLi₃Co₃ in LiCoO₂, OPFeLi₂ in LiFePO₄ …
    assert.ok(anions.polys.some((p) => p.verts.length === cn), `${f}: CN ${cn} around ${anion}`);
  }
  // the CN ≤ 6 limit of the default applies to cation centres only (N in Li₃N is CN 8)
  {
    const { doc, bonds } = await open('Li3N');
    assert.deepEqual(sc.defaultPolyElements(doc.crystal, doc.ox, bonds), ['Li']);
  }

  // hop classes and the highlighted hop path (#21)
  {
    const { computeStaticFeatures, hopClasses } = await server.ssrLoadModule('/src/lib/features.ts');
    const hopsOf = async (f) => {
      const { doc, bonds } = await open(f);
      const { table } = deriveBonds(doc.crystal, doc.ox, doc.bondSettings);
      const st = computeStaticFeatures(doc.crystal, doc.ox, bonds, table, { mobileEl: doc.mobile, hopCutoff: doc.hopCutoff });
      return { doc, bonds, hops: st.hops, classes: hopClasses(doc.crystal, st.hops) };
    };
    // LiCoO₂: the nine Li–Li hops are equivalent → one class
    const lco = await hopsOf('LiCoO2');
    assert.equal(lco.classes.length, 1);
    assert.deepEqual([lco.classes[0].from, lco.classes[0].to, lco.classes[0].members.length], ['Li1', 'Li1', 9]);
    // Li₃N: five classes, every hop in exactly one, ordered narrow → wide
    const li3n = await hopsOf('Li3N');
    assert.deepEqual(
      li3n.classes.map((c) => `${c.from}-${c.to} ${c.d.toFixed(3)} ×${c.members.length}`),
      ['Li1-Li2 2.862 ×12', 'Li2-Li2 3.648 ×6', 'Li2-Li2 2.106 ×3', 'Li1-Li1 3.648 ×3', 'Li2-Li2 3.875 ×2'],
    );
    assert.deepEqual(li3n.classes.flatMap((c) => c.members).sort((a, b) => a - b), li3n.hops.map((_, i) => i));
    assert.ok(li3n.classes.every((c, i) => i === 0 || c.rb >= li3n.classes[i - 1].rb));
    for (const c of li3n.classes) assert.ok(c.members.every((i) => Math.abs(li3n.hops[i].d - c.d) < 1e-3 && Math.abs(li3n.hops[i].rb - c.rb) < 1e-3));

    // the path: one segment per member and displayed cell, ends on drawn mobile ions, bottleneck on the segment
    const { doc, bonds, hops, classes } = li3n;
    const cls = classes[3]; // Li1–Li1, 3.648 Å within the Li1 layer
    const sel = cls.members.map((i) => hops[i]);
    for (const supercell of [[1, 1, 1], [2, 1, 2]]) {
      const view = { ...doc.view, supercell, showHops: false };
      const spec = sc.buildScene(doc.crystal, bonds, view, null, { selHops: sel, hopRange: [0, 0.646] });
      const nCells = supercell[0] * supercell[1] * supercell[2];
      assert.equal(spec.hopPath.segs.length, sel.length * nCells);
      assert.equal(spec.hopPath.necks.length, sel.length * nCells);
      assert.equal(spec.hopLines.length, 0, 'other hops stay hidden');
      const atXyz = (p) => spec.atoms.some((a) => Math.hypot(a.xyz[0] - p[0], a.xyz[1] - p[1], a.xyz[2] - p[2]) < 1e-6 && doc.crystal.sites[doc.crystal.positions[a.pos].main].element === 'Li');
      for (const [a, b] of spec.hopPath.segs) {
        assert.ok(atXyz(a) && atXyz(b), 'both ends are drawn Li atoms');
        assert.ok(Math.abs(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) - cls.d) < 1e-6);
      }
      spec.hopPath.necks.forEach((n, i) => {
        const [a, b] = spec.hopPath.segs[i];
        const ab = [0, 1, 2].map((k) => b[k] - a[k]);
        const an = [0, 1, 2].map((k) => n[k] - a[k]);
        const tt = (an[0] * ab[0] + an[1] * ab[1] + an[2] * ab[2]) / (ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2);
        const off = Math.hypot(...[0, 1, 2].map((k) => an[k] - tt * ab[k]));
        assert.ok(tt >= -1e-9 && tt <= 1 + 1e-9 && off < 1e-6, 'bottleneck lies on its segment');
      });
      // colour follows the shared bottleneck scale (widest class → green end)
      assert.deepEqual(spec.hopPath.color, sc.hopColor(cls.rb, 0, 0.646));
    }
    // stable-site markers (#26): boundary images like atoms (a corner site appears at all 8 corners)
    const mk = sc.buildScene(doc.crystal, bonds, doc.view, null, { minima: [{ frac: [0, 0, 0], occupied: false }, { frac: [0.5, 0.5, 0.5], occupied: true }] });
    assert.equal(mk.minima.filter((m) => !m.occupied).length, 8);
    assert.equal(mk.minima.filter((m) => m.occupied).length, 1);
    assert.equal(sc.buildScene(doc.crystal, bonds, { ...doc.view, supercell: [2, 1, 1] }, null, { minima: [{ frac: [0.5, 0.5, 0.5], occupied: true }] }).minima.length, 2);
    assert.deepEqual(sc.buildScene(doc.crystal, bonds, doc.view, null, {}).minima, []);
    // nothing selected → no path
    assert.equal(sc.buildScene(doc.crystal, bonds, doc.view, null, {}).hopPath, null);
    // hidden mobile ions are not added back as path ends
    const hidden = sc.buildScene(doc.crystal, bonds, { ...doc.view, hiddenElements: ['Li'] }, null, { selHops: sel });
    assert.ok(!hidden.atoms.some((a) => doc.crystal.sites[doc.crystal.positions[a.pos].main].element === 'Li'));
    assert.equal(hidden.hopPath.segs.length, sel.length);
  }
  // Changing themes changes the foreground dashes, never the bottleneck-coloured band (#21).
  {
    const { applyHopPathTheme } = await server.ssrLoadModule('/src/components/Viewer.tsx');
    const band = new LineMaterial({ color: 0x1baf7a, linewidth: 7 });
    const dash = new LineMaterial({ color: 0x1a1f2b, dashed: true, linewidth: 3 });
    try {
      for (const ink of [0xe5e8ef, 0x1a1f2b, 0xe5e8ef]) {
        applyHopPathTheme([band, dash], new Color(ink));
        assert.equal(band.color.getHex(), 0x1baf7a, 'band retains the bottleneck colour across theme changes');
        assert.equal(dash.color.getHex(), ink, 'dashes follow the current foreground colour');
      }
    } finally {
      band.dispose();
      dash.dispose();
    }
  }
} finally {
  await server.close();
}
