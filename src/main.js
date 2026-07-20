// SPDX-License-Identifier: GPL-3.0-or-later

import "./styles.css";
import { DECORATION_MODE, VoxelSimulation } from "./simulation.js";
import { MatterRenderer } from "./renderer.js";
import { Soundscape } from "./soundscape.js";
import { executeConsoleCommand } from "./console.js";
import { LuaScriptLibrary, LUA_SCRIPT_METADATA_KEY } from "./lua-script-library.js";
import { PARTICLE_PROPERTIES, parseParticleProperty } from "./property-tool.js";
import {
  CATEGORIES, CATEGORY_ORDER, MATERIAL_BY_ID, MAT, PRESETS,
  UPSTREAM_LIFE_RULES, UPSTREAM_TOOLS, UPSTREAM_WALLS,
  materialsInCategory,
} from "./materials.js";
import {
  commentOnCommunitySave, communityAvatarUrl, communitySaveDownloadUrl, communityThumbnailUrl, communityWebsiteUrl,
  deleteCommunitySave, downloadCommunitySave, editCommunityTag, favouriteCommunitySave,
  getCommunityCapabilities, getCommunityComments, getCommunityProfile, getCommunitySave, getCommunityStartup, loginCommunity,
  reportCommunitySave, searchCommunitySaves, setCommunitySavePublished, updateCommunityProfile,
  uploadCommunitySave, voteCommunitySave,
} from "./community-client.js";

const $ = (selector) => document.querySelector(selector);
const canvas = $("#scene");
const simulation = new VoxelSimulation(48, 36, 28);
simulation.loadPreset("foundry");
const matterRenderer = new MatterRenderer(canvas, simulation);
const soundscape = new Soundscape();
const communityCapabilities = getCommunityCapabilities();

const DECORATION_TOOLS = Object.freeze([
  { id: DECORATION_MODE.DRAW, code: "SET", name: "Set", description: "Draw decoration with no blending." },
  { id: DECORATION_MODE.CLEAR, code: "CLR", name: "Clear", description: "Erase decoration without deleting particles." },
  { id: DECORATION_MODE.ADD, code: "ADD", name: "Add", description: "Add the selected colour to existing decoration." },
  { id: DECORATION_MODE.SUBTRACT, code: "SUB", name: "Subtract", description: "Subtract the selected colour from existing decoration." },
  { id: DECORATION_MODE.MULTIPLY, code: "MUL", name: "Multiply", description: "Multiply existing decoration by the selected colour." },
  { id: DECORATION_MODE.DIVIDE, code: "DIV", name: "Divide", description: "Divide existing decoration by the selected colour." },
  { id: DECORATION_MODE.SMUDGE, code: "SMDG", name: "Smudge", description: "Blend nearby decoration in linear-light colour space." },
]);
const PROPERTY_TOOL_ITEM = Object.freeze({
  id: 0, code: "PROP", name: "Property", css: "#fea900", color: 0xfea900,
  description: "Draw a configured particle field value over matter or energy.", parity: "ported",
});

const state = {
  selectedType: MAT.SAND,
  previousType: MAT.SAND,
  category: "powders",
  libraryMode: "elements",
  elementQuery: "",
  selectedWall: 8,
  selectedTool: 0,
  selectedLife: 0,
  selectedDecoration: DECORATION_MODE.DRAW,
  decorationColor: "#c86432",
  decorationAlpha: 255,
  propertyField: "temp",
  propertyRaw: "22",
  propertyValue: 22,
  propertyValid: true,
  erasing: false,
  touchNavigation: false,
  radius: 2,
  brushShape: "sphere",
  paused: false,
  drawing: false,
  drawMode: "brush",
  dragStart: null,
  selection: null,
  clipboard: null,
  visualDirty: true,
  currentCell: null,
  lastPaintCell: null,
  currentPreset: "foundry",
  accumulator: 0,
  fps: 60,
  simStepMs: 0,
};
const undoStack = [];
const redoStack = [];
const HISTORY_LIMIT = 8;
const STAMP_STORAGE_KEY = "powder-toy-3d-stamps-v1";
const PHYSICS_STORAGE_KEY = "powder-toy-3d-physics-v1";
const STARTUP_NOTIFICATIONS_STORAGE_KEY = "powder-toy-3d-startup-notifications-v1";
const DECORATION_STORAGE_KEY = "powder-toy-3d-decoration-v1";
const PROPERTY_STORAGE_KEY = "powder-toy-3d-property-v1";
let stampLibrary = [];
let startupNotificationsEnabled = true;
try { startupNotificationsEnabled = localStorage.getItem(STARTUP_NOTIFICATIONS_STORAGE_KEY) !== "false"; }
catch { /* local preferences are optional */ }
try {
  const savedStamps = JSON.parse(localStorage.getItem(STAMP_STORAGE_KEY) ?? "[]");
  if (Array.isArray(savedStamps)) stampLibrary = savedStamps.filter((stamp) => stamp?.clipboard?.format === "powder-toy-3d-clipboard").slice(0, 20);
} catch {
  stampLibrary = [];
}
try {
  const decoration = JSON.parse(localStorage.getItem(DECORATION_STORAGE_KEY) ?? "null");
  if (/^#[0-9a-f]{6}$/i.test(decoration?.color)) state.decorationColor = decoration.color.toLowerCase();
  if (Number.isFinite(Number(decoration?.alpha))) state.decorationAlpha = Math.max(0, Math.min(255, Math.round(Number(decoration.alpha))));
} catch { /* local preferences are optional */ }
try {
  const property = JSON.parse(localStorage.getItem(PROPERTY_STORAGE_KEY) ?? "null");
  const parsed = parseParticleProperty(property?.field, property?.value);
  state.propertyField = parsed.property;
  state.propertyRaw = String(property.value);
  state.propertyValue = parsed.value;
} catch { /* local preferences are optional */ }
try {
  const physics = JSON.parse(localStorage.getItem(PHYSICS_STORAGE_KEY) ?? "null");
  if (physics) simulation.applySettings(physics);
} catch { /* local preferences are optional */ }

function stampPreview(clipboard) {
  const preview = document.createElement("canvas");
  preview.width = 160;
  preview.height = 100;
  const context = preview.getContext("2d");
  context.fillStyle = "#040b10";
  context.fillRect(0, 0, preview.width, preview.height);
  const scale = Math.min(preview.width / Math.max(1, clipboard.width), preview.height / Math.max(1, clipboard.height));
  const ox = (preview.width - clipboard.width * scale) / 2;
  const oy = (preview.height - clipboard.height * scale) / 2;
  for (const [x, y, particle] of [...(clipboard.matter ?? []), ...(clipboard.energy ?? [])]) {
    context.fillStyle = MATERIAL_BY_ID[particle.type]?.css ?? "#ffffff";
    context.fillRect(ox + x * scale, oy + (clipboard.height - y - 1) * scale, Math.max(1, scale), Math.max(1, scale));
  }
  return preview.toDataURL("image/png");
}

function persistStamps() {
  try {
    localStorage.setItem(STAMP_STORAGE_KEY, JSON.stringify(stampLibrary));
    return true;
  } catch {
    if (stampLibrary.length > 1) {
      stampLibrary.pop();
      try { localStorage.setItem(STAMP_STORAGE_KEY, JSON.stringify(stampLibrary)); return true; } catch { /* storage unavailable */ }
    }
    return false;
  }
}

function refreshStampList() {
  const list = $("#stampList");
  if (!stampLibrary.length) {
    const empty = document.createElement("div");
    empty.className = "stamp-empty";
    empty.textContent = "Select a region, then save it here for reuse across sessions.";
    list.replaceChildren(empty);
    return;
  }
  list.replaceChildren(...stampLibrary.map((stamp) => {
    const entry = document.createElement("article");
    entry.className = "stamp-entry";
    const preview = document.createElement("img");
    preview.src = stamp.preview;
    preview.alt = "";
    const body = document.createElement("div");
    const name = document.createElement("strong");
    name.textContent = stamp.name;
    const meta = document.createElement("small");
    meta.textContent = `${stamp.clipboard.width}×${stamp.clipboard.height} · ${(stamp.clipboard.matter?.length ?? 0) + (stamp.clipboard.energy?.length ?? 0)} cells`;
    const load = document.createElement("button");
    load.type = "button";
    load.textContent = "Arm stamp";
    load.addEventListener("click", () => {
      state.clipboard = structuredClone(stamp.clipboard);
      $("#stampDialog").hidden = true;
      showToast(`${stamp.name.toUpperCase()} READY · CTRL+V`, "#67e8ff");
    });
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "stamp-delete";
    remove.textContent = "Delete";
    remove.addEventListener("click", () => {
      stampLibrary = stampLibrary.filter((candidate) => candidate.id !== stamp.id);
      persistStamps();
      refreshStampList();
    });
    body.append(name, meta, load, remove);
    entry.append(preview, body);
    return entry;
  }));
}

function syncHistoryButtons() {
  $("#undoButton").disabled = undoStack.length === 0;
  $("#undoButton").title = undoStack.length ? `Undo last edit · ${undoStack.length} available (Ctrl+Z)` : "Nothing to undo";
}

function captureUndo() {
  undoStack.push(simulation.createSnapshot());
  if (undoStack.length > HISTORY_LIMIT) undoStack.shift();
  redoStack.length = 0;
  syncHistoryButtons();
}

function undo() {
  const snapshot = undoStack.pop();
  if (!snapshot) return;
  redoStack.push(simulation.createSnapshot());
  simulation.restoreSnapshot(snapshot);
  state.visualDirty = true;
  updateTelemetry(simulation.calculateStats());
  syncHistoryButtons();
  showToast("EDIT UNDONE", "#67e8ff");
}

function redo() {
  const snapshot = redoStack.pop();
  if (!snapshot) return;
  undoStack.push(simulation.createSnapshot());
  simulation.restoreSnapshot(snapshot);
  state.visualDirty = true;
  updateTelemetry(simulation.calculateStats());
  syncHistoryButtons();
  showToast("EDIT REDONE", "#67e8ff");
}

function buildCategoryTabs() {
  const container = $("#categoryTabs");
  container.replaceChildren(...CATEGORY_ORDER.map((category, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.role = "tab";
    button.dataset.category = category;
    button.title = `${index + 1} · ${CATEGORIES[category].name}`;
    button.innerHTML = `<strong>${CATEGORIES[category].short}</strong><span>${CATEGORIES[category].name}</span>`;
    button.addEventListener("click", () => {
      state.elementQuery = "";
      $("#elementSearch").value = "";
      setCategory(category);
    });
    return button;
  }));
  setCategory(state.category);
}

function setCategory(category) {
  state.category = category;
  document.querySelectorAll("#categoryTabs button").forEach((button) => {
    const selected = button.dataset.category === category;
    button.classList.toggle("active", selected);
    button.setAttribute("aria-selected", String(selected));
  });
  buildMaterialGrid();
}

function normalizeLibraryItem(item, kind) {
  if (kind === "elements") return item;
  if (kind === "walls") return { ...item, code: `W${String(item.id).padStart(2, "0")}`, parity: "generic" };
  if (kind === "tools") return { ...item, parity: "generic" };
  if (kind === "decorations") {
    const css = item.id === DECORATION_MODE.CLEAR ? "#91a9b0" : state.decorationColor;
    return { ...item, css, color: Number.parseInt(css.slice(1), 16), parity: "ported" };
  }
  if (kind === "properties") return item;
  return { ...item, name: item.code, parity: "ported" };
}

function decorationArgb() {
  return ((state.decorationAlpha << 24) | Number.parseInt(state.decorationColor.slice(1), 16)) >>> 0;
}

function paletteItems() {
  const query = state.elementQuery.trim().toLowerCase();
  if (state.libraryMode === "elements") return materialsInCategory(query ? null : state.category, query);
  const source = state.libraryMode === "walls" ? UPSTREAM_WALLS
      : state.libraryMode === "tools" ? UPSTREAM_TOOLS
      : state.libraryMode === "decorations" ? DECORATION_TOOLS
        : state.libraryMode === "properties" ? [PROPERTY_TOOL_ITEM] : UPSTREAM_LIFE_RULES;
  return source.map((item) => normalizeLibraryItem(item, state.libraryMode)).filter((item) => {
    if (!query) return true;
    return item.code.toLowerCase().includes(query) || item.name.toLowerCase().includes(query) || item.description.toLowerCase().includes(query);
  });
}

function currentPaletteItem() {
  if (state.erasing) return MATERIAL_BY_ID[MAT.EMPTY];
  if (state.libraryMode === "walls") return normalizeLibraryItem(UPSTREAM_WALLS[state.selectedWall], "walls");
  if (state.libraryMode === "tools") return normalizeLibraryItem(UPSTREAM_TOOLS[state.selectedTool], "tools");
  if (state.libraryMode === "life") return normalizeLibraryItem(UPSTREAM_LIFE_RULES[state.selectedLife], "life");
  if (state.libraryMode === "decorations") return normalizeLibraryItem(DECORATION_TOOLS[state.selectedDecoration], "decorations");
  if (state.libraryMode === "properties") return PROPERTY_TOOL_ITEM;
  return MATERIAL_BY_ID[state.selectedType];
}

function buildMaterialGrid() {
  const materials = paletteItems();
  const grid = $("#materialGrid");
  grid.replaceChildren(...materials.map((material) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "material-card";
    button.dataset.itemId = material.id;
    button.dataset.itemKind = state.libraryMode;
    button.style.setProperty("--material", material.css);
    button.innerHTML = `
      <span class="material-symbol">${material.code}</span>
      <span class="material-name">${material.name}</span>
      <span class="parity-pip ${material.parity}" title="${material.parity === "ported" ? "Bespoke 3D behavior" : "Upstream metadata + generic physics"}">${material.parity === "ported" ? "3D" : "UP"}</span>
      <span class="matter-dots"><i></i><i></i><i></i></span>
    `;
    button.title = material.description;
    button.addEventListener("click", () => selectLibraryItem(state.libraryMode, material.id));
    return button;
  }));
  const total = state.libraryMode === "elements" ? materialsInCategory(null).length
    : state.libraryMode === "walls" ? UPSTREAM_WALLS.length
      : state.libraryMode === "tools" ? UPSTREAM_TOOLS.length
        : state.libraryMode === "decorations" ? DECORATION_TOOLS.length : UPSTREAM_LIFE_RULES.length;
  const resolvedTotal = state.libraryMode === "properties" ? 1 : total;
  $("#elementCountBadge").textContent = `${materials.length} / ${resolvedTotal}`;
  syncMaterialSelection();
}

