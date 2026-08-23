// camind-ui-toolpath-viewer Host half — the viewer is a pure browser
// contribution (keyed `cam.nc.preview` renderer seat), so Host activation is
// intentionally empty. The NC parser (lib/nc-parser.js) is a dependency-free
// ESM module shared with the client bundle; import it from Node for offline
// verification.
export const name = 'ui-toolpath-viewer'

export function apply() {}
