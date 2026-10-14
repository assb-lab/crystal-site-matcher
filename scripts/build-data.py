#!/usr/bin/env python3
"""Regenerate src/data/*.json from pymatgen's bundled data files.

Usage (environment pinned by pyproject.toml / uv.lock, sources by scripts/sources.lock):
  bash scripts/fetch-sources.sh
  uv run --locked scripts/build-data.py .sources/pymatgen .sources/pymatgen-core .sources/BVlain

Sources (all redistributed under pymatgen's MIT licence):
  - Shannon (1976) effective ionic / crystal radii : pymatgen/dev_scripts/periodic_table_resources/Shannon_Radii.csv
  - Brese & O'Keeffe (1991) bond-valence parameters: pymatgen-core/src/pymatgen/core/bvparam_1991.yaml
  - Space-group symmetry operators (530 settings)  : pymatgen-core/src/pymatgen/symmetry/symm_ops.json
  - Element data (electronegativity, oxidation states, radii): pymatgen-core/src/pymatgen/core/periodic_table.json.gz
  - VESTA element colours                          : pymatgen-core/src/pymatgen/core/ElementColorSchemes.yaml
  - VESTA default bond cutoffs                     : pymatgen/src/pymatgen/analysis/vesta_cutoffs.yaml
  - Ideal coordination polyhedra (chemenv)         : pymatgen/src/pymatgen/analysis/chemenv/coordination_environments/coordination_geometries_files
  - X-ray atomic scattering factors                : pymatgen/src/pymatgen/analysis/diffraction/atomic_scattering_params.json
  - BVSE (softBV) Morse parameters, principal quantum numbers, softBV covalent radii:
        BVlain (MIT, A. D. Dembitskiy) bvlain/data/*.pkl — originally from
        Chen & Adams, IUCrJ 4 (2017) 614 and Chen, Wong & Adams, Acta Cryst. B75 (2019) 18
"""
import csv, gzip, json, os, re, sys

pmg, core = sys.argv[1], sys.argv[2]
bvlain = sys.argv[3] if len(sys.argv) > 3 else None
out = os.path.join(os.path.dirname(__file__), "..", "src", "data")
os.makedirs(out, exist_ok=True)

def simple_yaml_map(path):
    """Tiny parser for the flat YAML files used here."""
    res, cur = {}, None
    for line in open(path, encoding="utf-8"):
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        if not line.startswith(" "):
            key = line.split(":")[0].strip()
            cur = res.setdefault(key, {})
        else:
            k, v = line.strip().split(":", 1)
            cur[k.strip()] = v.strip()
    return res

ROMAN = {"I":1,"II":2,"III":3,"IV":4,"V":5,"VI":6,"VII":7,"VIII":8,"IX":9,"X":10,"XI":11,"XII":12,"XIV":14}

# ---------- Shannon ----------
rows = []
with open(os.path.join(pmg, "dev_scripts/periodic_table_resources/Shannon_Radii.csv"), encoding="utf-8-sig") as f:
    for r in csv.DictReader(f):
        cn_label = r["Coordination"].strip()
        m = re.match(r"^([IVX]+)(SQ|PY)?$", cn_label)
        cn = ROMAN[m.group(1)]
        spin = {"High Spin": "HS", "Low Spin": "LS"}.get(r["Spin State"].strip(), "")
        charge = r["Charge"].strip()
        if not charge:
            # Source CSV omits the charge for one row (Eu, VII, 1.15/1.01); Shannon (1976) lists it as Eu3+.
            if r["Element"].strip() == "Eu" and cn_label == "VII":
                charge = "3"
            else:
                continue
        rows.append([r["Element"].strip(), int(charge), cn, cn_label, spin,
                     float(r["Crystal Radius"]), float(r["Ionic Radius"])])
json.dump(rows, open(os.path.join(out, "shannon.json"), "w"), separators=(",", ":"))
print("shannon", len(rows))

# ---------- BV params ----------
bv = simple_yaml_map(os.path.join(core, "src/pymatgen/core/bvparam_1991.yaml"))
bv = {el: [float(v["r"]), float(v["c"])] for el, v in bv.items()}
json.dump(bv, open(os.path.join(out, "bvparams.json"), "w"), separators=(",", ":"))
print("bv", len(bv))

# ---------- elements ----------
pt = json.load(gzip.open(os.path.join(core, "src/pymatgen/core/periodic_table.json.gz")))
colors = {}
section = None
for line in open(os.path.join(core, "src/pymatgen/core/ElementColorSchemes.yaml")):
    if not line.startswith(" ") and line.strip():
        section = line.strip().rstrip(":")
    elif section == "VESTA" and ":" in line:
        k, v = line.strip().split(":", 1)
        colors[k.strip()] = [int(x) for x in re.findall(r"\d+", v)]
els = {}
def num(x):
    try:
        return float(x)
    except Exception:
        return None
