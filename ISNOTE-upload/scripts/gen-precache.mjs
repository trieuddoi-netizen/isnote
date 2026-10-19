// After `vite build`: list every built file in dist/precache.json and stamp a content hash into dist/sw.js,
// so the service worker caches the whole app on first visit (offline from the very first launch on iPad).
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const dist = new URL("../dist/", import.meta.url).pathname;
const SKIP = new Set(["sw.js", "precache.json", ".DS_Store"]);
const files = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (!SKIP.has(name)) files.push(relative(dist, p).split("\\").join("/"));
  }
})(dist);
files.sort();
const hash = createHash("sha256");
for (const f of files) hash.update(f).update(readFileSync(join(dist, f)));
const version = hash.digest("hex").slice(0, 12);
writeFileSync(join(dist, "precache.json"), JSON.stringify({ version, files: ["./", ...files.map((f) => `./${f}`)] }));
const sw = readFileSync(join(dist, "sw.js"), "utf8").replaceAll("__BUILD__", version);
writeFileSync(join(dist, "sw.js"), sw);
console.log(`precache: ${files.length} files, version ${version}`);