function selectMaterial(type) {
  state.selectedType = type;
  if (type !== MAT.EMPTY) state.previousType = type;
  state.erasing = type === MAT.EMPTY;
  syncMaterialSelection();
  const material = MATERIAL_BY_ID[type];
  showToast(`${material.name.toUpperCase()} ARMED`, material.css);
}

function refreshRuntimeMaterials() {
  state.visualDirty = true;
  if (!MATERIAL_BY_ID[state.selectedType]?.enabled) {
    state.selectedType = MAT.SAND;
    state.previousType = MAT.SAND;
    state.erasing = false;
    state.category = MATERIAL_BY_ID[MAT.SAND].category;
  }
  if (state.libraryMode === "elements") buildMaterialGrid();
}

function selectLibraryItem(kind, id) {
  state.erasing = false;
  if (kind === "walls") state.selectedWall = id;
  else if (kind === "tools") state.selectedTool = id;
  else if (kind === "life") state.selectedLife = id;
  else if (kind === "decorations") state.selectedDecoration = id;
  else if (kind === "properties") { /* configuration lives in the field/value controls */ }
  else {
    state.selectedType = id;
    state.previousType = id;
  }
  syncMaterialSelection();
  const material = currentPaletteItem();
  showToast(`${material.name.toUpperCase()} ARMED`, material.css);
}

function setLibraryMode(mode) {
  state.libraryMode = mode;
  state.erasing = false;
  state.elementQuery = "";
  $("#elementSearch").value = "";
  $("#categoryTabs").classList.toggle("hidden", mode !== "elements");
  $("#decorationControls").hidden = mode !== "decorations";
  $("#propertyControls").hidden = mode !== "properties";
  $("#libraryTitle").textContent = mode === "elements" ? "Elements" : mode === "walls" ? "Walls" : mode === "tools" ? "Tools" : mode === "life" ? "Life" : mode === "decorations" ? "Decorations" : "Property editor";
  document.querySelectorAll("#libraryModeTabs button").forEach((button) => {
    const selected = button.dataset.libraryMode === mode;
    button.classList.toggle("active", selected);
    button.setAttribute("aria-selected", String(selected));
  });
  buildMaterialGrid();
}

function syncMaterialSelection() {
  const material = currentPaletteItem();
  const selectedId = state.libraryMode === "walls" ? state.selectedWall
    : state.libraryMode === "tools" ? state.selectedTool
      : state.libraryMode === "life" ? state.selectedLife
        : state.libraryMode === "decorations" ? state.selectedDecoration : state.selectedType;
  const resolvedSelectedId = state.libraryMode === "properties" ? 0 : selectedId;
  document.querySelectorAll(".material-card").forEach((card) => card.classList.toggle("active", !state.erasing && card.dataset.itemKind === state.libraryMode && Number(card.dataset.itemId) === resolvedSelectedId));
  $("#eraseButton").classList.toggle("active", state.erasing);
  $("#brushColor").style.background = material.css;
  $("#brushColor").style.boxShadow = `0 0 18px ${material.css}`;
  $("#brushMaterial").textContent = material.name.toUpperCase();
  const info = $("#materialInfo");
  info.querySelector(".material-swatch").style.setProperty("--swatch", material.css);
  info.querySelector("strong").textContent = material.name;
  const actorHint = material.id === MAT.STKM ? " Arrow keys move/jump/fire; Num 7/9 strafe in depth."
    : material.id === MAT.STKM2 ? " WASD move/jump/fire; Q/E strafe in depth."
      : "";
  info.querySelector("span").textContent = `${material.description}${actorHint}`;
  matterRenderer.updateCursor(state.currentCell, state.radius, material.color || 0xbff7ff);
}

function buildPresets() {
  const list = $("#presetList");
  list.replaceChildren(...PRESETS.map((preset, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "preset-card";
    button.dataset.preset = preset.id;
    button.style.setProperty("--accent", preset.accent);
    button.innerHTML = `
      <span class="preset-number">0${index + 1}</span>
      <span><strong>${preset.name}</strong><small>${preset.description}</small></span>
      <b>${preset.tag}</b>
    `;
    button.addEventListener("click", () => loadPreset(preset.id));
    return button;
  }));
  syncPresetSelection();
}

function syncPresetSelection() {
  document.querySelectorAll(".preset-card").forEach((card) => card.classList.toggle("active", card.dataset.preset === state.currentPreset));
}

function loadPreset(id) {
  const preset = PRESETS.find((entry) => entry.id === id) ?? PRESETS[0];
  state.currentPreset = preset.id;
  captureUndo();
  simulation.loadPreset(preset.id);
  state.visualDirty = true;
  state.accumulator = 0;
  syncPresetSelection();
  showToast(`${preset.name.toUpperCase()} LOADED`, preset.accent);
  window.setTimeout(() => updateTelemetry(simulation.calculateStats()), 30);
}

function togglePause(force) {
  state.paused = force ?? !state.paused;
  const pause = $("#pauseButton");
  pause.classList.toggle("paused", state.paused);
  pause.querySelector(".pause-glyph").textContent = state.paused ? "▶" : "Ⅱ";
  pause.querySelector("small").textContent = state.paused ? "RESUME" : "PAUSE";
  $("#statusDot").classList.toggle("paused", state.paused);
  $("#statusLabel").textContent = state.paused ? "SIMULATION PAUSED" : "SIMULATION LIVE";
  showToast(state.paused ? "TIME SUSPENDED" : "TIME RESUMED", state.paused ? "#ffca72" : "#67e8ff");
}

function setViewMode(mode) {
  matterRenderer.setViewMode(mode);
  document.querySelectorAll("#viewModeButtons button").forEach((button) => button.classList.toggle("active", button.dataset.viewMode === matterRenderer.viewMode));
  showToast(`${matterRenderer.viewMode.toUpperCase()} VIEW ENABLED`, "#67e8ff");
}

function singleStep() {
  const started = performance.now();
  dispatchLuaEvent("presim");
  simulation.step();
  dispatchLuaEvent("tick");
  state.simStepMs = performance.now() - started;
  state.visualDirty = true;
  updateTelemetry(simulation.calculateStats());
}

function updateRadius(next) {
  state.radius = Math.max(1, Math.min(6, Number(next)));
  $("#radiusSlider").value = state.radius;
  $("#radiusLabel").textContent = `${state.radius} CELL${state.radius === 1 ? "" : "S"}`;
  $("#brushSize").textContent = `Ø ${state.radius * 2 + 1}`;
  matterRenderer.updateCursor(state.currentCell, state.radius, currentPaletteItem().color || 0xbff7ff);
}

function updateDepth(next) {
  const depth = Number(next);
  matterRenderer.setDepth(depth);
  state.visualDirty = true;
  $("#depthSlider").value = depth;
  $("#depthLabel").textContent = `${depth} / ${simulation.depth - 1}`;
  $("#brushDepth").textContent = `Z ${String(depth).padStart(2, "0")}`;
}

function toggleSection(force) {
  const enabled = force ?? !matterRenderer.sectionEnabled;
  matterRenderer.setSectionEnabled(enabled);
  state.visualDirty = true;
  const button = $("#sectionButton");
  button.classList.toggle("active", enabled);
  button.querySelector("b").textContent = enabled ? "ON" : "OFF";
  showToast(enabled ? "SECTION CUT ENABLED" : "FULL VOLUME RESTORED", "#67e8ff");
}

let toastTimer = 0;
function showToast(message, color = "#67e8ff") {
  const toast = $("#toast");
  toast.textContent = message;
  toast.style.setProperty("--toast-color", color);
  toast.classList.remove("visible");
  void toast.offsetWidth;
  toast.classList.add("visible");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove("visible"), 1500);
}

function paintCell(cell, toolDirection = null) {
  if (!cell) return;
  if (state.erasing) {
    simulation.paintSphere(cell.x, cell.y, cell.z, state.radius, MAT.EMPTY, true, {}, state.brushShape);
    simulation.paintWallSphere(cell.x, cell.y, cell.z, state.radius, null, state.brushShape);
    simulation.removeSignsInSphere(cell.x, cell.y, cell.z, state.radius);
  } else if (state.libraryMode === "properties") {
    if (!state.propertyValid) return;
    simulation.paintPropertySphere(cell.x, cell.y, cell.z, state.radius, state.propertyField, state.propertyValue, state.brushShape);
  } else if (state.libraryMode === "decorations") {
    simulation.paintDecorationSphere(cell.x, cell.y, cell.z, state.radius, decorationArgb(), state.selectedDecoration, state.brushShape);
  } else if (state.libraryMode === "walls") {
    simulation.paintWallSphere(cell.x, cell.y, cell.z, state.radius, state.selectedWall, state.brushShape);
  } else if (state.libraryMode === "tools") {
    simulation.applyToolSphere(cell.x, cell.y, cell.z, state.radius, state.selectedTool, state.brushShape, toolDirection);
  } else if (state.libraryMode === "life") {
    simulation.paintSphere(cell.x, cell.y, cell.z, state.radius, MAT.LIFE, false, { ctype: state.selectedLife }, state.brushShape);
  } else {
    simulation.paintSphere(cell.x, cell.y, cell.z, state.radius, state.selectedType, false, {}, state.brushShape);
  }
  state.visualDirty = true;
}

function paintLine(from, to) {
  if (!from) return paintCell(to);
  const distance = Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y), Math.abs(to.z - from.z));
  const steps = Math.max(1, Math.ceil(distance / Math.max(1, state.radius * 0.65)));
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  const length = Math.hypot(dx, dy, dz);
  const toolDirection = state.libraryMode === "tools" && UPSTREAM_TOOLS[state.selectedTool]?.code === "WIND" && length > 0
    ? [dx / length * 8, dy / length * 8, dz / length * 8] : null;
  const points = [];
  for (let i = 0; i <= steps; i += 1) {
    const point = {
      x: Math.round(from.x + (to.x - from.x) * i / steps),
      y: Math.round(from.y + (to.y - from.y) * i / steps),
      z: Math.round(from.z + (to.z - from.z) * i / steps),
    };
    points.push(point);
    paintCell(point, toolDirection);
  }
  if (state.libraryMode === "walls" && UPSTREAM_WALLS[state.selectedWall]?.identifier === "DEFAULT_WL_FAN") {
    if (length > 0) for (const point of points) simulation.setFanVectorSphere(point.x, point.y, point.z, state.radius, dx / length * 8, dy / length * 8, dz / length * 8);
  }
}

function paintBox(from, to) {
  if (!from || !to) return;
  const minX = Math.min(from.x, to.x);
  const maxX = Math.max(from.x, to.x);
  const minY = Math.min(from.y, to.y);
  const maxY = Math.max(from.y, to.y);
  for (let y = minY; y <= maxY; y += Math.max(1, state.radius)) {
    for (let x = minX; x <= maxX; x += Math.max(1, state.radius)) paintCell({ x, y, z: from.z });
  }
}

function currentPaintProperties() {
  return state.libraryMode === "life" ? { ctype: state.selectedLife } : {};
}

function floodAt(cell) {
  if (!cell) return;
  let changed = 0;
  if (state.libraryMode === "properties" && !state.erasing) {
    if (!state.propertyValid) return;
    changed = simulation.floodPropertyPlane(cell.x, cell.y, cell.z, state.propertyField, state.propertyValue);
  } else if (state.libraryMode === "decorations" && !state.erasing) changed = simulation.floodDecorationPlane(cell.x, cell.y, cell.z, decorationArgb(), state.selectedDecoration);
  else if (state.libraryMode === "walls") changed = simulation.floodWallPlane(cell.x, cell.y, cell.z, state.erasing ? null : state.selectedWall);
  else if (state.libraryMode === "tools") changed = simulation.applyToolSphere(cell.x, cell.y, cell.z, state.radius, state.selectedTool);
  else {
    const type = state.erasing ? MAT.EMPTY : state.libraryMode === "life" ? MAT.LIFE : state.selectedType;
    changed = simulation.floodFillPlane(cell.x, cell.y, cell.z, type, currentPaintProperties());
  }
  state.visualDirty = changed > 0;
  showToast(`${changed.toLocaleString()} CELLS FILLED`, currentPaletteItem().css);
}

function replaceAt(cell) {
  if (!cell) return;
  let changed = 0;
  if (state.libraryMode === "properties" && !state.erasing) {
    if (!state.propertyValid) return;
    const index = simulation.index(cell.x, cell.y, cell.z);
    const energy = simulation.particleLayerAt(index);
    if (energy != null) {
      const targetType = energy ? simulation.energyTypes[index] : simulation.types[index];
      changed = simulation.replacePropertyPlane(cell.z, targetType, state.propertyField, state.propertyValue, energy);
    }
  } else if (state.libraryMode === "decorations" && !state.erasing) {
    const index = simulation.index(cell.x, cell.y, cell.z);
    const target = simulation.decorationTargetAt(index);
    if (target) changed = simulation.replaceDecorationPlane(cell.z, target.field[index], decorationArgb(), state.selectedDecoration, target.energy);
  } else if (state.libraryMode === "walls") {
    const target = simulation.wallAtVoxel(cell.x, cell.y, cell.z);
    changed = simulation.replaceWallPlane(cell.z, target, state.erasing ? null : state.selectedWall);
  } else if (state.libraryMode === "tools") {
    changed = simulation.applyToolSphere(cell.x, cell.y, cell.z, state.radius, state.selectedTool);
  } else {
    const replacement = state.erasing ? MAT.EMPTY : state.libraryMode === "life" ? MAT.LIFE : state.selectedType;
    const replacementIsEnergy = MATERIAL_BY_ID[replacement].state === "energy";
    const targetIsEnergy = replacementIsEnergy || (simulation.get(cell.x, cell.y, cell.z) === MAT.EMPTY && simulation.getEnergy(cell.x, cell.y, cell.z) !== MAT.EMPTY);
    const target = targetIsEnergy ? simulation.getEnergy(cell.x, cell.y, cell.z) : simulation.get(cell.x, cell.y, cell.z);
    changed = simulation.replacePlane(cell.z, target, replacement, currentPaintProperties(), targetIsEnergy);
  }
  state.visualDirty = changed > 0;
  showToast(`${changed.toLocaleString()} CELLS REPLACED`, currentPaletteItem().css);
}

