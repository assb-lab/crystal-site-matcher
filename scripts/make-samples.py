#!/usr/bin/env python3
"""Regenerate the sample CIFs in src/samples (symmetry operators taken from src/data/spacegroups.json)."""
import json, os
sg = json.load(open(os.path.join(os.path.dirname(__file__), '..', 'src', 'data', 'spacegroups.json')))
def ops(u):
    g = next(g for g in sg['groups'] if g['u'] == u)
    return [sg['ops'][i] for i in g['o']], g
def cif(name, title, cell, u, sites, oxs=None, with_ops=True, ref=""):
    o, g = ops(u)
    a,b,c,al,be,ga = cell
    s = f"""# {title}
# {ref}
data_{name}
_chemical_name_common '{title}'
_cell_length_a {a}
_cell_length_b {b}
_cell_length_c {c}
_cell_angle_alpha {al}
_cell_angle_beta {be}
_cell_angle_gamma {ga}
_symmetry_space_group_name_H-M '{g['hm']}'
_symmetry_Int_Tables_number {g['n']}
"""
    if with_ops:
        s += "loop_\n_symmetry_equiv_pos_site_id\n_symmetry_equiv_pos_as_xyz\n" + "".join(f"{i+1} '{x}'\n" for i,x in enumerate(o))
    if oxs:
        s += "loop_\n_atom_type_symbol\n_atom_type_oxidation_number\n" + "".join(f"{k} {v}\n" for k,v in oxs.items())
    s += "loop_\n_atom_site_label\n_atom_site_type_symbol\n_atom_site_fract_x\n_atom_site_fract_y\n_atom_site_fract_z\n_atom_site_occupancy\n"
    for lab, typ, x, y, z, occ in sites:
        s += f"{lab} {typ} {x} {y} {z} {occ}\n"
    return s
out = os.path.join(os.path.dirname(__file__), '..', 'src', 'samples')
os.makedirs(out, exist_ok=True)
S = {}
S['LiFePO4'] = cif('LiFePO4', 'LiFePO4 (olivine)', (10.332, 6.010, 4.692, 90, 90, 90), 'P n m a',
  [('Li1','Li1+',0,0,0,1),('Fe1','Fe2+',0.2822,0.25,0.9747,1),('P1','P5+',0.0950,0.25,0.4182,1),
   ('O1','O2-',0.0968,0.25,0.7428,1),('O2','O2-',0.4571,0.25,0.2060,1),('O3','O2-',0.1656,0.0465,0.2848,1)],
  {'Li1+':1,'Fe2+':2,'P5+':5,'O2-':-2}, ref="Streltsov et al., Acta Cryst. B49 (1993) 147")
S['Y3Al5O12'] = cif('YAG', 'Y3Al5O12 (garnet, YAG)', (12.000, 12.000, 12.000, 90, 90, 90), 'I a -3 d',
  [('Y1','Y',0.125,0,0.25,1),('Al1','Al',0,0,0,1),('Al2','Al',0.375,0,0.25,1),('O1','O',-0.0306,0.0512,0.1500,1)],
  None, ref="Euler & Bruce, Acta Cryst. 19 (1965) 971")
S['MgAl2O4'] = cif('spinel', 'MgAl2O4 (spinel)', (8.0832, 8.0832, 8.0832, 90, 90, 90), 'F d -3 m :2',
  [('Mg1','Mg',0.125,0.125,0.125,1),('Al1','Al',0.5,0.5,0.5,1),('O1','O',0.2624,0.2624,0.2624,1)],
  None, with_ops=False, ref="space-group symbol only (no symmetry-operator loop), origin choice 2")
S['LiCoO2'] = cif('LiCoO2', 'LiCoO2 (layered rock salt)', (2.8156, 2.8156, 14.0542, 90, 90, 120), 'R -3 m :H',
  [('Li1','Li+',0,0,0,1),('Co1','Co3+',0,0,0.5,1),('O1','O2-',0,0,0.2396,1)],
  {'Li+':1,'Co3+':3,'O2-':-2}, ref="Akimoto et al., J. Solid State Chem. 141 (1998) 298")
