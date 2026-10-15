// Checks of the CIF-only descriptors (src/lib/descriptors.ts) through the CLI core, loaded with vite.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'vite';

const server = await createServer({ server: { middlewareMode: true }, logLevel: 'silent' });
try {
  const x = await server.ssrLoadModule('/src/cli/extract.ts');
  const { FEATURE_DEFS } = await server.ssrLoadModule('/src/lib/features.ts');
  const { translate } = await server.ssrLoadModule('/src/i18n/translate.ts');
  const near = (a, b, tol, msg) => assert.ok(a !== null && Math.abs(a - b) < tol, `${msg}: ${a} vs ${b}`);
  const values = async (f, opts = {}) => {
    const r = await x.extractFromText(await readFile(`src/samples/${f}.cif`, 'utf8'), f, { grid: null, ...opts });
    assert.deepEqual(r.errors, []);
    return r.records[0].values;
  };

  // every feature has a name and a description in both languages
  for (const d of FEATURE_DEFS)
    for (const lang of ['ja', 'en'])
      for (const part of ['label', 'desc']) {
        const k = `feat.${d.key}.${part}`;
        assert.notEqual(translate(lang, k), k, `${lang}: missing ${k}`);
      }

  // isolated anions: N in Li₃N and I in α-AgI see only the mobile ion; O in LiCoO₂ / LiFePO₄ is bonded to Co / Fe, P
  const li3n = await values('Li3N');
  assert.equal(li3n.isoAnion_frac, 1);
  assert.equal(li3n.isoAnion_cn, 8);
  near(li3n.isoAnion_dXX, 3.648, 1e-3, 'Li3N N–N (= a)');
  near(li3n.isoAnion_rho, 1000 / li3n.V, 1e-9, 'Li3N: one N per cell');
  assert.equal((await values('AgI_alpha')).isoAnion_frac, 1);
  for (const f of ['LiCoO2', 'LiFePO4']) {
    const v = await values(f);
    assert.equal(v.isoAnion_frac, 0, f);
    assert.equal(v.isoAnion_dXX, null, f);
  }
  // without a mobile ion "framework cation" is undefined → no isolated-anion features
  const noMobile = await values('LiCoO2', { mobile: null });
  for (const k of ['isoAnion_frac', 'isoAnion_rho', 'ionPot_isoAnion', 'cn_mobile_sd', 'bvvs_mobile']) assert.equal(noMobile[k], null, k);
  assert.notEqual(noMobile.ionPot_anion, null);

  // ionic potential: O²⁻ (CN 6) 2 / 1.40 Å in LiCoO₂; one anion site → no spread
  const lco = await values('LiCoO2');
  near(lco.ionPot_anion, 2 / 1.4, 1e-9, 'LiCoO2 ionPot');
  assert.equal(lco.ionPot_anion_range, 0);
  // site shapes: octahedral Li and Co in LiCoO₂, tetrahedral Mg and octahedral Al in MgAl₂O₄
  assert.equal(lco.mobile_oct_frac, 1);
  assert.equal(lco.frame_oct_frac, 1);
  assert.equal(lco.cn_mobile_sd, 0);
  const spinel = await values('MgAl2O4');
  assert.equal(spinel.mobile_tet_frac, 1);
  assert.equal(spinel.frame_oct_frac, 1);
  // Li₃N has two Li sites (CN 2 linear, CN 3 trigonal): CN spread 2–3
  assert.equal(li3n.cn_mobile_min, 2);
  assert.equal(li3n.cn_mobile_max, 3);
  assert.ok(li3n.cn_mobile_sd > 0);

  // BVVS: zero on centrosymmetric sites, from the bond vectors otherwise
  for (const k of ['bvvs_mobile', 'bvvs_frame']) near(lco[k], 0, 1e-9, `LiCoO2 ${k}`);
  {
    const { docFromText, deriveBonds } = await server.ssrLoadModule('/src/lib/doc.ts');
    const { analyzeSite, bvR0 } = await server.ssrLoadModule('/src/lib/analysis.ts');
    const doc = docFromText(await readFile('src/samples/LiFePO4.cif', 'utf8'), 'LiFePO4.cif', 0);
    const { bonds } = deriveBonds(doc.crystal, doc.ox, doc.bondSettings);
    const g = doc.crystal.groups.find((g) => g.key === 'Fe1');
    const a = analyzeSite(doc.crystal, doc.ox, bonds, g.positions[0], { kind: 'ionic' });
    const V = [0, 0, 0];
    for (const nb of bonds.bonded[g.positions[0]]) {
      const s = Math.exp((bvR0('Fe', 'O') - nb.d) / 0.37);
      for (let k = 0; k < 3; k++) V[k] += (s * nb.v[k]) / nb.d;
    }
    near(a.bvvsHost, Math.hypot(...V), 1e-9, 'LiFePO4 Fe1 BVVS');
    // off-centre by 0.30 Å, yet the bond valences nearly balance (small BVVS without a lone pair)
    assert.ok(a.bvvsHost > 0.01 && a.bvvsHost < 0.1, `Fe1 BVVS ${a.bvvsHost}`);
  }

  // mixed sites: a made-up rock salt (Ni²⁺/Fe³⁺)(O²⁻/F⁻), half and half on each site
  const toy = `data_toy
_cell_length_a 4.2
_cell_length_b 4.2
_cell_length_c 4.2
_cell_angle_alpha 90
_cell_angle_beta 90
_cell_angle_gamma 90
_symmetry_space_group_name_H-M 'F m -3 m'
loop_
_atom_type_symbol
_atom_type_oxidation_number
Ni2+ 2
Fe3+ 3
O2- -2
F1- -1
loop_
_atom_site_label
_atom_site_type_symbol
_atom_site_fract_x
_atom_site_fract_y
_atom_site_fract_z
_atom_site_occupancy
Ni1 Ni2+ 0 0 0 0.5
Fe1 Fe3+ 0 0 0 0.5
O1 O2- 0.5 0.5 0.5 0.5
F1 F1- 0.5 0.5 0.5 0.5
`;
  const t = (await x.extractFromText(toy, 'toy.cif', { grid: null, mobile: null })).records[0].values;
  near(t.mixEntropy_frame, Math.log(2), 1e-9, 'framework entropy');
  near(t.mixEntropy_anion, Math.log(2), 1e-9, 'anion entropy');
  near(t.chargeDisorder_frame, 0.5, 1e-9, 'Ni2+/Fe3+ charge spread');
  near(t.chargeDisorder_anion, 0.5, 1e-9, 'O2-/F- charge spread');
  // Shannon VI: Ni²⁺ 0.69, Fe³⁺ (HS) 0.645, O²⁻ 1.40, F⁻ 1.33
  near(t.radiusDisorder_frame, 0.0225 / 0.6675, 1e-6, 'cation size spread');
  near(t.radiusDisorder_anion, 0.035 / 1.365, 1e-6, 'anion size spread');
  near(t.ionPot_anion, 0.5 * (2 / 1.4) + 0.5 * (1 / 1.33), 1e-9, 'mixed-site ionic potential');
  // ordered samples: no mixing
  for (const k of ['mixEntropy_frame', 'mixEntropy_anion', 'radiusDisorder_frame', 'chargeDisorder_anion']) assert.equal(lco[k], 0, k);
} finally {
  await server.close();
}
