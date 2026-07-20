// SPDX-License-Identifier: GPL-3.0-or-later

import test from "node:test";
import assert from "node:assert/strict";
import { resolveCommunityRequest } from "../scripts/community-proxy.mjs";

const auth = { userId: 12, sessionId: "sid", sessionKey: "key" };

test("community gateway exposes only pinned official read endpoints", () => {
  const startup = resolveCommunityRequest("/community-api/startup");
  assert.equal(startup.url.href, "https://powdertoy.co.uk/Startup.json");
  const browse = resolveCommunityRequest("/community-api/saves?start=24&count=12&q=reactor%20sort%3Adate");
  assert.equal(browse.url.origin, "https://powdertoy.co.uk");
  assert.equal(browse.url.pathname, "/Browse.json");
  assert.equal(browse.url.searchParams.get("Start"), "24");
  assert.equal(browse.url.searchParams.get("Search_Query"), "reactor sort:date");
  const favourites = resolveCommunityRequest("/community-api/saves?start=0&count=24&category=Favourites", "POST", { auth });
  assert.equal(favourites.url.searchParams.get("Category"), "Favourites");
  assert.equal(favourites.headers["X-Auth-User-Id"], "12");
  assert.equal(favourites.headers["X-Auth-Session-Key"], "sid");
  const thumbnail = resolveCommunityRequest("/community-api/saves/3401734/thumbnail?date=98");
  assert.equal(thumbnail.url.href, "https://static.powdertoy.co.uk/3401734_98_small.png");
  const save = resolveCommunityRequest("/community-api/saves/3401734/data");
  assert.equal(save.url.href, "https://static.powdertoy.co.uk/3401734.cps");
  assert.throws(() => resolveCommunityRequest("/community-api/https://attacker.example"), /not found/u);
  assert.throws(() => resolveCommunityRequest("/community-api/saves?start=0&count=24", "POST", { auth: {} }), /user ID/u);
  assert.throws(() => resolveCommunityRequest("/community-api/saves/1/data?date=../../etc/passwd"), /save date/u);
});

test("community gateway authenticates startup state with the upstream session headers", () => {
  const startup = resolveCommunityRequest("/community-api/startup", "POST", { auth });
  assert.equal(startup.url.href, "https://powdertoy.co.uk/Startup.json");
  assert.equal(startup.method, "GET");
  assert.equal(startup.headers["X-Auth-User-Id"], "12");
  assert.equal(startup.headers["X-Auth-Session-Key"], "sid");
});

test("community gateway translates authenticated actions exactly and keeps secrets out of local URLs", () => {
  const view = resolveCommunityRequest("/community-api/saves/77/view", "POST", { auth });
  assert.equal(view.url.href, "https://powdertoy.co.uk/Browse/View.json?ID=77");
  assert.equal(view.headers["X-Auth-Session-Key"], "sid");
  const vote = resolveCommunityRequest("/community-api/saves/77/vote", "POST", { auth, direction: -1 });
  assert.equal(vote.url.href, "https://powdertoy.co.uk/Vote.api");
  assert.equal(vote.headers["X-Auth-User-Id"], "12");
  assert.equal(vote.headers["X-Auth-Session-Key"], "sid");
  assert.equal(vote.body, "ID=77&Action=Down&Key=key");
  const favourite = resolveCommunityRequest("/community-api/saves/77/favourite", "POST", { auth, favourite: false });
  assert.equal(favourite.method, "GET");
  assert.equal(favourite.url.searchParams.get("Mode"), "Remove");
  assert.equal(favourite.url.searchParams.get("Key"), "key");
  const tag = resolveCommunityRequest("/community-api/saves/77/tags", "POST", { auth, operation: "add", tag: "bomb" });
  assert.equal(tag.method, "GET");
  assert.equal(tag.url.pathname, "/Browse/EditTag.json");
  assert.equal(tag.url.searchParams.get("Op"), "add");
  const publish = resolveCommunityRequest("/community-api/saves/77/publish", "POST", { auth });
  assert.equal(publish.url.href, "https://powdertoy.co.uk/Browse/View.json?ID=77&Key=key");
  assert.equal(publish.method, "POST");
  assert.equal(publish.body, "ActionPublish=bagels");
  const unpublish = resolveCommunityRequest("/community-api/saves/77/unpublish", "POST", { auth });
  assert.equal(unpublish.url.href, "https://powdertoy.co.uk/Browse/Delete.json?ID=77&Mode=Unpublish&Key=key");
  const deletion = resolveCommunityRequest("/community-api/saves/77/delete", "POST", { auth });
  assert.equal(deletion.url.href, "https://powdertoy.co.uk/Browse/Delete.json?ID=77&Mode=Delete&Key=key");
  assert.equal(deletion.headers["X-Auth-Session-Key"], "sid");
  const report = resolveCommunityRequest("/community-api/saves/77/report", "POST", { auth, reason: "Stolen\r\nOriginal ID 8" });
  assert.equal(report.url.href, "https://powdertoy.co.uk/Browse/Report.json?ID=77&Key=key");
  assert.equal(report.method, "POST");
  assert.equal(report.headers["X-Auth-Session-Key"], "sid");
  assert.equal(report.body, "Reason=Stolen%0AOriginal+ID+8");
  assert.throws(() => resolveCommunityRequest("/community-api/saves/77/vote", "POST", { auth: {}, direction: 1 }), /user ID/u);
});

