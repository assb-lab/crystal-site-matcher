import { useEffect, useRef } from "react";
import * as THREE from "three";
import { TrackballControls } from "three/examples/jsm/controls/TrackballControls.js";
import { ConvexGeometry } from "three/examples/jsm/geometries/ConvexGeometry.js";
import { MarchingCubes } from "three/examples/jsm/objects/MarchingCubes.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import { MINIMUM_COLOR, MINIMUM_SITE_COLOR, SADDLE_COLOR, type SceneSpec } from "../lib/scene";
import type { Vec3 } from "../lib/structure";

export type ViewDir = "a" | "b" | "c" | "a*" | "b*" | "c*" | "reset";

interface Props {
  spec: SceneSpec;
  structureId: string;
  viewCmd: { dir: ViewDir; n: number } | null;
  onPick: (key: string) => void;
  describe: (key: string) => string;
}

interface Ctx {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: TrackballControls;
  content: THREE.Group;
  atomMesh: THREE.InstancedMesh | null;
  atomKeys: string[];
  gizmoScene: THREE.Scene;
  gizmoCam: THREE.OrthographicCamera;
  gizmoArrows: THREE.Group;
  cellMat: THREE.LineBasicMaterial;
  haloMat: THREE.MeshBasicMaterial;
  pathMats: LineMaterial[]; // resize both band and dashes; animate and recolour only dashes
  labels: { el: HTMLDivElement; pos: THREE.Vector3 }[];
  axisLabels: { el: HTMLSpanElement; dir: THREE.Vector3 }[];
  extent: number;
  axes: { a: Vec3; b: Vec3; c: Vec3 };
  raf: number;
}

const FOV = 24;
const GIZMO = 92;
/** Speed of the dashes along a highlighted hop path (Å/s). */
const DASH_SPEED = 0.9;

/** Preserve the band's bottleneck colour when the foreground colour changes. */
export function applyHopPathTheme(materials: LineMaterial[], ink: THREE.Color) {
  for (const m of materials) if (m.dashed) m.color.copy(ink);
}

function srgb(c: [number, number, number], k = 1) {
  return new THREE.Color().setRGB((c[0] / 255) * k, (c[1] / 255) * k, (c[2] / 255) * k, THREE.SRGBColorSpace);
}

function cssVar(name: string, fallback: string) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

