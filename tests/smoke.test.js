const test = require("node:test"); const assert = require("node:assert/strict");
test("analyzer loads in node", () => {
  const A = require("../analyzer.js");
  assert.equal(typeof A, "object");
  assert.deepEqual(Object.keys(A).sort(), []); // dropped in T1
});
