// Checks of the 3D scene builder (src/lib/scene.ts), loaded through vite like chart-fixture.mjs.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'vite';

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
} finally {
  await server.close();
}