function disposeTree(o: THREE.Object3D) {
  o.traverse((x) => {
    const m = x as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
    const mat = (m as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach((q) => q.dispose());
    else if (mat && mat !== undefined) mat.dispose();
  });
}

export default function Viewer({ spec, structureId, viewCmd, onPick, describe }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const ctxRef = useRef<Ctx | null>(null);
  const lastStructure = useRef<string>("");
  const pickRef = useRef(onPick);
  const describeRef = useRef(describe);
  pickRef.current = onPick;
  describeRef.current = describe;

  // ---------- init ----------
  useEffect(() => {
    const host = hostRef.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.autoClear = false;
    host.appendChild(renderer.domElement);
    renderer.domElement.style.display = "block";
    renderer.domElement.style.touchAction = "none";

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 2000);
    scene.add(camera);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x8a90a0, 1.6));
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(1.5, 2, 3);
    camera.add(key);
    const content = new THREE.Group();
    scene.add(content);

    const controls = new TrackballControls(camera, renderer.domElement);
    controls.rotateSpeed = 3.0;
    controls.zoomSpeed = 1.4;
    controls.panSpeed = 0.9;
    controls.staticMoving = false;
    controls.dynamicDampingFactor = 0.18;

    // axis gizmo
    const gizmoScene = new THREE.Scene();
    const gizmoCam = new THREE.OrthographicCamera(-1.4, 1.4, 1.4, -1.4, 0.1, 10);
    const gizmoArrows = new THREE.Group();
    gizmoScene.add(gizmoArrows);

    const cellMat = new THREE.LineBasicMaterial({ color: 0x333333, transparent: true, opacity: 0.8 });
    const haloMat = new THREE.MeshBasicMaterial({ color: 0xffb000, transparent: true, opacity: 0.35, depthWrite: false });

    const ctx: Ctx = {
      renderer,
      scene,
      camera,
      controls,
      content,
      atomMesh: null,
      atomKeys: [],
      gizmoScene,
      gizmoCam,
      gizmoArrows,
      cellMat,
      haloMat,
      pathMats: [],
      labels: [],
      axisLabels: [],
      extent: 10,
      axes: { a: [1, 0, 0], b: [0, 1, 0], c: [0, 0, 1] },
      raf: 0,
    };
    ctxRef.current = ctx;

    const applyTheme = () => {
      renderer.setClearColor(new THREE.Color(cssVar("--viewer-bg", "#f7f8fa")), 1);
      cellMat.color = new THREE.Color(cssVar("--cell-line", "#3a4150"));
      haloMat.color = new THREE.Color(cssVar("--select", "#ffb000"));
      applyHopPathTheme(ctx.pathMats, new THREE.Color(cssVar("--ink", "#1a1f2b")));
    };
    applyTheme();
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    mql.addEventListener("change", applyTheme);
    const mo = new MutationObserver(applyTheme);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "class"] });

    const resize = () => {
      const w = host.clientWidth,
        h = host.clientHeight;
      if (w === 0 || h === 0) return;
      renderer.setSize(w, h, false);
      renderer.domElement.style.width = w + "px";
      renderer.domElement.style.height = h + "px";
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      controls.handleResize();
      for (const m of ctx.pathMats) m.resolution.set(w, h);
    };
    const ro = new ResizeObserver(resize);
    ro.observe(host);
    resize();

    const v = new THREE.Vector3();
    const still = window.matchMedia("(prefers-reduced-motion: reduce)");
    let last = performance.now();
    const tick = () => {
      ctx.raf = requestAnimationFrame(tick);
      const now = performance.now();
      if (!still.matches) for (const m of ctx.pathMats) if (m.dashed) m.dashOffset -= (DASH_SPEED * (now - last)) / 1000;
      last = now;
      controls.update();
      const w = host.clientWidth,
        h = host.clientHeight;
      renderer.setViewport(0, 0, w, h);
      renderer.setScissorTest(false);
      renderer.clear();
      renderer.render(scene, camera);
      // labels
      for (const l of ctx.labels) {
        v.copy(l.pos).applyMatrix4(content.matrixWorld).project(camera);
        const visible = v.z < 1;
        l.el.style.display = visible ? "" : "none";
        l.el.style.transform = `translate(${((v.x + 1) / 2) * w}px, ${((1 - v.y) / 2) * h}px)`;
      }
      // gizmo
      const dir = new THREE.Vector3().subVectors(camera.position, controls.target).normalize();
      gizmoCam.position.copy(dir.multiplyScalar(4));
      gizmoCam.up.copy(camera.up);
      gizmoCam.lookAt(0, 0, 0);
      renderer.clearDepth();
      renderer.setScissorTest(true);
      renderer.setScissor(8, 8, GIZMO, GIZMO);
      renderer.setViewport(8, 8, GIZMO, GIZMO);
      renderer.render(gizmoScene, gizmoCam);
      renderer.setScissorTest(false);
      for (const al of ctx.axisLabels) {
        v.copy(al.dir).multiplyScalar(1.22).project(gizmoCam);
        al.el.style.transform = `translate(${8 + ((v.x + 1) / 2) * GIZMO}px, ${h - 8 - ((v.y + 1) / 2) * GIZMO}px)`;
      }
    };
    tick();

    // picking + hover
    const ray = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    let down: { x: number; y: number } | null = null;
    const hit = (ev: PointerEvent): string | null => {
      if (!ctx.atomMesh) return null;
      const r = renderer.domElement.getBoundingClientRect();
      ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      const hits = ray.intersectObject(ctx.atomMesh, false);
      if (hits.length && hits[0].instanceId !== undefined) return ctx.atomKeys[hits[0].instanceId];
      return null;
    };
    const onDown = (ev: PointerEvent) => (down = { x: ev.clientX, y: ev.clientY });
    const onUp = (ev: PointerEvent) => {
      if (down && Math.hypot(ev.clientX - down.x, ev.clientY - down.y) < 5) {
        const k = hit(ev);
        if (k) pickRef.current(k);
      }
      down = null;
    };
    let lastHover = 0;
    const onMove = (ev: PointerEvent) => {
      const tip = tipRef.current;
      if (!tip) return;
      if (ev.buttons) {
        tip.hidden = true;
        return;
      }
      const now = performance.now();
      if (now - lastHover < 40) return;
      lastHover = now;
      const k = hit(ev);
      if (!k) {
        tip.hidden = true;
        renderer.domElement.style.cursor = "";
        return;
      }
      const r = host.getBoundingClientRect();
      tip.hidden = false;
      tip.textContent = describeRef.current(k);
      tip.style.transform = `translate(${ev.clientX - r.left + 14}px, ${ev.clientY - r.top + 12}px)`;
      renderer.domElement.style.cursor = "pointer";
    };
    const onLeave = () => {
      if (tipRef.current) tipRef.current.hidden = true;
    };
    renderer.domElement.addEventListener("pointerdown", onDown);
    renderer.domElement.addEventListener("pointerup", onUp);
    renderer.domElement.addEventListener("pointermove", onMove);
    renderer.domElement.addEventListener("pointerleave", onLeave);

    return () => {
      cancelAnimationFrame(ctx.raf);
      ro.disconnect();
      mo.disconnect();
      mql.removeEventListener("change", applyTheme);
      controls.dispose();
      disposeTree(content);
      disposeTree(gizmoScene);
      renderer.dispose();
      host.removeChild(renderer.domElement);
      ctxRef.current = null;
    };
  }, []);

  // ---------- content ----------
  useEffect(() => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    const { content } = ctx;
    for (const ch of [...content.children]) {
      content.remove(ch);
      disposeTree(ch);
    }
    content.position.set(-spec.center[0], -spec.center[1], -spec.center[2]);
    content.updateMatrixWorld();

    const built = populateContent(content, spec, { halo: ctx.haloMat, cell: ctx.cellMat });
    ctx.atomMesh = built.atomMesh;
    ctx.atomKeys = built.atomKeys;
    ctx.pathMats = built.pathMats;
    const host = hostRef.current!;
    for (const m of ctx.pathMats) m.resolution.set(host.clientWidth, host.clientHeight);

    // labels
    const overlay = overlayRef.current!;
    for (const l of ctx.labels) l.el.remove();
    ctx.labels = spec.labels.map((l) => {
      const el = document.createElement("div");
      el.className = `vlabel vlabel-${l.kind}`;
      el.textContent = l.text;
      overlay.appendChild(el);
      return { el, pos: new THREE.Vector3(...l.xyz) };
    });

    // axis gizmo
    ctx.axes = spec.axes;
    const ga = ctx.gizmoArrows;
    for (const ch of [...ga.children]) {
      ga.remove(ch);
      disposeTree(ch);
    }
    for (const al of ctx.axisLabels) al.el.remove();
    ctx.axisLabels = [];
    const axCols = [0xd6453d, 0x2f9e54, 0x3567d6];
    (["a", "b", "c"] as const).forEach((n, i) => {
      const d = new THREE.Vector3(...spec.axes[n]).normalize();
      ga.add(new THREE.ArrowHelper(d, new THREE.Vector3(0, 0, 0), 1.0, axCols[i], 0.28, 0.16));
      const el = document.createElement("span");
      el.className = "vaxis";
      el.textContent = n;
      el.style.color = `#${axCols[i].toString(16).padStart(6, "0")}`;
      overlay.appendChild(el);
      ctx.axisLabels.push({ el, dir: d });
    });

    ctx.extent = spec.extent;
    if (lastStructure.current !== structureId) {
      lastStructure.current = structureId;
      setView(ctx, "reset");
    }
  }, [spec, structureId]);

  // ---------- view commands ----------
  useEffect(() => {
    const ctx = ctxRef.current;
    if (ctx && viewCmd) setView(ctx, viewCmd.dir);
  }, [viewCmd]);

  return (
    <div className="viewer" ref={hostRef}>
      <div className="viewer-overlay" ref={overlayRef} aria-hidden="true" />
      <div className="viewer-tip" ref={tipRef} hidden />
    </div>
  );
}

