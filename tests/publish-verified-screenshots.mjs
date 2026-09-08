import assert from "node:assert/strict";
import { copyFile, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

// Publish only PNGs freshly produced by a successful run of the corresponding
// suite. Known diagnostic/failure images are never marketing material.
const collections = {
  "automation-browser": "automation",
  "notification-browser": "notifications",
  "inbound-capture-browser": "inbound-capture",
  "storage-browser": "storage",
  "migration-browser": "migration",
  "enterprise-browser": "enterprise",
  "transfer-browser": "transfer",
};
const results = JSON.parse(await readFile("test-results/regression-shared/report.json", "utf8"));
const manifest = [];
await mkdir("docs/screenshots", { recursive: true });
for (const [suite, directory] of Object.entries(collections)) {
  const result = results.find(item => item.suite === suite);
  assert.ok(result?.ok, `Refusing unverified screenshots: ${suite}`);
  const start = Date.parse(result.checked_at) - result.seconds * 1000 - 2000;
  for (const name of (await readdir(path.join("test-results", directory))).sort()) {
    if (!name.endsWith(".png") || /(fail|error|diagnostic)/i.test(name)) continue;
    const source = path.join("test-results", directory, name), info = await stat(source);
    if (!info.isFile() || info.mtimeMs < start) continue;
    const target = path.join("docs/screenshots", name);
    await copyFile(source, target);
    manifest.push({ suite, bundle: result.bundle, source, target });
  }
}
await writeFile("test-results/regression-shared/published-screenshots.json", JSON.stringify(manifest, null, 2));
console.log(`Published ${manifest.length} verified screenshots from ${Object.keys(collections).length} successful suites`);
