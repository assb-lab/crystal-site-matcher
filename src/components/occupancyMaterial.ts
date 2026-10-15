// A camera-facing occupancy pie on each sphere; keep the standard sphere geometry, lighting and picking.
import * as THREE from "three";
import type { SceneAtom } from "../lib/scene";

export function applyOccupancyColors(geometry: THREE.BufferGeometry, material: THREE.MeshStandardMaterial, atoms: SceneAtom[]): THREE.DataTexture | null {
  if (!atoms.some((a) => a.sectors.length > 1)) return null;
  const info = new Float32Array(Math.max(atoms.length, 1) * 2);
  const palette: number[] = [];
  const patterns = new Map<string, { offset: number; count: number }>();
  let maxSectors = 1;
  for (let i = 0; i < atoms.length; i++) {
    const sectors = atoms[i].sectors;
    const key = JSON.stringify(sectors);
    let pattern = patterns.get(key);
    if (!pattern) {
      pattern = { offset: palette.length / 4, count: sectors.length };
      let end = 0;
      for (let j = 0; j < sectors.length; j++) {
        const s = sectors[j];
        end += s.fraction;
        const color = new THREE.Color().setRGB(s.color[0] / 255, s.color[1] / 255, s.color[2] / 255, THREE.SRGBColorSpace);
        palette.push(color.r, color.g, color.b, j === sectors.length - 1 ? 1 : end);
      }
      patterns.set(key, pattern);
    }
    info[i * 2] = pattern.offset;
    info[i * 2 + 1] = pattern.count;
    maxSectors = Math.max(maxSectors, pattern.count);
  }
  const width = Math.min(256, palette.length / 4);
  const height = Math.ceil(palette.length / 4 / width);
  const data = new Float32Array(width * height * 4);
  data.set(palette);
  const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.FloatType);
  texture.needsUpdate = true;
  geometry.setAttribute("occupancyInfo", new THREE.InstancedBufferAttribute(info, 2));
  material.customProgramCacheKey = () => `occupancy-pie-v1-${maxSectors}`;
  material.addEventListener("dispose", () => texture.dispose());
  material.onBeforeCompile = (shader) => {
    shader.uniforms.occupancyPalette = { value: texture };
    shader.uniforms.occupancySize = { value: new THREE.Vector2(width, height) };
    shader.vertexShader = shader.vertexShader.replace("#include <common>", `#include <common>
attribute vec2 occupancyInfo;
varying vec2 vOccupancyInfo;
varying vec3 vOccupancyCentre;`)
      .replace("#include <project_vertex>", `#include <project_vertex>
vec4 occupancyCentre = vec4(0.0, 0.0, 0.0, 1.0);
#ifdef USE_INSTANCING
  occupancyCentre = instanceMatrix * occupancyCentre;
#endif
vOccupancyCentre = (modelViewMatrix * occupancyCentre).xyz;
vOccupancyInfo = occupancyInfo;`);
    shader.fragmentShader = shader.fragmentShader.replace("#include <common>", `#include <common>
uniform mat4 projectionMatrix;
uniform sampler2D occupancyPalette;
uniform vec2 occupancySize;
varying vec2 vOccupancyInfo;
varying vec3 vOccupancyCentre;`)
      .replace("#include <color_fragment>", `#include <color_fragment>
if (vOccupancyInfo.y > 1.5) {
  // Start at the top and advance clockwise, relative to the camera for every viewing direction.
  vec4 pointClip = projectionMatrix * vec4(-vViewPosition, 1.0);
  vec4 centreClip = projectionMatrix * vec4(vOccupancyCentre, 1.0);
  vec2 pie = (pointClip.xy / pointClip.w - centreClip.xy / centreClip.w) / vec2(projectionMatrix[0][0], projectionMatrix[1][1]);
  float angle = mod(atan(pie.x, pie.y) + PI2, PI2) / PI2;
  for (int i = 0; i < ${maxSectors}; i++) {
    if (float(i) >= vOccupancyInfo.y) break;
    float index = vOccupancyInfo.x + float(i);
    vec2 uv = (vec2(mod(index, occupancySize.x), floor(index / occupancySize.x)) + 0.5) / occupancySize;
    vec4 sector = texture2D(occupancyPalette, uv);
    if (angle < sector.a) { diffuseColor.rgb = sector.rgb; break; }
  }
}`);
  };
  return texture;
}
