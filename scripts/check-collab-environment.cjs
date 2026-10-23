const { findElectronBinary } = require('./electron-binary.cjs');

/**
 * The collab server serves its pages without Electron but renders and syncs
 * slides through it, so a half-finished install boots "healthy" and then
 * answers every sync with a 500. Refuse to start instead, so the deploy
 * health check fails and rolls back rather than shipping a broken server.
 */
if (!findElectronBinary()) {
  console.error(`
The Electron binary is missing, so the collab server could not render or
sync slides. Refusing to start.

Fix: node node_modules/electron/install.js   (or: npm ci)
`);
  process.exit(1);
}

/**
 * The server fetches URLs its clients name (/api/import-url, pasted images),
 * and Node before the 2026-10-21 security releases decodes a hostile Brotli
 * response into an out-of-bounds write (CVE-2026-111497). Refuse to start on
 * a Node without those fixes.
 */
// ponytail: unknown majors are refused; add a row when moving to a newer line.
const [major, minor, patch] = process.versions.node.split('.').map(Number);
const floor = { 22: [23, 4], 24: [22, 1], 26: [12, 1] }[major];
if (!floor || minor < floor[0] || (minor === floor[0] && patch < floor[1])) {
  console.error(`
Node ${process.version} lacks the 2026-10-21 security fixes, so the collab
server could be compromised through a URL it fetches. Refusing to start.

Fix: run it on Node 22.23.4+, 24.22.1+ or 26.12.1+
`);
  process.exit(1);
}
