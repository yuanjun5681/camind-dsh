// Node-only adapter: reuse the desktop package verifier and bounded ZIP extraction.
export { Package } from './core/geompack/package.ts'
export { parseManifest, parseFaces } from './core/geompack/manifest.ts'
export { readZipEntry } from '../../tool-cam/lib/delivery-route.js'
