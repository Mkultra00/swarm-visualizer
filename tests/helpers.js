// Shared test helpers (not a test file).
const fs = require("node:fs");
const path = require("node:path");
const ROOT = path.join(__dirname, "..");
const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf8"));
const clone = (o) => JSON.parse(JSON.stringify(o));
const manifest = () => readJson("data/manifest.json");
module.exports = { ROOT, readJson, clone, manifest };