function sampleAt(cell) {
  if (!cell) return;
  const energyType = simulation.getEnergy(cell.x, cell.y, cell.z);
  const matterType = simulation.get(cell.x, cell.y, cell.z);
  const type = energyType || matterType;
  if (type === MAT.LIFE) {
    state.selectedLife = simulation.ctype[simulation.index(cell.x, cell.y, cell.z)];
    setLibraryMode("life");
  } else if (type !== MAT.EMPTY) {
    setLibraryMode("elements");
    state.category = MATERIAL_BY_ID[type].category;
    setCategory(state.category);
    selectMaterial(type);
  } else {
    const wall = simulation.wallAtVoxel(cell.x, cell.y, cell.z);
    if (wall != null) {
      state.selectedWall = wall;
      setLibraryMode("walls");
      syncMaterialSelection();
    } else {
      showToast("EMPTY CELL", "#78949c");
      return;
    }
  }
  showToast(`${currentPaletteItem().name.toUpperCase()} SAMPLED`, currentPaletteItem().css);
}

function normalizeSelection(from, to) {
  if (!from || !to) return null;
  return {
    from: { x: Math.min(from.x, to.x), y: Math.min(from.y, to.y), z: from.z },
    to: { x: Math.max(from.x, to.x), y: Math.max(from.y, to.y), z: from.z },
  };
}

function copySelection(cut = false) {
  if (!state.selection) {
    showToast("SELECT A REGION FIRST", "#ffca72");
    return;
  }
  const { from, to } = state.selection;
  state.clipboard = simulation.copyRegionPlane(from.x, from.y, to.x, to.y, from.z);
  if (cut) {
    captureUndo();
    simulation.clearRegionPlane(from.x, from.y, to.x, to.y, from.z);
    state.visualDirty = true;
  }
  const cells = state.clipboard.matter.length + state.clipboard.energy.length;
  showToast(`${cells.toLocaleString()} CELLS ${cut ? "CUT" : "COPIED"}`, cut ? "#ffca72" : "#67e8ff");
}

function pasteClipboard() {
  if (!state.clipboard) {
    showToast("CLIPBOARD EMPTY", "#ffca72");
    return;
  }
  const target = state.currentCell ?? state.selection?.from;
  if (!target) {
    showToast("POINT TO A PASTE ORIGIN", "#ffca72");
    return;
  }
  captureUndo();
  const pasted = simulation.pasteRegionPlane(target.x, target.y, target.z, state.clipboard, true);
  state.selection = normalizeSelection(target, {
    x: Math.min(simulation.width - 1, target.x + state.clipboard.width - 1),
    y: Math.min(simulation.height - 1, target.y + state.clipboard.height - 1),
    z: target.z,
  });
  matterRenderer.setSelection(state.selection.from, state.selection.to);
  state.visualDirty = pasted > 0;
  showToast(`${pasted.toLocaleString()} CELLS PASTED`, "#67e8ff");
}

function setDrawMode(mode) {
  state.drawMode = mode;
  state.drawing = false;
  state.dragStart = null;
  document.querySelectorAll("#drawModeButtons button").forEach((button) => button.classList.toggle("active", button.dataset.drawMode === mode));
  const label = document.querySelector(`#drawModeButtons [data-draw-mode="${mode}"] small`)?.textContent ?? mode;
  showToast(`${label} MODE`, "#67e8ff");
}

let signEditCell = null;
function setSignOpen(cell) {
  signEditCell = cell;
  const existing = cell ? simulation.signs.find((sign) => sign.x === cell.x && sign.y === cell.y && sign.z === cell.z) : null;
  $("#signDialog").hidden = !cell;
  if (!cell) return;
  $("#signCoordinate").textContent = `CELL ${cell.x},${cell.y},${cell.z}`;
  $("#signText").value = existing?.text ?? "";
  $("#signJustification").value = existing?.justification ?? "center";
  $("#signColor").value = `#${(existing?.color ?? 0x8feeff).toString(16).padStart(6, "0").slice(-6)}`;
  $("#deleteSignButton").hidden = !existing;
  requestAnimationFrame(() => $("#signText").focus());
}

canvas.addEventListener("pointermove", (event) => {
  if (state.touchNavigation && event.pointerType === "touch") {
    state.currentCell = null;
    matterRenderer.updateCursor(null);
    return;
  }
  const cell = matterRenderer.pickCell(event.clientX, event.clientY);
  state.currentCell = cell;
  matterRenderer.updateCursor(cell, state.radius, currentPaletteItem().color || 0xbff7ff);
  if (state.drawing && state.drawMode === "brush" && cell) {
    paintLine(state.lastPaintCell, cell);
    state.lastPaintCell = cell;
  } else if (state.drawing && state.drawMode === "select" && cell) {
    const selection = normalizeSelection(state.dragStart, cell);
    matterRenderer.setSelection(selection.from, selection.to);
  }
});

canvas.addEventListener("pointerdown", (event) => {
  if (event.button !== 0) return;
  if (state.touchNavigation && event.pointerType === "touch") {
    state.drawing = false;
    matterRenderer.updateCursor(null);
    return;
  }
  event.preventDefault();
  const cell = matterRenderer.pickCell(event.clientX, event.clientY);
  state.currentCell = cell;
  state.lastPaintCell = cell;
  state.dragStart = cell;
  if (state.drawMode === "sample") {
    sampleAt(cell);
    return;
  }
  if (state.drawMode === "sign") {
    if (!cell) return;
    setSignOpen(cell);
    return;
  }
  if (state.drawMode === "select") {
    if (!cell) return;
    state.drawing = true;
    canvas.setPointerCapture(event.pointerId);
    matterRenderer.setSelection(cell, cell);
    return;
  }
  captureUndo();
  if (state.drawMode === "flood") {
    floodAt(cell);
    return;
  }
  if (state.drawMode === "replace") {
    replaceAt(cell);
    return;
  }
  state.drawing = true;
  canvas.setPointerCapture(event.pointerId);
  if (state.drawMode === "brush") paintCell(cell);
});

canvas.addEventListener("pointerup", (event) => {
  if (event.button !== 0) return;
  if (state.touchNavigation && event.pointerType === "touch") return;
  const cell = matterRenderer.pickCell(event.clientX, event.clientY) ?? state.currentCell;
  if (state.drawing && state.drawMode === "line") paintLine(state.dragStart, cell);
  else if (state.drawing && state.drawMode === "box") paintBox(state.dragStart, cell);
  else if (state.drawing && state.drawMode === "select") {
    state.selection = normalizeSelection(state.dragStart, cell);
    if (state.selection) {
      matterRenderer.setSelection(state.selection.from, state.selection.to);
      const width = state.selection.to.x - state.selection.from.x + 1;
      const height = state.selection.to.y - state.selection.from.y + 1;
      showToast(`${width}×${height} REGION SELECTED`, "#67e8ff");
    }
  }
  state.drawing = false;
  state.lastPaintCell = null;
  state.dragStart = null;
  if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
});

canvas.addEventListener("pointerleave", () => {
  if (!state.drawing) matterRenderer.updateCursor(null);
});

canvas.addEventListener("pointercancel", (event) => {
  state.drawing = false;
  state.lastPaintCell = null;
  state.dragStart = null;
  if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
});

canvas.addEventListener("contextmenu", (event) => event.preventDefault());
canvas.addEventListener("wheel", (event) => {
  if (event.altKey || event.ctrlKey) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  updateRadius(state.radius + (event.deltaY > 0 ? -1 : 1));
}, { passive: false, capture: true });

const mobileLayoutQuery = window.matchMedia("(max-width: 760px)");
function setMobilePanel(panel = null) {
  const next = mobileLayoutQuery.matches && ["materials", "inspector"].includes(panel) ? panel : null;
  if (next) document.documentElement.dataset.mobilePanel = next;
  else delete document.documentElement.dataset.mobilePanel;
  $("#mobileMaterialsButton").setAttribute("aria-expanded", String(next === "materials"));
  $("#mobileInspectorButton").setAttribute("aria-expanded", String(next === "inspector"));
  $("#mobilePanelScrim").hidden = !next;
}

function setTouchNavigation(enabled, { announce = true } = {}) {
  state.touchNavigation = Boolean(enabled);
  matterRenderer.setTouchNavigation(state.touchNavigation);
  const button = $("#touchModeButton");
  button.classList.toggle("active", state.touchNavigation);
  button.setAttribute("aria-pressed", String(state.touchNavigation));
  button.querySelector("strong").textContent = state.touchNavigation ? "ORBIT" : "DRAW";
  canvas.classList.toggle("touch-orbit", state.touchNavigation);
  if (announce) showToast(state.touchNavigation ? "TOUCH ORBIT · DRAG TO ROTATE · PINCH TO ZOOM" : "TOUCH DRAW · TAP OR DRAG TO PAINT", "#67e8ff");
}

$("#mobileMaterialsButton").addEventListener("click", () => setMobilePanel(document.documentElement.dataset.mobilePanel === "materials" ? null : "materials"));
$("#mobileInspectorButton").addEventListener("click", () => setMobilePanel(document.documentElement.dataset.mobilePanel === "inspector" ? null : "inspector"));
$("#closeMobileMaterials").addEventListener("click", () => setMobilePanel());
$("#closeMobileInspector").addEventListener("click", () => setMobilePanel());
$("#mobilePanelScrim").addEventListener("click", () => setMobilePanel());
$("#materialGrid").addEventListener("click", (event) => {
  if (mobileLayoutQuery.matches && event.target.closest("button")) setMobilePanel();
});
$("#touchModeButton").addEventListener("click", () => setTouchNavigation(!state.touchNavigation));
mobileLayoutQuery.addEventListener("change", (event) => {
  setMobilePanel();
  if (!event.matches) setTouchNavigation(false, { announce: false });
});
setTouchNavigation(false, { announce: false });

$("#pauseButton").addEventListener("click", () => togglePause());
$("#stepButton").addEventListener("click", singleStep);
$("#resetButton").addEventListener("click", () => loadPreset(state.currentPreset));
$("#radiusSlider").addEventListener("input", (event) => updateRadius(event.target.value));
$("#radiusDown").addEventListener("click", () => updateRadius(state.radius - 1));
$("#radiusUp").addEventListener("click", () => updateRadius(state.radius + 1));
$("#brushShape").addEventListener("change", (event) => {
  state.brushShape = event.target.value;
  showToast(`${state.brushShape.toUpperCase()} BRUSH`, "#67e8ff");
});
$("#depthSlider").addEventListener("input", (event) => updateDepth(event.target.value));
$("#sectionButton").addEventListener("click", () => toggleSection());
$("#undoButton").addEventListener("click", undo);
$("#saveButton").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(simulation.serialize())], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `powder-3d-${new Date().toISOString().replace(/[:.]/g, "-")}.pt3d`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  showToast("CHAMBER SAVE EXPORTED", "#67e8ff");
});
$("#loadButton").addEventListener("click", () => $("#loadInput").click());
$("#stampButton").addEventListener("click", () => {
  refreshStampList();
  $("#stampDialog").hidden = false;
  $("#stampName").focus();
});
const consoleHistory = [];
let consoleHistoryIndex = 0;
let luaRuntime = null;
let luaRuntimePromise = null;
let luaScriptLibrary = null;
let selectedLuaScript = null;
let luaScriptSnapshot = { name: "", content: "" };
let consolePane = "console";
const luaUiNodes = new Map();

function appendLuaUiOutput(lines) {
  for (const line of lines ?? []) appendConsole(line, line.includes(" error:") ? "console-error" : "console-result");
}

function dispatchLuaUi(id, event, values = []) {
  if (!luaRuntime) return;
  appendLuaUiOutput(luaRuntime.invokeUiEvent(id, event, values, luaContext(true)));
}

function createLuaUiNode(component) {
  let host;
  let control = null;
  let content = null;
  if (component.kind === "window") {
    host = document.createElement("section");
    host.className = "lua-ui-window";
    host.setAttribute("role", "dialog");
    const close = document.createElement("button");
    close.type = "button";
    close.className = "lua-ui-close";
    close.textContent = "×";
    close.setAttribute("aria-label", "Close script window");
    close.addEventListener("click", () => appendLuaUiOutput(luaRuntime?.closeUiWindow(component.id, luaContext(true))));
    content = document.createElement("div");
    content.className = "lua-ui-window-content";
    host.append(content, close);
  } else if (component.kind === "button") {
    host = document.createElement("button");
    host.type = "button";
    host.className = "lua-ui-component lua-ui-button";
    host.addEventListener("click", () => dispatchLuaUi(component.id, "action"));
  } else if (component.kind === "label") {
    host = document.createElement("div");
    host.className = "lua-ui-component lua-ui-label";
  } else if (component.kind === "textbox") {
    host = document.createElement("input");
    host.type = "text";
    host.className = "lua-ui-component lua-ui-textbox";
    control = host;
    host.addEventListener("input", () => dispatchLuaUi(component.id, "onTextChanged", [host.value]));
  } else if (component.kind === "checkbox") {
    host = document.createElement("label");
    host.className = "lua-ui-component lua-ui-checkbox";
    control = document.createElement("input");
    control.type = "checkbox";
    const label = document.createElement("span");
    host.append(control, label);
    control.addEventListener("change", () => dispatchLuaUi(component.id, "action", [control.checked]));
  } else if (component.kind === "slider") {
    host = document.createElement("input");
    host.type = "range";
    host.className = "lua-ui-component lua-ui-slider";
    control = host;
    host.addEventListener("input", () => dispatchLuaUi(component.id, "onValueChanged", [Number(host.value)]));
  } else {
    host = document.createElement("div");
    host.className = "lua-ui-component lua-ui-progress";
    const track = document.createElement("div");
    track.className = "lua-ui-progress-track";
    const fill = document.createElement("i");
    const status = document.createElement("span");
    track.append(fill);
    host.append(track, status);
    control = { fill, status };
  }
  host.dataset.luaUiId = component.id;
  host.addEventListener("pointerdown", (event) => event.stopPropagation());
  const record = { host, control, content };
  luaUiNodes.set(component.id, record);
  return record;
}

