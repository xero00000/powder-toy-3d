// SPDX-License-Identifier: GPL-3.0-or-later

const API_ROOT = "/community-api";
const OFFICIAL_API_ORIGIN = "https://powdertoy.co.uk";
const OFFICIAL_STATIC_ORIGIN = "https://static.powdertoy.co.uk";
const PUBLIC_READER_ORIGIN = "https://r.jina.ai";
const MAX_PAGE_SIZE = 60;
let communityTransportOverride = null;

export class CommunityError extends Error {
  constructor(message, status = 0, details = null) {
    super(message);
    this.name = "CommunityError";
    this.status = status;
    this.details = details;
  }
}

function inferredCommunityTransport() {
  const configured = globalThis.__POWDER3_COMMUNITY_MODE__;
  if (configured === "local" || configured === "hosted") return configured;
  return globalThis.location?.hostname?.endsWith(".github.io") ? "hosted" : "local";
}

function communityTransport() {
  return communityTransportOverride ?? inferredCommunityTransport();
}

export function configureCommunityTransport(mode = null) {
  if (mode !== null && mode !== "local" && mode !== "hosted") throw new TypeError("community transport must be local, hosted or null");
  communityTransportOverride = mode;
}

export function getCommunityCapabilities() {
  const mode = communityTransport();
  return Object.freeze({
    mode,
    livePublicReads: true,
    accounts: mode === "local",
    directLoad: mode === "local",
    source: "powdertoy.co.uk",
  });
}

function integer(value, name, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new TypeError(`${name} must be an integer from ${minimum} to ${maximum}`);
  }
  return parsed;
}

function text(value, name, maximum, allowEmpty = true) {
  const parsed = String(value ?? "").trim();
  if ((!allowEmpty && !parsed) || parsed.length > maximum || /[\u0000-\u001f\u007f]/u.test(parsed)) {
    throw new TypeError(`${name} must be ${allowEmpty ? `at most ${maximum}` : `1-${maximum}`} printable characters`);
  }
  return parsed;
}

function multilineText(value, name, maximum, allowEmpty = true) {
  const parsed = String(value ?? "").replace(/\r\n?/gu, "\n").trim();
  if ((!allowEmpty && !parsed) || parsed.length > maximum || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(parsed)) {
    throw new TypeError(`${name} must be ${allowEmpty ? `at most ${maximum}` : `1-${maximum}`} safe characters`);
  }
  return parsed;
}

function saveId(value) {
  return integer(value, "save ID", 1, 2_147_483_647);
}

function authRecord(auth) {
  if (!auth || typeof auth !== "object") throw new TypeError("authentication is required");
  return {
    userId: integer(auth.userId, "user ID", 1, 2_147_483_647),
    sessionId: text(auth.sessionId, "session ID", 512, false),
    sessionKey: text(auth.sessionKey, "session key", 512, false),
  };
}

function officialPublicRequest(path) {
  const request = new URL(path, "https://powder3.invalid");
  const saveMatch = request.pathname.match(/^\/saves\/(\d+)(?:\/(comments))?$/u);
  const profileMatch = request.pathname.match(/^\/profiles\/([^/]+)$/u);
  if (request.pathname === "/startup") return new URL("/Startup.json", OFFICIAL_API_ORIGIN);
  if (request.pathname === "/saves") {
    const upstream = new URL("/Browse.json", OFFICIAL_API_ORIGIN);
    upstream.searchParams.set("Start", request.searchParams.get("start") || "0");
    upstream.searchParams.set("Count", request.searchParams.get("count") || "24");
    if (request.searchParams.get("q")) upstream.searchParams.set("Search_Query", request.searchParams.get("q"));
    return upstream;
  }
  if (request.pathname === "/tags") {
    const upstream = new URL("/Browse/Tags.json", OFFICIAL_API_ORIGIN);
    upstream.searchParams.set("Start", request.searchParams.get("start") || "0");
    upstream.searchParams.set("Count", request.searchParams.get("count") || "24");
    if (request.searchParams.get("q")) upstream.searchParams.set("Search_Query", request.searchParams.get("q"));
    return upstream;
  }
  if (profileMatch) {
    const upstream = new URL("/User.json", OFFICIAL_API_ORIGIN);
    upstream.searchParams.set("Name", decodeURIComponent(profileMatch[1]));
    return upstream;
  }
  if (saveMatch) {
    const id = saveMatch[1];
    const upstream = new URL(saveMatch[2] ? "/Browse/Comments.json" : "/Browse/View.json", OFFICIAL_API_ORIGIN);
    upstream.searchParams.set("ID", id);
    if (request.searchParams.get("date")) upstream.searchParams.set("Date", request.searchParams.get("date"));
    if (saveMatch[2]) {
      upstream.searchParams.set("Start", request.searchParams.get("start") || "0");
      upstream.searchParams.set("Count", request.searchParams.get("count") || "40");
    }
    return upstream;
  }
  throw new CommunityError("This community action requires the local secure gateway", 503);
}

