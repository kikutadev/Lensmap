#!/usr/bin/env node
/* global console */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const manifestPath = resolve("apps/chrome-extension/.output/chrome-mv3/manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const permissions = [...(manifest.permissions ?? [])].sort();
const hosts = [...(manifest.host_permissions ?? [])].sort();

assert.deepEqual(permissions, ["activeTab", "contextMenus", "nativeMessaging", "sidePanel", "storage"].sort(),
  `Unexpected extension permissions: ${permissions.join(", ")}`);
assert.deepEqual(hosts, ["file:///*", "http://127.0.0.1/*"].sort(),
  `Unexpected extension host permissions: ${hosts.join(", ")}`);
assert(!permissions.includes("tabs"), "The broad tabs permission must not be reintroduced without a documented review.");

const expectedIcons = {
  "16": "icons/icon-16.png",
  "32": "icons/icon-32.png",
  "48": "icons/icon-48.png",
  "128": "icons/icon-128.png",
};
assert.deepEqual(manifest.icons, expectedIcons, "Unexpected extension icon manifest mapping");
assert.deepEqual(manifest.action?.default_icon, expectedIcons, "Unexpected action icon manifest mapping");
for (const iconPath of Object.values(expectedIcons)) {
  assert(existsSync(resolve("apps/chrome-extension/.output/chrome-mv3", iconPath)), `Built extension icon is missing: ${iconPath}`);
}

console.log(JSON.stringify({ permissions, hostPermissions: hosts, icons: expectedIcons }, null, 2));
