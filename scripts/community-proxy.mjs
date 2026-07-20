// SPDX-License-Identifier: GPL-3.0-or-later

const API_ORIGIN = "https://powdertoy.co.uk";
const STATIC_ORIGIN = "https://static.powdertoy.co.uk";
const DEFAULT_TIMEOUT_MS = 15_000;
const JSON_LIMIT = 2 * 1024 * 1024;
const SAVE_LIMIT = 32 * 1024 * 1024;
const IMAGE_LIMIT = 5 * 1024 * 1024;

class ProxyInputError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function integer(value, name, minimum, maximum) {
  if (value == null || value === "") throw new ProxyInputError(`${name} is required`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new ProxyInputError(`${name} must be an integer from ${minimum} to ${maximum}`);
  }
  return parsed;
}

function optionalInteger(value, name, minimum, maximum, fallback) {
  return value == null || value === "" ? fallback : integer(value, name, minimum, maximum);
}

function cleanText(value, name, maximum, allowEmpty = true) {
  const parsed = String(value ?? "").trim();
  if ((!allowEmpty && !parsed) || parsed.length > maximum || /[\u0000-\u001f\u007f]/u.test(parsed)) {
    throw new ProxyInputError(`${name} must be ${allowEmpty ? `at most ${maximum}` : `1-${maximum}`} printable characters`);
  }
  return parsed;
}

function cleanMultilineText(value, name, maximum, allowEmpty = true) {
  const parsed = String(value ?? "").replace(/\r\n?/gu, "\n").trim();
  if ((!allowEmpty && !parsed) || parsed.length > maximum || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(parsed)) {
    throw new ProxyInputError(`${name} must be ${allowEmpty ? `at most ${maximum}` : `1-${maximum}`} safe characters`);
  }
  return parsed;
}

function username(value) {
  const parsed = cleanText(value, "username", 64, false);
  if (!/^[A-Za-z0-9_-]+$/u.test(parsed)) throw new ProxyInputError("username contains unsupported characters");
  return parsed;
}

function parseAuth(auth) {
  if (!auth || typeof auth !== "object") throw new ProxyInputError("authentication is required", 401);
  return {
    userId: integer(auth.userId, "user ID", 1, 2_147_483_647),
    sessionId: cleanText(auth.sessionId, "session ID", 512, false),
    sessionKey: cleanText(auth.sessionKey, "session key", 512, false),
  };
}

function authHeaders(auth) {
  const parsed = parseAuth(auth);
  return {
    "X-Auth-User-Id": String(parsed.userId),
    "X-Auth-Session-Key": parsed.sessionId,
  };
}

function formBody(values) {
  const form = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) form.set(key, String(value));
  return form.toString();
}