/** Build all 3D objects for a scene into `content` (shared by the main view and thumbnails). */
export function populateContent(
  content: THREE.Group,
  spec: SceneSpec,
  colors: { halo: THREE.MeshBasicMaterial; cell: THREE.LineBasicMaterial },
): { atomMesh: THREE.InstancedMesh; atomKeys: string[]; pathMats: LineMaterial[] } {
  // atoms
  const sphere = new THREE.SphereGeometry(1, 28, 18);
  const atomMat = new THREE.MeshStandardMaterial({ roughness: 0.42, metalness: 0.05 });
  const mesh = new THREE.InstancedMesh(sphere, atomMat, Math.max(spec.atoms.length, 1));
  mesh.count = spec.atoms.length;
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  spec.atoms.forEach((a, i) => {
    m4.compose(new THREE.Vector3(...a.xyz), q, new THREE.Vector3(a.radius, a.radius, a.radius));
    mesh.setMatrixAt(i, m4);
    mesh.setColorAt(i, srgb(a.color));
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingSphere();
  content.add(mesh);

  // selection halo
  const sel = spec.atoms.find((a) => a.key === spec.selectedKey);
  if (sel) {
    const halo = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 18), colors.halo.clone());
    halo.position.set(...sel.xyz);
    halo.scale.setScalar(sel.radius * 1.55 + 0.12);
    halo.renderOrder = 3;
    content.add(halo);
  }

  // bonds (two coloured halves each)
  if (spec.bonds.length) {
    const cyl = new THREE.CylinderGeometry(1, 1, 1, 14, 1, true);
    const bmat = new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0.05 });
    const bm = new THREE.InstancedMesh(cyl, bmat, spec.bonds.length * 2);
    const up = new THREE.Vector3(0, 1, 0);
    let k = 0;
    const r = spec.bondRadius;
    for (const b of spec.bonds) {
      const A = new THREE.Vector3(...b.a),
        B = new THREE.Vector3(...b.b);
      const M = A.clone().add(B).multiplyScalar(0.5);
      const dir = B.clone().sub(A).normalize();
      q.setFromUnitVectors(up, dir);
      for (const [p0, p1, col] of [
        [A, M, b.ca],
        [M, B, b.cb],
      ] as const) {
        const len = p0.distanceTo(p1);
        m4.compose(p0.clone().add(p1).multiplyScalar(0.5), q, new THREE.Vector3(r, len, r));
        bm.setMatrixAt(k, m4);
        bm.setColorAt(k, srgb(col as [number, number, number]));
        k++;
      }
    }
    bm.instanceMatrix.needsUpdate = true;
    if (bm.instanceColor) bm.instanceColor.needsUpdate = true;
    content.add(bm);
  }

  // polyhedra
  for (const p of spec.polys) {
    let geom: THREE.BufferGeometry | null = null;
    try {
      if (p.verts.length >= 4) {
        geom = new ConvexGeometry(p.verts.map((v) => new THREE.Vector3(...v)));
        if (!geom.getAttribute("position") || geom.getAttribute("position").count === 0) geom = null;
      }
    } catch {
      geom = null;
    }
    if (!geom && p.verts.length >= 3) {
      geom = new THREE.BufferGeometry();
      const flat: number[] = [];
      for (let i = 1; i + 1 < p.verts.length; i++) flat.push(...p.verts[0], ...p.verts[i], ...p.verts[i + 1]);
      geom.setAttribute("position", new THREE.Float32BufferAttribute(flat, 3));
      geom.computeVertexNormals();
    }
    if (!geom) continue;
    const mat = new THREE.MeshStandardMaterial({
      color: srgb(p.color),
      transparent: true,
      opacity: p.highlight ? Math.min(0.85, spec.polyOpacity + 0.25) : spec.polyOpacity,
      side: THREE.DoubleSide,
      depthWrite: false,
      roughness: 0.65,
      metalness: 0,
      emissive: p.highlight ? new THREE.Color(cssVar("--select", "#ffb000")) : new THREE.Color(0x000000),
      emissiveIntensity: p.highlight ? 0.25 : 0,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });
    const pm = new THREE.Mesh(geom, mat);
    pm.renderOrder = 2;
    content.add(pm);
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(geom, 8),
      new THREE.LineBasicMaterial({ color: p.highlight ? new THREE.Color(cssVar("--select-edge", "#b06f00")) : srgb(p.color, 0.5), transparent: true, opacity: 0.9 }),
    );
    edges.renderOrder = 2;
    content.add(edges);
  }

  // cell
  if (spec.cellEdges.length) {
    const pts: number[] = [];
    for (const [a, b] of spec.cellEdges) pts.push(...a, ...b);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    const lines = new THREE.LineSegments(g, colors.cell.clone());
    (lines.material as THREE.LineBasicMaterial).color = colors.cell.color;
    content.add(lines);
  }


  // migration hops (straight segments, coloured by bottleneck radius)
  if (spec.hopLines.length) {
    const pts: number[] = [];
    const cols: number[] = [];
    for (const h of spec.hopLines) {
      pts.push(...h.a, ...h.b);
      const c = srgb(h.color);
      cols.push(c.r, c.g, c.b, c.r, c.g, c.b);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(cols, 3));
    const lines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.95, depthTest: false }));
    lines.renderOrder = 5;
    content.add(lines);
  }

  // selected hop path: a wide band in the bottleneck colour with moving dashes on top, drawn over everything
  const pathMats: LineMaterial[] = [];
  if (spec.hopPath) {
    const hp = spec.hopPath;
    const pts: number[] = [];
    for (const [a, b] of hp.segs) pts.push(...a, ...b);
    const band = new LineMaterial({ color: srgb(hp.color), linewidth: 7, transparent: true, opacity: 0.55, depthTest: false });
    const dash = new LineMaterial({ color: new THREE.Color(cssVar("--ink", "#1a1f2b")), linewidth: 3, dashed: true, dashSize: 0.28, gapSize: 0.2, depthTest: false });
    for (const [mat, order] of [
      [band, 6],
      [dash, 7],
    ] as const) {
      const g = new LineSegmentsGeometry().setPositions(pts);
      const line = new LineSegments2(g, mat);
      line.computeLineDistances();
      line.renderOrder = order;
      content.add(line);
    }
    pathMats.push(band, dash);
    const neck = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 16, 12), new THREE.MeshBasicMaterial({ color: srgb(hp.color), depthTest: false }), hp.necks.length);
    hp.necks.forEach((n, i) => {
      m4.compose(new THREE.Vector3(...n), q, new THREE.Vector3(0.11, 0.11, 0.11));
      neck.setMatrixAt(i, m4);
    });
    neck.instanceMatrix.needsUpdate = true;
    neck.computeBoundingSphere();
    neck.renderOrder = 8;
    content.add(neck);
    if (hp.saddles.length) {
      // saddles as small cubes, so they read apart from the round bottleneck markers
      const sad = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: srgb(SADDLE_COLOR), depthTest: false }), hp.saddles.length);
      hp.saddles.forEach((p, i) => {
        m4.compose(new THREE.Vector3(...p), new THREE.Quaternion(), new THREE.Vector3(0.2, 0.2, 0.2));
        sad.setMatrixAt(i, m4);
      });
      sad.instanceMatrix.needsUpdate = true;
      sad.computeBoundingSphere();
      sad.renderOrder = 8;
      content.add(sad);
    }
  }

  // BVSE minima: small markers drawn over everything (empty candidate sites larger and coloured)
  for (const occupied of [true, false]) {
    const ms = spec.minima.filter((m) => m.occupied === occupied);
    if (!ms.length) continue;
    const mat = occupied
      ? new THREE.MeshBasicMaterial({ color: srgb(MINIMUM_SITE_COLOR), transparent: true, opacity: 0.75, depthTest: false })
      : new THREE.MeshBasicMaterial({ color: srgb(MINIMUM_COLOR), depthTest: false });
    const mm = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 16, 12), mat, ms.length);
    const r = occupied ? 0.12 : 0.2;
    ms.forEach((m, i) => {
      m4.compose(new THREE.Vector3(...m.xyz), new THREE.Quaternion(), new THREE.Vector3(r, r, r));
      mm.setMatrixAt(i, m4);
    });
    mm.instanceMatrix.needsUpdate = true;
    mm.computeBoundingSphere();
    mm.renderOrder = 9;
    content.add(mm);
  }

  // BVSE isosurface
  if (spec.iso) addIsosurface(content, spec.iso);

  return { atomMesh: mesh, atomKeys: spec.atoms.map((a) => a.key), pathMats };
}

