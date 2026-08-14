#!/usr/bin/env node
/* global console */
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import process from "node:process";

const root = process.cwd();
const outputPath = resolve(root, "THIRD_PARTY_NOTICES.md");
const paths = execFileSync("npm", ["ls", "--omit=dev", "--all", "--parseable"], {
  cwd: root,
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
})
  .split("\n")
  .map((value) => value.trim())
  .filter(Boolean);

const packages = [];
for (const packagePath of paths) {
  if (resolve(packagePath) === resolve(root)) continue;
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(resolve(packagePath, "package.json"), "utf8"));
  } catch {
    continue;
  }
  if (typeof manifest.name !== "string" || manifest.name.startsWith("@deep-reader/")) continue;

  const files = readdirSync(packagePath, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name);
  const licenseFiles = files
    .filter((name) => /^(licen[cs]e|copying)(\..+)?$/iu.test(name))
    .sort((left, right) => left.localeCompare(right));
  const noticeFiles = files
    .filter((name) => /^notice(\..+)?$/iu.test(name))
    .sort((left, right) => left.localeCompare(right));

  packages.push({
    name: manifest.name,
    version: String(manifest.version ?? "unknown"),
    license: normalizeLicense(manifest.license, licenseFiles.map((name) => readFileSync(resolve(packagePath, name), "utf8"))),
    homepage: typeof manifest.homepage === "string" ? manifest.homepage : null,
    repository: repositoryUrl(manifest.repository),
    licenseTexts: licenseFiles.map((name) => ({ name, text: normalizeText(readFileSync(resolve(packagePath, name), "utf8")) })),
    noticeTexts: noticeFiles.map((name) => ({ name, text: normalizeText(readFileSync(resolve(packagePath, name), "utf8")) })),
  });
}

packages.sort((left, right) => left.name.localeCompare(right.name) || left.version.localeCompare(right.version));
const unique = packages.filter((entry, index) =>
  index === 0 || entry.name !== packages[index - 1].name || entry.version !== packages[index - 1].version,
);

const lines = [
  "# Third-Party Notices",
  "",
  "Deep Reader includes or bundles software from the packages listed below in production builds.",
  "This file is generated from the installed production dependency tree by `npm run licenses:generate`.",
  "The upstream license/notice text is reproduced when the installed package ships it.",
  "",
  `Generated package count: ${unique.length}`,
  "",
];

for (const entry of unique) {
  lines.push(`## ${entry.name}@${entry.version}`, "", `License: ${entry.license}`);
  if (entry.homepage) lines.push(`Homepage: ${entry.homepage}`);
  if (entry.repository) lines.push(`Repository: ${entry.repository}`);
  lines.push("");

  if (entry.licenseTexts.length === 0) {
    lines.push("The installed package does not ship a standalone LICENSE/COPYING file; consult the upstream package metadata for the stated license.", "");
  } else {
    for (const file of entry.licenseTexts) {
      lines.push(`### ${basename(file.name)}`, "", "```text", file.text, "```", "");
    }
  }
  for (const file of entry.noticeTexts) {
    lines.push(`### ${basename(file.name)}`, "", "```text", file.text, "```", "");
  }
}

writeFileSync(outputPath, `${lines.join("\n").trimEnd()}\n`, "utf8");
console.log(`Wrote ${outputPath} with ${unique.length} production packages.`);


function normalizeText(value) {
  return value
    .replace(/\r\n?/gu, "\n")
    .split("\n")
    .map((line) => line.replace(/[\t ]+$/gu, ""))
    .join("\n")
    .trim();
}

function normalizeLicense(value, licenseTexts) {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (value && typeof value === "object" && typeof value.type === "string") return value.type;

  const combined = licenseTexts.join("\n");
  if (/The MIT License|Permission is hereby granted, free of charge, to any person obtaining a copy/iu.test(combined)) {
    return "MIT (identified from bundled license text)";
  }
  return licenseTexts.length > 0 ? "See bundled license text" : "UNKNOWN";
}

function repositoryUrl(value) {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && typeof value.url === "string") return value.url;
  return null;
}