function readerJson(textValue) {
  const marker = "\nMarkdown Content:\n";
  const markerIndex = textValue.indexOf(marker);
  let payload = (markerIndex >= 0 ? textValue.slice(markerIndex + marker.length) : textValue).trim();
  if (payload.startsWith("```")) payload = payload.replace(/^```(?:json)?\s*/u, "").replace(/\s*```$/u, "");
  try { return JSON.parse(payload); }
  catch { throw new CommunityError("The live community bridge returned an invalid response", 502); }
}

async function apiFetch(path, options = {}) {
  const { binary = false, textResponse = false, ...fetchOptions } = options;
  const hosted = communityTransport() === "hosted";
  if (hosted && (fetchOptions.method || "GET") !== "GET") {
    throw new CommunityError("Sign-in and community write actions require the local secure gateway", 503);
  }
  if (hosted && binary) {
    throw new CommunityError("Use the official CPS download on the hosted build", 503);
  }
  const upstream = hosted ? officialPublicRequest(path) : null;
  const requestUrl = hosted ? `${PUBLIC_READER_ORIGIN}/${upstream.href}` : `${API_ROOT}${path}`;
  const response = await fetch(requestUrl, {
    ...fetchOptions,
    headers: {
      Accept: hosted ? "text/plain" : binary ? "application/octet-stream" : "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });
  if (response.ok) {
    if (binary) return new Uint8Array(await response.arrayBuffer());
    if (textResponse) return response.text();
    if (hosted) return readerJson(await response.text());
    return response.json();
  }
  let details = null;
  try { details = await response.json(); } catch { /* upstream can return plain text */ }
  throw new CommunityError(details?.error || `Community request failed (${response.status})`, response.status, details);
}

export function communityThumbnailUrl(id, date = 0) {
  const cleanId = saveId(id);
  const cleanDate = date ? integer(date, "save date", 1, 9_999_999_999) : 0;
  if (communityTransport() === "hosted") return `${OFFICIAL_STATIC_ORIGIN}/${cleanId}${cleanDate ? `_${cleanDate}` : ""}_small.png`;
  return `${API_ROOT}/saves/${cleanId}/thumbnail${cleanDate ? `?date=${cleanDate}` : ""}`;
}

export function communityWebsiteUrl(id) {
  return `https://powdertoy.co.uk/Browse/View.html?ID=${saveId(id)}`;
}

export function communityAvatarUrl(username, size = 0) {
  const cleanUsername = text(username, "username", 64, false);
  const cleanSize = integer(size, "avatar size", 0, 256);
  if (communityTransport() === "hosted") return `${OFFICIAL_STATIC_ORIGIN}/avatars/${encodeURIComponent(cleanUsername)}${cleanSize ? `.${cleanSize}` : ""}.png`;
  return `${API_ROOT}/profiles/${encodeURIComponent(cleanUsername)}/avatar${cleanSize ? `?size=${cleanSize}` : ""}`;
}

export function communitySaveDownloadUrl(id, date = 0) {
  const cleanId = saveId(id);
  const cleanDate = date ? integer(date, "save date", 1, 9_999_999_999) : 0;
  return `${OFFICIAL_STATIC_ORIGIN}/${cleanId}${cleanDate ? `_${cleanDate}` : ""}.cps`;
}

function remoteText(value, maximum) {
  return String(value ?? "").replace(/\r\n?/gu, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, "").slice(0, maximum).trim();
}

export async function getCommunityStartup(auth = null) {
  const result = await apiFetch("/startup", auth ? {
    method: "POST", body: JSON.stringify({ auth: authRecord(auth) }),
  } : {});
  const notifications = Array.isArray(result?.Notifications) ? result.Notifications.slice(0, 32).map((item) => ({
    text: remoteText(item?.Text, 2048), link: remoteText(item?.Link, 2048),
  })).filter((item) => item.text) : [];
  return {
    sessionGood: result?.Session !== false,
    messageOfTheDay: remoteText(result?.MessageOfTheDay, 4096),
    notifications,
    updates: result?.Updates && typeof result.Updates === "object" && !Array.isArray(result.Updates) ? result.Updates : {},
  };
}

export async function getCommunityProfile(username) {
  const cleanUsername = text(username, "username", 64, false);
  const result = await apiFetch(`/profiles/${encodeURIComponent(cleanUsername)}`);
  if (!result?.User || typeof result.User !== "object") throw new CommunityError("The server returned an invalid profile");
  return result.User;
}

export function updateCommunityProfile({ location = "", biography = "" } = {}, auth) {
  return apiFetch("/profile", {
    method: "POST",
    body: JSON.stringify({
      auth: authRecord(auth), location: text(location, "location", 40),
      biography: multilineText(biography, "biography", 20000),
    }),
  });
}

export async function searchCommunitySaves({ start = 0, count = 24, query = "", category = "", auth = null } = {}) {
  const params = new URLSearchParams({
    start: String(integer(start, "start", 0, 10_000_000)),
    count: String(integer(count, "count", 1, MAX_PAGE_SIZE)),
  });
  const cleanQuery = text(query, "search query", 180);
  const cleanCategory = text(category, "category", 24);
  if (cleanCategory && cleanCategory !== "Favourites") throw new TypeError("category must be empty or Favourites");
  if (cleanCategory === "Favourites" && !auth) throw new TypeError("authentication is required for favourites");
  if (cleanQuery) params.set("q", cleanQuery);
  if (cleanCategory) params.set("category", cleanCategory);
  const result = await apiFetch(`/saves?${params}`, auth ? {
    method: "POST", body: JSON.stringify({ auth: authRecord(auth) }),
  } : {});
  return {
    total: Number(result.Count ?? 0),
    saves: Array.isArray(result.Saves) ? result.Saves : [],
  };
}

export function getCommunitySave(id, { date = 0, auth = null } = {}) {
  const params = new URLSearchParams();
  if (date) params.set("date", String(integer(date, "save date", 1, 9_999_999_999)));
  const path = `/saves/${saveId(id)}${auth ? "/view" : ""}${params.size ? `?${params}` : ""}`;
  return auth
    ? apiFetch(path, { method: "POST", body: JSON.stringify({ auth: authRecord(auth) }) })
    : apiFetch(path);
}

export function getCommunityComments(id, { start = 0, count = 40 } = {}) {
  const params = new URLSearchParams({
    start: String(integer(start, "start", 0, 10_000_000)),
    count: String(integer(count, "count", 1, MAX_PAGE_SIZE)),
  });
  return apiFetch(`/saves/${saveId(id)}/comments?${params}`);
}

export function searchCommunityTags({ start = 0, count = 24, query = "" } = {}) {
  const params = new URLSearchParams({
    start: String(integer(start, "start", 0, 10_000_000)),
    count: String(integer(count, "count", 1, MAX_PAGE_SIZE)),
  });
  const cleanQuery = text(query, "tag query", 80);
  if (cleanQuery) params.set("q", cleanQuery);
  return apiFetch(`/tags?${params}`);
}

export function downloadCommunitySave(id, date = 0) {
  const query = date ? `?date=${integer(date, "save date", 1, 9_999_999_999)}` : "";
  return apiFetch(`/saves/${saveId(id)}/data${query}`, { binary: true });
}

export function loginCommunity(username, password) {
  return apiFetch("/login", {
    method: "POST",
    body: JSON.stringify({
      username: text(username, "username", 64, false),
      password: String(password ?? "").slice(0, 512),
    }),
  });
}

function writeSaveAction(id, action, auth, values = {}, options = {}) {
  return apiFetch(`/saves/${saveId(id)}/${action}`, {
    method: "POST",
    body: JSON.stringify({ auth: authRecord(auth), ...values }),
    ...options,
  });
}

export function voteCommunitySave(id, direction, auth) {
  if (![-1, 0, 1].includes(direction)) throw new TypeError("vote direction must be -1, 0 or 1");
  return writeSaveAction(id, "vote", auth, { direction }, { textResponse: true });
}

export function commentOnCommunitySave(id, comment, auth) {
  return writeSaveAction(id, "comments", auth, { comment: multilineText(comment, "comment", 4096, false) });
}

export function favouriteCommunitySave(id, favourite, auth) {
  return writeSaveAction(id, "favourite", auth, { favourite: Boolean(favourite) });
}

export function editCommunityTag(id, operation, tag, auth) {
  if (!['add', 'delete'].includes(operation)) throw new TypeError("tag operation must be add or delete");
  return writeSaveAction(id, "tags", auth, { operation, tag: text(tag, "tag", 48, false) });
}

export function setCommunitySavePublished(id, published, auth) {
  return writeSaveAction(id, published ? "publish" : "unpublish", auth);
}

export function deleteCommunitySave(id, auth) {
  return writeSaveAction(id, "delete", auth);
}

export function reportCommunitySave(id, reason, auth) {
  return writeSaveAction(id, "report", auth, { reason: multilineText(reason, "report reason", 4096, false) });
}

function bytesToBase64(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.length > 8 * 1024 * 1024) throw new TypeError("upload data exceeds 8 MiB");
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

export async function uploadCommunitySave({ name, description = "", published = false, data }, auth) {
  const response = await apiFetch("/upload", {
    method: "POST",
    body: JSON.stringify({
      auth: authRecord(auth), name: text(name, "save name", 64, false),
      description: multilineText(description, "description", 1024), published: Boolean(published),
      data: bytesToBase64(data),
    }),
    textResponse: true,
  });
  const match = String(response).match(/(?:^|\s)(\d+)(?:\s|$)/u);
  if (!match) throw new CommunityError("Upload succeeded but the server returned no save ID");
  return Number(match[1]);
}
