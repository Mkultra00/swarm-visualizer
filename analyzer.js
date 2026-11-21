/* analyzer.js — pure, no DOM. Runs as a classic <script> (self.SwarmAnalyzer) and via require(). */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.SwarmAnalyzer = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const TS_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?Z$/;

  // Engine-independent ISO-8601 UTC parser. Fraction truncated to ms. NaN on anything else.
  function parseTs(ts) {
    if (typeof ts !== "string") return NaN;
    const m = TS_RE.exec(ts);
    if (!m) return NaN;
    const [y, mo, d, h, mi, s] = m.slice(1, 7).map(Number);
    const ms = m[7] ? Number((m[7] + "00").slice(0, 3)) : 0;
    const t = Date.UTC(y, mo - 1, d, h, mi, s, ms);
    const dt = new Date(t);
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d ||
        dt.getUTCHours() !== h || dt.getUTCMinutes() !== mi || dt.getUTCSeconds() !== s) return NaN;
    return t;
  }

  return { parseTs };
});