function upsertLuaComponent(component) {
  const record = luaUiNodes.get(component.id) ?? createLuaUiNode(component);
  const { host, control } = record;
  host.style.left = component.x < 0 ? "50%" : `${component.x}px`;
  host.style.top = component.y < 0 ? "50%" : `${component.y}px`;
  host.style.transform = component.x < 0 || component.y < 0 ? `translate(${component.x < 0 ? "-50%" : "0"}, ${component.y < 0 ? "-50%" : "0"})` : "";
  host.style.width = `${component.width}px`;
  host.style.height = `${component.height}px`;
  host.hidden = component.kind === "window" ? !component.shown : !component.visible;
  if (component.kind === "window") {
    if (component.shown) setConsoleOpen(false);
  } else if (component.kind === "button" || component.kind === "label") {
    host.textContent = component.text;
    if (component.kind === "button") { host.disabled = !component.enabled; host.title = component.tooltip; }
  } else if (component.kind === "textbox") {
    if (host.value !== component.text) host.value = component.text;
    host.placeholder = component.placeholder;
    host.readOnly = component.readonly;
    if (component.focused && document.activeElement !== host) host.focus();
  } else if (component.kind === "checkbox") {
    control.checked = component.checked;
    host.querySelector("span").textContent = component.text;
  } else if (component.kind === "slider") {
    host.min = "0"; host.max = String(component.steps); host.step = "1"; host.value = String(component.value);
  } else {
    control.fill.style.width = component.progress < 0 ? "100%" : `${Math.max(0, Math.min(100, component.progress))}%`;
    control.status.textContent = component.status;
  }
  const parent = component.parent > 0 ? luaUiNodes.get(component.parent)?.content : $("#luaUiLayer");
  if (parent && host.parentElement !== parent) parent.append(host);
}

function setConsoleOpen(open) {
  $("#consoleDialog").hidden = !open;
  if (open) {
    consoleHistoryIndex = consoleHistory.length;
    requestAnimationFrame(() => (consolePane === "scripts" ? $("#luaScriptEditor") : $("#consoleInput")).focus());
  }
}
function appendConsole(text, className) {
  const line = document.createElement("p");
  line.className = className;
  line.textContent = text;
  $("#consoleOutput").append(line);
  $("#consoleOutput").scrollTop = $("#consoleOutput").scrollHeight;
}
function luaContext(eventMode = false) {
  return {
    simulation,
    currentDepth: () => state.currentCell?.z ?? matterRenderer.sectionDepth,
    setDepth: (depth) => updateDepth(depth),
    windowSize: () => [window.innerWidth, window.innerHeight],
    brushRadius: () => state.radius,
    setBrushRadius: (radius) => updateRadius(radius),
    mousePosition: () => state.currentCell ? [state.currentCell.x, state.currentCell.y, state.currentCell.z] : [0, 0, matterRenderer.sectionDepth],
    activeTool: () => state.libraryMode === "elements" ? state.selectedType : state.libraryMode === "walls" ? state.selectedWall : state.selectedTool,
    activeMenu: () => Math.max(0, CATEGORY_ORDER.indexOf(state.category)),
    setActiveMenu: (menu) => { if (CATEGORY_ORDER[menu]) setCategory(CATEGORY_ORDER[menu]); },
    refreshMaterials: refreshRuntimeMaterials,
    upsertLuaComponent,
    consoleOpen: () => !$("#consoleDialog").hidden,
    setConsoleOpen,
    luaPrompt: (kind, { title, message, initial }) => {
      if (kind === "input") return window.prompt(`${title}\n${message}`, initial);
      if (kind === "confirm") return window.confirm(`${title}\n${message}`);
      window.alert(`${title}\n${message}`);
      return null;
    },
    paused: () => state.paused,
    setPaused: (paused) => togglePause(paused),
    setView: setViewMode,
    reset: (preset) => loadPreset(PRESETS.some((item) => item.id === preset) ? preset : state.currentPreset),
    beforeMutate: captureUndo,
    onMutate: () => {
      state.visualDirty = true;
      if (!eventMode) updateTelemetry(simulation.calculateStats());
    },
  };
}
async function ensureLuaRuntime() {
  if (!luaRuntimePromise) {
    appendConsole("Loading sandboxed Lua 5.3 runtime…", "console-system");
    luaRuntimePromise = import("./lua-console.js").then(({ PowderLuaRuntime }) => {
      luaRuntime = new PowderLuaRuntime({ storage: localStorage });
      luaScriptLibrary = new LuaScriptLibrary({ fileSystem: luaRuntime.fileSystem, storage: localStorage });
      return luaRuntime;
    });
  }
  return luaRuntimePromise;
}

function luaScriptDirty() {
  return $("#luaScriptName").value !== luaScriptSnapshot.name || $("#luaScriptEditor").value !== luaScriptSnapshot.content;
}

function setLuaScriptStatus(message, error = false) {
  $("#luaScriptStatus").textContent = message;
  $("#luaScriptStatus").style.color = error ? "#e98679" : "";
}

function confirmLuaScriptDiscard() {
  return !luaScriptDirty() || window.confirm("Discard unsaved Lua script changes?");
}

function updateLuaScriptControls() {
  const hasSource = Boolean($("#luaScriptEditor").value.trim());
  $("#deleteLuaScript").disabled = !selectedLuaScript;
  $("#exportLuaScript").disabled = !hasSource;
  $("#saveLuaScript").disabled = !$("#luaScriptName").value.trim();
  $("#runLuaScript").disabled = !hasSource;
  if (luaScriptDirty()) setLuaScriptStatus("Unsaved changes");
}

function showLuaScript(script) {
  selectedLuaScript = script?.name ?? null;
  const name = script?.name ?? "experiment.lua";
  const content = script?.content ?? "-- Powder³ Lua 5.3\n\n";
  $("#luaScriptName").value = name;
  $("#luaScriptEditor").value = content;
  $("#luaScriptAutorun").checked = Boolean(script?.autorun);
  $("#luaScriptAutorun").disabled = !script;
  luaScriptSnapshot = { name, content };
  setLuaScriptStatus(script ? `${script.bytes.toLocaleString()} bytes · stored locally` : "New unsaved script");
  updateLuaScriptControls();
}

function refreshLuaScriptList(selectName = selectedLuaScript) {
  const scripts = luaScriptLibrary?.list() ?? [];
  const list = $("#luaScriptList");
  list.replaceChildren();
  if (!scripts.length) {
    const empty = document.createElement("p");
    empty.className = "lua-script-empty";
    empty.textContent = "No local scripts yet.";
    list.append(empty);
  }
  for (const script of scripts) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `lua-script-entry${script.name === selectName ? " active" : ""}`;
    button.setAttribute("role", "option");
    button.setAttribute("aria-selected", String(script.name === selectName));
    const label = document.createElement("strong");
    label.textContent = script.name;
    const size = document.createElement("small");
    size.textContent = `${script.bytes.toLocaleString()} B`;
    button.append(label, size);
    if (script.autorun) button.append(document.createElement("i"));
    button.addEventListener("click", () => {
      if (!confirmLuaScriptDiscard()) return;
      showLuaScript(luaScriptLibrary.get(script.name));
      refreshLuaScriptList(script.name);
    });
    list.append(button);
  }
}

async function setConsolePane(next) {
  consolePane = next === "scripts" ? "scripts" : "console";
  const scripts = consolePane === "scripts";
  $("#consolePane").hidden = scripts;
  $("#scriptManagerPane").hidden = !scripts;
  $("#consoleTab").classList.toggle("active", !scripts);
  $("#scriptsTab").classList.toggle("active", scripts);
  $("#consoleTab").setAttribute("aria-selected", String(!scripts));
  $("#scriptsTab").setAttribute("aria-selected", String(scripts));
  $("#consoleDialogTitle").textContent = scripts ? "Script manager" : "Console";
  if (scripts) {
    await ensureLuaRuntime();
    refreshLuaScriptList();
    if (!selectedLuaScript && !luaScriptDirty()) showLuaScript(null);
    requestAnimationFrame(() => $("#luaScriptEditor").focus());
  } else requestAnimationFrame(() => $("#consoleInput").focus());
}

function saveActiveLuaScript() {
  if (!luaScriptLibrary) throw new Error("script library is not ready");
  const requested = $("#luaScriptName").value;
  const content = $("#luaScriptEditor").value;
  let saved;
  if (selectedLuaScript && luaScriptLibrary.path(selectedLuaScript) !== luaScriptLibrary.path(requested)) {
    const existing = luaScriptLibrary.get(requested);
    if (existing && !window.confirm(`Replace ${existing.name}?`)) return null;
    saved = luaScriptLibrary.rename(selectedLuaScript, requested, Boolean(existing));
  } else if (!selectedLuaScript) {
    const existing = luaScriptLibrary.get(requested);
    if (existing && !window.confirm(`Replace ${existing.name}?`)) return null;
  }
  saved = luaScriptLibrary.write(saved?.name ?? requested, content);
  selectedLuaScript = saved.name;
  luaScriptSnapshot = { name: saved.name, content: saved.content };
  $("#luaScriptName").value = saved.name;
  $("#luaScriptAutorun").disabled = false;
  $("#luaScriptAutorun").checked = saved.autorun;
  setLuaScriptStatus(`Saved ${saved.name} · ${saved.bytes.toLocaleString()} bytes`);
  refreshLuaScriptList(saved.name);
  updateLuaScriptControls();
  return saved;
}

async function runActiveLuaScript() {
  const source = $("#luaScriptEditor").value;
  if (!source.trim()) return;
  const label = $("#luaScriptName").value.trim() || "unsaved script";
  setLuaScriptStatus(`Running ${label}…`);
  try {
    const runtime = await ensureLuaRuntime();
    const result = runtime.execute(source, luaContext());
    appendConsole(`[${label}] ${result}`, "console-result");
    setLuaScriptStatus(`${label} completed successfully`);
    showToast(`${label.toUpperCase()} COMPLETED`, "#67e8ff");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    appendConsole(`[${label}] ${message}`, "console-error");
    setLuaScriptStatus(message, true);
  }
}

async function importLuaScripts(files) {
  await ensureLuaRuntime();
  let last = null;
  for (const file of files) {
    try {
      if (file.size > luaRuntime.fileSystem.maxBytes) throw new Error(`${file.name} exceeds the 256 KiB sandbox limit`);
      const name = luaScriptLibrary.uniqueName(file.name || "import.lua");
      last = luaScriptLibrary.write(name, await file.text());
    } catch (error) {
      setLuaScriptStatus(error instanceof Error ? error.message : String(error), true);
    }
  }
  if (last) {
    showLuaScript(last);
    refreshLuaScriptList(last.name);
    setLuaScriptStatus(`Imported ${last.name}`);
  }
}