S['SrTiO3'] = cif('SrTiO3', 'SrTiO3 (cubic perovskite)', (3.905, 3.905, 3.905, 90, 90, 90), 'P m -3 m',
  [('Sr1','Sr',0,0,0,1),('Ti1','Ti',0.5,0.5,0.5,1),('O1','O',0.5,0.5,0,1)], None)
S['TiO2_rutile'] = cif('rutile', 'TiO2 (rutile)', (4.5937, 4.5937, 2.9587, 90, 90, 90), 'P 42/m n m',
  [('Ti1','Ti4+',0,0,0,1),('O1','O2-',0.30478,0.30478,0,1)], {'Ti4+':4,'O2-':-2}, ref="Burdett et al., JACS 109 (1987) 3639")
S['AgI_alpha'] = cif('AgI_alpha', 'alpha-AgI (superionic, ~420 K)', (5.07, 5.07, 5.07, 90, 90, 90), 'I m -3 m',
  [('I1','I-',0,0,0,1),('Ag1','Ag+',0.25,0,0.5,0.1667)], {'I-':-1,'Ag+':1}, ref="Ag disordered over the 12d tetrahedral sites (Strock 1934; Cava et al. 1977)")
S['Li3N'] = cif('Li3N', 'Li3N (alpha)', (3.648, 3.648, 3.875, 90, 90, 120), 'P 6/m m m',
  [('N1','N3-',0,0,0,1),('Li1','Li+',0,0,0.5,1),('Li2','Li+',0.3333333,0.6666667,0,1)], {'N3-':-3,'Li+':1}, ref="Rabenau & Schulz, J. Less-Common Met. 50 (1976) 155")
# sulphide electrolytes: cell, coordinates and occupancies as published (standard uncertainties omitted)
S['Li10GeP2S12'] = cif('LGPS', 'Li10GeP2S12 (LGPS, single crystal, 298 K)', (8.719, 8.719, 12.639, 90, 90, 90), 'P 42/n m c :1',
  [('Li1','Li+',0.267,0.273,0.194,0.466),('Li2','Li+',0,0.5,0.9454,0.86),('Li3','Li+',0.248,0.248,0,0.74),('Li4','Li+',0,0,0.251,0.81),
   ('Ge1','Ge4+',0,0.5,0.69154,0.5),('P1','P5+',0,0.5,0.69154,0.5),('P2','P5+',0,0,0.5,1),
   ('S1','S2-',0,0.18857,0.40707,1),('S2','S2-',0,0.29557,0.09727,1),('S3','S2-',0,0.69901,0.79168,1)],
  {'Li+':1,'Ge4+':4,'P5+':5,'S2-':-2}, ref="Kuhn, Koehler & Lotsch, Phys. Chem. Chem. Phys. 15 (2013) 11620 (origin choice 1)")
S['Li6PS5Cl'] = cif('Li6PS5Cl', 'Li6PS5Cl (argyrodite)', (9.85485, 9.85485, 9.85485, 90, 90, 90), 'F -4 3 m',
  [('Li1','Li+',0.3202,0.0183,0.6798,0.5),('Cl1','Cl-',0,0,0,0.385),('S3','S2-',0,0,0,0.615),('Cl2','Cl-',0.25,0.25,0.75,0.615),
   ('S1','S2-',0.25,0.25,0.75,0.385),('P1','P5+',0,0,0.5,1),('S2','S2-',0.12,-0.12,0.62,1)],
  {'Li+':1,'P5+':5,'S2-':-2,'Cl-':-1}, ref="Dewald et al., Chem. Mater. 31 (2019) 8328 (S/Cl mixed on 4a and 4d)")
for k,v in S.items():
    open(f'{out}/{k}.cif','w').write(v)
print(os.listdir(out))
