// SPDX-License-Identifier: GPL-3.0-or-later

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { MATERIAL_BY_ID, MAT, UPSTREAM_LIFE_RULES, UPSTREAM_WALLS } from "./materials.js";
import { PIPE_FLAG } from "./simulation.js";
import { formatSignText, parseSignAction } from "./signs.js";
import { graphicsStyle } from "./graphics-modes.js";

const SILICON_COLORS = [
  0x5a6679, 0x6878a1, 0xabbfdd, 0x838490,
  0xbccddf, 0x82a0d2, 0x5b6680, 0x232c3b,
  0x485067, 0x8b9ab6, 0xadb1c1, 0xc3c6d1,
  0x8594ad, 0x262f47, 0xa9aebc, 0xc2e1f7,
];
const PLANT_LEAF_COLORS = [
  0xf3f6f4, 0xffdf32, 0xffb7c5, 0xfa0019,
  0x80cec4, 0x7fff00, 0x004ab2, 0x0cac00,
];
const PLASMA_GRADIENT = [
  [0, [0x00, 0x00, 0x00]],
  [0.25, [0x30, 0x10, 0x40]],
  [0.5, [0x30, 0x10, 0x60]],
  [0.9, [0xaf, 0xff, 0xff]],
  [1, [0xaf, 0xff, 0xff]],
];

const RENDER_KINDS = ["solid", "powder", "liquid", "gas"];
const METALLIC_TYPES = new Set([
  MAT.METL, MAT.BMTL, MAT.BRMT, MAT.IRON, MAT.GOLD, MAT.TTAN, MAT.TUNG, MAT.PTNM,
  MAT.ETRD, MAT.NTCT, MAT.PTCT, MAT.INWR, MAT.WIRE, MAT.INST, MAT.PSCN, MAT.NSCN,
].filter(Number.isInteger));
const TRANSLUCENT_TYPES = new Set([
  MAT.GLAS, MAT.BGLA, MAT.DMND, MAT.FILT, MAT.INVIS, MAT.QRTZ, MAT.PQRT, MAT.CRMC,
].filter(Number.isInteger));
const CRYSTAL_TYPES = new Set([
  MAT.SALT, MAT.SAND, MAT.QRTZ, MAT.PQRT, MAT.SNOW, MAT.ICEI, MAT.FRZZ, MAT.RFRG,
].filter(Number.isInteger));
const MOLTEN_TYPES = new Set([
  MAT.LAVA, MAT.MWAX, MAT.SLTW, MAT.RFGL,
].filter(Number.isInteger));
const FLAME_TYPES = new Set([
  MAT.FIRE, MAT.PLSM, MAT.CFLM, MAT.LIGH, MAT.THDR, MAT.EMBR, MAT.VRSG,
].filter(Number.isInteger));
const NO_DECORATION_TYPES = new Set([MAT.VIRS, MAT.VRSS, MAT.VRSG].filter(Number.isInteger));
const BIZARRE_TYPES = new Set([MAT.BIZR, MAT.BIZRG, MAT.BIZRS].filter(Number.isInteger));

function visualMeshKey(type, renderKind) {
  if (FLAME_TYPES.has(type)) return "flame";
  if (MOLTEN_TYPES.has(type)) return "molten";
  if (TRANSLUCENT_TYPES.has(type)) return "glass";
  if (METALLIC_TYPES.has(type)) return "metal";
  if (CRYSTAL_TYPES.has(type) && renderKind === "powder") return "crystal";
  return renderKind;
}

function tintEmissiveWithInstanceColor(material) {
  if (!material.emissive) return material;
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      "vec3 totalEmissiveRadiance = emissive;",
      "vec3 totalEmissiveRadiance = emissive * vColor;",
    );
  };
  material.customProgramCacheKey = () => "instance-tinted-emissive-v1";
  return material;
}

export class MatterRenderer {
  constructor(canvas, simulation) {
    this.canvas = canvas;
    this.simulation = simulation;
    this.sectionEnabled = false;
    this.sectionDepth = Math.floor(simulation.depth / 2);
    this.lastRenderCounts = Object.fromEntries(RENDER_KINDS.map((kind) => [kind, 0]));
    this.shake = 0;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    this.renderer.setClearColor(0x0b1820, 1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 2.3;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0b1820);
    this.scene.fog = new THREE.FogExp2(0x0b1820, 0.0025);
    this.signGroup = new THREE.Group();
    this.signGroup.renderOrder = 12;
    this.scene.add(this.signGroup);
    this.lastSignVersion = -1;
    this.lastDynamicSignTick = -1;

    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 300);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.065;
    this.controls.minDistance = 34;
    this.controls.maxDistance = 110;
    this.controls.enablePan = true;
    this.controls.screenSpacePanning = true;
    this.controls.mouseButtons = {
      LEFT: null,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.ROTATE,
    };
    this.controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.scratchMatrix = new THREE.Matrix4();
    this.scratchPosition = new THREE.Vector3();
    this.scratchScale = new THREE.Vector3(1, 1, 1);
    this.scratchQuaternion = new THREE.Quaternion();
    this.scratchEuler = new THREE.Euler();
    this.scratchColor = new THREE.Color();
    this.carriedColor = new THREE.Color();
    this.hotColor = new THREE.Color(0xff3800);
    this.coolColor = new THREE.Color(0x78bfff);
    this.visibilityLift = new THREE.Color(0xb8d9e3);
    this.baseBloomStrength = 0.54;
    this.viewMode = "clarity";
    this.postProcessingEnabled = false;

