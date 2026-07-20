// SPDX-License-Identifier: GPL-3.0-or-later

import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

const PATCH_FLAG = Symbol.for("powder-toy-3d.visual-upgrade.v1");
const LUMA = "vec3(0.2126, 0.7152, 0.0722)";

function near(value, expected, tolerance = 0.025) {
  return Number.isFinite(value) && Math.abs(value - expected) <= tolerance;
}

function classifyMatterMesh(mesh) {
  const geometry = mesh?.geometry;
  const parameters = geometry?.parameters ?? {};
  if (!mesh?.isInstancedMesh || mesh.userData.visualProfile) return null;

  if (geometry.type === "BoxGeometry" && near(parameters.width, 0.92)) return "solid";
  if (geometry.type === "BoxGeometry" && near(parameters.width, 0.93)) return "metal";
  if (geometry.type === "OctahedronGeometry" && near(parameters.radius, 0.59)) return "glass";
  if (geometry.type === "IcosahedronGeometry" && near(parameters.radius, 0.54)) return "powder";
  if (geometry.type === "OctahedronGeometry" && near(parameters.radius, 0.57)) return "crystal";
  if (geometry.type === "SphereGeometry" && near(parameters.radius, 0.56)) return "liquid";
  if (geometry.type === "SphereGeometry" && near(parameters.radius, 0.57)) return "molten";
  if (geometry.type === "IcosahedronGeometry" && near(parameters.radius, 0.47)) return "gas";
  if (geometry.type === "ConeGeometry" && near(parameters.radius, 0.5) && near(parameters.height, 1.18)) return "flame";
  return null;
}

function deformGeometry(geometry, amount = 0.06, verticalBias = 0) {
  const position = geometry.attributes.position;
  for (let index = 0; index < position.count; index += 1) {
    const x = position.getX(index);
    const y = position.getY(index);
    const z = position.getZ(index);
    const noise = Math.sin(x * 17.13 + y * 31.77 + z * 47.21) * 0.5
      + Math.sin(x * 53.61 - y * 11.27 + z * 23.43) * 0.5;
    const scale = 1 + noise * amount + Math.abs(y) * verticalBias;
    position.setXYZ(index, x * scale, y * scale, z * scale);
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function createProfileGeometry(profile) {
  switch (profile) {
    case "solid":
      return new RoundedBoxGeometry(0.92, 0.92, 0.92, 1, 0.09);
    case "metal":
      return new RoundedBoxGeometry(0.94, 0.94, 0.94, 1, 0.13);
    case "glass": {
      const geometry = new THREE.DodecahedronGeometry(0.59, 0);
      geometry.scale(0.96, 1.08, 0.96);
      return geometry;
    }
    case "powder":
      return deformGeometry(new THREE.IcosahedronGeometry(0.54, 0), 0.095, 0.018);
    case "crystal": {
      const geometry = new THREE.CylinderGeometry(0.2, 0.45, 1.08, 6, 1, false);
      geometry.rotateX(Math.PI * 0.5);
      return geometry;
    }
    case "liquid":
      return new THREE.SphereGeometry(0.56, 8, 6);
    case "molten":
      return deformGeometry(new THREE.SphereGeometry(0.57, 8, 6), 0.035, 0.012);
    case "gas":
      return deformGeometry(new THREE.IcosahedronGeometry(0.49, 1), 0.055, 0);
    case "flame": {
      const geometry = new THREE.ConeGeometry(0.5, 1.24, 8, 2, true);
      geometry.translate(0, 0.08, 0);
      return geometry;
    }
    default:
      return null;
  }
}

function profileShadeAmount(profile) {
  switch (profile) {
    case "metal": return 0.5;
    case "glass": return 0.26;
    case "crystal": return 0.38;
    case "liquid": return 0.3;
    default: return 0.4;
  }
}

function applySurfaceProfile(material, profile) {
  material.toneMapped = false;
  material.dithering = true;
  material.userData.visualProfile = profile;

  if (profile === "solid") {
    material.roughness = 0.58;
    material.metalness = 0.06;
    material.emissiveIntensity = 0.025;
  } else if (profile === "metal") {
    material.roughness = 0.23;
    material.metalness = 0.74;
    material.clearcoat = 0.32;
    material.clearcoatRoughness = 0.18;
    material.emissiveIntensity = 0.03;
  } else if (profile === "glass") {
    material.roughness = 0.07;
    material.metalness = 0;
    material.clearcoat = 1;
    material.clearcoatRoughness = 0.04;
    material.transmission = 0.08;
    material.thickness = 0.65;
    material.ior = 1.46;
    material.opacity = 0.7;
    material.emissiveIntensity = 0.018;
  } else if (profile === "powder") {
    material.roughness = 0.92;
    material.metalness = 0;
    material.flatShading = true;
    material.emissiveIntensity = 0.035;
  } else if (profile === "crystal") {
    material.roughness = 0.28;
    material.metalness = 0.03;
    material.clearcoat = 0.78;
    material.clearcoatRoughness = 0.12;
    material.iridescence = 0.08;
    material.emissiveIntensity = 0.025;
  } else if (profile === "liquid") {
    material.roughness = 0.08;
    material.metalness = 0;
    material.clearcoat = 1;
    material.clearcoatRoughness = 0.06;
    material.transmission = 0.04;
    material.thickness = 0.35;
    material.ior = 1.33;
    material.opacity = 0.82;
    material.emissiveIntensity = 0.018;
  } else if (profile === "molten") {
    material.opacity = 0.96;
  } else if (profile === "gas") {
    material.opacity = 0.48;
  } else if (profile === "flame") {
    material.opacity = 0.82;
  }

  if (!material.isMeshStandardMaterial) {
    material.needsUpdate = true;
    return;
  }

  const previousCompile = material.onBeforeCompile?.bind(material);
  const previousCacheKey = material.customProgramCacheKey?.bind(material);
  const shadeAmount = profileShadeAmount(profile).toFixed(3);

  material.onBeforeCompile = (shader, renderer) => {
    previousCompile?.(shader, renderer);
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <opaque_fragment>",
      `
#ifdef USE_COLOR
  float canonicalLuma = max(dot(vColor, ${LUMA}), 0.018);
  float renderedLuma = dot(max(outgoingLight, vec3(0.0)), ${LUMA});
  float neutralShade = clamp(renderedLuma / canonicalLuma, 0.58, 1.3);
  neutralShade = mix(1.0, neutralShade, ${shadeAmount});
  outgoingLight = vColor * neutralShade;
#endif
#include <opaque_fragment>
`,
    );
  };
  material.customProgramCacheKey = () => `${previousCacheKey?.() ?? ""}|canonical-palette-${profile}-v1`;
  material.needsUpdate = true;
}

function upgradeMatterMesh(mesh) {
  const profile = classifyMatterMesh(mesh);
  if (!profile) return;

  const geometry = createProfileGeometry(profile);
  if (geometry) mesh.geometry = geometry;
  applySurfaceProfile(mesh.material, profile);
  mesh.userData.visualProfile = profile;
  mesh.userData.canonicalPalette = true;
}

if (!THREE.Object3D.prototype[PATCH_FLAG]) {
  Object.defineProperty(THREE.Object3D.prototype, PATCH_FLAG, { value: true });
  const originalAdd = THREE.Object3D.prototype.add;
  THREE.Object3D.prototype.add = function addWithVisualProfiles(...objects) {
    for (const object of objects) upgradeMatterMesh(object);
    return originalAdd.apply(this, objects);
  };
}
