/* analyzer.js — pure, no DOM. Runs as a classic <script> (self.SwarmAnalyzer) and via require(). */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.SwarmAnalyzer = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  return {};
});
