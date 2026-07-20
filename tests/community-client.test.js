// SPDX-License-Identifier: GPL-3.0-or-later

import test from "node:test";
import assert from "node:assert/strict";
import {
  commentOnCommunitySave, communityAvatarUrl, communityThumbnailUrl, communityWebsiteUrl,
  deleteCommunitySave, downloadCommunitySave, editCommunityTag, favouriteCommunitySave,
  getCommunityComments, getCommunityProfile, getCommunitySave, getCommunityStartup, loginCommunity,
  reportCommunitySave, searchCommunitySaves, searchCommunityTags, setCommunitySavePublished, voteCommunitySave,
  updateCommunityProfile, uploadCommunitySave,
} from "../src/community-client.js";

function withFetch(handler, run) {
  const previous = globalThis.fetch;
  globalThis.fetch = handler;
  return Promise.resolve(run()).finally(() => { globalThis.fetch = previous; });
}

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
}

test("community read client maps strict local endpoints", async () => {
  const requests = [];
  const auth = { userId: 9, sessionId: "session", sessionKey: "key" };
  await withFetch(async (url, options) => {
    requests.push({ url: String(url), options });
    if (String(url).includes("/data")) return new Response(Uint8Array.of(0x4f, 0x50, 0x53, 0x31));
    if (String(url).includes("/saves?")) return jsonResponse({ Count: 2, Saves: [{ ID: 7 }] });
    return jsonResponse([]);
  }, async () => {
    assert.deepEqual(await searchCommunitySaves({ start: 24, count: 24, query: "reactor", category: "Favourites", auth }), { total: 2, saves: [{ ID: 7 }] });
    await getCommunitySave(7, { date: 100 });
    await getCommunityComments(7, { start: 0, count: 20 });
    await searchCommunityTags({ count: 12, query: "bom" });
    assert.deepEqual([...await downloadCommunitySave(7)], [0x4f, 0x50, 0x53, 0x31]);
  });
  assert.equal(requests[0].url, "/community-api/saves?start=24&count=24&q=reactor&category=Favourites");
  assert.equal(requests[0].options.method, "POST");
  assert.deepEqual(JSON.parse(requests[0].options.body), { auth });
  assert.equal(requests[1].url, "/community-api/saves/7?date=100");
  assert.equal(requests[2].url, "/community-api/saves/7/comments?start=0&count=20");
  assert.equal(requests[3].url, "/community-api/tags?start=0&count=12&q=bom");
  assert.equal(requests[4].url, "/community-api/saves/7/data");
  assert.equal(communityThumbnailUrl(7, 100), "/community-api/saves/7/thumbnail?date=100");
  assert.equal(communityWebsiteUrl(7), "https://powdertoy.co.uk/Browse/View.html?ID=7");
});

test("community upload client sends bounded OPS data and parses the returned save ID", async () => {
  const auth = { userId: 9, sessionId: "session", sessionKey: "key" };
  let request;
  await withFetch(async (url, options) => {
    request = { url: String(url), options };
    return new Response("OK 3402000");
  }, async () => {
    const id = await uploadCommunitySave({ name: "Test", description: "Private fixture", data: Uint8Array.from([79, 80, 83, 49]), published: false }, auth);
    assert.equal(id, 3402000);
  });
  const body = JSON.parse(request.options.body);
  assert.equal(request.url, "/community-api/upload");
  assert.equal(body.name, "Test");
  assert.equal(body.published, false);
  assert.equal(body.data, "T1BTMQ==");
  assert.deepEqual(body.auth, auth);
});

test("community profile client maps public profiles, avatars, and owner edits", async () => {
  const requests = [];
  const auth = { userId: 9, sessionId: "session", sessionKey: "key" };
  await withFetch(async (url, options = {}) => {
    requests.push({ url: String(url), options });
    return jsonResponse(String(url).endsWith("/profiles/alice")
      ? { User: { Username: "alice", Biography: "Line one\nLine two" } }
      : { Status: 1 });
  }, async () => {
    assert.deepEqual(await getCommunityProfile("alice"), { Username: "alice", Biography: "Line one\nLine two" });
    await updateCommunityProfile({ location: "The Lab", biography: "Line one\r\nLine two" }, auth);
  });
  assert.equal(communityAvatarUrl("alice"), "/community-api/profiles/alice/avatar");
  assert.equal(communityAvatarUrl("alice", 128), "/community-api/profiles/alice/avatar?size=128");
  assert.equal(requests[0].url, "/community-api/profiles/alice");
  assert.equal(requests[1].url, "/community-api/profile");
  assert.equal(requests[1].options.method, "POST");
  assert.deepEqual(JSON.parse(requests[1].options.body), {
    auth, location: "The Lab", biography: "Line one\nLine two",
  });
});