for sym, d in pt.items():
    els[sym] = {
        "Z": d.get("Atomic no"),
        "X": num(d.get("X")),
        "r": num(d.get("Atomic radius")) or num(d.get("Atomic radius calculated")),
        "ox": d.get("Common oxidation states") or [],
        "icsd": d.get("ICSD oxidation states") or [],
        "col": colors.get(sym, [200, 200, 200]),
        "m": num(d.get("Atomic mass")),
    }
json.dump(els, open(os.path.join(out, "elements.json"), "w"), separators=(",", ":"))
print("elements", len(els))

# ---------- VESTA cutoffs ----------
vc = {}
for line in open(os.path.join(pmg, "src/pymatgen/analysis/vesta_cutoffs.yaml")):
    m = re.match(r"^\[(\w+),\s*(\w+)\]:\s*([\d.]+)", line)
    if m:
        a, b = sorted([m.group(1), m.group(2)])
        vc[f"{a}-{b}"] = round(float(m.group(3)), 3)
json.dump(vc, open(os.path.join(out, "vesta_cutoffs.json"), "w"), separators=(",", ":"))
print("vesta cutoffs", len(vc))

# ---------- space groups ----------
sg = json.load(open(os.path.join(core, "src/pymatgen/symmetry/symm_ops.json")))
oplist, opidx, groups = [], {}, []
for e in sg:
    if "(" in e["universal_h_m"]:
        continue  # non-standard cell transformations
    idx = []
    for o in e["symops"]:
        if o not in opidx:
            opidx[o] = len(oplist); oplist.append(o)
        idx.append(opidx[o])
    groups.append({"n": e["number"], "hm": e["hermann_mauguin"].strip(), "u": e["universal_h_m"].strip(),
                   "hall": e["hall"].strip(), "s": e["short_h_m"].strip(), "o": idx})
json.dump({"ops": oplist, "groups": groups}, open(os.path.join(out, "spacegroups.json"), "w"), separators=(",", ":"))
print("space groups", len(groups), "ops", len(oplist))

# ---------- ideal polyhedra ----------
gdir = os.path.join(pmg, "src/pymatgen/analysis/chemenv/coordination_environments/coordination_geometries_files")
polys = []
for fn in sorted(os.listdir(gdir)):
    if not fn.endswith(".json") or "explicit" in fn:
        continue
    d = json.load(open(os.path.join(gdir, fn)))
    if d.get("deactivate"):
        continue
    pts = d.get("points")
    if pts is None:
        continue
    if isinstance(pts, str):
        pts = json.loads(pts)
    c = d.get("central_site", [0, 0, 0])
    polys.append({"sym": d["mp_symbol"], "name": d["name"], "cn": d["coordination"],
                  "iupac": d.get("IUPAC_symbol"),
                  "pts": [[round(p[i] - c[i], 6) for i in range(3)] for p in pts]})
json.dump(polys, open(os.path.join(out, "ideal_polyhedra.json"), "w"), separators=(",", ":"))
print("ideal polyhedra", len(polys), sorted({(p['cn'], p['sym']) for p in polys}))

# ---------- X-ray scattering ----------
xs = json.load(open(os.path.join(pmg, "src/pymatgen/analysis/diffraction/atomic_scattering_params.json")))
json.dump(xs, open(os.path.join(out, "xray_scattering.json"), "w"), separators=(",", ":"))
print("xray scattering", len(xs))

# ---------- BVSE parameters (BVlain / softBV) ----------
if bvlain:
    import pickle
    dd = os.path.join(bvlain, "bvlain", "data")
    Z2S = {v["Z"]: k for k, v in els.items()}
    def conv(tbl):
        res = {}
        for zm, byq in tbl.items():
            for qm, partners in byq.items():
                key = f"{Z2S[int(zm)]}{int(qm):+d}"
                for zp, byq2 in partners.items():
                    for qp, prm in byq2.items():
                        res.setdefault(key, {})[f"{Z2S[int(zp)]}{int(qp):+d}"] = [
                            round(float(prm["r_min"]), 5), round(float(prm["alpha"]), 5), round(float(prm["d0"]), 5)]
        return res
    cat = conv(pickle.load(open(os.path.join(dd, "cation.pkl"), "rb")))
    ani = conv(pickle.load(open(os.path.join(dd, "anion.pkl"), "rb")))
    qn = {Z2S[int(z)]: int(n) for z, n in pickle.load(open(os.path.join(dd, "quantum_n.pkl"), "rb")).items() if int(z) in Z2S}
    rc = {}
    for z, byq in pickle.load(open(os.path.join(dd, "covalent_radii_softvb.pkl"), "rb")).items():
        if int(z) in Z2S:
            for q, r in byq.items():
                rc[f"{Z2S[int(z)]}{int(q):+d}"] = float(r)
    json.dump({"mobile": {**cat, **ani}, "n": qn, "rc": rc}, open(os.path.join(out, "bvse.json"), "w"), separators=(",", ":"))
    print("bvse mobile ions", sorted({**cat, **ani}.keys()))