function requestSpec(url, method, body) {
  const path = url.pathname.replace(/^\/community-api/, "");
  const saveMatch = path.match(/^\/saves\/(\d+)(?:\/(view|thumbnail|data|comments|vote|favourite|tags|publish|unpublish|delete|report))?$/u);
  const profileMatch = path.match(/^\/profiles\/([^/]+)(?:\/(avatar))?$/u);
  const common = { method: "GET", headers: {}, limit: JSON_LIMIT, kind: "json" };

  if ((method === "GET" || method === "POST") && path === "/startup") {
    return {
      ...common, url: new URL("/Startup.json", API_ORIGIN),
      headers: method === "POST" ? authHeaders(body?.auth) : {},
    };
  }

  if ((method === "GET" || method === "POST") && path === "/saves") {
    const upstream = new URL("/Browse.json", API_ORIGIN);
    upstream.searchParams.set("Start", String(optionalInteger(url.searchParams.get("start"), "start", 0, 10_000_000, 0)));
    upstream.searchParams.set("Count", String(optionalInteger(url.searchParams.get("count"), "count", 1, 60, 24)));
    const query = cleanText(url.searchParams.get("q"), "search query", 180);
    const category = cleanText(url.searchParams.get("category"), "category", 24);
    if (query) upstream.searchParams.set("Search_Query", query);
    if (category) upstream.searchParams.set("Category", category);
    return { ...common, url: upstream, headers: method === "POST" ? authHeaders(body?.auth) : {} };
  }

  if (method === "GET" && path === "/tags") {
    const upstream = new URL("/Browse/Tags.json", API_ORIGIN);
    upstream.searchParams.set("Start", String(optionalInteger(url.searchParams.get("start"), "start", 0, 10_000_000, 0)));
    upstream.searchParams.set("Count", String(optionalInteger(url.searchParams.get("count"), "count", 1, 60, 24)));
    const query = cleanText(url.searchParams.get("q"), "tag query", 80);
    if (query) upstream.searchParams.set("Search_Query", query);
    return { ...common, url: upstream };
  }

  if (method === "POST" && path === "/login") {
    const username = cleanText(body?.username, "username", 64, false);
    const password = String(body?.password ?? "").slice(0, 512);
    if (!password) throw new ProxyInputError("password is required");
    return {
      ...common, method: "POST", url: new URL("/Login.json", API_ORIGIN),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formBody({ name: username, pass: password }),
    };
  }

  if (method === "POST" && path === "/profile") {
    const auth = parseAuth(body?.auth);
    return {
      ...common, method: "POST", url: new URL("/Profile.json", API_ORIGIN),
      headers: { ...authHeaders(auth), "Content-Type": "application/x-www-form-urlencoded" },
      body: formBody({
        Location: cleanText(body?.location, "location", 40),
        Biography: cleanMultilineText(body?.biography, "biography", 20000),
      }),
    };
  }

  if (method === "GET" && profileMatch) {
    let decoded;
    try { decoded = decodeURIComponent(profileMatch[1]); }
    catch { throw new ProxyInputError("username is invalid"); }
    const name = username(decoded);
    if (profileMatch[2] === "avatar") {
      const size = optionalInteger(url.searchParams.get("size"), "avatar size", 1, 256, 0);
      const suffix = size ? `.${size}` : "";
      return { ...common, url: new URL(`/avatars/${name}${suffix}.png`, STATIC_ORIGIN), kind: "image", limit: IMAGE_LIMIT };
    }
    const upstream = new URL("/User.json", API_ORIGIN);
    upstream.searchParams.set("Name", name);
    return { ...common, url: upstream };
  }

  if (method === "POST" && path === "/upload") {
    const auth = parseAuth(body?.auth);
    const name = cleanText(body?.name, "save name", 64, false);
    const description = cleanMultilineText(body?.description, "description", 1024);
    if (typeof body?.data !== "string" || !/^[A-Za-z0-9+/]*={0,2}$/u.test(body.data)) throw new ProxyInputError("upload data must be base64");
    const data = Buffer.from(body.data, "base64");
    if (!data.length || data.length > 8 * 1024 * 1024) throw new ProxyInputError("upload data must be 1 byte to 8 MiB", 413);
    if (data.length < 13 || data.subarray(0, 4).toString("ascii") !== "OPS1") throw new ProxyInputError("upload data must be an OPS1 save");
    const form = new FormData();
    form.set("Name", name);
    form.set("Description", description);
    form.set("Data", new Blob([data], { type: "application/octet-stream" }), "save.bin");
    form.set("Publish", body?.published ? "Public" : "Private");
    form.set("Key", auth.sessionKey);
    return { ...common, method: "POST", url: new URL("/Save.api", API_ORIGIN), headers: authHeaders(auth), body: form };
  }

  if (saveMatch) {
    const id = integer(saveMatch[1], "save ID", 1, 2_147_483_647);
    const action = saveMatch[2] || "view";
    const date = optionalInteger(url.searchParams.get("date"), "save date", 1, 9_999_999_999, 0);
    if ((method === "GET" || method === "POST") && action === "view") {
      const upstream = new URL("/Browse/View.json", API_ORIGIN);
      upstream.searchParams.set("ID", String(id));
      if (date) upstream.searchParams.set("Date", String(date));
      return { ...common, url: upstream, headers: method === "POST" ? authHeaders(body?.auth) : {} };
    }
    if (method === "GET" && action === "comments") {
      const upstream = new URL("/Browse/Comments.json", API_ORIGIN);
      upstream.searchParams.set("ID", String(id));
      upstream.searchParams.set("Start", String(optionalInteger(url.searchParams.get("start"), "start", 0, 10_000_000, 0)));
      upstream.searchParams.set("Count", String(optionalInteger(url.searchParams.get("count"), "count", 1, 60, 40)));
      return { ...common, url: upstream };
    }
    if (method === "GET" && action === "thumbnail") {
      const suffix = date ? `_${date}` : "";
      return { ...common, url: new URL(`/${id}${suffix}_small.png`, STATIC_ORIGIN), kind: "image", limit: IMAGE_LIMIT };
    }
    if (method === "GET" && action === "data") {
      const suffix = date ? `_${date}` : "";
      return { ...common, url: new URL(`/${id}${suffix}.cps`, STATIC_ORIGIN), kind: "save", limit: SAVE_LIMIT };
    }
    if (method === "POST" && action === "vote") {
      const auth = parseAuth(body?.auth);
      const direction = integer(body?.direction, "vote direction", -1, 1);
      return {
        ...common, method: "POST", url: new URL("/Vote.api", API_ORIGIN), headers: {
          ...authHeaders(auth), "Content-Type": "application/x-www-form-urlencoded",
        }, body: formBody({ ID: id, Action: direction === 1 ? "Up" : direction === -1 ? "Down" : "Reset", Key: auth.sessionKey }),
      };
    }
    if (method === "POST" && action === "comments") {
      const auth = parseAuth(body?.auth);
      const comment = cleanMultilineText(body?.comment, "comment", 4096, false);
      const upstream = new URL("/Browse/Comments.json", API_ORIGIN);
      upstream.searchParams.set("ID", String(id));
      return {
        ...common, method: "POST", url: upstream, headers: { ...authHeaders(auth), "Content-Type": "application/x-www-form-urlencoded" },
        body: formBody({ Comment: comment, Key: auth.sessionKey }),
      };
    }
    if (method === "POST" && action === "favourite") {
      const auth = parseAuth(body?.auth);
      const upstream = new URL("/Browse/Favourite.json", API_ORIGIN);
      upstream.searchParams.set("ID", String(id));
      upstream.searchParams.set("Key", auth.sessionKey);
      if (!body?.favourite) upstream.searchParams.set("Mode", "Remove");
      return { ...common, url: upstream, headers: authHeaders(auth) };
    }
    if (method === "POST" && action === "tags") {
      const auth = parseAuth(body?.auth);
      const operation = body?.operation;
      if (operation !== "add" && operation !== "delete") throw new ProxyInputError("tag operation must be add or delete");
      const upstream = new URL("/Browse/EditTag.json", API_ORIGIN);
      upstream.searchParams.set("Op", operation);
      upstream.searchParams.set("ID", String(id));
      upstream.searchParams.set("Tag", cleanText(body?.tag, "tag", 48, false));
      upstream.searchParams.set("Key", auth.sessionKey);
      return { ...common, url: upstream, headers: authHeaders(auth) };
    }
    if (method === "POST" && action === "publish") {
      const auth = parseAuth(body?.auth);
      const upstream = new URL("/Browse/View.json", API_ORIGIN);
      upstream.searchParams.set("ID", String(id));
      upstream.searchParams.set("Key", auth.sessionKey);
      return {
        ...common, method: "POST", url: upstream,
        headers: { ...authHeaders(auth), "Content-Type": "application/x-www-form-urlencoded" },
        body: formBody({ ActionPublish: "bagels" }),
      };
    }
    if (method === "POST" && (action === "unpublish" || action === "delete")) {
      const auth = parseAuth(body?.auth);
      const upstream = new URL("/Browse/Delete.json", API_ORIGIN);
      upstream.searchParams.set("ID", String(id));
      upstream.searchParams.set("Mode", action === "delete" ? "Delete" : "Unpublish");
      upstream.searchParams.set("Key", auth.sessionKey);
      return { ...common, url: upstream, headers: authHeaders(auth) };
    }
    if (method === "POST" && action === "report") {
      const auth = parseAuth(body?.auth);
      const upstream = new URL("/Browse/Report.json", API_ORIGIN);
      upstream.searchParams.set("ID", String(id));
      upstream.searchParams.set("Key", auth.sessionKey);
      return {
        ...common, method: "POST", url: upstream,
        headers: { ...authHeaders(auth), "Content-Type": "application/x-www-form-urlencoded" },
        body: formBody({ Reason: cleanMultilineText(body?.reason, "report reason", 4096, false) }),
      };
    }
  }
  throw new ProxyInputError("community endpoint not found", 404);
}

