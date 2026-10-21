// Checks of the 3D scene builder (src/lib/scene.ts), loaded through vite like chart-fixture.mjs.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'vite';
import { Color, SphereGeometry, MeshStandardMaterial, ShaderLib, Group, MeshBasicMaterial, LineBasicMaterial } from 'three';
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

  // Occupancy sectors: chemical alternatives and vacancy stay separate, without changing the CIF data.
  {
    const { applyOccupancyColors } = await server.ssrLoadModule('/src/components/occupancyMaterial.ts');
    const { populateContent } = await server.ssrLoadModule('/src/components/Viewer.tsx');
    const make = (rows) => docFromText(`data_mixed
_cell_length_a 8
_cell_length_b 8
_cell_length_c 8
_space_group_name_H-M_alt 'P 1'
loop_
_atom_site_label
_atom_site_type_symbol
_atom_site_fract_x
_atom_site_fract_y
_atom_site_fract_z
_atom_site_occupancy
${rows.map(([label, el, occ]) => `${label} ${el} 0.5 0.5 0.5 ${occ}`).join('\n')}
`, 'mixed.cif', 0);
    const doc = make([['Li1', 'Li+', 0.1], ['Na1', 'Na+', 0.2], ['K1', 'K+', 0.3]]);
    const before = JSON.stringify(doc.crystal);
    const sectors = sc.atomSectors(doc.crystal, 0);
    const fractions = Object.fromEntries(sectors.map((s) => [s.element ?? 'vacancy', s.fraction]));
    for (const [el, f] of Object.entries({ Li: 0.1, Na: 0.2, K: 0.3, vacancy: 0.4 })) assert.ok(Math.abs(fractions[el] - f) < 1e-12);
    assert.equal(JSON.stringify(doc.crystal), before);
    assert.deepEqual(sectors.at(-1).color, [255, 255, 255]);
    const duplicate = make([['Li1', 'Li+', 0.2], ['Li2', 'Li+', 0.3]]);
    assert.deepEqual(sc.atomSectors(duplicate.crystal, 0).map((s) => [s.element, s.fraction]), [['Li', 0.5], [null, 0.5]]);
    const full = make([['Li1', 'Li+', 1]]);
    assert.equal(sc.atomSectors(full.crystal, 0).length, 1);
    const over = make([['Li1', 'Li+', 0.8], ['Na1', 'Na+', 0.8]]);
    assert.deepEqual(sc.atomSectors(over.crystal, 0).map((s) => s.fraction), [0.5, 0.5]);
    assert.equal(over.crystal.positions[0].occupants.reduce((sum, o) => sum + o.occ, 0), 1.6);
    const rounded = make([['Li1', 'Li+', 0.99999999]]);
    assert.equal(sc.atomSectors(rounded.crystal, 0).length, 1);
    assert.equal(sc.atomSectors(rounded.crystal, 0)[0].fraction, 1);
    // CIF rounding: three rows of 0.33 (total 0.99) or 0.995 on one row are a full site, normalised to 1
    const thirds = sc.atomSectors(make([['Li1', 'Li+', 0.33], ['Na1', 'Na+', 0.33], ['K1', 'K+', 0.33]]).crystal, 0);
    assert.deepEqual(thirds.map((s) => s.element), ['K', 'Li', 'Na']);
    assert.ok(thirds.every((s) => Math.abs(s.fraction - 1 / 3) < 1e-12));
    assert.equal(sc.atomSectors(make([['Li1', 'Li+', 0.995]]).crystal, 0).length, 1);
    // a deficit beyond that rounding is a vacancy (0.98 on one row, 0.32 × 3 = 0.96)
    assert.deepEqual(sc.atomSectors(make([['Li1', 'Li+', 0.98]]).crystal, 0).map((s) => s.element), ['Li', null]);
    assert.ok(Math.abs(sc.atomSectors(make([['Li1', 'Li+', 0.32], ['Na1', 'Na+', 0.32], ['K1', 'K+', 0.32]]).crystal, 0).at(-1).fraction - 0.04) < 1e-12);
    const { bonds } = deriveBonds(doc.crystal, doc.ox, doc.bondSettings);
    const spec = sc.buildScene(doc.crystal, bonds, { ...doc.view, polyMode: 'none', supercell: [2, 1, 1] }, null);
    assert.equal(spec.atoms.length, 2);
    spec.atoms.forEach((a) => assert.deepEqual(a.sectors, sectors));
    const geometry = new SphereGeometry(1, 12, 8), material = new MeshStandardMaterial();
    const texture = applyOccupancyColors(geometry, material, spec.atoms);
    assert.ok(texture);
    const info = geometry.getAttribute('occupancyInfo');
    assert.equal(info.getX(0), info.getX(1), 'periodic images reuse the palette');
    assert.equal(info.getY(0), 4);
    let end = 0;
    sectors.forEach((s, i) => {
      end += s.fraction;
      assert.ok(Math.abs(texture.image.data[i * 4 + 3] - end) < 1e-7);
      const color = new Color().setRGB(...s.color.map((c) => c / 255), 'srgb');
      assert.ok(Math.abs(texture.image.data[i * 4] - color.r) < 1e-7);
    });
    const shader = { vertexShader: ShaderLib.standard.vertexShader, fragmentShader: ShaderLib.standard.fragmentShader, uniforms: {} };
    material.onBeforeCompile(shader, null);
    assert.match(shader.fragmentShader, /atan\(pie.x/);
    assert.equal(shader.uniforms.occupancyPalette.value, texture);
    let disposed = 0; texture.addEventListener('dispose', () => disposed++);
    material.dispose();geometry.dispose();assert.equal(disposed, 1, 'palette lifetime follows material');
    const pureGeometry = new SphereGeometry(), pureMaterial = new MeshStandardMaterial();
    assert.equal(applyOccupancyColors(pureGeometry, pureMaterial, [{ ...spec.atoms[0], sectors: sc.atomSectors(full.crystal, 0) }]), null);
    pureGeometry.dispose();pureMaterial.dispose();
    const content = new Group();
    const built = populateContent(content, spec, { halo: new MeshBasicMaterial(), cell: new LineBasicMaterial() });
    assert.equal(built.atomMesh.count, spec.atoms.length);
    assert.deepEqual(built.atomKeys, spec.atoms.map((a) => a.key));
    assert.ok(built.atomMesh.geometry.getAttribute('occupancyInfo'));
    content.traverse((o) => {o.geometry?.dispose();if (Array.isArray(o.material))o.material.forEach((m) => m.dispose());else o.material?.dispose();});
    // Real LGPS Ge/P and argyrodite S/Cl mixing, and partially occupied Li sites.
    for (const f of ['Li10GeP2S12', 'Li6PS5Cl']) {
      const { doc, bonds } = await open(f);
      const mixed = sc.buildScene(doc.crystal, bonds, doc.view, null);
      assert.ok(mixed.atoms.some((a) => a.sectors.filter((s) => s.element !== null).length > 1));
      assert.ok(mixed.atoms.some((a) => a.sectors.some((s) => s.element === null)));
      for (const a of mixed.atoms) assert.ok(Math.abs(a.sectors.reduce((sum, s) => sum + s.fraction, 0) - 1) < 1e-6);
    }
  }
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
      ['Li2-Li2 3.648 ×6', 'Li1-Li2 2.862 ×12', 'Li1-Li1 3.648 ×3', 'Li2-Li2 2.106 ×3', 'Li2-Li2 3.875 ×2'],
    );
    assert.deepEqual(li3n.classes.flatMap((c) => c.members).sort((a, b) => a - b), li3n.hops.map((_, i) => i));
    assert.ok(li3n.classes.every((c, i) => i === 0 || c.rb >= li3n.classes[i - 1].rb));
    for (const c of li3n.classes) assert.ok(c.members.every((i) => Math.abs(li3n.hops[i].d - c.d) < 1e-3 && Math.abs(li3n.hops[i].rb - c.rb) < 1e-3));

    // the path: one polyline per member and displayed cell, ends on drawn mobile ions, bottleneck on the path
    const { doc, bonds, hops, classes } = li3n;
    const atXyz = (spec, p) => spec.atoms.some((a) => Math.hypot(a.xyz[0] - p[0], a.xyz[1] - p[1], a.xyz[2] - p[2]) < 1e-6 && doc.crystal.sites[doc.crystal.positions[a.pos].main].element === 'Li');
    const segDist = (n, a, b) => {
      const ab = [0, 1, 2].map((k) => b[k] - a[k]);
      const an = [0, 1, 2].map((k) => n[k] - a[k]);
      const tt = Math.max(0, Math.min(1, (an[0] * ab[0] + an[1] * ab[1] + an[2] * ab[2]) / (ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2)));
      return Math.hypot(...[0, 1, 2].map((k) => an[k] - tt * ab[k]));
    };
    // Li1–Li1 3.648 Å within the Li1 layer runs straight; Li2–Li2 2.106 Å in the Li2N plane bends (#62)
    for (const [cls, points] of [[classes[2], 2], [classes[3], 3]]) {
      const sel = cls.members.map((i) => hops[i]);
      for (const supercell of [[1, 1, 1], [2, 1, 2]]) {
        const view = { ...doc.view, supercell, showHops: false };
        const spec = sc.buildScene(doc.crystal, bonds, view, null, { selHops: sel, hopRange: [0, 0.646] });
        const nCells = supercell[0] * supercell[1] * supercell[2];
        assert.equal(spec.hopPath.paths.length, sel.length * nCells);
        assert.equal(spec.hopPath.necks.length, sel.length * nCells);
        assert.equal(spec.hopLines.length, 0, 'other hops stay hidden');
        spec.hopPath.paths.forEach((path, i) => {
          assert.equal(path.length, points);
          const a = path[0],
            b = path[path.length - 1];
          assert.ok(atXyz(spec, a) && atXyz(spec, b), 'both ends are drawn Li atoms');
          assert.ok(Math.abs(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) - cls.d) < 1e-6);
          if (points === 3) {
            // the bend stays in the sphere with the hop as diameter
            const m = [0, 1, 2].map((k) => (a[k] + b[k]) / 2);
            assert.ok(Math.hypot(...[0, 1, 2].map((k) => path[1][k] - m[k])) <= cls.d / 2 + 1e-9);
            assert.ok(segDist(path[1], a, b) > 0.5, 'Li2–Li2 bends well off the straight line');
          }
          const n = spec.hopPath.necks[i];
          assert.ok(Math.min(...path.slice(1).map((q, k) => segDist(n, path[k], q))) < 1e-6, 'bottleneck lies on its path');
        });
        // colour follows the shared bottleneck scale (widest class → green end)
        assert.deepEqual(spec.hopPath.color, sc.hopColor(cls.rb, 0, 0.646));
      }
    }
    const sel = classes[2].members.map((i) => hops[i]);
    // saddle markers (#27): one per member and cell, shifted with the path
    const withSaddle = sel.map((h) => ({ ...h, saddle: h.mid }));
    const sp = sc.buildScene(doc.crystal, bonds, { ...doc.view, supercell: [2, 1, 1] }, null, { selHops: withSaddle });
    assert.equal(sp.hopPath.saddles.length, sel.length * 2);
    assert.deepEqual(sp.hopPath.saddles, sp.hopPath.necks);
    assert.deepEqual(sc.buildScene(doc.crystal, bonds, doc.view, null, { selHops: sel }).hopPath.saddles, []);
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
    assert.equal(hidden.hopPath.paths.length, sel.length);
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