async function runLuaAutorunScripts() {
  let requested = [];
  try {
    const metadata = JSON.parse(localStorage.getItem(LUA_SCRIPT_METADATA_KEY) ?? "null");
    if (metadata?.version === 1 && Array.isArray(metadata.autorun)) requested = metadata.autorun;
  } catch { return; }
  if (!requested.length) return;
  const runtime = await ensureLuaRuntime();
  let failures = 0;
  for (const name of requested) {
    const script = luaScriptLibrary.get(name);
    if (!script?.autorun) continue;
    try {
      appendConsole(`[autorun:${script.name}] ${runtime.execute(script.content, luaContext())}`, "console-result");
    } catch (error) {
      failures += 1;
      appendConsole(`[autorun:${script.name}] ${error instanceof Error ? error.message : String(error)}`, "console-error");
    }
  }
  if (failures) showToast(`${failures} LUA AUTORUN ERROR${failures === 1 ? "" : "S"}`, "#ff8c7d");
}
function dispatchLuaEvent(name) {
  if (!luaRuntime) return;
  for (const line of luaRuntime.dispatch(name, luaContext(true))) appendConsole(line, line.includes(" error:") ? "console-error" : "console-result");
}
async function runConsole(input) {
  const command = input.trim();
  if (!command) return;
  consoleHistory.push(command);
  if (consoleHistory.length > 100) consoleHistory.shift();
  consoleHistoryIndex = consoleHistory.length;
  appendConsole(command, "console-command");
  try {
    const result = executeConsoleCommand(command, luaContext());
    if (result && typeof result === "object" && result.clear) $("#consoleOutput").replaceChildren();
    if (typeof result === "string" && result) appendConsole(result, "console-result");
    else if (result?.text) appendConsole(result.text, "console-system");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.startsWith("Unknown command:") && !command.startsWith("=") && !command.startsWith("lua ")) {
      appendConsole(message, "console-error");
      return;
    }
    try {
      const runtime = await ensureLuaRuntime();
      appendConsole(runtime.execute(command, luaContext()), "console-result");
    } catch (luaError) {
      appendConsole(luaError instanceof Error ? luaError.message : String(luaError), "console-error");
    }
  }
}
$("#consoleButton").addEventListener("click", () => setConsoleOpen(true));
$("#consoleTab").addEventListener("click", () => void setConsolePane("console"));
$("#scriptsTab").addEventListener("click", () => void setConsolePane("scripts"));
$("#closeConsoleDialog").addEventListener("click", () => setConsoleOpen(false));
$("#consoleDialog").addEventListener("pointerdown", (event) => {
  if (event.target === $("#consoleDialog")) setConsoleOpen(false);
});
$("#consoleForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const input = $("#consoleInput");
  void runConsole(input.value);
  input.value = "";
});
$("#consoleInput").addEventListener("keydown", (event) => {
  if (event.code === "Escape") {
    event.preventDefault();
    setConsoleOpen(false);
  } else if (event.code === "ArrowUp" || event.code === "ArrowDown") {
    event.preventDefault();
    consoleHistoryIndex = Math.max(0, Math.min(consoleHistory.length, consoleHistoryIndex + (event.code === "ArrowUp" ? -1 : 1)));
    event.currentTarget.value = consoleHistory[consoleHistoryIndex] ?? "";
  }
});
$("#newLuaScript").addEventListener("click", () => {
  if (!confirmLuaScriptDiscard()) return;
  showLuaScript(null);
  refreshLuaScriptList(null);
});
$("#importLuaScript").addEventListener("click", () => $("#luaScriptInput").click());
$("#luaScriptInput").addEventListener("change", (event) => {
  void importLuaScripts([...event.currentTarget.files]);
  event.currentTarget.value = "";
});
$("#saveLuaScript").addEventListener("click", () => {
  try { saveActiveLuaScript(); }
  catch (error) { setLuaScriptStatus(error instanceof Error ? error.message : String(error), true); }
});
$("#runLuaScript").addEventListener("click", () => void runActiveLuaScript());
$("#deleteLuaScript").addEventListener("click", () => {
  if (!selectedLuaScript || !window.confirm(`Delete ${selectedLuaScript} from the local script library?`)) return;
  luaScriptLibrary.remove(selectedLuaScript);
  showLuaScript(null);
  refreshLuaScriptList(null);
  setLuaScriptStatus("Script deleted from local storage");
});
$("#exportLuaScript").addEventListener("click", () => {
  const blob = new Blob([$("#luaScriptEditor").value], { type: "text/x-lua;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = $("#luaScriptName").value.trim() || "powder-script.lua";
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  setLuaScriptStatus(`Exported ${link.download}`);
});
$("#luaScriptAutorun").addEventListener("change", (event) => {
  try {
    const saved = luaScriptDirty() ? saveActiveLuaScript() : luaScriptLibrary.get(selectedLuaScript);
    if (!saved) { event.currentTarget.checked = false; return; }
    luaScriptLibrary.setAutorun(saved.name, event.currentTarget.checked);
    setLuaScriptStatus(`${saved.name} will ${event.currentTarget.checked ? "run" : "not run"} on startup`);
    refreshLuaScriptList(saved.name);
  } catch (error) {
    event.currentTarget.checked = false;
    setLuaScriptStatus(error instanceof Error ? error.message : String(error), true);
  }
});
for (const selector of ["#luaScriptName", "#luaScriptEditor"]) $(selector).addEventListener("input", updateLuaScriptControls);
$("#luaScriptEditor").addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.code === "KeyS") {
    event.preventDefault();
    try { saveActiveLuaScript(); }
    catch (error) { setLuaScriptStatus(error instanceof Error ? error.message : String(error), true); }
  } else if ((event.ctrlKey || event.metaKey) && event.code === "Enter") {
    event.preventDefault();
    void runActiveLuaScript();
  }
});
$("#closeSignDialog").addEventListener("click", () => setSignOpen(null));
$("#signDialog").addEventListener("pointerdown", (event) => {
  if (event.target === $("#signDialog")) setSignOpen(null);
});
$("#signForm").addEventListener("keydown", (event) => {
  if (event.code === "Escape") {
    event.preventDefault();
    setSignOpen(null);
  }
});
$("#signForm").addEventListener("submit", (event) => {
  event.preventDefault();
  if (!signEditCell) return;
  const text = $("#signText").value.trim();
  const color = Number.parseInt($("#signColor").value.slice(1), 16);
  captureUndo();
  simulation.removeSignsInSphere(signEditCell.x, signEditCell.y, signEditCell.z, 0);
  const placed = text && simulation.addSign(signEditCell.x, signEditCell.y, signEditCell.z, text, color, $("#signJustification").value);
  state.visualDirty = true;
  setSignOpen(null);
  showToast(placed ? "SIGN SAVED" : text ? "SIGN LIMIT REACHED" : "SIGN REMOVED", placed ? "#67e8ff" : text ? "#ffca72" : "#8fa8af");
});
$("#deleteSignButton").addEventListener("click", () => {
  if (!signEditCell) return;
  captureUndo();
  simulation.removeSignsInSphere(signEditCell.x, signEditCell.y, signEditCell.z, 0);
  state.visualDirty = true;
  setSignOpen(null);
  showToast("SIGN REMOVED", "#8fa8af");
});
function syncSettingsDialog() {
  $("#heatSimulationSetting").checked = simulation.heatSimulationEnabled;
  $("#newtonianGravitySetting").checked = simulation.newtonianGravityEnabled;
  $("#waterEqualizationSetting").checked = simulation.waterEqualization;
  $("#gravityModeSetting").value = simulation.gravityMode;
  $("#gravityXSetting").value = simulation.customGravity[0];
  $("#gravityYSetting").value = simulation.customGravity[1];
  $("#gravityZSetting").value = simulation.customGravity[2];
  $("#airModeSetting").value = simulation.air.mode;
  $("#edgeModeSetting").value = simulation.edgeMode;
  $("#ambientTemperatureSetting").value = simulation.air.ambientTemperature;
  $("#ambientHeatSetting").checked = simulation.air.ambientHeatEnabled;
  $("#edgePressureSetting").value = simulation.air.edgePressure;
  $("#edgeVelocityXSetting").value = simulation.air.edgeVelocityX;
  $("#edgeVelocityYSetting").value = simulation.air.edgeVelocityY;
  $("#edgeVelocityZSetting").value = simulation.air.edgeVelocityZ;
  $("#vorticitySetting").value = simulation.air.vorticityCoeff;
  $("#convectionModeSetting").value = simulation.air.convectionMode;
  $("#decorationColorSpaceSetting").value = simulation.decorationColorSpace;
  $("#startupNotificationsSetting").checked = startupNotificationsEnabled;
  const custom = simulation.gravityMode === 3;
  for (const input of [$("#gravityXSetting"), $("#gravityYSetting"), $("#gravityZSetting")]) input.disabled = !custom;
}
function setSettingsOpen(open) {
  $("#settingsDialog").hidden = !open;
  if (open) syncSettingsDialog();
}
$("#gravityModeSetting").addEventListener("change", () => {
  const custom = Number($("#gravityModeSetting").value) === 3;
  for (const input of [$("#gravityXSetting"), $("#gravityYSetting"), $("#gravityZSetting")]) input.disabled = !custom;
});
$("#settingsButton").addEventListener("click", () => setSettingsOpen(true));
$("#closeSettingsDialog").addEventListener("click", () => setSettingsOpen(false));
$("#settingsDialog").addEventListener("pointerdown", (event) => {
  if (event.target === $("#settingsDialog")) setSettingsOpen(false);
});
$("#settingsForm").addEventListener("submit", (event) => {
  event.preventDefault();
  captureUndo();
  const startupWasEnabled = startupNotificationsEnabled;
  startupNotificationsEnabled = $("#startupNotificationsSetting").checked;
  const settings = {
    gravityMode: Number($("#gravityModeSetting").value),
    customGravity: [$("#gravityXSetting"), $("#gravityYSetting"), $("#gravityZSetting")].map((input) => Number(input.value) || 0),
    airMode: Number($("#airModeSetting").value), edgeMode: Number($("#edgeModeSetting").value),
    ambientTemperature: Number($("#ambientTemperatureSetting").value), ambientHeatEnabled: $("#ambientHeatSetting").checked,
    heatSimulationEnabled: $("#heatSimulationSetting").checked, newtonianGravityEnabled: $("#newtonianGravitySetting").checked,
    waterEqualization: $("#waterEqualizationSetting").checked,
    edgePressure: Number($("#edgePressureSetting").value), edgeVelocityX: Number($("#edgeVelocityXSetting").value),
    edgeVelocityY: Number($("#edgeVelocityYSetting").value), edgeVelocityZ: Number($("#edgeVelocityZSetting").value),
    vorticityCoeff: Number($("#vorticitySetting").value), convectionMode: Number($("#convectionModeSetting").value),
    decorationColorSpace: Number($("#decorationColorSpaceSetting").value),
  };
  simulation.applySettings(settings);
  localStorage.setItem(PHYSICS_STORAGE_KEY, JSON.stringify(settings));
  localStorage.setItem(STARTUP_NOTIFICATIONS_STORAGE_KEY, String(startupNotificationsEnabled));
  if (startupNotificationsEnabled && !startupWasEnabled) refreshCommunityStartup({ announce: true });
  state.visualDirty = true;
  setSettingsOpen(false);
  showToast("PHYSICS SETTINGS APPLIED", "#67e8ff");
});
$("#closeStampDialog").addEventListener("click", () => { $("#stampDialog").hidden = true; });
$("#stampDialog").addEventListener("pointerdown", (event) => {
  if (event.target === $("#stampDialog")) $("#stampDialog").hidden = true;
});
$("#saveStampButton").addEventListener("click", () => {
  if (!state.selection) {
    showToast("SELECT A REGION FIRST", "#ffca72");
    return;
  }
  const { from, to } = state.selection;
  const clipboard = simulation.copyRegionPlane(from.x, from.y, to.x, to.y, from.z);
  const requestedName = $("#stampName").value.trim();
  const stamp = {
    id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`,
    name: requestedName || `Stamp ${stampLibrary.length + 1}`,
    created: new Date().toISOString(),
    preview: stampPreview(clipboard),
    clipboard,
  };
  stampLibrary.unshift(stamp);
  stampLibrary = stampLibrary.slice(0, 20);
  if (!persistStamps()) showToast("STAMP STORAGE FULL", "#ff6f61");
  else showToast("STAMP SAVED", "#67e8ff");
  $("#stampName").value = "";
  refreshStampList();
});

async function loadSimulationBytes(sourceBytes) {
  const bytes = sourceBytes instanceof Uint8Array ? sourceBytes : new Uint8Array(sourceBytes);
  const beforeLoad = simulation.createSnapshot();
  const previousRedo = [...redoStack];
  try {
    captureUndo();
    const isOps = bytes.length >= 4 && bytes[0] === 0x4f && bytes[1] === 0x50 && bytes[2] === 0x53 && bytes[3] === 0x31;
    const isPsv = bytes.length >= 3
      && ((bytes[0] === 0x50 && bytes[1] === 0x53 && bytes[2] === 0x76)
        || (bytes[0] === 0x66 && bytes[1] === 0x75 && bytes[2] === 0x43));
    if (isOps) {
      const { importOps } = await import("./ops-import.js");
      const report = importOps(bytes, simulation, state.currentCell?.z ?? Math.floor(simulation.depth / 2));
      togglePause(report.paused);
      const omitted = report.omitted ? ` · ${report.omitted} OMITTED` : "";
      showToast(`OPS V${report.savedVersion} · ${report.imported} IMPORTED${omitted}`, report.omitted ? "#ffca72" : "#67e8ff");
    } else if (isPsv) {
      const { importPsv } = await import("./psv-import.js");
      const report = importPsv(bytes, simulation, state.currentCell?.z ?? Math.floor(simulation.depth / 2));
      togglePause(report.paused);
      const omitted = report.omitted ? ` · ${report.omitted} OMITTED` : "";
      showToast(`${report.format} V${report.savedVersion} · ${report.imported} IMPORTED${omitted}`, report.omitted ? "#ffca72" : "#67e8ff");
    } else {
      const save = JSON.parse(new TextDecoder().decode(bytes));
      simulation.deserialize(save);
      showToast("CHAMBER SAVE LOADED", "#67e8ff");
    }
    state.currentPreset = simulation.currentPreset;
    state.visualDirty = true;
    updateTelemetry(simulation.calculateStats());
    return true;
  } catch (error) {
    simulation.restoreSnapshot(beforeLoad);
    undoStack.pop();
    redoStack.splice(0, redoStack.length, ...previousRedo);
    syncHistoryButtons();
    throw error;
  }
}

const COMMUNITY_AUTH_KEY = "powder-toy-3d-community-auth-v1";
const COMMUNITY_PAGE_SIZE = 24;
const communityState = {
  start: 0, total: 0, query: "", sequence: 0, saves: [], selected: null, detail: null, comments: [], auth: null,
  profile: null, profileReturn: "browse",
};
const startupCommunityState = {
  sequence: 0, messageOfTheDay: "Fetching the message of the day…", notifications: [], updates: {}, status: "loading",
};
try {
  const storedAuth = JSON.parse(sessionStorage.getItem(COMMUNITY_AUTH_KEY) ?? "null");
  if (communityCapabilities.accounts && storedAuth && Number.isSafeInteger(Number(storedAuth.userId)) && storedAuth.sessionId && storedAuth.sessionKey) communityState.auth = storedAuth;
} catch { /* invalid or unavailable session storage starts as guest */ }

function communityElement(tag, className = "", text = "") {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function communityNotificationUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  try {
    const parsed = new URL(raw, "https://powdertoy.co.uk");
    return ["http:", "https:"].includes(parsed.protocol) ? parsed.href : null;
  } catch { return null; }
}

function renderCommunityStartup() {
  $("#messageOfTheDay").textContent = startupCommunityState.messageOfTheDay || "No message of the day was supplied.";
  const count = startupCommunityState.notifications.length;
  $("#notificationsStatus").textContent = startupCommunityState.status === "error"
    ? "OFFICIAL STARTUP SERVICE UNAVAILABLE"
    : count ? `${count} ACTIVE OFFICIAL ${count === 1 ? "NOTIFICATION" : "NOTIFICATIONS"}` : "NO ACTIVE ACCOUNT NOTIFICATIONS";
  const badge = $("#notificationBadge");
  badge.hidden = count === 0;
  badge.textContent = String(count);
  $("#notificationsButton").classList.toggle("has-notices", count > 0);
  const list = $("#notificationsList");
  if (!count) {
    list.replaceChildren(communityElement("div", "notifications-empty", "You have no active official notifications."));
  } else {
    list.replaceChildren(...startupCommunityState.notifications.map((notification, index) => {
      const item = communityElement("article", "notification-item");
      const link = communityNotificationUrl(notification.link);
      const content = communityElement(link ? "a" : "span", "", notification.text);
      if (link) {
        content.href = link;
        content.target = "_blank";
        content.rel = "noreferrer";
      }
      const dismiss = communityElement("button", "", "×");
      dismiss.type = "button";
      dismiss.setAttribute("aria-label", `Dismiss notification: ${notification.text}`);
      dismiss.addEventListener("click", () => {
        startupCommunityState.notifications.splice(index, 1);
        renderCommunityStartup();
      });
      item.append(content, dismiss);
      return item;
    }));
  }
  const updates = Object.entries(startupCommunityState.updates).filter(([, info]) => info && typeof info === "object" && !Array.isArray(info));
  $("#officialUpdates").hidden = updates.length === 0;
  $("#officialUpdatesList").replaceChildren(...updates.map(([channel, info]) => {
    const file = communityNotificationUrl(info.File);
    const node = communityElement(file ? "a" : "span", "official-update");
    if (file) {
      node.href = file;
      node.target = "_blank";
      node.rel = "noreferrer";
    }
    const build = Number(info[channel === "Snapshot" ? "Snapshot" : "Build"] || 0);
    const version = channel === "Snapshot" ? `Build ${build}` : `${Number(info.Major || 0)}.${Number(info.Minor || 0)} · Build ${build}`;
    node.append(communityElement("strong", "", channel), document.createTextNode(version));
    if (info.Changelog) node.title = String(info.Changelog).slice(0, 2048);
    return node;
  }));
}

async function refreshCommunityStartup({ announce = false } = {}) {
  const sequence = ++startupCommunityState.sequence;
  startupCommunityState.status = "loading";
  $("#notificationsStatus").textContent = "CONTACTING POWDERTOY.CO.UK…";
  $("#refreshNotifications").disabled = true;
  try {
    const result = await getCommunityStartup(communityState.auth);
    if (sequence !== startupCommunityState.sequence) return;
    startupCommunityState.messageOfTheDay = result.messageOfTheDay;
    startupCommunityState.notifications = result.notifications;
    startupCommunityState.updates = result.updates;
    startupCommunityState.status = "ready";
    if (communityState.auth && !result.sessionGood) {
      communityState.auth = null;
      sessionStorage.removeItem(COMMUNITY_AUTH_KEY);
      updateCommunityAccountUi();
      showToast("COMMUNITY SESSION EXPIRED · SIGNED OUT", "#ffca72");
    } else if (announce) {
      showToast(`OFFICIAL NEWS REFRESHED · ${result.notifications.length} NOTICES`, "#67e8ff");
    }
    renderCommunityStartup();
  } catch (error) {
    if (sequence !== startupCommunityState.sequence) return;
    startupCommunityState.status = "error";
    if (!startupCommunityState.messageOfTheDay || startupCommunityState.messageOfTheDay.startsWith("Fetching")) {
      startupCommunityState.messageOfTheDay = error instanceof Error ? `Could not fetch the message of the day: ${error.message}` : "Could not fetch the message of the day.";
    }
    renderCommunityStartup();
    if (announce) showToast("OFFICIAL NEWS REFRESH FAILED", "#ff6f61");
  } finally {
    if (sequence === startupCommunityState.sequence) $("#refreshNotifications").disabled = false;
  }
}

function formatCommunityDate(seconds) {
  const timestamp = Number(seconds);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return "UNKNOWN DATE";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(timestamp * 1000));
}

function communitySearchQuery() {
  const fragments = [$("#communitySearch").value.trim()];
  if ($("#communitySort").value === "date") fragments.push("sort:date");
  const period = $("#communityPeriod").value;
  if (period !== "all") {
    const days = { today: 1, week: 7, month: 31, year: 365 }[period];
    const after = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
    fragments.push(`after:${after}`);
  }
  if ($("#communityScope").value === "mine" && communityState.auth?.username) fragments.push(`user:${communityState.auth.username}`);
  return fragments.filter(Boolean).join(" ");
}

function setCommunityBusy(busy, label = "Contacting the official server…") {
  $("#communityBusy").hidden = !busy;
  $("#communityBusy span").textContent = label;
}

function updateCommunityAccountUi() {
  const auth = communityState.auth;
  const hostedReadOnly = !communityCapabilities.accounts;
  const author = String(communityState.detail?.Username || communityState.selected?.Username || "").trim().toLocaleLowerCase();
  const ownsSave = Boolean(auth?.username && author && auth.username.trim().toLocaleLowerCase() === author);
  $("#communityTransportBadge").textContent = hostedReadOnly ? "LIVE OFFICIAL DATA" : "LOCAL SECURE GATEWAY";
  $("#communityTransportBadge").title = hostedReadOnly
    ? "Public metadata is read live from powdertoy.co.uk through a read-only CORS bridge. No credentials are sent."
    : "The local allowlisted gateway supports official account and upload actions.";
  $("#communityAccountLabel").textContent = auth ? `SIGNED IN · ${auth.username || `USER ${auth.userId}`}` : hostedReadOnly ? "HOSTED · READ ONLY" : "READ-ONLY GUEST";
  $("#communityLoginToggle").textContent = auth ? "Sign out" : "Sign in";
  $("#communityLoginToggle").hidden = hostedReadOnly;
  $("#communityUploadToggle").hidden = hostedReadOnly;
  $("#communityProfileToggle").hidden = !auth?.username;
  $("#communityUploadSubmit").disabled = !auth;
  $("#communityUploadSubmit").title = auth ? "Upload to the official server" : "Sign in before uploading";
  for (const option of $("#communityScope").options) {
    if (option.value !== "all") option.disabled = !auth;
  }
  if (!auth && $("#communityScope").value !== "all") $("#communityScope").value = "all";
  $("#communityVoteActions").hidden = !auth || !communityState.detail;
  if (!auth || !communityState.detail) $("#communityReportForm").hidden = true;
  $("#communityCommentForm").hidden = !auth || !communityState.detail;
  $("#communityTagForm").hidden = !auth || !communityState.detail;
  $("#communityOwnerActions").hidden = !ownsSave;
  $("#communityLoadSave").textContent = communityCapabilities.directLoad ? "Load in 3D" : "Download CPS ↗";
  $("#communityLoadSave").title = communityCapabilities.directLoad
    ? "Download and project this official save into the 3D chamber"
    : "Open the official CPS download. Direct in-app loading requires the local secure gateway.";
  if (ownsSave) {
    const published = communityState.detail?.Published !== false;
    $("#communityPublishSave").hidden = published;
    $("#communityUnpublishSave").hidden = !published;
  }
}

function renderCommunitySaves() {
  const grid = $("#communitySaveGrid");
  grid.replaceChildren();
  if (!communityState.saves.length) {
    grid.append(communityElement("div", "community-empty", "No community saves matched this search."));
  } else {
    for (const save of communityState.saves) {
      const id = Number(save.ID);
      const card = communityElement("button", "community-save-card");
      card.type = "button";
      card.setAttribute("aria-label", `Open ${save.Name || `save ${id}`} by ${save.Username || "unknown"}`);
      const preview = communityElement("img");
      preview.alt = "";
      preview.loading = "lazy";
      preview.src = communityThumbnailUrl(id, Number(save.Version) || 0);
      preview.addEventListener("error", () => {
        const fallback = communityThumbnailUrl(id);
        if (!preview.src.endsWith(fallback)) preview.src = fallback;
      }, { once: true });
      const content = communityElement("span", "community-save-card-content");
      const copy = communityElement("span", "community-save-card-copy");
      copy.append(communityElement("strong", "", save.Name || `Save #${id}`));
      copy.append(communityElement("small", "", `${save.Username || "UNKNOWN"} · ${formatCommunityDate(save.Updated || save.Created)}`));
      const score = Number(save.ScoreUp || 0) - Number(save.ScoreDown || 0);
      content.append(copy, communityElement("span", "community-save-score", `${score >= 0 ? "+" : ""}${score}`));
      card.append(preview, content);
      card.addEventListener("click", () => openCommunitySave(save));
      grid.append(card);
    }
  }
  const page = Math.floor(communityState.start / COMMUNITY_PAGE_SIZE) + 1;
  const pages = Math.max(1, Math.ceil(communityState.total / COMMUNITY_PAGE_SIZE));
  $("#communityPageLabel").textContent = `PAGE ${page} / ${pages}`;
  $("#communityPrevious").disabled = communityState.start === 0;
  $("#communityNext").disabled = communityState.start + COMMUNITY_PAGE_SIZE >= communityState.total;
  $("#communityResultLabel").textContent = `${communityState.total.toLocaleString()} OFFICIAL SAVES · SHOWING ${communityState.saves.length}${communityCapabilities.mode === "hosted" ? " · LIVE READ-ONLY" : ""}`;
}

