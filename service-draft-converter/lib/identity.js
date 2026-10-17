// Authoritative conversion and pack identity rules for cache keys and descriptors.
// conversion.commit is display provenance only; the cache identity uses the real build bytes,
// dwg2dxf version and normalized output-affecting options. pack.identity is not embedded in the pack.
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const BUILD_FILES = [
  'lib/aci.js', 'lib/convert.js', 'lib/dwg.js', 'lib/dxfparse.js',
  'lib/expand.js', 'lib/hatch.js', 'lib/packcheck.js', 'lib/text.js', 'lib/worker.js',
]

export function converterRelease() {
  if (process.env.CAMIND_CONVERTER_COMMIT) return process.env.CAMIND_CONVERTER_COMMIT
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version
  }
}

export function converterBuildFingerprint() {
  const hash = createHash('sha256')
  for (const relative of BUILD_FILES) {
    hash.update(relative)
    hash.update('\0')
    hash.update(readFileSync(path.join(ROOT, relative)))
    hash.update('\0')
  }
  return hash.digest('hex')
}

function canonical(value) {
  if (value === undefined || value === null) return ''
  if (typeof value === 'string') return value.normalize('NFC')
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value)
  if (Array.isArray(value)) return value.map(canonical)
  if (typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]))
  }
  return String(value)
}

export function conversionFingerprint({ buildFingerprint, libredwgVersion = '', options = {} }) {
  if (!/^[0-9a-f]{64}$/i.test(buildFingerprint)) throw new Error('转换构建指纹必须是 64 位十六进制')
  return createHash('sha256').update(JSON.stringify({
    build: buildFingerprint,
    libredwg: String(libredwgVersion),
    options: canonical(options),
  })).digest('hex')
}

export function packIdentity(pack, { conversionFingerprint: fingerprint }) {
  if (!/^[0-9a-f]{64}$/i.test(fingerprint)) throw new Error('转换身份指纹必须是 64 位十六进制')
  const fields = [
    String(pack.source_sha256 ?? ''),
    String(pack.pipeline_version ?? ''),
    String(pack.origin?.channel ?? ''),
    fingerprint,
    String(pack.rules_version ?? ''),
    String(pack.view_rule_version ?? ''),
  ]
  return {
    fields,
    identity: createHash('sha256').update(JSON.stringify(fields)).digest('hex'),
  }
}

export const identityTestInternals = { canonical }
