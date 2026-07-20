// SPDX-License-Identifier: GPL-3.0-or-later

const DEFAULT_KEY = "powder-toy-3d-lua-filesystem-v1";

export class LuaVirtualFileSystem {
  constructor({ storage = null, key = DEFAULT_KEY, maxBytes = 256 * 1024, maxFiles = 128 } = {}) {
    this.storage = storage;
    this.key = key;
    this.maxBytes = maxBytes;
    this.maxFiles = maxFiles;
    this.files = new Map();
    this.directories = new Set(["/"]);
    this.restore();
  }

  normalize(input) {
    const raw = String(input ?? "").replaceAll("\\", "/").trim();
    if (!raw || raw.includes("\0")) throw new Error("invalid virtual path");
    const parts = raw.split("/").filter((part) => part && part !== ".");
    if (parts.some((part) => part === "..")) throw new Error("virtual paths cannot escape the script sandbox");
    const normalized = `/${parts.join("/")}`;
    if (normalized.length > 160) throw new Error("virtual path is too long");
    return normalized;
  }

  parent(path) {
    const index = path.lastIndexOf("/");
    return index <= 0 ? "/" : path.slice(0, index);
  }

  restore() {
    if (!this.storage) return;
    try {
      const saved = JSON.parse(this.storage.getItem(this.key) ?? "null");
      if (!saved || saved.version !== 1 || !Array.isArray(saved.files) || !Array.isArray(saved.directories)) return;
      for (const directory of saved.directories) this.directories.add(this.normalize(directory));
      for (const [filename, content] of saved.files.slice(0, this.maxFiles)) {
        const path = this.normalize(filename);
        if (typeof content === "string") this.files.set(path, content);
      }
    } catch {
      this.files.clear();
      this.directories = new Set(["/"]);
    }
  }

  persist() {
    if (!this.storage) return true;
    try {
      this.storage.setItem(this.key, JSON.stringify({ version: 1, directories: [...this.directories], files: [...this.files] }));
      return true;
    } catch {
      return false;
    }
  }

  totalBytes(files = this.files) {
    let total = 0;
    for (const [path, content] of files) total += path.length + new TextEncoder().encode(content).length;
    return total;
  }

  list(input) {
    const directory = this.normalize(input);
    if (!this.directories.has(directory)) return [];
    const prefix = directory === "/" ? "/" : `${directory}/`;
    const entries = new Set();
    for (const path of [...this.directories, ...this.files.keys()]) {
      if (path === directory || !path.startsWith(prefix)) continue;
      const remainder = path.slice(prefix.length);
      if (remainder && !remainder.includes("/")) entries.add(remainder);
    }
    return [...entries].sort((left, right) => left.localeCompare(right));
  }

  exists(input) {
    const path = this.normalize(input);
    return this.files.has(path) || this.directories.has(path);
  }

  isFile(input) { return this.files.has(this.normalize(input)); }
  isDirectory(input) { return this.directories.has(this.normalize(input)); }
  isLink() { return false; }

  makeDirectory(input) {
    const path = this.normalize(input);
    if (this.files.has(path)) return false;
    let current = "";
    for (const part of path.split("/").filter(Boolean)) {
      current += `/${part}`;
      if (this.files.has(current)) return false;
      this.directories.add(current);
    }
    return this.persist();
  }

  removeDirectory(input) {
    const path = this.normalize(input);
    if (path === "/" || !this.directories.has(path)) return false;
    const prefix = `${path}/`;
    if ([...this.files.keys(), ...this.directories].some((candidate) => candidate.startsWith(prefix))) return false;
    this.directories.delete(path);
    return this.persist();
  }

  read(input) {
    return this.files.get(this.normalize(input)) ?? null;
  }

  write(input, content, append = false) {
    const path = this.normalize(input);
    if (this.directories.has(path) || !this.directories.has(this.parent(path))) return false;
    if (!this.files.has(path) && this.files.size >= this.maxFiles) throw new Error(`script filesystem is limited to ${this.maxFiles} files`);
    const next = new Map(this.files);
    next.set(path, append ? `${next.get(path) ?? ""}${String(content)}` : String(content));
    if (this.totalBytes(next) > this.maxBytes) throw new Error(`script filesystem is limited to ${this.maxBytes} bytes`);
    this.files = next;
    return this.persist();
  }

  removeFile(input) {
    const path = this.normalize(input);
    if (!this.files.delete(path)) return false;
    return this.persist();
  }

  copy(sourceInput, targetInput, replace = false) {
    const source = this.normalize(sourceInput);
    const target = this.normalize(targetInput);
    if (!this.files.has(source) || this.directories.has(target) || (!replace && this.files.has(target)) || !this.directories.has(this.parent(target))) return false;
    return this.write(target, this.files.get(source));
  }

  move(sourceInput, targetInput, replace = false) {
    const source = this.normalize(sourceInput);
    const target = this.normalize(targetInput);
    if (!this.copy(source, target, replace)) return false;
    this.files.delete(source);
    return this.persist();
  }
}