function addIsosurface(content: THREE.Group, iso: NonNullable<SceneSpec["iso"]>) {
  const N = 52;
  const mat = new THREE.MeshStandardMaterial({
    color: srgb(iso.color),
    transparent: true,
    opacity: 0.62,
    side: THREE.DoubleSide,
    depthWrite: false,
    roughness: 0.45,
    emissive: srgb(iso.color),
    emissiveIntensity: 0.25,
  });
  const mc = new MarchingCubes(N, mat, false, false, 250000);
  const [na, nb, nc] = iso.n;
  const f = iso.field;
  const at = (i: number, j: number, k: number) => {
    i = ((i % na) + na) % na;
    j = ((j % nb) + nb) % nb;
    k = ((k % nc) + nc) % nc;
    return f[i + na * (j + nb * k)];
  };
  const sample = (u: number, v: number, w: number) => {
    const x = u * na,
      y = v * nb,
      z = w * nc;
    const i = Math.floor(x),
      j = Math.floor(y),
      k = Math.floor(z);
    const dx = x - i,
      dy = y - j,
      dz = z - k;
    let s = 0;
    for (let a = 0; a < 2; a++)
      for (let b = 0; b < 2; b++)
        for (let c = 0; c < 2; c++) s += (a ? dx : 1 - dx) * (b ? dy : 1 - dy) * (c ? dz : 1 - dz) * at(i + a, j + b, k + c);
    return s;
  };
  for (let z = 0; z < N; z++)
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) mc.field[x + N * (y + N * z)] = sample((x - 2) / (N - 4), (y - 2) / (N - 4), (z - 2) / (N - 4));
  mc.isolation = iso.level;
  mc.update();
  const sc = N / 2 / (N - 4),
    off = (N / 2 - 2) / (N - 4);
  const [A, B, C] = iso.axes;
  for (let i = 0; i < iso.supercell[0]; i++)
    for (let j = 0; j < iso.supercell[1]; j++)
      for (let k = 0; k < iso.supercell[2]; k++) {
        const m = new THREE.Mesh(mc.geometry, mat);
        // local [-1,1]^3 → fractional (off + sc·f) → Cartesian
        const M = new THREE.Matrix4().set(
          A[0] * sc, B[0] * sc, C[0] * sc, A[0] * (off + i) + B[0] * (off + j) + C[0] * (off + k),
          A[1] * sc, B[1] * sc, C[1] * sc, A[1] * (off + i) + B[1] * (off + j) + C[1] * (off + k),
          A[2] * sc, B[2] * sc, C[2] * sc, A[2] * (off + i) + B[2] * (off + j) + C[2] * (off + k),
          0, 0, 0, 1,
        );
        m.matrixAutoUpdate = false;
        m.matrix.copy(M);
        m.renderOrder = 4;
        content.add(m);
      }
}