async function refreshCommunityBrowse({ reset = false } = {}) {
  if (reset) communityState.start = 0;
  communityState.query = communitySearchQuery();
  const sequence = ++communityState.sequence;
  setCommunityBusy(true, "Loading official community saves…");
  try {
    const result = await searchCommunitySaves({
      start: communityState.start,
      count: COMMUNITY_PAGE_SIZE,
      query: communityState.query,
      category: $("#communityScope").value === "favourites" ? "Favourites" : "",
      auth: communityState.auth,
    });
    if (sequence !== communityState.sequence) return;
    communityState.total = result.total;
    communityState.saves = result.saves;
    renderCommunitySaves();
  } catch (error) {
    if (sequence !== communityState.sequence) return;
    communityState.saves = [];
    renderCommunitySaves();
    $("#communityResultLabel").textContent = "OFFICIAL SERVER UNAVAILABLE";
    showToast(error instanceof Error ? error.message.toUpperCase() : "COMMUNITY REQUEST FAILED", "#ff6f61");
  } finally {
    if (sequence === communityState.sequence) setCommunityBusy(false);
  }
}

function renderCommunityComments() {
  const host = $("#communityComments");
  host.replaceChildren();
  $("#communityCommentsLabel").textContent = `${Number(communityState.detail?.Comments || communityState.comments.length)} COMMENTS`;
  if (!communityState.comments.length) {
    host.append(communityElement("div", "community-empty", "No comments yet."));
    return;
  }
  for (const comment of communityState.comments) {
    const item = communityElement("article", "community-comment");
    item.append(communityElement("strong", "", comment.FormattedUsername || comment.Username || "Unknown"));
    item.append(communityElement("p", "", comment.Text || ""));
    if (comment.Timestamp) item.append(communityElement("time", "", formatCommunityDate(comment.Timestamp)));
    host.append(item);
  }
}

function renderCommunityDetail(summary, detail) {
  communityState.detail = detail;
  const id = Number(detail.ID || summary.ID);
  $("#communityDetailId").textContent = `SAVE #${id}`;
  $("#communityDetailName").textContent = detail.Name || detail.ShortName || summary.Name || `Save #${id}`;
  const author = detail.Username || summary.Username || "Unknown";
  $("#communityAuthorProfile").textContent = `VIEW AUTHOR PROFILE · ${author}`;
  $("#communityAuthorProfile").dataset.username = author;
  $("#communityDetailDescription").textContent = detail.Description || "No description provided.";
  $("#communityDetailImage").src = communityThumbnailUrl(id, Number(summary.Version || detail.Version) || 0);
  $("#communityOpenWebsite").href = communityWebsiteUrl(id);
  const up = Number(detail.ScoreUp ?? summary.ScoreUp ?? 0);
  const down = Number(detail.ScoreDown ?? summary.ScoreDown ?? 0);
  const meta = [
    ["Author", detail.Username || summary.Username || "Unknown"], ["Score", `${up - down} (${up}▲ ${down}▼)`],
    ["Views", Number(detail.Views || 0).toLocaleString()], ["Updated", formatCommunityDate(detail.Date || summary.Updated)],
    ["Status", detail.Published === false ? "Private" : "Published"],
  ];
  const metaHost = $("#communityDetailMeta");
  metaHost.replaceChildren(...meta.map(([name, value]) => {
    const node = communityElement("span");
    node.append(communityElement("strong", "", `${name}: `), document.createTextNode(String(value)));
    return node;
  }));
  const tags = Array.isArray(detail.Tags) ? detail.Tags : [];
  $("#communityDetailTags").replaceChildren(...tags.map((tag) => communityElement("span", "", String(tag))));
  document.querySelectorAll("[data-community-vote]").forEach((button) => {
    button.dataset.selected = String(Number(button.dataset.communityVote) === Number(detail.ScoreMine || 0));
  });
  $("#communityFavourite").textContent = detail.Favourite ? "★ Favourited" : "☆ Favourite";
  $("#communityReportForm").hidden = true;
  $("#communityReportReason").value = "";
  renderCommunityComments();
  updateCommunityAccountUi();
}

function profileWebsite(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  try {
    const parsed = new URL(/^[a-z][a-z0-9+.-]*:/iu.test(raw) ? raw : `https://${raw}`);
    return ["http:", "https:"].includes(parsed.protocol) ? parsed.href : null;
  } catch { return null; }
}

function renderCommunityProfile(profile) {
  communityState.profile = profile;
  const username = String(profile.Username || profile.Name || "Unknown");
  $("#communityProfileName").textContent = username;
  $("#communityProfileAvatar").src = communityAvatarUrl(username);
  $("#communityProfileLocation").textContent = profile.Location || "Location not provided";
  $("#communityProfileBiography").textContent = profile.Biography || "No biography provided.";
  const website = profileWebsite(profile.Website);
  $("#communityProfileWebsite").hidden = !website;
  if (website) $("#communityProfileWebsite").href = website;
  const saves = profile.Saves && typeof profile.Saves === "object" ? profile.Saves : {};
  const forum = profile.Forum && typeof profile.Forum === "object" ? profile.Forum : {};
  const stats = [
    ["Saves", Number(saves.Count || 0).toLocaleString()],
    ["Average score", Number(saves.AverageScore || 0).toFixed(2)],
    ["Highest score", Number(saves.HighestScore || 0).toLocaleString()],
    ["Forum topics", Number(forum.Topics || 0).toLocaleString()],
    ["Forum replies", Number(forum.Replies || 0).toLocaleString()],
    ["Reputation", Number(forum.Reputation || 0).toLocaleString()],
  ];
  $("#communityProfileStats").replaceChildren(...stats.map(([label, value]) => {
    const item = communityElement("span");
    item.append(communityElement("strong", "", value), document.createTextNode(label));
    return item;
  }));
  const ownsProfile = Boolean(communityState.auth?.username && communityState.auth.username.toLocaleLowerCase() === username.toLocaleLowerCase());
  $("#communityProfileForm").hidden = !ownsProfile;
  if (ownsProfile) {
    $("#communityProfileLocationInput").value = profile.Location || "";
    $("#communityProfileBiographyInput").value = profile.Biography || "";
  }
}

