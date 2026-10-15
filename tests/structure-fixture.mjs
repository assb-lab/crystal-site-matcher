// Checks of crystal construction (src/lib/structure.ts): cell validation (#44).
import assert from 'node:assert/strict';
import { createServer } from 'vite';

const server = await createServer({ server: { middlewareMode: true }, logLevel: 'silent' });
try {
  const S = await server.ssrLoadModule('/src/lib/structure.ts');
  const { parseCif } = await server.ssrLoadModule('/src/lib/cif.ts');
  const { MsgError } = await server.ssrLoadModule('/src/lib/messages.ts');
  const x = await server.ssrLoadModule('/src/cli/extract.ts');
  const cif = (a, b, c, al, be, ga) => `data_t
_cell_length_a ${a}
_cell_length_b ${b}
_cell_length_c ${c}
${al === undefined ? '' : `_cell_angle_alpha ${al}`}
${be === undefined ? '' : `_cell_angle_beta ${be}`}
${ga === undefined ? '' : `_cell_angle_gamma ${ga}`}
_symmetry_space_group_name_H-M 'P 1'
loop_
_atom_site_label
_atom_site_type_symbol
_atom_site_fract_x
_atom_site_fract_y
_atom_site_fract_z
Li1 Li+ 0 0 0
`;
  const build = (...p) => S.crystalFromCif(parseCif(cif(...p))[0]);
  const rejects = (key, ...p) =>
    assert.throws(() => build(...p), (e) => e instanceof MsgError && e.msg.key === key, `${key}: ${p.join(', ')}`);

  // cells that cannot exist: the angle triple of the issue, a flat cell (60/60/120 lies in a plane), angles at the bounds
  rejects('err.cell.volume', 3, 3, 3, 10, 10, 170);
  rejects('err.cell.volume', 3, 3, 3, 60, 60, 120);
  rejects('err.cell.volume', 3, 3, 3, 120, 120, 120);
  rejects('err.cell.angle', 3, 3, 3, 90, 90, 0);
  rejects('err.cell.angle', 3, 3, 3, 90, 180, 90);
  rejects('err.cell.angle', 3, 3, 3, -90, 90, 90);
  // non-finite and non-positive values
  rejects('err.cell.angle', 3, 3, 3, 90, '1e999', 90);
  rejects('err.cell.length', '1e999', 3, 3, 90, 90, 90);
  rejects('err.cell.length', 3, -3, 3, 90, 90, 90);
  rejects('err.cell.length', 3, 3, 0, 90, 90, 90);
  rejects('err.noCell', '?', 3, 3, 90, 90, 90);
  assert.equal(S.cellProblem(3, 3, 3, 10, 10, 170), 'volume');
  assert.equal(S.cellProblem(3, 3, 3, 90, 90, 90), null);

  // valid cells load with the volume of the metric tensor; missing or unknown angles are 90°
  const vol = (a, b, c, al, be, ga) => {
    const [x, y, z] = [al, be, ga].map((t) => Math.cos((t * Math.PI) / 180));
    return a * b * c * Math.sqrt(1 - x * x - y * y - z * z + 2 * x * y * z);
  };
  for (const p of [[3, 4, 5, 90, 90, 90], [5, 6, 7, 90, 103.5, 90], [5, 6, 7, 71, 82, 95], [3, Math.hypot(15, 0.6), 3, 90, 90, (Math.atan2(0.6, 15) * 180) / Math.PI]]) {
    const cr = build(...p);
    assert.ok(Number.isFinite(cr.lattice.volume) && Math.abs(cr.lattice.volume - vol(...p)) < 1e-9 * vol(...p), `volume ${p}`);
    assert.ok(cr.lattice.inv.flat().every(Number.isFinite));
  }
  assert.equal(build(3, 4, 5).lattice.volume, 60);
  assert.equal(build(3, 4, 5, '?', '.', 90).lattice.gamma, 90);

  // the CLI reports the error in English and produces no record (no NaN downstream)
  const r = await x.extractFromText(cif(3, 3, 3, 10, 10, 170), 'bad.cif', { grid: null });
  assert.equal(r.records.length, 0);
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0].message, /do not form a 3D cell/);
} finally {
  await server.close();
}