    this.buildEnvironment();
    this.buildMatterMeshes();
    this.buildInteractionPlane();
    this.buildPostProcessing();
    this.resetCamera(false);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas.parentElement);
    this.resize();
  }

  buildEnvironment() {
    const { width, height, depth } = this.simulation;
    const ambient = new THREE.HemisphereLight(0xe6f9ff, 0x547487, 4.8);
    this.scene.add(ambient);
    this.ambientLight = ambient;

    const key = new THREE.DirectionalLight(0xf4fdff, 6.2);
    key.position.set(-25, 35, 40);
    this.scene.add(key);
    this.keyLight = key;

    const rim = new THREE.DirectionalLight(0x7ca5ff, 4.1);
    rim.position.set(30, 8, -35);
    this.scene.add(rim);
    this.rimLight = rim;

    this.heatLight = new THREE.PointLight(0xff4817, 0, 32, 1.7);
    this.scene.add(this.heatLight);

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(width * 2.7, depth * 3.3),
      new THREE.MeshPhysicalMaterial({
        color: 0x18394a,
        roughness: 0.48,
        metalness: 0.42,
        transparent: true,
        opacity: 0.9,
      }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -height / 2 - 1.7;
    this.scene.add(floor);

    const floorGrid = new THREE.GridHelper(width * 2.7, 54, 0x24546b, 0x102b38);
    floorGrid.position.y = floor.position.y + 0.035;
    floorGrid.material.transparent = true;
    floorGrid.material.opacity = 0.46;
    this.scene.add(floorGrid);
    this.floorGrid = floorGrid;

    const chamberBox = new THREE.BoxGeometry(width + 1.4, height + 1.4, depth + 1.4);
    const edges = new THREE.EdgesGeometry(chamberBox);
    this.chamberEdges = new THREE.LineSegments(
      edges,
      new THREE.LineBasicMaterial({ color: 0x4fb6d2, transparent: true, opacity: 0.23 }),
    );
    this.scene.add(this.chamberEdges);

    const cornerLength = 3.6;
    const cornerMaterial = new THREE.LineBasicMaterial({ color: 0x7ee8ff, transparent: true, opacity: 0.74 });
    const cornerPoints = [];
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        for (const sz of [-1, 1]) {
          const x = sx * (width + 1.5) / 2;
          const y = sy * (height + 1.5) / 2;
          const z = sz * (depth + 1.5) / 2;
          cornerPoints.push(
            x, y, z, x - sx * cornerLength, y, z,
            x, y, z, x, y - sy * cornerLength, z,
            x, y, z, x, y, z - sz * cornerLength,
          );
        }
      }
    }
    const cornersGeometry = new THREE.BufferGeometry();
    cornersGeometry.setAttribute("position", new THREE.Float32BufferAttribute(cornerPoints, 3));
    this.scene.add(new THREE.LineSegments(cornersGeometry, cornerMaterial));

    const particleCount = 900;
    const starPositions = new Float32Array(particleCount * 3);
    for (let i = 0; i < particleCount; i += 1) {
      const radius = 65 + Math.random() * 75;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      starPositions[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
      starPositions[i * 3 + 1] = radius * Math.cos(phi);
      starPositions[i * 3 + 2] = radius * Math.sin(phi) * Math.sin(theta);
    }
    const starGeometry = new THREE.BufferGeometry();
    starGeometry.setAttribute("position", new THREE.BufferAttribute(starPositions, 3));
    const stars = new THREE.Points(
      starGeometry,
      new THREE.PointsMaterial({ color: 0x6cb3cc, size: 0.12, transparent: true, opacity: 0.42, depthWrite: false }),
    );
    this.scene.add(stars);
    this.stars = stars;
  }

  buildMatterMeshes() {
    const capacity = this.simulation.size;
    const definitions = {
      solid: {
        geometry: new THREE.BoxGeometry(0.92, 0.92, 0.92, 1, 1, 1),
        material: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.38, metalness: 0.28, emissive: 0xffffff, emissiveIntensity: 0.24 }),
        renderKind: "solid",
      },
      metal: {
        geometry: new THREE.BoxGeometry(0.93, 0.93, 0.93, 1, 1, 1),
        material: new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.3, metalness: 0.52, clearcoat: 0.3, clearcoatRoughness: 0.2, emissive: 0xffffff, emissiveIntensity: 0.22 }),
        renderKind: "solid",
      },
      glass: {
        geometry: new THREE.OctahedronGeometry(0.59, 0),
        material: new THREE.MeshPhysicalMaterial({
          vertexColors: true, roughness: 0.08, metalness: 0.03, clearcoat: 1, clearcoatRoughness: 0.06,
          transparent: true, opacity: 0.62, depthWrite: true, emissive: 0xffffff, emissiveIntensity: 0.16,
        }),
        renderKind: "solid",
      },
      powder: {
        geometry: new THREE.IcosahedronGeometry(0.54, 0),
        material: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0.02, emissive: 0xffffff, emissiveIntensity: 0.26 }),
        renderKind: "powder",
      },
      crystal: {
        geometry: new THREE.OctahedronGeometry(0.57, 0),
        material: new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.36, metalness: 0.06, clearcoat: 0.62, clearcoatRoughness: 0.24, emissive: 0xffffff, emissiveIntensity: 0.22 }),
        renderKind: "powder",
      },
      liquid: {
        geometry: new THREE.SphereGeometry(0.56, 8, 6),
        material: new THREE.MeshPhysicalMaterial({
          vertexColors: true,
          roughness: 0.16,
          metalness: 0.08,
          clearcoat: 0.82,
          clearcoatRoughness: 0.16,
          transparent: true,
          opacity: 0.86,
          emissive: 0xffffff,
          emissiveIntensity: 0.16,
        }),
        renderKind: "liquid",
      },
      molten: {
        geometry: new THREE.SphereGeometry(0.57, 8, 6),
        material: new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.94 }),
        renderKind: "liquid",
      },
      gas: {
        geometry: new THREE.IcosahedronGeometry(0.47, 1),
        material: new THREE.MeshBasicMaterial({
          vertexColors: true,
          transparent: true,
          opacity: 0.58,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        }),
        renderKind: "gas",
      },
      flame: {
        geometry: new THREE.ConeGeometry(0.5, 1.18, 7, 1, true),
        material: new THREE.MeshBasicMaterial({
          vertexColors: true, transparent: true, opacity: 0.78, depthWrite: false,
          blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
        }),
        renderKind: "gas",
      },
    };

    this.meshes = {};
    for (const [kind, definition] of Object.entries(definitions)) {
      tintEmissiveWithInstanceColor(definition.material);
      const mesh = new THREE.InstancedMesh(definition.geometry, definition.material, capacity);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.material.userData.baseOpacity = mesh.material.opacity;
      mesh.material.userData.baseTransparent = mesh.material.transparent;
      mesh.userData.renderKind = definition.renderKind;
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.renderOrder = definition.renderKind === "gas" ? 3 : definition.renderKind === "liquid" ? 2 : 1;
      this.scene.add(mesh);
      this.meshes[kind] = mesh;
    }

    this.wallMesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(this.simulation.air.cellSize * 0.94, this.simulation.air.cellSize * 0.94, this.simulation.air.cellSize * 0.94),
      tintEmissiveWithInstanceColor(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.52, metalness: 0.28, transparent: true, opacity: 0.2, depthWrite: false, emissive: 0xffffff, emissiveIntensity: 0.2 })),
      this.simulation.air.size,
    );
    this.wallMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.wallMesh.count = 0;
    this.wallMesh.frustumCulled = false;
    this.wallMesh.renderOrder = 2;
    this.scene.add(this.wallMesh);

    this.fieldMesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(this.simulation.air.cellSize * 0.9, this.simulation.air.cellSize * 0.9, this.simulation.air.cellSize * 0.9),
      new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.28, depthWrite: false, blending: THREE.AdditiveBlending }),
      this.simulation.air.size,
    );
    this.fieldMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.fieldMesh.count = 0;
    this.fieldMesh.visible = false;
    this.fieldMesh.frustumCulled = false;
    this.fieldMesh.renderOrder = 0;
    this.scene.add(this.fieldMesh);

    this.energyMesh = new THREE.InstancedMesh(
      new THREE.IcosahedronGeometry(0.42, 1),
      new THREE.MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0.92,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
      capacity,
    );
    this.energyMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.energyMesh.count = 0;
    this.energyMesh.frustumCulled = false;
    this.energyMesh.renderOrder = 4;
    this.scene.add(this.energyMesh);

    this.soapLinkPositions = new Float32Array(capacity * 6);
    const soapLinkGeometry = new THREE.BufferGeometry();
    soapLinkGeometry.setAttribute("position", new THREE.BufferAttribute(this.soapLinkPositions, 3).setUsage(THREE.DynamicDrawUsage));
    soapLinkGeometry.setDrawRange(0, 0);
    this.soapLinks = new THREE.LineSegments(
      soapLinkGeometry,
      new THREE.LineBasicMaterial({ color: 0xe8ffff, transparent: true, opacity: 0.66, depthWrite: false }),
    );
    this.soapLinks.frustumCulled = false;
    this.soapLinks.renderOrder = 5;
    this.scene.add(this.soapLinks);

    this.persistence = new Float32Array(capacity);
    this.persistenceColors = new Uint32Array(capacity);
    this.trailMesh = new THREE.InstancedMesh(
      new THREE.IcosahedronGeometry(0.5, 1),
      new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.24, depthWrite: false, blending: THREE.AdditiveBlending }),
      capacity,
    );
    this.trailMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.trailMesh.count = 0;
    this.trailMesh.visible = false;
    this.trailMesh.frustumCulled = false;
    this.trailMesh.renderOrder = 0;
    this.scene.add(this.trailMesh);

    this.actorLinePositions = new Float32Array(102 * 18 * 3);
    this.actorLineColors = new Float32Array(102 * 18 * 3);
    const actorGeometry = new THREE.BufferGeometry();
    actorGeometry.setAttribute("position", new THREE.BufferAttribute(this.actorLinePositions, 3).setUsage(THREE.DynamicDrawUsage));
    actorGeometry.setAttribute("color", new THREE.BufferAttribute(this.actorLineColors, 3).setUsage(THREE.DynamicDrawUsage));
    actorGeometry.setDrawRange(0, 0);
    this.actorLines = new THREE.LineSegments(
      actorGeometry,
      new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.96, depthWrite: false }),
    );
    this.actorLines.frustumCulled = false;
    this.actorLines.renderOrder = 6;
    this.scene.add(this.actorLines);
  }

  buildInteractionPlane() {
    const { width, height, depth } = this.simulation;
    const material = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      colorWrite: false,
    });
    this.interactionPlane = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
    this.interactionPlane.position.z = this.sectionDepth - depth / 2 + 0.5;
    this.interactionPlane.renderOrder = -10;
    this.scene.add(this.interactionPlane);

    this.sliceGrid = new THREE.GridHelper(Math.max(width, height), Math.max(width, height), 0x61d8f4, 0x174d60);
    this.sliceGrid.rotation.x = Math.PI / 2;
    this.sliceGrid.position.z = this.interactionPlane.position.z - 0.02;
    this.sliceGrid.material.transparent = true;
    this.sliceGrid.material.opacity = 0.12;
    this.sliceGrid.visible = false;
    this.scene.add(this.sliceGrid);

    this.cursor = new THREE.Group();
    const ringMaterial = new THREE.MeshBasicMaterial({ color: 0xbff7ff, transparent: true, opacity: 0.9, depthTest: false });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.035, 8, 48), ringMaterial);
    const ringOuter = new THREE.Mesh(new THREE.TorusGeometry(0.74, 0.014, 6, 48), ringMaterial.clone());
    ringOuter.material.opacity = 0.36;
    this.cursor.add(ring, ringOuter);
    this.cursor.renderOrder = 20;
    this.cursor.visible = false;
    this.scene.add(this.cursor);

    this.selectionBox = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 0.18)),
      new THREE.LineBasicMaterial({ color: 0x8ff2ff, transparent: true, opacity: 0.92, depthTest: false }),
    );
    this.selectionBox.renderOrder = 21;
    this.selectionBox.visible = false;
    this.scene.add(this.selectionBox);
  }

  setSelection(from, to) {
    if (!from || !to) {
      this.selectionBox.visible = false;
      return;
    }
    const minX = Math.min(from.x, to.x);
    const maxX = Math.max(from.x, to.x);
    const minY = Math.min(from.y, to.y);
    const maxY = Math.max(from.y, to.y);
    this.selectionBox.position.set(
      (minX + maxX + 1) / 2 - this.simulation.width / 2,
      (minY + maxY + 1) / 2 - this.simulation.height / 2,
      from.z - this.simulation.depth / 2 + 0.5,
    );
    this.selectionBox.scale.set(maxX - minX + 1, maxY - minY + 1, 1);
    this.selectionBox.visible = true;
  }

  buildPostProcessing() {
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(1, 1), this.baseBloomStrength, 0.52, 0.76);
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(new OutputPass());
  }

  resetCamera(animate = true) {
    const targetPosition = new THREE.Vector3(35, 15, 57);
    if (!animate) {
      this.camera.position.copy(targetPosition);
      this.controls.target.set(0, -1, 0);
      this.controls.update();
      return;
    }
    const start = this.camera.position.clone();
    const startTarget = this.controls.target.clone();
    const began = performance.now();
    const duration = 620;
    const update = (time) => {
      const raw = Math.min(1, (time - began) / duration);
      const eased = 1 - Math.pow(1 - raw, 3);
      this.camera.position.lerpVectors(start, targetPosition, eased);
      this.controls.target.lerpVectors(startTarget, new THREE.Vector3(0, -1, 0), eased);
      if (raw < 1) requestAnimationFrame(update);
    };
    requestAnimationFrame(update);
  }

  resize() {
    const parent = this.canvas.parentElement;
    const width = Math.max(1, parent.clientWidth);
    const height = Math.max(1, parent.clientHeight);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
    this.composer.setSize(width, height);
    this.bloomPass.resolution.set(width, height);
  }

  cellPosition(x, y, z, target = new THREE.Vector3()) {
    target.set(
      x - this.simulation.width / 2 + 0.5,
      y - this.simulation.height / 2 + 0.5,
      z - this.simulation.depth / 2 + 0.5,
    );
    return target;
  }

  setDepth(depth) {
    this.sectionDepth = Math.max(0, Math.min(this.simulation.depth - 1, depth));
    const worldZ = this.sectionDepth - this.simulation.depth / 2 + 0.5;
    this.interactionPlane.position.z = worldZ;
    this.sliceGrid.position.z = worldZ - 0.02;
  }

  setSectionEnabled(enabled) {
    this.sectionEnabled = enabled;
    this.sliceGrid.visible = enabled;
    this.chamberEdges.material.opacity = enabled ? 0.36 : 0.23;
  }

  setExposure(exposure) {
    this.renderer.toneMappingExposure = Math.max(0.5, Math.min(2.8, exposure));
  }

  setViewMode(mode) {
    this.viewMode = [
      "clarity", "cinematic", "xray", "heat", "pressure", "velocity", "gravity",
      "basic", "fancy", "fire", "blob", "persistent", "gradient", "life", "air",
    ].includes(mode) ? mode : "clarity";
    const cinematic = this.viewMode === "cinematic";
    const clarity = this.viewMode === "clarity";
    const xray = this.viewMode === "xray";
    const diagnostic = ["heat", "pressure", "velocity", "gravity", "air"].includes(this.viewMode);
    const darkLegacy = ["fire", "persistent", "life"].includes(this.viewMode);
    const background = cinematic || darkLegacy ? 0x020609 : clarity ? 0x102832 : 0x0b1820;
    this.scene.background.setHex(background);
    this.scene.fog.color.setHex(background);
    this.scene.fog.density = cinematic ? 0.009 : xray || diagnostic ? 0.0022 : 0.0025;
    this.ambientLight.intensity = darkLegacy ? 1.15 : cinematic ? 1.65 : clarity ? 6.1 : xray || diagnostic ? 4.6 : 4.8;
    this.keyLight.intensity = darkLegacy ? 2.2 : cinematic ? 3.4 : clarity ? 7.4 : xray || diagnostic ? 5 : 6.2;
    this.rimLight.intensity = cinematic ? 2.1 : clarity ? 5.2 : xray || diagnostic ? 4.1 : 4.1;
    this.baseBloomStrength = this.viewMode === "basic" ? 0.08 : this.viewMode === "fancy" ? 0.86 : darkLegacy ? 1.02 : cinematic ? 0.82 : xray ? 0.35 : diagnostic ? 0.44 : 0.54;
    this.postProcessingEnabled = ["cinematic", "fancy", "fire", "persistent"].includes(this.viewMode);
    const xrayOpacity = { solid: 0.28, powder: 0.64, liquid: 0.52, gas: 0.42 };
    for (const mesh of Object.values(this.meshes)) {
      const material = mesh.material;
      const kind = mesh.userData.renderKind;
      material.transparent = xray || material.userData.baseTransparent;
      material.opacity = xray ? xrayOpacity[kind] : material.userData.baseOpacity;
      material.depthWrite = xray ? kind === "powder" : kind !== "gas";
      material.needsUpdate = true;
    }
    this.wallMesh.material.opacity = xray ? 0.08 : diagnostic ? 0.12 : cinematic ? 0.38 : 0.2;
    this.wallMesh.material.depthWrite = cinematic;
    this.energyMesh.material.opacity = xray ? 1 : cinematic ? 0.9 : 0.96;
    this.fieldMesh.visible = diagnostic;
    this.trailMesh.visible = this.viewMode === "persistent";
    document.documentElement.dataset.viewMode = this.viewMode;
  }

  pickCell(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hit = this.raycaster.intersectObject(this.interactionPlane, false)[0];
    if (!hit) return null;
    const x = Math.floor(hit.point.x + this.simulation.width / 2);
    const y = Math.floor(hit.point.y + this.simulation.height / 2);
    if (!this.simulation.inBounds(x, y, this.sectionDepth)) return null;
    return { x, y, z: this.sectionDepth, point: hit.point };
  }

  updateCursor(cell, radius = 2, color = 0xbff7ff) {
    if (!cell) {
      this.cursor.visible = false;
      return;
    }
    this.cursor.visible = true;
    this.cellPosition(cell.x, cell.y, cell.z, this.cursor.position);
    this.cursor.position.z += 0.54;
    const scale = Math.max(0.84, radius * 1.42);
    this.cursor.scale.setScalar(scale);
    for (const child of this.cursor.children) child.material.color.setHex(color);
  }

  syncSigns() {
    const dynamicTick = Math.floor(this.simulation.tick / 8);
    const hasDynamicSigns = this.simulation.signs.some((sign) => sign.text.includes("{"));
    if (this.lastSignVersion !== this.simulation.signVersion || (hasDynamicSigns && dynamicTick !== this.lastDynamicSignTick)) {
      for (const sprite of this.signGroup.children) {
        sprite.material.map?.dispose();
        sprite.material.dispose();
      }
      this.signGroup.clear();
      for (const sign of this.simulation.signs) {
        const displayText = formatSignText(this.simulation, sign);
        const canvas = document.createElement("canvas");
        canvas.width = 512;
        canvas.height = 128;
        const context = canvas.getContext("2d");
        const color = `#${(sign.color || 0x8feeff).toString(16).padStart(6, "0").slice(-6)}`;
        context.fillStyle = "rgba(3, 14, 20, 0.9)";
        context.strokeStyle = color;
        context.lineWidth = 5;
        context.beginPath();
        context.roundRect(5, 5, 502, 118, 14);
        context.fill();
        context.stroke();
        context.fillStyle = color;
        context.font = "700 36px ui-monospace, monospace";
        context.textAlign = "center";
        context.textBaseline = "middle";
        context.shadowColor = color;
        context.shadowBlur = 14;
        context.fillText(displayText, 256, 64, 472);
        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: true, depthWrite: false });
        const sprite = new THREE.Sprite(material);
        this.cellPosition(sign.x, sign.y + 1.3, sign.z, sprite.position);
        sprite.scale.set(Math.max(3.4, Math.min(8.5, displayText.length * 0.28)), 1.45, 1);
        sprite.center.set(sign.justification === "left" ? 0 : sign.justification === "right" ? 1 : 0.5, 0.5);
        sprite.userData.depth = sign.z;
        sprite.userData.action = parseSignAction(sign.text);
        this.signGroup.add(sprite);
      }
      this.lastSignVersion = this.simulation.signVersion;
      this.lastDynamicSignTick = dynamicTick;
    }
    for (const sprite of this.signGroup.children) sprite.visible = !this.sectionEnabled || sprite.userData.depth <= this.sectionDepth;
  }

  updateFromSimulation() {
    this.syncSigns();
    const counts = { solid: 0, powder: 0, liquid: 0, gas: 0 };
    const meshCounts = Object.fromEntries(Object.keys(this.meshes).map((kind) => [kind, 0]));
    let hotX = 0;
    let hotY = 0;
    let hotZ = 0;
    let hotWeight = 0;
    const { types, temperatures, width, height, depth } = this.simulation;
    const needsAirSample = this.viewMode === "pressure" || this.viewMode === "velocity" || this.viewMode === "air";
    const needsGravitySample = this.viewMode === "gravity";

    for (let index = 0; index < types.length; index += 1) {
      const type = types[index];
      if (type === MAT.EMPTY) {
        this.persistence[index] *= 0.91;
        continue;
      }
      this.persistence[index] = 1;
      const material = MATERIAL_BY_ID[type];
      const meshKey = material ? visualMeshKey(type, material.render) : null;
      if (!material || !this.meshes[meshKey]) continue;
      const z = Math.floor(index / (width * height));
      if (this.sectionEnabled && z > this.sectionDepth) continue;
      const layerIndex = index - z * width * height;
      const y = Math.floor(layerIndex / width);
      const x = layerIndex - y * width;
      const mesh = this.meshes[meshKey];
      const instance = meshCounts[meshKey];

      this.cellPosition(x, y, z, this.scratchPosition);
      const hash = ((x * 73856093) ^ (y * 19349663) ^ (z * 83492791)) >>> 0;
      if (material.render === "powder") {
        this.scratchEuler.set((hash % 31) * 0.1, ((hash >>> 4) % 29) * 0.11, ((hash >>> 8) % 23) * 0.13);
        this.scratchQuaternion.setFromEuler(this.scratchEuler);
        const scale = 0.78 + (hash % 13) * 0.014;
        this.scratchScale.set(scale, scale, scale);
      } else if (material.render === "liquid") {
        this.scratchQuaternion.identity();
        this.scratchScale.set(1.03, 0.82, 1.03);
      } else if (material.render === "gas") {
        this.scratchEuler.set(0, (hash % 21) * 0.16, 0);
        this.scratchQuaternion.setFromEuler(this.scratchEuler);
        const pulse = 0.82 + ((this.simulation.tick + hash) % 17) * 0.012;
        if (meshKey === "flame") this.scratchScale.set(0.72 + pulse * 0.28, 0.78 + pulse * 0.45, 0.72 + pulse * 0.28);
        else this.scratchScale.setScalar(pulse);
      } else {
        this.scratchQuaternion.identity();
        if (type === MAT.TRON) {
          const head = Boolean(this.simulation.tmp[index] & 1);
          const trail = Math.max(0.46, Math.min(0.94, this.simulation.life[index] / Math.max(1, this.simulation.tmp2[index])));
          this.scratchScale.setScalar(head ? 1.18 : trail);
        } else this.scratchScale.setScalar(type === MAT.GLASS ? 0.91 : 0.97);
      }
      if (this.viewMode === "blob") this.scratchScale.multiplyScalar(1.24);
      if (type === MAT.WARP) this.scratchScale.setScalar(0.001);

      this.scratchMatrix.compose(this.scratchPosition, this.scratchQuaternion, this.scratchScale);
      mesh.setMatrixAt(instance, this.scratchMatrix);

      const lifeRule = type === MAT.LIFE ? UPSTREAM_LIFE_RULES[this.simulation.ctype[index]] : null;
      let scriptNoDecoration = false;
      this.scratchColor.setHex(lifeRule?.color ?? material.color);
      if (type === MAT.SWCH && this.simulation.life[index] >= 10) this.scratchColor.setHex(0x11d918);
      else if (type === MAT.WIRE && this.simulation.ctype[index] === 1) this.scratchColor.setHex(0x3264ff);
      else if (type === MAT.WIRE && this.simulation.ctype[index] === 2) this.scratchColor.setHex(0xff6432);
      else if (type === MAT.WIFI) {
        const channel = Math.trunc((temperatures[index] + 300) / 100);
        this.scratchColor.setRGB(
          (Math.sin(0.0628 * channel) * 127 + 128) / 255,
          (Math.sin(0.0628 * channel + 2) * 127 + 128) / 255,
          (Math.sin(0.0628 * channel + 4) * 127 + 128) / 255,
        );
      } else if (type === MAT.EMP && this.simulation.life[index]) {
        this.scratchColor.setRGB(
          this.simulation.life[index] * 1.5 / 255,
          this.simulation.life[index] * 1.5 / 255,
          Math.max(0, 200 - this.simulation.life[index]) / 255,
        );
      } else if (type === MAT.DLAY && temperatures[index] !== 0) {
        const stage = Math.trunc(this.simulation.life[index] / temperatures[index] * 100) / 255;
        this.scratchColor.r += stage;
        this.scratchColor.g += stage;
        this.scratchColor.b += stage;
      }
      else if (type === MAT.SEED) {
        const water = (this.simulation.ctype[index] >>> 12) & 0xff;
        const darken = water > 3 ? 50 / 255 : water > 0 ? 25 / 255 : 0;
        this.scratchColor.setRGB(
          Math.max(0, this.scratchColor.r - darken),
          Math.max(0, this.scratchColor.g - darken),
          Math.max(0, this.scratchColor.b - darken),
        );
      } else if (type === MAT.PLNT && this.simulation.ctype[index] !== 0) {
        const colorGenes = (this.simulation.ctype[index] >>> 6) & 0x3f;
        const cyan = colorGenes & 0b110000 ? 1 : 0;
        const magenta = colorGenes & 0b001100 ? 1 : 0;
        const yellow = colorGenes & 0b000011 ? 1 : 0;
        this.scratchColor.setHex(PLANT_LEAF_COLORS[4 * cyan + 2 * magenta + yellow]);
      } else if (type === MAT.PLNT || type === MAT.VINE) {
        const maximumTemperature = Math.max(this.simulation.tmp2[index], temperatures[index]);
        if (maximumTemperature > 26.85) {
          this.scratchColor.r = Math.min(1, this.scratchColor.r + Math.min(58, (maximumTemperature - 26.85) / 5) / 255);
          this.scratchColor.g = Math.max(0, this.scratchColor.g - Math.min(102, (maximumTemperature - 26.85) / 2) / 255);
          this.scratchColor.b = Math.min(1, this.scratchColor.b + Math.min(70, (maximumTemperature - 26.85) / 5) / 255);
        }
        if (maximumTemperature < -0.15) {
          this.scratchColor.g = Math.min(1, this.scratchColor.g + Math.min(255, (-0.15 - maximumTemperature) / 4) / 255);
          this.scratchColor.b = Math.min(1, this.scratchColor.b + Math.min(255, (-0.15 - maximumTemperature) / 1.5) / 255);
        }
      }
      else if (type === MAT.LCRY) {
        const brightness = (0x50 + Math.min(10, this.simulation.tmp2[index]) * 10) / 255;
        this.scratchColor.setRGB(brightness, brightness, brightness);
      } else if ([MAT.PUMP, MAT.GPMP, MAT.HSWC].includes(type)) {
        const active = Math.min(10, this.simulation.life[index]) * 19 / 255;
        if (type === MAT.PUMP) this.scratchColor.b = Math.min(1, this.scratchColor.b + active);
        else if (type === MAT.GPMP) {
          this.scratchColor.g = Math.min(1, this.scratchColor.g + active);
          this.scratchColor.b = Math.min(1, this.scratchColor.b + active);
        } else this.scratchColor.r = Math.min(1, this.scratchColor.r + active);
      } else if (type === MAT.PCLN || type === MAT.PBCN) {
        const active = Math.min(10, this.simulation.life[index]) * 10 / 255;
        this.scratchColor.r = Math.min(1, this.scratchColor.r + active);
        this.scratchColor.g = Math.min(1, this.scratchColor.g + (type === MAT.PCLN ? active : active * 0.5));
      } else if (type === MAT.PVOD) {
        this.scratchColor.r = Math.min(1, this.scratchColor.r + Math.min(10, this.simulation.life[index]) * 16 / 255);
      } else if (type === MAT.PSTN && this.simulation.life[index]) {
        this.scratchColor.r = Math.max(0, this.scratchColor.r - 60 / 255);
        this.scratchColor.g = Math.max(0, this.scratchColor.g - 60 / 255);
      } else if (type === MAT.FRME && this.simulation.tmp[index]) {
        this.scratchColor.offsetHSL(0, 0, 30 / 255);
      } else if ((type === MAT.ACEL || type === MAT.DCEL) && this.simulation.tmp[index]) {
        this.scratchColor.lerp(this.visibilityLift, 0.42);
      }
      const carriedType = type === MAT.STOR ? this.simulation.tmp[index]
        : type === MAT.CONV ? (this.simulation.ctype[index] & 0x1ff)
          : [MAT.CRAY, MAT.DRAY].includes(type) ? (this.simulation.ctype[index] & 0x1ff)
            : [MAT.PIPE, MAT.PPIP, MAT.CLNE, MAT.PCLN, MAT.BCLN, MAT.PBCN, MAT.STKM, MAT.STKM2, MAT.FIGH].includes(type) ? this.simulation.ctype[index] : MAT.EMPTY;
      if ((type === MAT.PIPE || type === MAT.PPIP) && !carriedType) {
        const pipeColor = this.simulation.tmp[index] & PIPE_FLAG.COLORS;
        if (pipeColor === PIPE_FLAG.COLOR_RED) this.scratchColor.setHex(0x8f2525);
        else if (pipeColor === PIPE_FLAG.COLOR_GREEN) this.scratchColor.setHex(0x258f38);
        else if (pipeColor === PIPE_FLAG.COLOR_BLUE) this.scratchColor.setHex(0x274b9c);
        if (this.simulation.tmp[index] & PIPE_FLAG.PAUSED) this.scratchColor.multiplyScalar(0.34);
      }
      if (carriedType && MATERIAL_BY_ID[carriedType]) this.scratchColor.lerp(this.carriedColor.setHex(MATERIAL_BY_ID[carriedType].color), 0.58);
      if (type === MAT.EMBR && this.simulation.ctype[index] > 0xff) this.scratchColor.setHex(this.simulation.ctype[index] & 0xffffff);
      if (type === MAT.GLOW) {
        let red = Math.max(0, Math.min(255, 64 + temperatures[index] - 34));
        let green = Math.max(0, Math.min(255, 64 + this.simulation.ctype[index]));
        let blue = Math.max(0, Math.min(255, 64 + this.simulation.tmp[index]));
        const additive = red + green + blue > 257 + (hash & 31);
        if (additive) {
          red = Math.max(0, red - 54);
          green = Math.max(0, green - 54);
          blue = Math.max(0, blue - 54);
        }
        this.scratchColor.setRGB(red / 255, green / 255, blue / 255);
        if (additive) this.scratchColor.multiplyScalar(1.65);
      }
      if (type === MAT.FILT || BIZARRE_TYPES.has(type)
        || ((type === MAT.BRAY || type === MAT.C5) && (this.simulation.ctype[index] & 0x3fffffff))) {
        const temperatureBin = Math.max(0, Math.min(25, Math.floor(temperatures[index] * 0.025)));
        const wavelength = (this.simulation.ctype[index] & 0x3fffffff)
          || (type === MAT.FILT ? ((0x1f << temperatureBin) & 0x3fffffff) : 0);
        let red = 0;
        let green = 0;
        let blue = 0;
        for (let bit = 0; bit < 12; bit += 1) {
          red += (wavelength >> (bit + 18)) & 1;
          green += (wavelength >> (bit + 9)) & 1;
          blue += (wavelength >> bit) & 1;
        }
        const wavelengthScale = 624 / (red + green + blue + 1);
        this.scratchColor.setRGB(Math.min(1, red * wavelengthScale / 255), Math.min(1, green * wavelengthScale / 255), Math.min(1, blue * wavelengthScale / 255));
      }
      if (BIZARRE_TYPES.has(type)) {
        const speedGlow = Math.min(2, (Math.abs(this.simulation.velocityX[index])
          + Math.abs(this.simulation.velocityY[index]) + Math.abs(this.simulation.velocityZ[index])) / 5);
        if (speedGlow > 0) this.scratchColor.multiplyScalar(1 + speedGlow);
      }
      if (type === MAT.INVIS && this.simulation.tmp2[index]) this.scratchColor.setRGB(15 / 255, 0, 150 / 255);
      if (type === MAT.GEL) {
        const saturation = Math.max(0, Math.min(100, this.simulation.tmp[index]));
        this.scratchColor.setRGB(
          (255 + saturation * (32 - 255) / 120) / 255,
          (186 + saturation * (48 - 186) / 120) / 255,
          saturation * 208 / 120 / 255,
        );
      }
      if (type === MAT.SPNG) {
        const absorbed = this.simulation.life[index] * 15 / 255;
        this.scratchColor.setRGB(
          Math.max(50 / 255, this.scratchColor.r - absorbed),
          Math.max(50 / 255, this.scratchColor.g - absorbed),
          Math.max(20 / 255, this.scratchColor.b - absorbed),
        );
      }
      if (type === MAT.LITH) {
        if (this.simulation.life[index] >= 1000) this.scratchColor.setRGB(1.7, 160 / 255 * 1.7, 64 / 255 * 1.7);
        else if (this.simulation.ctype[index] > 0) {
          const low = Math.floor(this.simulation.ctype[index] / 3);
          const range = Math.max(1, this.simulation.ctype[index] - low + 1);
          const multiplier = Math.min(6, Math.floor((low + hash % range) / 15));
          this.scratchColor.r = Math.max(0, this.scratchColor.r - 30 * multiplier / 255);
          this.scratchColor.b += 20 * multiplier / 255;
          if (multiplier) this.scratchColor.multiplyScalar(1.18);
        }
      }
      if (type === MAT.BRAY && this.simulation.tmp[index] === 2) this.scratchColor.setHex(0xff9632);
      if (type === MAT.QRTZ || type === MAT.PQRT) {
        const speckle = (this.simulation.tmp2[index] - 5) * 16 / 255;
        this.scratchColor.setRGB(
          Math.max(0, Math.min(1, this.scratchColor.r + speckle)),
          Math.max(0, Math.min(1, this.scratchColor.g + speckle)),
          Math.max(0, Math.min(1, this.scratchColor.b + speckle)),
        );
      }
      if (type === MAT.COAL || type === MAT.BCOL) {
        const baseGreen = Math.round(this.scratchColor.g * 255);
        let red = Math.round(this.scratchColor.r * 255) + Math.trunc((this.simulation.tmp2[index] - 22) / 3);
        red = Math.max(baseGreen, Math.min(170, red));
        let green = red;
        let blue = red;
        if (this.simulation.temperatures[index] > 122) {
          const q = Math.trunc(this.simulation.temperatures[index] > 322 ? 200 : this.simulation.temperatures[index] - 122);
          const frequency = Math.PI / 500;
          red += Math.trunc(Math.sin(frequency * q) * 226);
          green += Math.trunc(-Math.sin(frequency * q * 4.55) * 34);
          blue += Math.trunc(-Math.sin(frequency * q * 2.22) * 64);
        }
        this.scratchColor.setRGB(Math.max(0, red) / 255, Math.max(0, green) / 255, Math.max(0, blue) / 255);
      }
      if (type === MAT.GOLD) {
        let glintBits = hash;
        const redGlint = (glintBits % 10 - 5) / 255;
        glintBits >>>= 4;
        const greenGlint = (glintBits % 10 - 5) / 255;
        glintBits >>>= 4;
        const blueGlint = (glintBits % 10 - 5) / 255;
        this.scratchColor.setRGB(
          Math.max(0, Math.min(1, this.scratchColor.r + redGlint)),
          Math.max(0, Math.min(1, this.scratchColor.g + greenGlint)),
          Math.max(0, Math.min(1, this.scratchColor.b + blueGlint)),
        );
      }
      if (type === MAT.TUNG) {
        const startTemperature = MATERIAL_BY_ID[MAT.TUNG].highTemperature - 1500;
        let phase = ((this.simulation.temperatures[index] - startTemperature) / 1500) * Math.PI - Math.PI / 2;
        if (phase > -Math.PI / 2) {
          phase = Math.min(Math.PI / 2, phase);
          const glow = Math.sin(phase) + 1;
          this.scratchColor.r += glow * 258 / 255;
          this.scratchColor.g += glow * 156 / 255;
          this.scratchColor.b += glow * 112 / 255;
        }
      }
      if (type === MAT.CRMC || type === MAT.CLST) {
        const state = type === MAT.CRMC ? this.simulation.tmp2[index] - 2 : this.simulation.tmp[index] - 5;
        const speckle = state * (type === MAT.CRMC ? 8 : 16) / 255;
        this.scratchColor.setRGB(
          Math.max(0, Math.min(1, this.scratchColor.r + speckle)),
          Math.max(0, Math.min(1, this.scratchColor.g + speckle)),
          Math.max(0, Math.min(1, this.scratchColor.b + speckle)),
        );
      }
      if (type === MAT.SLCN) {
        const current = (this.simulation.tmp[index] >>> 12) & 15;
        this.scratchColor.setHex(SILICON_COLORS[current]);
        if (this.simulation.tmp[index] & 0x800) {
          const next = (this.simulation.tmp[index] >>> 16) & 15;
          this.scratchColor.lerp(this.carriedColor.setHex(SILICON_COLORS[next]), 0.5);
        }
        const sparkle = (this.simulation.tmp[index] & 0xffff) * ((this.simulation.tmp[index] >>> 16) & 0xffff);
        if (sparkle % 887 === 0) this.scratchColor.multiplyScalar(2.15);
        if (sparkle % 593 === 0) this.scratchColor.multiplyScalar(1.55);
      }
      if (type === MAT.PTNM && this.simulation.tmp[index]) this.scratchColor.multiplyScalar(2.15);
      if (type === MAT.POLO) {
        if (this.simulation.tmp[index] >= 5) this.scratchColor.setHex(0x707070);
        else this.scratchColor.multiplyScalar(1.5);
      }
      if (type === MAT.DEUT) {
        const concentration = this.simulation.life[index];
        if (concentration >= 240) this.scratchColor.setRGB(1.2, 1.2, 1.2);
        else if (concentration > 0) {
          this.scratchColor.r += concentration / 255;
          this.scratchColor.g += concentration * 2 / 255;
          this.scratchColor.b += concentration * 3 / 255;
        }
      }
      if (type === MAT.EXOT) {
        const temperatureKelvin = this.simulation.temperatures[index] + 273.15;
        const pulse = this.simulation.tmp[index];
        const charge = this.simulation.tmp2[index];
        const flare = this.simulation.life[index] < 1001
          && ((hash + this.simulation.tick * 2654435761) >>> 0) % 1000 < Math.max(0, charge - 1);
        const frequency = this.simulation.life[index] < 1001 ? (flare ? 0.04045 : 0.00045) : 0.013;
        const phase = flare ? charge : temperatureKelvin;
        const offset = flare ? 150 : this.simulation.life[index] < 1001 ? pulse / 1.7 : pulse / 2.9 + 80;
        const channelPhase = this.simulation.life[index] < 1001 && !flare ? [4, 6, 8]
          : [flare ? 4 : 6, flare ? 6 : 6, flare ? 8 : 6];
        this.scratchColor.setRGB(
          (Math.sin(frequency * phase + channelPhase[0]) * 127 + offset) / 255,
          (Math.sin(frequency * phase + channelPhase[1]) * 127 + offset) / 255,
          (Math.sin(frequency * phase + channelPhase[2]) * 127 + offset) / 255,
        );
        if (flare) this.scratchColor.multiplyScalar(1.6);
      }
      if (type === MAT.VIBR || type === MAT.BVBR) {
        const gradient = Math.trunc(this.simulation.tmp[index] / 10);
        if (gradient >= 100 || this.simulation.life[index]) {
          const red = Math.abs(Math.sin(Math.exp((750 - this.simulation.life[index]) / 170))) * 200 / 255;
          this.scratchColor.setRGB(red, this.simulation.tmp2[index] ? red : 1, this.simulation.tmp2[index] ? 1 : red);
        } else {
          this.scratchColor.r += Math.min(255, gradient * 2) / 255;
          this.scratchColor.g += Math.min(175, gradient * 2) / 255;
          this.scratchColor.b += Math.min(255, gradient * 2) / 255;
        }
      }
      if (type === MAT.CBNW) {
        const speckle = this.simulation.tmp2[index] - 20;
        this.scratchColor.setRGB(
          Math.max(0, Math.min(1, this.scratchColor.r + speckle / 255)),
          Math.max(0, Math.min(1, this.scratchColor.g + speckle * 2 / 255)),
          Math.max(0, Math.min(1, this.scratchColor.b + speckle * 8 / 255)),
        );
      }
      if (type === MAT.PLSM) {
        const phase = Math.max(0, Math.min(1, this.simulation.life[index] / 199));
        let upper = 1;
        while (upper < PLASMA_GRADIENT.length - 1 && phase > PLASMA_GRADIENT[upper][0]) upper += 1;
        const [lowerStop, lowerColor] = PLASMA_GRADIENT[upper - 1];
        const [upperStop, upperColor] = PLASMA_GRADIENT[upper];
        const blend = (phase - lowerStop) / Math.max(Number.EPSILON, upperStop - lowerStop);
        this.scratchColor.setRGB(
          (lowerColor[0] + (upperColor[0] - lowerColor[0]) * blend) / 255,
          (lowerColor[1] + (upperColor[1] - lowerColor[1]) * blend) / 255,
          (lowerColor[2] + (upperColor[2] - lowerColor[2]) * blend) / 255,
        );
      }
      if (type === MAT.TRON) {
        const hue = (((this.simulation.tmp[index] & 0xf800) >>> 11) * 16) % 360;
        this.scratchColor.setHSL(hue / 360, 1, this.simulation.tmp[index] & 1 ? 0.66 : 0.5);
        if (this.simulation.tmp[index] & 0x10) this.scratchColor.lerp(this.hotColor, 0.58);
      }
      if (this.simulation.customElementGraphicsTypes?.has(type)) {
        const graphics = this.simulation.customElementGraphics?.(
          type,
          index,
          Math.max(0, Math.min(255, Math.round(this.scratchColor.r * 255))),
          Math.max(0, Math.min(255, Math.round(this.scratchColor.g * 255))),
          Math.max(0, Math.min(255, Math.round(this.scratchColor.b * 255))),
        );
        if (graphics) {
          const style = graphicsStyle(graphics);
          scriptNoDecoration = style.noDecoration;
          this.scratchColor.setRGB(style.color[0] / 255, style.color[1] / 255, style.color[2] / 255);
          if (style.fireBlend > 0) {
            this.scratchColor.lerp(
              this.carriedColor.setRGB(style.fireColor[0] / 255, style.fireColor[1] / 255, style.fireColor[2] / 255),
              style.fireBlend,
            );
          }
          this.scratchColor.multiplyScalar(style.intensity);
          this.scratchScale.multiplyScalar(style.visible ? style.scale : 0.001);
          this.scratchMatrix.compose(this.scratchPosition, this.scratchQuaternion, this.scratchScale);
          mesh.setMatrixAt(instance, this.scratchMatrix);
        }
      }
      if (this.viewMode === "fire") {
        const emission = Math.max(material.emissive ?? 0, Math.min(1, Math.max(0, temperatures[index] - 80) / 900));
        this.scratchColor.multiplyScalar(0.08 + emission * 1.35);
      } else if (this.viewMode === "gradient") {
        const gradient = Math.max(0, Math.min(1, y / Math.max(1, height - 1) * 0.7 + z / Math.max(1, depth - 1) * 0.3));
        this.scratchColor.lerp(this.carriedColor.setHSL(0.62 - gradient * 0.58, 0.92, 0.56), 0.62);
      } else if (this.viewMode === "life") {
        if (type === MAT.LIFE) this.scratchColor.lerp(this.visibilityLift, 0.32);
        else this.scratchColor.multiplyScalar(0.11);
      }
      if (type === MAT.GRAV) {
        const tick = this.simulation.tick;
        const r = Math.abs((tick % 120) - 60);
        const g = Math.abs(((tick + 60) % 120) - 60);
        const b = Math.abs(((tick + 120) % 120) - 60);
        const r2 = Math.abs((tick % 60) - 30);
        const g2 = Math.abs(((tick + 30) % 60) - 30);
        const b2 = Math.abs(((tick + 60) % 60) - 30);
        const vx = this.simulation.velocityX[index];
        const vy = this.simulation.velocityY[index];
        const vz = this.simulation.velocityZ[index];
        this.scratchColor.setRGB(
          Math.min(1, (20 + Math.max(0, vx) * r - Math.min(0, vx) * b + Math.max(0, vy) * g - Math.min(0, vy) * r2 + Math.max(0, vz) * b - Math.min(0, vz) * g2) / 255),
          Math.min(1, (20 + Math.max(0, vx) * g - Math.min(0, vx) * r + Math.max(0, vy) * b - Math.min(0, vy) * g2 + Math.max(0, vz) * r - Math.min(0, vz) * b2) / 255),
          Math.min(1, (20 + Math.max(0, vx) * b - Math.min(0, vx) * g + Math.max(0, vy) * r - Math.min(0, vy) * b2 + Math.max(0, vz) * g - Math.min(0, vz) * r2) / 255),
        );
        if (this.simulation.life[index]) this.scratchColor.multiplyScalar(3);
      }
      const decoration = this.simulation.decorations[index] >>> 0;
      const decorationAlpha = (decoration >>> 24) / 255;
      if (decorationAlpha > 0 && !NO_DECORATION_TYPES.has(type) && !scriptNoDecoration) {
        this.scratchColor.lerp(this.carriedColor.setHex(decoration & 0xffffff), decorationAlpha);
      }
      const luminance = this.scratchColor.r * 0.2126 + this.scratchColor.g * 0.7152 + this.scratchColor.b * 0.0722;
      if (this.viewMode === "clarity" && luminance < 0.58) {
        if (luminance > 0.012) this.scratchColor.multiplyScalar(Math.min(6, 0.58 / luminance));
        else this.scratchColor.lerp(this.visibilityLift, 0.38);
      } else if (luminance < 0.32) this.scratchColor.lerp(this.visibilityLift, (0.32 - luminance) * 0.38);
      const temperature = temperatures[index];
      const airSample = needsAirSample ? this.simulation.air.sampleVoxel(x, y, z) : null;
      const gravitySample = needsGravitySample ? this.simulation.gravity.sampleVoxel(x, y, z) : null;
      if (this.viewMode === "heat") {
        const normalized = Math.max(-1, Math.min(1, (temperature - 22) / 900));
        this.scratchColor.setRGB(normalized > 0 ? 0.25 + normalized * 0.75 : 0.08, 0.16 + (1 - Math.abs(normalized)) * 0.52, normalized < 0 ? 0.35 + -normalized * 0.65 : 0.06);
      } else if (this.viewMode === "pressure") {
        const normalized = Math.max(-1, Math.min(1, airSample.pressure / 48));
        this.scratchColor.setRGB(normalized > 0 ? 0.35 + normalized * 0.65 : 0.06, 0.12, normalized < 0 ? 0.4 + -normalized * 0.6 : 0.08);
      } else if (this.viewMode === "velocity") {
        const speed = Math.min(1, Math.hypot(airSample.velocityX, airSample.velocityY, airSample.velocityZ) / 12);
        this.scratchColor.setRGB(0.08, 0.35 + speed * 0.65, 0.45 + speed * 0.55);
      } else if (this.viewMode === "gravity") {
        const force = Math.min(1, Math.hypot(gravitySample.forceX, gravitySample.forceY, gravitySample.forceZ) / 3);
        this.scratchColor.setRGB(0.12 + force * 0.2, 0.34 + force * 0.66, 0.22 + force * 0.28);
      } else if (this.viewMode === "air") {
        const pressure = Math.max(-1, Math.min(1, airSample.pressure / 48));
        const speed = Math.min(1, Math.hypot(airSample.velocityX, airSample.velocityY, airSample.velocityZ) / 12);
        this.scratchColor.setRGB(0.16 + Math.max(0, pressure) * 0.84, 0.18 + speed * 0.72, 0.2 + Math.max(0, -pressure) * 0.8);
      } else if (!["basic", "gradient", "life"].includes(this.viewMode) && temperature > 130) {
        const heat = Math.min(0.86, (temperature - 130) / 1250);
        this.scratchColor.lerp(this.hotColor, heat);
        const weight = Math.min(1, heat + 0.16);
        hotX += this.scratchPosition.x * weight;
        hotY += this.scratchPosition.y * weight;
        hotZ += this.scratchPosition.z * weight;
        hotWeight += weight;
      } else if (temperature < 0) {
        this.scratchColor.lerp(this.coolColor, Math.min(0.55, -temperature / 100));
      }
      mesh.setColorAt(instance, this.scratchColor);
      this.persistenceColors[index] = this.scratchColor.getHex();
      meshCounts[meshKey] += 1;
      counts[material.render] += 1;
    }

    for (const [kind, mesh] of Object.entries(this.meshes)) {
      mesh.count = meshCounts[kind];
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }

    let trailCount = 0;
    if (this.viewMode === "persistent") {
      for (let index = 0; index < types.length; index += 1) {
        const persistence = this.persistence[index];
        if (types[index] !== MAT.EMPTY || persistence < 0.035) continue;
        const [x, y, z] = this.simulation.coords(index);
        if (this.sectionEnabled && z > this.sectionDepth) continue;
        this.cellPosition(x, y, z, this.scratchPosition);
        this.scratchQuaternion.identity();
        this.scratchScale.setScalar(0.42 + persistence * 0.5);
        this.scratchMatrix.compose(this.scratchPosition, this.scratchQuaternion, this.scratchScale);
        this.trailMesh.setMatrixAt(trailCount, this.scratchMatrix);
        this.scratchColor.setHex(this.persistenceColors[index] || 0x9edfff).multiplyScalar(0.32 + persistence * 0.68);
        this.trailMesh.setColorAt(trailCount, this.scratchColor);
        trailCount += 1;
      }
    }
    this.trailMesh.count = trailCount;
    this.trailMesh.instanceMatrix.needsUpdate = true;
    if (this.trailMesh.instanceColor) this.trailMesh.instanceColor.needsUpdate = true;

    let soapLinkCount = 0;
    for (let index = 0; index < types.length; index += 1) {
      if (types[index] !== MAT.SOAP || !(this.simulation.ctype[index] & 2)) continue;
      const mate = this.simulation.tmp[index];
      if (mate < 0 || mate >= types.length || types[mate] !== MAT.SOAP) continue;
      const [x, y, z] = this.simulation.coords(index);
      const [mx, my, mz] = this.simulation.coords(mate);
      if (this.sectionEnabled && (z > this.sectionDepth || mz > this.sectionDepth)) continue;
      const offset = soapLinkCount * 6;
      this.soapLinkPositions[offset] = x - width / 2 + 0.5;
      this.soapLinkPositions[offset + 1] = y - height / 2 + 0.5;
      this.soapLinkPositions[offset + 2] = z - depth / 2 + 0.5;
      this.soapLinkPositions[offset + 3] = mx - width / 2 + 0.5;
      this.soapLinkPositions[offset + 4] = my - height / 2 + 0.5;
      this.soapLinkPositions[offset + 5] = mz - depth / 2 + 0.5;
      soapLinkCount += 1;
    }
    this.soapLinks.geometry.setDrawRange(0, soapLinkCount * 2);
    this.soapLinks.geometry.attributes.position.needsUpdate = true;

    let actorSegments = 0;
    const addActorSegment = (start, end, color) => {
      if (actorSegments >= 102 * 9) return;
      const offset = actorSegments * 6;
      this.actorLinePositions.set(start, offset);
      this.actorLinePositions.set(end, offset + 3);
      this.actorLineColors.set([color.r, color.g, color.b, color.r, color.g, color.b], offset);
      actorSegments += 1;
    };
    for (let index = 0; index < types.length && actorSegments < 102 * 9; index += 1) {
      const type = types[index];
      if (![MAT.STKM, MAT.STKM2, MAT.FIGH].includes(type)) continue;
      const [x, y, z] = this.simulation.coords(index);
      if (this.sectionEnabled && z > this.sectionDepth) continue;
      const cx = x - width / 2 + 0.5;
      const cy = y - height / 2 + 0.5;
      const cz = z - depth / 2 + 0.5;
      const facing = this.simulation.tmp4[index] & 3;
      const fx = facing === 0 ? -1 : facing === 1 ? 1 : 0;
      const fz = facing === 2 ? -1 : facing === 3 ? 1 : 0;
      const lx = -fz || (fx ? 0 : 1);
      const lz = fx || (fz ? 0 : 0);
      const speed = Math.min(1, Math.hypot(this.simulation.velocityX[index], this.simulation.velocityZ[index]));
      const stride = Math.sin(this.simulation.tick * 0.48 + index * 0.17) * (0.12 + speed * 0.46);
      const actorColor = this.carriedColor.setHex(type === MAT.STKM2 ? 0x648cff : type === MAT.FIGH ? 0xff896f : 0xffe0a0);
      const carried = MATERIAL_BY_ID[this.simulation.ctype[index]];
      if (carried) actorColor.lerp(this.scratchColor.setHex(carried.color), 0.22);
      const neck = [cx, cy - 0.38, cz];
      const shoulders = [cx, cy - 0.72, cz];
      const leftShoulder = [cx + lx * 0.62, cy - 0.78, cz + lz * 0.62];
      const rightShoulder = [cx - lx * 0.62, cy - 0.78, cz - lz * 0.62];
      const hip = [cx, cy - 1.72, cz];
      const leftHand = [cx + lx * 0.92 + fx * stride, cy - 1.42, cz + lz * 0.92 + fz * stride];
      const rightHand = [cx - lx * 0.92 - fx * stride, cy - 1.42, cz - lz * 0.92 - fz * stride];
      const leftKnee = [cx + lx * 0.3 + fx * stride * 0.38, cy - 2.34, cz + lz * 0.3 + fz * stride * 0.38];
      const rightKnee = [cx - lx * 0.3 - fx * stride * 0.38, cy - 2.34, cz - lz * 0.3 - fz * stride * 0.38];
      const leftFoot = [cx + lx * 0.43 - fx * stride * 0.5, cy - 3.04, cz + lz * 0.43 - fz * stride * 0.5];
      const rightFoot = [cx - lx * 0.43 + fx * stride * 0.5, cy - 3.04, cz - lz * 0.43 + fz * stride * 0.5];
      addActorSegment(neck, shoulders, actorColor);
      addActorSegment(leftShoulder, rightShoulder, actorColor);
      addActorSegment(leftShoulder, leftHand, actorColor);
      addActorSegment(rightShoulder, rightHand, actorColor);
      addActorSegment(shoulders, hip, actorColor);
      addActorSegment(hip, leftKnee, actorColor);
      addActorSegment(hip, rightKnee, actorColor);
      addActorSegment(leftKnee, leftFoot, actorColor);
      addActorSegment(rightKnee, rightFoot, actorColor);
    }
    this.actorLines.geometry.setDrawRange(0, actorSegments * 2);
    this.actorLines.geometry.attributes.position.needsUpdate = true;
    this.actorLines.geometry.attributes.color.needsUpdate = true;

    let energyCount = 0;
    for (let index = 0; index < this.simulation.energyTypes.length; index += 1) {
      const type = this.simulation.energyTypes[index];
      if (type === MAT.EMPTY) continue;
      const z = Math.floor(index / (width * height));
      if (this.sectionEnabled && z > this.sectionDepth) continue;
      const layerIndex = index - z * width * height;
      const y = Math.floor(layerIndex / width);
      const x = layerIndex - y * width;
      this.cellPosition(x, y, z, this.scratchPosition);
      const pulse = 0.74 + ((this.simulation.tick + index * 7) % 13) * 0.026;
      this.scratchScale.setScalar(pulse);
      this.scratchQuaternion.identity();
      this.scratchMatrix.compose(this.scratchPosition, this.scratchQuaternion, this.scratchScale);
      this.energyMesh.setMatrixAt(energyCount, this.scratchMatrix);

      if (type === MAT.PHOT) {
        const wavelength = this.simulation.energyCtype[index] & 0x3fffffff;
        let red = 0;
        let green = 0;
        let blue = 0;
        for (let bit = 0; bit < 12; bit += 1) {
          red += (wavelength >> (bit + 18)) & 1;
          green += (wavelength >> (bit + 9)) & 1;
          blue += (wavelength >> bit) & 1;
        }
        const scale = 624 / (red + green + blue + 1);
        this.scratchColor.setRGB(Math.min(1, red * scale / 255), Math.min(1, green * scale / 255), Math.min(1, blue * scale / 255));
      } else {
        this.scratchColor.setHex(MATERIAL_BY_ID[type]?.color ?? 0xffffff);
      }
      let scriptNoDecoration = false;
      if (this.simulation.customElementGraphicsTypes?.has(type)) {
        const graphics = this.simulation.customElementGraphics?.(
          type,
          index,
          Math.max(0, Math.min(255, Math.round(this.scratchColor.r * 255))),
          Math.max(0, Math.min(255, Math.round(this.scratchColor.g * 255))),
          Math.max(0, Math.min(255, Math.round(this.scratchColor.b * 255))),
        );
        if (graphics) {
          const style = graphicsStyle(graphics);
          scriptNoDecoration = style.noDecoration;
          this.scratchColor.setRGB(style.color[0] / 255, style.color[1] / 255, style.color[2] / 255);
          if (style.fireBlend > 0) {
            this.scratchColor.lerp(
              this.carriedColor.setRGB(style.fireColor[0] / 255, style.fireColor[1] / 255, style.fireColor[2] / 255),
              style.fireBlend,
            );
          }
          this.scratchColor.multiplyScalar(style.intensity);
          this.scratchScale.multiplyScalar(style.visible ? style.scale : 0.001);
          this.scratchMatrix.compose(this.scratchPosition, this.scratchQuaternion, this.scratchScale);
          this.energyMesh.setMatrixAt(energyCount, this.scratchMatrix);
        }
      }
      const energyTemp = this.simulation.energyTemperatures[index];
      if (energyTemp > 900) this.scratchColor.lerp(this.hotColor, Math.min(0.44, (energyTemp - 900) / 4000));
      const decoration = this.simulation.energyDecorations[index] >>> 0;
      const decorationAlpha = (decoration >>> 24) / 255;
      if (decorationAlpha > 0 && !scriptNoDecoration) this.scratchColor.lerp(this.carriedColor.setHex(decoration & 0xffffff), decorationAlpha);
      this.energyMesh.setColorAt(energyCount, this.scratchColor);
      energyCount += 1;
    }
    this.energyMesh.count = energyCount;
    this.energyMesh.instanceMatrix.needsUpdate = true;
    if (this.energyMesh.instanceColor) this.energyMesh.instanceColor.needsUpdate = true;
    counts.energy = energyCount;

    let fieldCount = 0;
    if (this.fieldMesh.visible) {
      const cellSize = this.simulation.air.cellSize;
      for (let fieldIndex = 0; fieldIndex < this.simulation.air.size; fieldIndex += 1) {
        const cz = Math.floor(fieldIndex / (this.simulation.air.width * this.simulation.air.height));
        const layer = fieldIndex - cz * this.simulation.air.width * this.simulation.air.height;
        const cy = Math.floor(layer / this.simulation.air.width);
        const cx = layer - cy * this.simulation.air.width;
        const voxelZ = cz * cellSize + cellSize * 0.5 - 0.5;
        if (this.sectionEnabled && voxelZ > this.sectionDepth) continue;
        let intensity = 0;
        if (this.viewMode === "heat") {
          const delta = this.simulation.air.ambientHeat[fieldIndex] - 22;
          intensity = Math.min(1, Math.abs(delta) / 500);
          this.scratchColor.setRGB(delta > 0 ? 1 : 0.08, 0.14 + (1 - intensity) * 0.28, delta < 0 ? 1 : 0.08);
        } else if (this.viewMode === "pressure") {
          const pressure = this.simulation.air.pressure[fieldIndex];
          intensity = Math.min(1, Math.abs(pressure) / 48);
          this.scratchColor.setRGB(pressure > 0 ? 1 : 0.07, 0.08, pressure < 0 ? 1 : 0.08);
        } else if (this.viewMode === "velocity") {
          intensity = Math.min(1, Math.hypot(this.simulation.air.velocityX[fieldIndex], this.simulation.air.velocityY[fieldIndex], this.simulation.air.velocityZ[fieldIndex]) / 12);
          this.scratchColor.setRGB(0.06, 0.58 + intensity * 0.42, 1);
        } else if (this.viewMode === "gravity") {
          intensity = Math.min(1, Math.hypot(this.simulation.gravity.forceX[fieldIndex], this.simulation.gravity.forceY[fieldIndex], this.simulation.gravity.forceZ[fieldIndex]) / 3);
          this.scratchColor.setRGB(0.08, 1, 0.38 + intensity * 0.3);
        } else if (this.viewMode === "air") {
          const pressure = Math.max(-1, Math.min(1, this.simulation.air.pressure[fieldIndex] / 48));
          const speed = Math.min(1, Math.hypot(this.simulation.air.velocityX[fieldIndex], this.simulation.air.velocityY[fieldIndex], this.simulation.air.velocityZ[fieldIndex]) / 12);
          intensity = Math.max(Math.abs(pressure), speed);
          this.scratchColor.setRGB(0.1 + Math.max(0, pressure) * 0.9, 0.2 + speed * 0.75, 0.12 + Math.max(0, -pressure) * 0.88);
        }
        if (intensity < 0.018) continue;
        this.cellPosition(cx * cellSize + cellSize * 0.5 - 0.5, cy * cellSize + cellSize * 0.5 - 0.5, voxelZ, this.scratchPosition);
        this.scratchQuaternion.identity();
        this.scratchScale.setScalar(0.18 + intensity * 0.72);
        this.scratchMatrix.compose(this.scratchPosition, this.scratchQuaternion, this.scratchScale);
        this.fieldMesh.setMatrixAt(fieldCount, this.scratchMatrix);
        this.fieldMesh.setColorAt(fieldCount, this.scratchColor);
        fieldCount += 1;
      }
    }
    this.fieldMesh.count = fieldCount;
    this.fieldMesh.instanceMatrix.needsUpdate = true;
    if (this.fieldMesh.instanceColor) this.fieldMesh.instanceColor.needsUpdate = true;

    let wallCount = 0;
    const cellSize = this.simulation.air.cellSize;
    for (let airIndex = 0; airIndex < this.simulation.walls.length; airIndex += 1) {
      const encoded = this.simulation.walls[airIndex];
      if (!encoded) continue;
      const cz = Math.floor(airIndex / (this.simulation.air.width * this.simulation.air.height));
      const layer = airIndex - cz * this.simulation.air.width * this.simulation.air.height;
      const cy = Math.floor(layer / this.simulation.air.width);
      const cx = layer - cy * this.simulation.air.width;
      const voxelZ = cz * cellSize + cellSize * 0.5 - 0.5;
      if (this.sectionEnabled && voxelZ > this.sectionDepth) continue;
      this.cellPosition(
        cx * cellSize + cellSize * 0.5 - 0.5,
        cy * cellSize + cellSize * 0.5 - 0.5,
        voxelZ,
        this.scratchPosition,
      );
      this.scratchQuaternion.identity();
      this.scratchScale.setScalar(1);
      this.scratchMatrix.compose(this.scratchPosition, this.scratchQuaternion, this.scratchScale);
      this.wallMesh.setMatrixAt(wallCount, this.scratchMatrix);
      this.scratchColor.setHex(UPSTREAM_WALLS[encoded - 1]?.color ?? 0x808080);
      if (this.simulation.wallElectricity[airIndex] > 0) this.scratchColor.lerp(this.hotColor, 0.62);
      this.wallMesh.setColorAt(wallCount, this.scratchColor);
      wallCount += 1;
    }
    this.wallMesh.count = wallCount;
    this.wallMesh.instanceMatrix.needsUpdate = true;
    if (this.wallMesh.instanceColor) this.wallMesh.instanceColor.needsUpdate = true;

    if (hotWeight > 0) {
      this.heatLight.position.set(hotX / hotWeight, hotY / hotWeight, hotZ / hotWeight);
      this.heatLight.intensity = Math.min(46, 4 + hotWeight * 0.085);
    } else {
      this.heatLight.intensity = 0;
    }
    this.bloomPass.strength = Math.min(1.18, this.baseBloomStrength + hotWeight * 0.0009);
    if (this.simulation.activity.explosions > 0) this.shake = Math.min(1.4, this.shake + this.simulation.activity.explosions * 0.8);
    this.lastRenderCounts = counts;
    return counts;
  }

  render(delta = 0.016) {
    this.controls.update();
    this.stars.rotation.y += delta * 0.003;
    this.floorGrid.material.opacity = 0.42 + Math.sin(performance.now() * 0.0005) * 0.035;
    const originalPosition = this.camera.position.clone();
    if (this.shake > 0.01) {
      this.camera.position.x += (Math.random() - 0.5) * this.shake;
      this.camera.position.y += (Math.random() - 0.5) * this.shake;
      this.shake *= Math.pow(0.055, delta);
    }
    if (this.postProcessingEnabled) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
    this.camera.position.copy(originalPosition);
  }

  dispose() {
    this.resizeObserver.disconnect();
    this.controls.dispose();
    this.renderer.dispose();
  }
}