test("community startup client normalizes MotD, notifications, updates, and authenticated sessions", async () => {
  const auth = { userId: 9, sessionId: "session", sessionKey: "key" };
  let request;
  await withFetch(async (url, options = {}) => {
    request = { url: String(url), options };
    return jsonResponse({
      Session: false, MessageOfTheDay: "Welcome\r\nto Powder Toy",
      Notifications: [{ Text: "Forum news", Link: "https://powdertoy.co.uk/Discussions/" }, { Text: "", Link: "ignored" }],
      Updates: { Stable: { Major: 99, Minor: 1, Build: 5 } },
    });
  }, async () => {
    assert.deepEqual(await getCommunityStartup(auth), {
      sessionGood: false, messageOfTheDay: "Welcome\nto Powder Toy",
      notifications: [{ text: "Forum news", link: "https://powdertoy.co.uk/Discussions/" }],
      updates: { Stable: { Major: 99, Minor: 1, Build: 5 } },
    });
  });
  assert.equal(request.url, "/community-api/startup");
  assert.equal(request.options.method, "POST");
  assert.deepEqual(JSON.parse(request.options.body), { auth });
});

test("authenticated detail lookup keeps session material in the request body", async () => {
  const auth = { userId: 9, sessionId: "session", sessionKey: "key" };
  let request;
  await withFetch(async (url, options) => {
    request = { url: String(url), options };
    return jsonResponse({ ID: 7, ScoreMine: 1 });
  }, () => getCommunitySave(7, { auth }));
  assert.equal(request.url, "/community-api/saves/7/view");
  assert.equal(request.options.method, "POST");
  assert.deepEqual(JSON.parse(request.options.body), { auth });
  assert.equal(request.url.includes("session"), false);
});

test("community write client reproduces upstream actions without persisting credentials", async () => {
  const requests = [];
  const auth = { userId: 9, sessionId: "session", sessionKey: "key" };
  await withFetch(async (url, options) => {
    requests.push({ url: String(url), method: options.method, body: JSON.parse(options.body) });
    return jsonResponse({ Status: 1 });
  }, async () => {
    await loginCommunity("user", "pass");
    await voteCommunitySave(8, 1, auth);
    await commentOnCommunitySave(8, "Nice save", auth);
    await favouriteCommunitySave(8, true, auth);
    await editCommunityTag(8, "add", "reactor", auth);
    await setCommunitySavePublished(8, true, auth);
    await setCommunitySavePublished(8, false, auth);
    await deleteCommunitySave(8, auth);
    await reportCommunitySave(8, "Stolen from save 7\nIncludes copied tags", auth);
  });
  assert.deepEqual(requests.map(({ url }) => url), [
    "/community-api/login", "/community-api/saves/8/vote", "/community-api/saves/8/comments",
    "/community-api/saves/8/favourite", "/community-api/saves/8/tags", "/community-api/saves/8/publish",
    "/community-api/saves/8/unpublish", "/community-api/saves/8/delete", "/community-api/saves/8/report",
  ]);
  assert.deepEqual(requests[1].body, { auth, direction: 1 });
  assert.equal(requests[2].body.comment, "Nice save");
  assert.equal(requests[3].body.favourite, true);
  assert.deepEqual({ operation: requests[4].body.operation, tag: requests[4].body.tag }, { operation: "add", tag: "reactor" });
  assert.deepEqual(requests.slice(5, 8).map(({ body }) => body), [{ auth }, { auth }, { auth }]);
  assert.deepEqual(requests[8].body, { auth, reason: "Stolen from save 7\nIncludes copied tags" });
});

test("community client rejects unsafe or unreasonable values before fetch", async () => {
  assert.throws(() => communityThumbnailUrl(0), /save ID/u);
  assert.throws(() => voteCommunitySave(1, 2, {}), /vote direction/u);
  await assert.rejects(searchCommunitySaves({ count: 999 }), /count/u);
  await assert.rejects(searchCommunitySaves({ category: "Favourites" }), /authentication/u);
  await assert.rejects(searchCommunitySaves({ category: "Unsafe", auth: { userId: 1, sessionId: "s", sessionKey: "k" } }), /category/u);
  assert.throws(() => commentOnCommunitySave(1, "", { userId: 1, sessionId: "s", sessionKey: "k" }), /comment/u);
  assert.throws(() => communityAvatarUrl("alice", 512), /avatar size/u);
  await withFetch(async () => jsonResponse({ Status: 1 }), async () => {
    await assert.rejects(getCommunityProfile("alice"), /invalid profile/u);
  });
});
