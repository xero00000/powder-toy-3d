// SPDX-License-Identifier: GPL-3.0-or-later

// Node's test runner can consume compressjs through its CommonJS/AMD bridge.
// Vite replaces this small adapter with browser-native virtual ESM modules.
import Bzip2Module from "compressjs/lib/Bzip2.js";

export default Bzip2Module?.default ?? Bzip2Module;
