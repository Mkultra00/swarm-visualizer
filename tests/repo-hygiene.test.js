const test = require("node:test"); const assert = require("node:assert/strict");
const fs = require("node:fs"); const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { ROOT } = require("./helpers.js");

// Everything git would commit: tracked files plus untracked files that are not gitignored.
function repoFiles() {
  const out = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { cwd: ROOT });
  return [...new Set(out.toString("utf8").split("\0").filter(Boolean))]
    .filter((f) => fs.existsSync(path.join(ROOT, f)) && !f.startsWith("node_modules/"));
}
const BINARY = /\.(wav|mp3|ogg|png|jpe?g|gif|webp|ico|mp4)$/i;
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

// Patterns are assembled so this file does not match itself.
const J = (...p) => p.join("");
const CONTENT = [
  ["google-key", new RegExp(J("\\bAI", "za[0-9A-Za-z_-]{35}\\b"))],
  ["openai-key", new RegExp(J("\\bs", "k-[A-Za-z0-9]{20,}\\b"))],
  ["bearer", new RegExp(J("\\bbear", "er\\s+[A-Za-z0-9._~+/-]{8,}"), "i")],
  ["jwt", new RegExp(J("\\bey", "J[A-Za-z0-9_-]{10,}\\."))],
  ["ipv4", /\b\d{1,3}(\.\d{1,3}){3}\b/],
];
// Allowlist (§6.2 [DECISION]): gate fixtures that must trip, and the TDD's own pattern table (checked by hand).
const ALLOW_ALL = [/^tests\/fixtures\/dirty-[^/]+\.json$/, /^docs\/TDD-swarm-visualizer\.md$/];
// Known lab export defect, pinned in tests/data-gate.test.js as KNOWN_REJECTED. Only ipv4 is tolerated there.
const ALLOW_RULE = { "data/runs/7c2756ff.json": ["ipv4"] };

test("gitignore covers inputs/, .env*, node_modules/", () => {
  const gi = read(".gitignore").split(/\r?\n/).map((l) => l.trim());
  for (const need of ["inputs/", ".env*", "node_modules/"]) assert.ok(gi.includes(need), need);
});

test("no secret-shaped file names", () => {
  for (const f of repoFiles()) {
    const b = path.basename(f);
    assert.equal(/^\.env(\..*)?$|\.pem$|\.key$|^id_|^auth\.json$/.test(b), false, f);
  }
});

test("no key / bearer / jwt / ipv4 content in committed text files", () => {
  const hits = [];
  for (const f of repoFiles()) {
    if (BINARY.test(f) || ALLOW_ALL.some((re) => re.test(f))) continue;
    const s = read(f);
    for (const [rule, re] of CONTENT) if (re.test(s) && !(ALLOW_RULE[f] || []).includes(rule)) hits.push(`${f}: ${rule}`);
  }
  assert.deepEqual(hits, []);
});

test("no fetch() to an absolute http URL in *.js / *.mjs browser or tool code", () => {
  for (const f of repoFiles().filter((x) => /\.(m?js)$/.test(x) && !x.startsWith("tests/"))) {
    assert.doesNotMatch(read(f), /fetch\(\s*["'`]https?:/i, f);
  }
});

test("index.html loads nothing remote", () => {
  const html = read("index.html");
  assert.doesNotMatch(html, /<script[^>]+src=["']?(https?:)?\/\//i);
  assert.doesNotMatch(html, /<link[^>]+href=["']?(https?:)?\/\//i);
});

test("self-check: the content scan does fire", () => {
  const s = J("x 192.0", ".2.1 y");
  assert.ok(CONTENT.find(([r]) => r === "ipv4")[1].test(s));
});