function setView(ctx: Ctx, dir: ViewDir) {
  const { camera, controls, axes } = ctx;
  const A = new THREE.Vector3(...axes.a),
    B = new THREE.Vector3(...axes.b),
    C = new THREE.Vector3(...axes.c);
  let d: THREE.Vector3, up: THREE.Vector3;
  switch (dir) {
    case "a":
      d = A.clone().normalize();
      up = C.clone();
      break;
    case "b":
      d = B.clone().normalize();
      up = C.clone();
      break;
    case "c":
      d = C.clone().normalize();
      up = B.clone();
      break;
    case "a*":
      d = new THREE.Vector3().crossVectors(B, C).normalize();
      up = C.clone();
      break;
    case "b*":
      d = new THREE.Vector3().crossVectors(C, A).normalize();
      up = C.clone();
      break;
    case "c*":
      d = new THREE.Vector3().crossVectors(A, B).normalize();
      up = B.clone();
      break;
    default:
      d = new THREE.Vector3(0.62, -1.0, 0.42).normalize();
      up = new THREE.Vector3(0, 0, 1);
  }
  // make "up" perpendicular to the viewing direction
  up.sub(d.clone().multiplyScalar(up.dot(d)));
  if (up.lengthSq() < 1e-6) up.set(0, 1, 0);
  up.normalize();
  const dist = (ctx.extent / Math.tan(((FOV / 2) * Math.PI) / 180)) * 1.08;
  controls.target.set(0, 0, 0);
  camera.position.copy(d.multiplyScalar(dist));
  camera.up.copy(up);
  camera.near = Math.max(0.1, dist / 100);
  camera.far = dist * 10;
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();
}

