// SPDX-License-Identifier: GPL-3.0-or-later

import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

const PATCH_FLAG = Symbol.for("powder-toy-3d.visual-upgrade.v1");
const LIGHT_RIG_FLAG = Symbol.for("powder-toy-3d.three-point-lighting.v1");
const LUMA = "vec3(0.2126, 0.7152, 0.0722)";
const KEY_COLOR = 0xf4fdff;
const RIM_COLOR = 0x7ca5ff;
const FILL_COLOR = 0xd9edff;

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

  material.userData.baseOpacity = material.opacity;
  material.userData.baseTransparent = material.transparent;

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
  float neutralShade = clamp(renderedLuma / canonicalLuma, 0.68, 1.34);
  neutralShade = mix(1.0, neutralShade, ${shadeAmount});
  outgoingLight = vColor * neutralShade;
#endif
#include <opaque_fragment>
`,
    );
  };
  material.customProgramCacheKey = () => `${previousCacheKey?.() ?? ""}|canonical-palette-${profile}-v2`;
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

function lightWithColor(scene, color) {
  return scene.children.find((child) => child.isDirectionalLight && child.color.getHex() === color);
}

function lightingLevels(viewMode) {
  if (["fire", "persistent", "life"].includes(viewMode)) {
    return { ambient: 1.25, key: 2.6, fill: 1.15, rim: 2.8 };
  }
  if (viewMode === "cinematic") {
    return { ambient: 2.05, key: 4.7, fill: 2.35, rim: 4.15 };
  }
  if (viewMode === "clarity") {
    return { ambient: 4.35, key: 6.4, fill: 4.5, rim: 3.65 };
  }
  if (["xray", "heat", "pressure", "velocity", "gravity", "air"].includes(viewMode)) {
    return { ambient: 4.65, key: 5.2, fill: 3.7, rim: 4.05 };
  }
  return { ambient: 4.1, key: 5.8, fill: 3.65, rim: 3.7 };
}

function placeLight(light, target, forward, right, up, distance, offsets) {
  light.position.copy(target)
    .addScaledVector(forward, offsets.forward * distance)
    .addScaledVector(right, offsets.right * distance)
    .addScaledVector(up, offsets.up * distance);
  light.target.position.copy(target);
}

function updateThreePointLighting(scene, camera) {
  const rig = scene.userData.threePointLighting;
  if (!rig || !camera?.isCamera) return;

  const viewMode = globalThis.document?.documentElement?.dataset?.viewMode ?? "clarity";
  const levels = lightingLevels(viewMode);
  rig.ambient.intensity = levels.ambient;
  rig.key.intensity = levels.key;
  rig.fill.intensity = levels.fill;
  rig.rim.intensity = levels.rim;

  const target = rig.targetPosition.set(0, -1, 0);
  const forward = rig.forward.subVectors(target, camera.position);
  if (forward.lengthSq() < Number.EPSILON) forward.set(0, 0, -1);
  else forward.normalize();

  const right = rig.right.crossVectors(forward, camera.up);
  if (right.lengthSq() < Number.EPSILON) right.set(1, 0, 0);
  else right.normalize();
  const up = rig.up.crossVectors(right, forward).normalize();
  const distance = Math.max(30, Math.min(82, camera.position.distanceTo(target)));

  placeLight(rig.key, target, forward, right, up, distance, { forward: -0.58, right: -0.62, up: 0.68 });
  placeLight(rig.fill, target, forward, right, up, distance, { forward: -0.46, right: 0.72, up: 0.16 });
  placeLight(rig.rim, target, forward, right, up, distance, { forward: 0.62, right: 0.32, up: 0.54 });
}

function installThreePointLighting(scene) {
  if (!scene?.isScene || scene[LIGHT_RIG_FLAG]) return;
  const ambient = scene.children.find((child) => child.isHemisphereLight);
  const key = lightWithColor(scene, KEY_COLOR);
  const rim = lightWithColor(scene, RIM_COLOR);
  if (!ambient || !key || !rim) return;

  Object.defineProperty(scene, LIGHT_RIG_FLAG, { value: true });
  key.name = key.name || "MatterKeyLight";
  rim.name = rim.name || "MatterRimLight";

  const fill = new THREE.DirectionalLight(FILL_COLOR, 4.5);
  fill.name = "MatterFillLight";
  fill.castShadow = false;

  for (const light of [key, fill, rim]) {
    const target = new THREE.Object3D();
    target.name = `${light.name}Target`;
    light.target = target;
    scene.add(target);
  }
  scene.add(fill);

  scene.userData.threePointLighting = {
    cameraRelative: true,
    ambient,
    key,
    fill,
    rim,
    targetPosition: new THREE.Vector3(),
    forward: new THREE.Vector3(),
    right: new THREE.Vector3(),
    up: new THREE.Vector3(),
  };

  const previousBeforeRender = scene.onBeforeRender?.bind(scene);
  scene.onBeforeRender = (renderer, renderedScene, camera, ...rest) => {
    updateThreePointLighting(scene, camera);
    previousBeforeRender?.(renderer, renderedScene, camera, ...rest);
  };
}

if (!THREE.Object3D.prototype[PATCH_FLAG]) {
  Object.defineProperty(THREE.Object3D.prototype, PATCH_FLAG, { value: true });
  const originalAdd = THREE.Object3D.prototype.add;
  THREE.Object3D.prototype.add = function addWithVisualProfiles(...objects) {
    for (const object of objects) upgradeMatterMesh(object);
    const result = originalAdd.apply(this, objects);
    installThreePointLighting(this);
    return result;
  };
}
