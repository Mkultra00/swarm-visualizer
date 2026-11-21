const test = require("node:test"); const assert = require("node:assert/strict");
const fs = require("node:fs"); const path = require("node:path");
const { ROOT } = require("./helpers.js");
const src = fs.readFileSync(path.join(ROOT, "app.js"), "utf8");
test("app.js never uses innerHTML / outerHTML / insertAdjacentHTML / document.write", () => {
  assert.doesNotMatch(src, /\b(innerHTML|outerHTML|insertAdjacentHTML|document\.write)\b/);
});
test("index.html loads analyzer then viz-model then app", () => {
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const a = html.indexOf('src="analyzer.js"');
  const v = html.indexOf('src="viz-model.js"');
  const p = html.indexOf('src="app.js"');
  assert.ok(a >= 0 && v > a && p > v);
});