async function openCommunityProfile(username, returnView = "browse") {
  communityState.profileReturn = returnView;
  $("#communityBrowseView").hidden = true;
  $("#communityDetailView").hidden = true;
  $("#communityProfileView").hidden = false;
  setCommunityBusy(true, "Loading official user profile…");
  try {
    renderCommunityProfile(await getCommunityProfile(username));
  } catch (error) {
    $("#communityProfileView").hidden = true;
    $(returnView === "detail" && communityState.detail ? "#communityDetailView" : "#communityBrowseView").hidden = false;
    showToast(error instanceof Error ? error.message.toUpperCase() : "PROFILE LOAD FAILED", "#ff6f61");
  } finally { setCommunityBusy(false); }
}

async function openCommunitySave(summary) {
  communityState.selected = summary;
  $("#communityBrowseView").hidden = true;
  $("#communityDetailView").hidden = false;
  setCommunityBusy(true, "Loading save details and comments…");
  try {
    const id = Number(summary.ID);
    const [detailResult, commentsResult] = await Promise.allSettled([
      getCommunitySave(id, { auth: communityState.auth }),
      getCommunityComments(id, { count: 40 }),
    ]);
    if (detailResult.status !== "fulfilled") throw detailResult.reason;
    communityState.comments = commentsResult.status === "fulfilled" && Array.isArray(commentsResult.value) ? commentsResult.value : [];
    renderCommunityDetail(summary, detailResult.value);
  } catch (error) {
    $("#communityBrowseView").hidden = false;
    $("#communityDetailView").hidden = true;
    showToast(error instanceof Error ? error.message.toUpperCase() : "SAVE DETAILS FAILED", "#ff6f61");
  } finally { setCommunityBusy(false); }
}

function setCommunityOpen(open) {
  $("#communityDialog").hidden = !open;
  if (open) {
    updateCommunityAccountUi();
    $("#communityLoginForm").hidden = true;
    $("#communityUploadForm").hidden = true;
    $("#communityBrowseView").hidden = false;
    $("#communityDetailView").hidden = true;
    $("#communityProfileView").hidden = true;
    refreshCommunityBrowse({ reset: true });
  }
}

function setNotificationsOpen(open) {
  $("#notificationsDialog").hidden = !open;
  if (open) renderCommunityStartup();
}
$("#notificationsButton").addEventListener("click", () => setNotificationsOpen(true));
$("#closeNotificationsDialog").addEventListener("click", () => setNotificationsOpen(false));
$("#notificationsDialog").addEventListener("pointerdown", (event) => {
  if (event.target === $("#notificationsDialog")) setNotificationsOpen(false);
});
$("#refreshNotifications").addEventListener("click", () => refreshCommunityStartup({ announce: true }));

$("#communityButton").addEventListener("click", () => setCommunityOpen(true));
$("#closeCommunityDialog").addEventListener("click", () => setCommunityOpen(false));
$("#communityDialog").addEventListener("pointerdown", (event) => { if (event.target === $("#communityDialog")) setCommunityOpen(false); });
$("#communitySearchForm").addEventListener("submit", (event) => { event.preventDefault(); refreshCommunityBrowse({ reset: true }); });
$("#communityRefresh").addEventListener("click", () => refreshCommunityBrowse());
$("#communityPrevious").addEventListener("click", () => { communityState.start = Math.max(0, communityState.start - COMMUNITY_PAGE_SIZE); refreshCommunityBrowse(); });
$("#communityNext").addEventListener("click", () => { communityState.start += COMMUNITY_PAGE_SIZE; refreshCommunityBrowse(); });
$("#communityBack").addEventListener("click", () => { $("#communityDetailView").hidden = true; $("#communityBrowseView").hidden = false; communityState.detail = null; updateCommunityAccountUi(); });
$("#communityProfileBack").addEventListener("click", () => {
  $("#communityProfileView").hidden = true;
  $(communityState.profileReturn === "detail" && communityState.detail ? "#communityDetailView" : "#communityBrowseView").hidden = false;
});
$("#communityAuthorProfile").addEventListener("click", () => {
  const username = $("#communityAuthorProfile").dataset.username;
  if (username && username !== "Unknown") openCommunityProfile(username, "detail");
});
$("#communityProfileToggle").addEventListener("click", () => {
  if (!communityState.auth?.username) return;
  const returnView = !$("#communityDetailView").hidden ? "detail" : "browse";
  openCommunityProfile(communityState.auth.username, returnView);
});
$("#communityLoginToggle").addEventListener("click", () => {
  if (communityState.auth) {
    communityState.auth = null;
    sessionStorage.removeItem(COMMUNITY_AUTH_KEY);
    $("#communityLoginForm").hidden = true;
    $("#communityUploadForm").hidden = true;
    updateCommunityAccountUi();
    if (startupNotificationsEnabled) refreshCommunityStartup();
    showToast("SIGNED OUT OF COMMUNITY", "#67e8ff");
    return;
  }
  $("#communityLoginForm").hidden = !$("#communityLoginForm").hidden;
  if (!$("#communityLoginForm").hidden) $("#communityUsername").focus();
});
$("#communityUploadToggle").addEventListener("click", () => {
  $("#communityUploadForm").hidden = !$("#communityUploadForm").hidden;
  $("#communityLoginForm").hidden = true;
  if (!$("#communityUploadForm").hidden) $("#communityUploadName").focus();
});

async function prepareCommunityOps() {
  const projection = $("#communityUploadMode").value;
  const { exportOps } = await import("./ops-export.js");
  const result = exportOps(simulation, { mode: projection, depth: state.currentCell?.z ?? Math.floor(simulation.depth / 2), paused: state.paused });
  const omitted = result.report.omitted ? ` · ${result.report.omitted} unsupported omitted` : "";
  $("#communityUploadReport").textContent = `${result.report.width}×${result.report.height} · ${result.report.exported} particles · ${(result.bytes.length / 1024).toFixed(1)} KiB${omitted}`;
  return result;
}

$("#communityPrepareUpload").addEventListener("click", async () => {
  setCommunityBusy(true, "Validating official OPS serialization…");
  try {
    const { report } = await prepareCommunityOps();
    showToast(`OPS VALID · ${report.exported} PARTICLES`, report.omitted ? "#ffca72" : "#67e8ff");
  } catch (error) { showToast(error instanceof Error ? error.message.toUpperCase() : "OPS EXPORT FAILED", "#ff6f61"); }
  finally { setCommunityBusy(false); }
});
$("#communityLoginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  setCommunityBusy(true, "Signing in to powdertoy.co.uk…");
  try {
    const result = await loginCommunity($("#communityUsername").value, $("#communityPassword").value);
    communityState.auth = {
      userId: Number(result.UserID), username: result.Username, sessionId: result.SessionID, sessionKey: result.SessionKey,
    };
    sessionStorage.setItem(COMMUNITY_AUTH_KEY, JSON.stringify(communityState.auth));
    $("#communityPassword").value = "";
    $("#communityLoginForm").hidden = true;
    updateCommunityAccountUi();
    if (startupNotificationsEnabled) await refreshCommunityStartup();
    showToast(`SIGNED IN AS ${String(result.Username || "USER").toUpperCase()}`, "#67e8ff");
    if (communityState.selected && communityState.detail) await openCommunitySave(communityState.selected);
  } catch (error) { showToast(error instanceof Error ? error.message.toUpperCase() : "SIGN IN FAILED", "#ff6f61"); }
  finally { setCommunityBusy(false); }
});
$("#communityUploadForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!communityState.auth) return;
  const name = $("#communityUploadName").value.trim();
  const published = $("#communityUploadPublished").checked;
  const projection = $("#communityUploadMode").value;
  const visibility = published ? "publicly" : "as a private save";
  if (!window.confirm(`Upload “${name}” ${visibility} to powdertoy.co.uk using the ${projection} projection?`)) return;
  setCommunityBusy(true, "Serializing the chamber to official OPS format…");
  try {
    const { bytes, report } = await prepareCommunityOps();
    setCommunityBusy(true, "Uploading OPS save to powdertoy.co.uk…");
    const id = await uploadCommunitySave({
      name, description: $("#communityUploadDescription").value, published, data: bytes,
    }, communityState.auth);
    $("#communityUploadForm").reset();
    $("#communityUploadForm").hidden = true;
    const omitted = report.omitted ? ` · ${report.omitted} CUSTOM PARTICLES OMITTED` : "";
    showToast(`SAVE #${id} UPLOADED · ${report.exported} PARTICLES${omitted}`, report.omitted ? "#ffca72" : "#67e8ff");
    refreshCommunityBrowse({ reset: true });
  } catch (error) { showToast(error instanceof Error ? error.message.toUpperCase() : "UPLOAD FAILED", "#ff6f61"); }
  finally { setCommunityBusy(false); }
});
$("#communityLoadSave").addEventListener("click", async () => {
  const id = Number(communityState.detail?.ID || communityState.selected?.ID);
  if (!id) return;
  if (!communityCapabilities.directLoad) {
    const date = Number(communityState.selected?.Version || communityState.detail?.Version) || 0;
    window.open(communitySaveDownloadUrl(id, date), "_blank", "noopener,noreferrer");
    showToast(`OFFICIAL SAVE #${id} DOWNLOAD OPENED`, "#67e8ff");
    return;
  }
  setCommunityBusy(true, "Downloading and projecting save into 3D…");
  try {
    const bytes = await downloadCommunitySave(id);
    await loadSimulationBytes(bytes);
    setCommunityOpen(false);
    showToast(`COMMUNITY SAVE #${id} LOADED`, "#67e8ff");
  } catch (error) { showToast(error instanceof Error ? error.message.toUpperCase() : "COMMUNITY LOAD FAILED", "#ff6f61"); }
  finally { setCommunityBusy(false); }
});
document.querySelectorAll("[data-community-vote]").forEach((button) => button.addEventListener("click", async () => {
  if (!communityState.auth || !communityState.detail) return;
  setCommunityBusy(true, "Submitting vote…");
  try {
    await voteCommunitySave(communityState.detail.ID, Number(button.dataset.communityVote), communityState.auth);
    await openCommunitySave(communityState.selected);
    showToast("VOTE UPDATED", "#67e8ff");
  } catch (error) { showToast(error instanceof Error ? error.message.toUpperCase() : "VOTE FAILED", "#ff6f61"); }
  finally { setCommunityBusy(false); }
}));
$("#communityFavourite").addEventListener("click", async () => {
  if (!communityState.auth || !communityState.detail) return;
  setCommunityBusy(true, "Updating favourite…");
  try {
    await favouriteCommunitySave(communityState.detail.ID, !communityState.detail.Favourite, communityState.auth);
    await openCommunitySave(communityState.selected);
    showToast("FAVOURITE UPDATED", "#67e8ff");
  } catch (error) { showToast(error instanceof Error ? error.message.toUpperCase() : "FAVOURITE FAILED", "#ff6f61"); }
  finally { setCommunityBusy(false); }
});
$("#communityReportToggle").addEventListener("click", () => {
  if (!communityState.auth || !communityState.detail) return;
  $("#communityReportForm").hidden = !$("#communityReportForm").hidden;
  if (!$("#communityReportForm").hidden) $("#communityReportReason").focus();
});
$("#communityReportCancel").addEventListener("click", () => {
  $("#communityReportForm").hidden = true;
  $("#communityReportReason").value = "";
});
$("#communityReportForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!communityState.auth || !communityState.detail) return;
  const id = Number(communityState.detail.ID);
  const name = communityState.detail.Name || `Save #${id}`;
  const reason = $("#communityReportReason").value;
  if (!window.confirm(`Submit this report about “${name}” to the Powder Toy moderators?`)) return;
  setCommunityBusy(true, "Submitting report to the official moderators…");
  try {
    await reportCommunitySave(id, reason, communityState.auth);
    $("#communityReportReason").value = "";
    $("#communityReportForm").hidden = true;
    showToast("REPORT SUBMITTED", "#67e8ff");
  } catch (error) { showToast(error instanceof Error ? error.message.toUpperCase() : "REPORT FAILED", "#ff6f61"); }
  finally { setCommunityBusy(false); }
});
async function changeCommunityPublishState(published) {
  if (!communityState.auth || !communityState.detail) return;
  const id = Number(communityState.detail.ID);
  const name = communityState.detail.Name || `Save #${id}`;
  const verb = published ? "publish" : "unpublish";
  if (!window.confirm(`${published ? "Publish" : "Unpublish"} “${name}” on powdertoy.co.uk?`)) return;
  setCommunityBusy(true, `${published ? "Publishing" : "Unpublishing"} save…`);
  try {
    await setCommunitySavePublished(id, published, communityState.auth);
    await openCommunitySave(communityState.selected);
    showToast(`SAVE #${id} ${verb.toUpperCase()}ED`, "#67e8ff");
  } catch (error) { showToast(error instanceof Error ? error.message.toUpperCase() : `${verb.toUpperCase()} FAILED`, "#ff6f61"); }
  finally { setCommunityBusy(false); }
}
$("#communityPublishSave").addEventListener("click", () => changeCommunityPublishState(true));
$("#communityUnpublishSave").addEventListener("click", () => changeCommunityPublishState(false));
$("#communityDeleteSave").addEventListener("click", async () => {
  if (!communityState.auth || !communityState.detail) return;
  const id = Number(communityState.detail.ID);
  const name = communityState.detail.Name || `Save #${id}`;
  if (!window.confirm(`Permanently delete “${name}” (save #${id}) from powdertoy.co.uk? This cannot be undone.`)) return;
  setCommunityBusy(true, "Deleting save from powdertoy.co.uk…");
  try {
    await deleteCommunitySave(id, communityState.auth);
    communityState.detail = null;
    communityState.selected = null;
    $("#communityDetailView").hidden = true;
    $("#communityBrowseView").hidden = false;
    updateCommunityAccountUi();
    await refreshCommunityBrowse();
    showToast(`SAVE #${id} DELETED`, "#67e8ff");
  } catch (error) { showToast(error instanceof Error ? error.message.toUpperCase() : "DELETE FAILED", "#ff6f61"); }
  finally { setCommunityBusy(false); }
});
$("#communityProfileForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!communityState.auth || !communityState.profile) return;
  setCommunityBusy(true, "Saving official profile…");
  try {
    await updateCommunityProfile({
      location: $("#communityProfileLocationInput").value,
      biography: $("#communityProfileBiographyInput").value,
    }, communityState.auth);
    renderCommunityProfile(await getCommunityProfile(communityState.auth.username));
    showToast("PROFILE UPDATED", "#67e8ff");
  } catch (error) { showToast(error instanceof Error ? error.message.toUpperCase() : "PROFILE UPDATE FAILED", "#ff6f61"); }
  finally { setCommunityBusy(false); }
});
$("#communityCommentForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!communityState.auth || !communityState.detail) return;
  setCommunityBusy(true, "Posting comment…");
  try {
    await commentOnCommunitySave(communityState.detail.ID, $("#communityCommentText").value, communityState.auth);
    $("#communityCommentText").value = "";
    await openCommunitySave(communityState.selected);
    showToast("COMMENT POSTED", "#67e8ff");
  } catch (error) { showToast(error instanceof Error ? error.message.toUpperCase() : "COMMENT FAILED", "#ff6f61"); }
  finally { setCommunityBusy(false); }
});
$("#communityTagForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!communityState.auth || !communityState.detail) return;
  const operation = event.submitter?.dataset.tagOperation;
  if (operation !== "add" && operation !== "delete") return;
  setCommunityBusy(true, operation === "add" ? "Adding tag…" : "Removing tag…");
  try {
    const tags = await editCommunityTag(communityState.detail.ID, operation, $("#communityTagText").value, communityState.auth);
    $("#communityTagText").value = "";
    if (Array.isArray(tags?.Tags)) communityState.detail.Tags = tags.Tags;
    await openCommunitySave(communityState.selected);
    showToast(operation === "add" ? "TAG ADDED" : "TAG REMOVED", "#67e8ff");
  } catch (error) { showToast(error instanceof Error ? error.message.toUpperCase() : "TAG UPDATE FAILED", "#ff6f61"); }
  finally { setCommunityBusy(false); }
});

