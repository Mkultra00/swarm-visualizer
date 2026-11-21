const test = require("node:test"); const assert = require("node:assert/strict");
const A = require("../analyzer.js");
test("parseTs: whole seconds", () => assert.equal(A.parseTs("2026-11-19T17:39:27Z"), Date.UTC(2026, 10, 19, 17, 39, 27, 0)));
test("parseTs: 6-digit fraction truncates to ms", () => assert.equal(A.parseTs("2026-11-19T17:39:27.429413Z"), Date.UTC(2026, 10, 19, 17, 39, 27, 429)));
test("parseTs: 1-digit fraction", () => assert.equal(A.parseTs("2026-11-19T17:39:27.4Z"), Date.UTC(2026, 10, 19, 17, 39, 27, 400)));
test("parseTs: 9-digit fraction", () => assert.equal(A.parseTs("2026-11-19T17:39:27.123456789Z"), Date.UTC(2026, 10, 19, 17, 39, 27, 123)));
test("parseTs: space separator is NaN", () => assert.ok(Number.isNaN(A.parseTs("2026-11-19 17:39:27"))));
test("parseTs: junk is NaN", () => { for (const v of ["", null, 42, undefined, "2026-11-19T17:39:27.Z", "2026-13-40T99:99:99Z"]) assert.ok(Number.isNaN(A.parseTs(v)), String(v)); });