// ---------------------------------------------------------------------------
// Thumbnails: one shared offscreen renderer, transparent background.
let thumbCtx: { renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera } | null = null;

export function renderThumbnail(spec: SceneSpec, size = 176): string | null {
  try {
    if (!thumbCtx) {
      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
      renderer.setPixelRatio(1);
      renderer.setSize(size, size, false);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.setClearColor(0x000000, 0);
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 2000);
      scene.add(camera);
      scene.add(new THREE.HemisphereLight(0xffffff, 0x8a90a0, 1.6));
      const key = new THREE.DirectionalLight(0xffffff, 2.2);
      key.position.set(1.5, 2, 3);
      camera.add(key);
      thumbCtx = { renderer, scene, camera };
    }
    const { renderer, scene, camera } = thumbCtx;
    const content = new THREE.Group();
    populateContent(content, spec, {
      halo: new THREE.MeshBasicMaterial({ color: 0xffb000, transparent: true, opacity: 0.35 }),
      cell: new THREE.LineBasicMaterial({ color: 0x8890a0 }),
    });
    content.position.set(-spec.center[0], -spec.center[1], -spec.center[2]);
    scene.add(content);
    const d = new THREE.Vector3(0.62, -1.0, 0.42).normalize();
    const dist = (spec.extent / Math.tan(((FOV / 2) * Math.PI) / 180)) * 1.02;
    camera.position.copy(d.multiplyScalar(dist));
    camera.up.set(0, 0, 1);
    camera.near = dist / 100;
    camera.far = dist * 10;
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    renderer.clear();
    renderer.render(scene, camera);
    const url = renderer.domElement.toDataURL("image/png");
    scene.remove(content);
    disposeTree(content);
    return url;
  } catch {
    return null;
  }
}
