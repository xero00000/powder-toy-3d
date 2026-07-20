// SPDX-License-Identifier: GPL-3.0-or-later

export const LUA_SCRIPT_METADATA_KEY = "powder-toy-3d-lua-script-manager-v1";
const SCRIPT_DIRECTORY = "/scripts";

function cleanName(input) {
  const leaf = String(input ?? "").replaceAll("\\", "/").split("/").pop().trim();
  const stem = leaf.replace(/[\u0000-\u001f<>:"|?*]/g, "-").replace(/^\.+/, "").slice(0, 72);
  if (!stem) throw new Error("script name is required");
  return stem.toLowerCase().endsWith(".lua") ? stem : `${stem}.lua`;
}

export class LuaScriptLibrary {
  constructor({ fileSystem, storage = null, key = LUA_SCRIPT_METADATA_KEY } = {}) {
    if (!fileSystem) throw new Error("script library requires a virtual filesystem");
    this.fileSystem = fileSystem;
    this.storage = storage;
    this.key = key;
    this.enabled = new Set();
    this.fileSystem.makeDirectory(SCRIPT_DIRECTORY);
    this.restore();
  }

  restore() {
    if (!this.storage) return;
    try {
      const saved = JSON.parse(this.storage.getItem(this.key) ?? "null");
      if (saved?.version !== 1 || !Array.isArray(saved.autorun)) return;
      for (const name of saved.autorun) {
        const normalized = cleanName(name);
        if (this.fileSystem.isFile(this.path(normalized))) this.enabled.add(normalized);
      }
    } catch {
      this.enabled.clear();
    }
  }

  persist() {
    if (!this.storage) return true;
    try {
      this.storage.setItem(this.key, JSON.stringify({ version: 1, autorun: [...this.enabled].sort() }));
      return true;
    } catch {
      return false;
    }
  }

  path(name) { return `${SCRIPT_DIRECTORY}/${cleanName(name)}`; }

  list() {
    return this.fileSystem.list(SCRIPT_DIRECTORY)
      .filter((name) => name.toLowerCase().endsWith(".lua") && this.fileSystem.isFile(this.path(name)))
      .map((name) => {
        const content = this.fileSystem.read(this.path(name)) ?? "";
        return { name, content, bytes: new TextEncoder().encode(content).length, autorun: this.enabled.has(name) };
      });
  }

  get(name) {
    const normalized = cleanName(name);
    const content = this.fileSystem.read(this.path(normalized));
    return content == null ? null : { name: normalized, content, bytes: new TextEncoder().encode(content).length, autorun: this.enabled.has(normalized) };
  }

  write(name, content) {
    const normalized = cleanName(name);
    if (!this.fileSystem.write(this.path(normalized), String(content ?? ""))) throw new Error(`could not save ${normalized}`);
    return this.get(normalized);
  }

  rename(from, to, replace = false) {
    const source = cleanName(from);
    const target = cleanName(to);
    if (source === target) return this.get(source);
    if (!this.fileSystem.move(this.path(source), this.path(target), replace)) throw new Error(`could not rename ${source}`);
    if (this.enabled.delete(source)) this.enabled.add(target);
    this.persist();
    return this.get(target);
  }

  remove(name) {
    const normalized = cleanName(name);
    if (!this.fileSystem.removeFile(this.path(normalized))) return false;
    this.enabled.delete(normalized);
    this.persist();
    return true;
  }

  setAutorun(name, enabled) {
    const normalized = cleanName(name);
    if (!this.fileSystem.isFile(this.path(normalized))) throw new Error(`script ${normalized} has not been saved`);
    if (enabled) this.enabled.add(normalized);
    else this.enabled.delete(normalized);
    this.persist();
    return enabled;
  }

  uniqueName(input) {
    const requested = cleanName(input);
    if (!this.get(requested)) return requested;
    const stem = requested.slice(0, -4);
    for (let suffix = 2; suffix <= 999; suffix += 1) {
      const candidate = `${stem}-${suffix}.lua`;
      if (!this.get(candidate)) return candidate;
    }
    throw new Error("script library has no available filename");
  }
}