test("community gateway uses official login field names", () => {
  const login = resolveCommunityRequest("/community-api/login", "POST", { username: "alice", password: "correct horse" });
  assert.equal(login.url.href, "https://powdertoy.co.uk/Login.json");
  assert.equal(login.method, "POST");
  assert.equal(login.body, "name=alice&pass=correct+horse");
});

test("community gateway maps public profiles and static avatars without an open proxy", () => {
  const profile = resolveCommunityRequest("/community-api/profiles/alice");
  assert.equal(profile.url.href, "https://powdertoy.co.uk/User.json?Name=alice");
  assert.equal(profile.kind, "json");
  const avatar = resolveCommunityRequest("/community-api/profiles/alice/avatar");
  assert.equal(avatar.url.href, "https://static.powdertoy.co.uk/avatars/alice.png");
  assert.equal(avatar.kind, "image");
  const sizedAvatar = resolveCommunityRequest("/community-api/profiles/alice/avatar?size=128");
  assert.equal(sizedAvatar.url.href, "https://static.powdertoy.co.uk/avatars/alice.128.png");
  assert.throws(() => resolveCommunityRequest("/community-api/profiles/alice%2F.."), /username/u);
  assert.throws(() => resolveCommunityRequest("/community-api/profiles/alice/avatar?size=512"), /avatar size/u);
});

test("community gateway reproduces the official owner profile update", () => {
  const profile = resolveCommunityRequest("/community-api/profile", "POST", {
    auth, location: "The Lab", biography: "Line one\r\nLine two",
  });
  assert.equal(profile.url.href, "https://powdertoy.co.uk/Profile.json");
  assert.equal(profile.method, "POST");
  assert.equal(profile.headers["X-Auth-User-Id"], "12");
  assert.equal(profile.headers["X-Auth-Session-Key"], "sid");
  assert.equal(profile.headers["Content-Type"], "application/x-www-form-urlencoded");
  assert.equal(profile.body, "Location=The+Lab&Biography=Line+one%0ALine+two");
});

test("community gateway builds the official multipart OPS upload without changing server state", async () => {
  const data = Buffer.concat([Buffer.from("OPS1"), Buffer.alloc(9, 1)]);
  const upload = resolveCommunityRequest("/community-api/upload", "POST", {
    auth, name: "Volumetric reactor", description: "Projected from Powder Toy 3D", published: false, data: data.toString("base64"),
  });
  assert.equal(upload.url.href, "https://powdertoy.co.uk/Save.api");
  assert.equal(upload.method, "POST");
  assert.equal(upload.headers["X-Auth-Session-Key"], "sid");
  assert.equal(upload.body.get("Name"), "Volumetric reactor");
  assert.equal(upload.body.get("Publish"), "Private");
  assert.equal(upload.body.get("Key"), "key");
  const file = upload.body.get("Data");
  assert.equal(file.name, "save.bin");
  assert.deepEqual([...new Uint8Array(await file.arrayBuffer())], [...data]);
});
