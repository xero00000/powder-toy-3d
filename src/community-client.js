// SPDX-License-Identifier: GPL-3.0-or-later

const API_ROOT = "/community-api";
const MAX_PAGE_SIZE = 60;

export class CommunityError extends Error {
  constructor(message, status = 0, details = null) {
    super(message);
    this.name = "CommunityError";
    this.status = status;
    this.details = details;
  }
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

async function apiFetch(path, options = {}) {
  const { binary = false, textResponse = false, ...fetchOptions } = options;
  const response = await fetch(`${API_ROOT}${path}`, {
    ...fetchOptions,
    headers: {
      Accept: binary ? "application/octet-stream" : "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });
  if (response.ok) {
    if (binary) return new Uint8Array(await response.arrayBuffer());
    if (textResponse) return response.text();
    return response.json();
  }
  let details = null;
  try { details = await response.json(); } catch { /* upstream can return plain text */ }
  throw new CommunityError(details?.error || `Community request failed (${response.status})`, response.status, details);
}

export function communityThumbnailUrl(id, date = 0) {
  const query = date ? `?date=${integer(date, "save date", 1, 9_999_999_999)}` : "";
  return `${API_ROOT}/saves/${saveId(id)}/thumbnail${query}`;
}

export function communityWebsiteUrl(id) {
  return `https://powdertoy.co.uk/Browse/View.html?ID=${saveId(id)}`;
}

export function communityAvatarUrl(username, size = 0) {
  const cleanUsername = text(username, "username", 64, false);
  const cleanSize = integer(size, "avatar size", 0, 256);
  return `${API_ROOT}/profiles/${encodeURIComponent(cleanUsername)}/avatar${cleanSize ? `?size=${cleanSize}` : ""}`;
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
