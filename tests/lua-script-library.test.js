// SPDX-License-Identifier: GPL-3.0-or-later

import test from "node:test";
import assert from "node:assert/strict";
import { LuaVirtualFileSystem } from "../src/lua-filesystem.js";
import { LuaScriptLibrary } from "../src/lua-script-library.js";

function harness() {
  const stored = new Map();
  const storage = { getItem: (key) => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, value) };
  const fileSystem = new LuaVirtualFileSystem({ storage });
  return { stored, storage, fileSystem, library: new LuaScriptLibrary({ fileSystem, storage }) };
}

test("Lua script library saves, renames, deletes and persists explicit autorun state", () => {
  const { storage, fileSystem, library } = harness();
  assert.deepEqual(library.list(), []);
  assert.equal(library.write("reactor", "counter = 1").name, "reactor.lua");
  library.setAutorun("reactor.lua", true);
  assert.deepEqual(library.list().map(({ name, autorun }) => ({ name, autorun })), [{ name: "reactor.lua", autorun: true }]);
  assert.equal(library.rename("reactor.lua", "core.lua").name, "core.lua");

  const restored = new LuaScriptLibrary({ fileSystem: new LuaVirtualFileSystem({ storage }), storage });
  assert.equal(restored.get("core").autorun, true);
  assert.equal(restored.remove("core"), true);
  assert.equal(restored.get("core"), null);
});

test("Lua script library normalizes imports and chooses collision-free names", () => {
  const { library } = harness();
  library.write("../unsafe?.lua", "return 1");
  assert.equal(library.list()[0].name, "unsafe-.lua");
  assert.equal(library.uniqueName("../unsafe?.lua"), "unsafe--2.lua");
  assert.throws(() => library.write("...", ""), /script name is required/);
});
