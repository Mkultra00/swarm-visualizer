// Node 22 resolves `node --test tests/` to this file (directory → index.js).
// It loads every tests/*.test.js so the documented command runs the whole suite.
const fs = require("node:fs");
const path = require("node:path");
for (const f of fs.readdirSync(__dirname).filter((n) => n.endsWith(".test.js")).sort()) {
  require(path.join(__dirname, f));
}