$("#loadInput").addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    await loadSimulationBytes(new Uint8Array(await file.arrayBuffer()));
  } catch (error) {
    showToast(error instanceof Error ? error.message.toUpperCase() : "SAVE LOAD FAILED", "#ff6f61");
  } finally { event.target.value = ""; }
});
document.querySelectorAll("#libraryModeTabs button").forEach((button) => button.addEventListener("click", () => setLibraryMode(button.dataset.libraryMode)));
$("#propertyField").replaceChildren(...PARTICLE_PROPERTIES.map((property) => {
  const option = document.createElement("option");
  option.value = property.id;
  option.textContent = property.name;
  return option;
}));
$("#propertyField").value = state.propertyField;
$("#propertyValue").value = state.propertyRaw;
function syncPropertyEditor(persist = true) {
  state.propertyField = $("#propertyField").value;
  state.propertyRaw = $("#propertyValue").value;
  try {
    const parsed = parseParticleProperty(state.propertyField, state.propertyRaw);
    state.propertyField = parsed.property;
    state.propertyValue = parsed.value;
    state.propertyValid = true;
    $("#propertyValue").setAttribute("aria-invalid", "false");
    $("#propertyHint").textContent = parsed.descriptor.description;
    if (persist) localStorage.setItem(PROPERTY_STORAGE_KEY, JSON.stringify({ field: state.propertyField, value: state.propertyRaw }));
  } catch (error) {
    state.propertyValid = false;
    $("#propertyValue").setAttribute("aria-invalid", "true");
    $("#propertyHint").textContent = error instanceof Error ? error.message : "Invalid property value";
  }
}
$("#propertyField").addEventListener("change", () => syncPropertyEditor());
$("#propertyValue").addEventListener("input", () => syncPropertyEditor());
syncPropertyEditor(false);
$("#decorationColor").value = state.decorationColor;
$("#decorationAlpha").value = state.decorationAlpha;
$("#decorationAlphaLabel").textContent = state.decorationAlpha;
$("#decorationColor").addEventListener("input", (event) => {
  state.decorationColor = event.target.value;
  localStorage.setItem(DECORATION_STORAGE_KEY, JSON.stringify({ color: state.decorationColor, alpha: state.decorationAlpha }));
  buildMaterialGrid();
});
$("#decorationAlpha").addEventListener("input", (event) => {
  state.decorationAlpha = Number(event.target.value);
  $("#decorationAlphaLabel").textContent = state.decorationAlpha;
  localStorage.setItem(DECORATION_STORAGE_KEY, JSON.stringify({ color: state.decorationColor, alpha: state.decorationAlpha }));
});
$("#elementSearch").addEventListener("input", (event) => {
  state.elementQuery = event.target.value;
  document.querySelectorAll("#categoryTabs button").forEach((button) => button.classList.toggle("active", !state.elementQuery && button.dataset.category === state.category));
  buildMaterialGrid();
});
$("#exposureSlider").addEventListener("input", (event) => {
  const exposure = Number(event.target.value);
  matterRenderer.setExposure(exposure / 100);
  $("#exposureLabel").textContent = `${exposure}%`;
});
document.querySelectorAll("#viewModeButtons button").forEach((button) => button.addEventListener("click", () => setViewMode(button.dataset.viewMode)));
document.querySelectorAll("#drawModeButtons button").forEach((button) => button.addEventListener("click", () => setDrawMode(button.dataset.drawMode)));
$("#eraseButton").addEventListener("click", () => {
  state.erasing = !state.erasing;
  syncMaterialSelection();
  showToast(state.erasing ? "ERASER ARMED" : `${currentPaletteItem().name.toUpperCase()} ARMED`, state.erasing ? "#b8d4dc" : currentPaletteItem().css);
});
$("#cameraButton").addEventListener("click", () => {
  matterRenderer.resetCamera(true);
  showToast("CAMERA RECENTERED", "#67e8ff");
});
$("#fullscreenButton").addEventListener("click", async () => {
  if (document.fullscreenElement) await document.exitFullscreen();
  else await document.documentElement.requestFullscreen();
});
$("#audioButton").addEventListener("click", async () => {
  const enabled = await soundscape.toggle();
  $("#audioButton").classList.toggle("active", enabled);
  $("#audioButton .button-label").textContent = enabled ? "Audio on" : "Audio off";
  showToast(enabled ? "PROCEDURAL AUDIO ONLINE" : "AUDIO MUTED", "#67e8ff");
});

const ACTOR_KEY_BINDINGS = new Map([
  ["ArrowLeft", [0, 0x01]], ["ArrowRight", [0, 0x02]], ["ArrowUp", [0, 0x04]], ["ArrowDown", [0, 0x08]],
  ["Numpad7", [0, 0x10]], ["Numpad9", [0, 0x20]],
  ["KeyA", [1, 0x01]], ["KeyD", [1, 0x02]], ["KeyW", [1, 0x04]], ["KeyS", [1, 0x08]],
  ["KeyQ", [1, 0x10]], ["KeyE", [1, 0x20]],
]);

document.addEventListener("keydown", (event) => {
  if (event.target instanceof HTMLInputElement) return;
  if (event.code === "Backquote") {
    event.preventDefault();
    setConsoleOpen(true);
    return;
  }
  if (event.ctrlKey || event.metaKey) {
    if (event.code === "KeyC") {
      event.preventDefault();
      copySelection(false);
    } else if (event.code === "KeyX") {
      event.preventDefault();
      copySelection(true);
    } else if (event.code === "KeyV") {
      event.preventDefault();
      pasteClipboard();
    } else if (event.code === "KeyZ") {
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
    } else if (event.code === "KeyY") {
      event.preventDefault();
      redo();
    } else if (event.code === "KeyS") {
      event.preventDefault();
      $("#saveButton").click();
    } else if (event.code === "KeyO") {
      event.preventDefault();
      $("#loadButton").click();
    }
    return;
  }
  const actorBinding = ACTOR_KEY_BINDINGS.get(event.code);
  if (actorBinding && simulation.actorSpawns[actorBinding[0]]) {
    event.preventDefault();
    simulation.setActorCommand(actorBinding[0], actorBinding[1], true);
    return;
  }
  if (event.code === "Space") {
    event.preventDefault();
    togglePause();
  } else if (event.code === "KeyE") {
    event.preventDefault();
    $("#elementSearch").focus();
  } else if (event.code === "KeyF") singleStep();
  else if (event.code === "KeyR") loadPreset(state.currentPreset);
  else if (event.code === "KeyX") {
    state.erasing = !state.erasing;
    syncMaterialSelection();
  }
  else if (event.code === "KeyC") matterRenderer.resetCamera(true);
  else if (event.code === "KeyS") toggleSection();
  else if (event.code === "KeyB") setDrawMode("brush");
  else if (event.code === "KeyL") setDrawMode("line");
  else if (event.code === "KeyU") setDrawMode("box");
  else if (event.code === "KeyG") setDrawMode("flood");
  else if (event.code === "KeyI") setDrawMode("sample");
  else if (event.code === "KeyP") setDrawMode("replace");
  else if (event.code === "KeyM") setDrawMode("select");
  else if (event.code === "KeyN") setDrawMode("sign");
  else if (event.code === "BracketLeft") updateRadius(state.radius - 1);
  else if (event.code === "BracketRight") updateRadius(state.radius + 1);
  else if (event.code.startsWith("Digit")) {
    const index = Number(event.code.slice(-1)) - 1;
    if (CATEGORY_ORDER[index]) {
      if (state.libraryMode !== "elements") setLibraryMode("elements");
      setCategory(CATEGORY_ORDER[index]);
    }
  }
});

document.addEventListener("keyup", (event) => {
  const actorBinding = ACTOR_KEY_BINDINGS.get(event.code);
  if (!actorBinding) return;
  simulation.setActorCommand(actorBinding[0], actorBinding[1], false);
});

window.addEventListener("blur", () => {
  simulation.actorCommands.fill(0);
});

function updateTelemetry(stats) {
  $("#particleCount").textContent = stats.active.toLocaleString();
  $("#temperatureReadout").textContent = `${Math.round(stats.peakTemp).toLocaleString()}°C`;
  $("#pressureReadout").textContent = Number(stats.maxPressure ?? 0).toFixed(2);
  $("#airVelocityReadout").textContent = Number(stats.maxAirVelocity ?? 0).toFixed(2);
  $("#gravityReadout").textContent = `${Number(stats.maxGravity ?? 0).toFixed(2)} G`;
  $("#tickLabel").textContent = `TICK ${String(simulation.tick).padStart(6, "0")}`;
  $("#fpsBadge").textContent = `${Math.round(state.fps)} FPS`;
  const capacityRatio = stats.active / simulation.size;
  $("#particleSpark").style.transform = `scaleX(${Math.max(0.06, Math.min(1, capacityRatio * 2.8))})`;
  $("#heatSpark").style.transform = `scaleX(${Math.max(0.04, Math.min(1, stats.peakTemp / 1500))})`;
  $("#pressureSpark").style.transform = `scaleX(${Math.max(0.04, Math.min(1, (stats.maxPressure ?? 0) / 64))})`;
  $("#airVelocitySpark").style.transform = `scaleX(${Math.max(0.04, Math.min(1, (stats.maxAirVelocity ?? 0) / 16))})`;
  $("#gravitySpark").style.transform = `scaleX(${Math.max(0.04, Math.min(1, (stats.maxGravity ?? 0) / 4))})`;
  const load = Math.min(100, state.simStepMs / (1000 / 24) * 100);
  $("#loadReadout").textContent = `${Math.round(load)}%`;
  $("#loadBar").style.width = `${Math.max(2, load)}%`;
  soundscape.update(stats, simulation.activity);
}

buildCategoryTabs();
buildPresets();
syncHistoryButtons();
matterRenderer.setExposure(2.3);
matterRenderer.setViewMode("clarity");
updateRadius(state.radius);
updateDepth(Math.floor(simulation.depth / 2));
matterRenderer.setSectionEnabled(true);
matterRenderer.updateFromSimulation();
updateTelemetry(simulation.calculateStats());

window.setTimeout(() => $("#loading").classList.add("complete"), 650);
window.setTimeout(() => $("#loading").remove(), 1250);

let lastFrame = performance.now();
let telemetryTimer = 0;
function animate(now) {
  const delta = Math.min(0.08, (now - lastFrame) / 1000);
  lastFrame = now;
  const instantFps = 1 / Math.max(delta, 0.001);
  state.fps += (instantFps - state.fps) * 0.06;

  if (!state.paused) {
    state.accumulator += delta;
    const interval = 1 / 24;
    let steps = 0;
    while (state.accumulator >= interval && steps < 2) {
      const started = performance.now();
      dispatchLuaEvent("presim");
      simulation.step();
      dispatchLuaEvent("tick");
      state.simStepMs += ((performance.now() - started) - state.simStepMs) * 0.16;
      state.accumulator -= interval;
      state.visualDirty = true;
      steps += 1;
    }
    if (steps === 2) state.accumulator = Math.min(state.accumulator, interval);
  }

  if (state.visualDirty) {
    matterRenderer.updateFromSimulation();
    state.visualDirty = false;
  }
  matterRenderer.render(delta);

  telemetryTimer += delta;
  if (telemetryTimer >= 0.28) {
    telemetryTimer = 0;
    updateTelemetry(simulation.calculateStats());
  }
  requestAnimationFrame(animate);
}
requestAnimationFrame(animate);

renderCommunityStartup();
if (startupNotificationsEnabled) refreshCommunityStartup();
void runLuaAutorunScripts();

window.addEventListener("beforeunload", () => matterRenderer.dispose());