async function readJsonBody(req, limit = 32 * 1024) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new ProxyInputError("request body is too large", 413);
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new ProxyInputError("request body must be valid JSON"); }
}

function sendJson(res, status, value) {
  const bytes = Buffer.from(JSON.stringify(value));
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Length", String(bytes.length));
  res.setHeader("Cache-Control", "no-store");
  res.end(bytes);
}

export function resolveCommunityRequest(rawUrl, method = "GET", body = null) {
  const url = new URL(rawUrl, "http://localhost");
  return requestSpec(url, method.toUpperCase(), body);
}

export function createCommunityProxy({ fetchImpl = globalThis.fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  return async function communityProxy(req, res, next) {
    if (!req.url?.startsWith("/community-api")) return next();
    try {
      const method = String(req.method || "GET").toUpperCase();
      if (!['GET', 'POST'].includes(method)) throw new ProxyInputError("method not allowed", 405);
      const body = method === "POST" ? await readJsonBody(req, 12 * 1024 * 1024) : null;
      const spec = resolveCommunityRequest(req.url, method, body);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let upstream;
      try {
        upstream = await fetchImpl(spec.url, {
          method: spec.method,
          headers: {
            Accept: spec.kind === "json" ? "application/json" : "*/*",
            "User-Agent": "PowderToy3D/0.1 community compatibility",
            ...spec.headers,
          },
          body: spec.method === "POST" ? spec.body : undefined,
          redirect: "error",
          signal: controller.signal,
        });
      } finally { clearTimeout(timer); }
      const declaredLength = Number(upstream.headers.get("content-length") || 0);
      if (declaredLength > spec.limit) throw new ProxyInputError("upstream response is too large", 502);
      const bytes = Buffer.from(await upstream.arrayBuffer());
      if (bytes.length > spec.limit) throw new ProxyInputError("upstream response is too large", 502);
      res.statusCode = upstream.status;
      res.setHeader("Content-Type", upstream.headers.get("content-type") || (spec.kind === "json" ? "application/json; charset=utf-8" : "application/octet-stream"));
      res.setHeader("Content-Length", String(bytes.length));
      res.setHeader("Cache-Control", spec.kind === "image" ? "public, max-age=300" : "no-store");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.end(bytes);
    } catch (error) {
      const status = error instanceof ProxyInputError ? error.status : error?.name === "AbortError" ? 504 : 502;
      sendJson(res, status, { error: error instanceof Error ? error.message : "community gateway failed" });
    }
  };
}

export function communityProxyPlugin(options) {
  const middleware = createCommunityProxy(options);
  return {
    name: "powder-toy-community-proxy",
    configureServer(server) { server.middlewares.use(middleware); },
    configurePreviewServer(server) { server.middlewares.use(middleware); },
  };
}
