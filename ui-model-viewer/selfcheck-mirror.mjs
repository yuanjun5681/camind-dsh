// Keep the selective viewer mirror manifest bound to exact local and upstream file bytes.
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('./', import.meta.url))
const desktop = path.resolve(process.env.DESKTOP_REPO ?? fileURLToPath(new URL('../../Camind-desktop', import.meta.url)))
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'mirror-manifest.json'), 'utf8'))
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex')

function verifyManifest(manifest) {
  assert.deepEqual(manifest.files.map(file => file.path), ['geom_view.ts', 'scene_renderer.ts', 'shaders.ts', 'nc/parser.ts'], 'mirror file set changed')
  assert.deepEqual(manifest.fixtures.map(fixture => fixture.path), ['packages/viewer/src/synthetic_pack.ts', 'packages/viewer/test/gl_mock.ts'], 'mirror fixture set changed')
  assert.match(manifest.sourceCommit, /^[0-9a-f]{40}$/)
  assert.match(manifest.reviewBaseCommit, /^[0-9a-f]{40}$/)
  assert.equal(manifest.reviewBaseCommit, '726694d1ffa75eb210e5304bc94aad437fb2ba8a', 'reviewBaseCommit must stay pinned to the INT-04 review baseline')
  assert.match(manifest.localBaseCommit, /^[0-9a-f]{40}$/)
  assert.match(manifest.mergeBase, /^[0-9a-f]{40}$/)
  assert.ok(manifest.localBaseCommitRole && manifest.hashScope)
  execFileSync('git', ['-C', root, 'cat-file', '-e', manifest.reviewBaseCommit])
  const reviewAncestor = execFileSync('git', ['-C', root, 'merge-base', manifest.reviewBaseCommit, 'HEAD'], { encoding: 'utf8' }).trim()
  assert.equal(reviewAncestor, manifest.reviewBaseCommit, 'reviewBaseCommit must be an ancestor of HEAD')
  if (process.env.CAMIND_MIRROR_LOCAL_ONLY !== '1') {
    for (const commit of [manifest.sourceCommit, manifest.localBaseCommit, manifest.mergeBase])
      execFileSync('git', ['-C', desktop, 'cat-file', '-e', commit])
    const sourceAncestor = execFileSync('git', ['-C', desktop, 'merge-base', manifest.sourceCommit, 'HEAD'], { encoding: 'utf8' }).trim()
    assert.equal(sourceAncestor, manifest.sourceCommit, 'sourceCommit must be an ancestor of desktop HEAD')
    const mergeBase = execFileSync('git', ['-C', desktop, 'merge-base', manifest.sourceCommit, manifest.localBaseCommit], { encoding: 'utf8' }).trim()
    assert.equal(mergeBase, manifest.mergeBase, 'manifest mergeBase does not match the two desktop commits')
  }
  for (const file of manifest.files) {
    if (file.status === 'identical')
      assert.equal(file.sha256, file.sourceSha256, `${file.path}: status identical requires equal local/upstream hashes`)
    const local = fs.readFileSync(path.join(root, file.localPath ?? path.join('src/viewer', file.path)))
    assert.equal(sha(local), file.sha256, `${file.path}: local mirror hash is stale`)
    if (process.env.CAMIND_MIRROR_LOCAL_ONLY === '1') continue
    const upstreamPath = file.upstreamPath ?? `${manifest.sourceRoot}/${file.path}`
    const upstream = execFileSync('git', ['-C', desktop, 'show', `${manifest.sourceCommit}:${upstreamPath}`])
    assert.equal(sha(upstream), file.sourceSha256, `${file.path}: upstream mirror hash is stale`)
  }
  if (process.env.CAMIND_MIRROR_LOCAL_ONLY !== '1') {
    for (const fixture of manifest.fixtures) {
      const upstream = execFileSync('git', ['-C', desktop, 'show', `${manifest.sourceCommit}:${fixture.path}`])
      assert.equal(sha(upstream), fixture.sha256, `${fixture.path}: fixture mirror hash is stale`)
    }
  }
}

verifyManifest(manifest)
const badLocal = structuredClone(manifest)
badLocal.files[0].sha256 = '0'.repeat(64)
assert.throws(() => verifyManifest(badLocal), /local mirror hash is stale/)
const badIdentical = structuredClone(manifest)
badIdentical.files.find(file => file.status === 'identical').sourceSha256 = '0'.repeat(64)
assert.throws(() => verifyManifest(badIdentical), /status identical requires equal local\/upstream hashes/)
const badFileSet = structuredClone(manifest)
badFileSet.files = badFileSet.files.slice(0, 3)
assert.throws(() => verifyManifest(badFileSet), /mirror file set changed/)
const badFixtureSet = structuredClone(manifest)
badFixtureSet.fixtures = badFixtureSet.fixtures.slice(0, 1)
assert.throws(() => verifyManifest(badFixtureSet), /mirror fixture set changed/)
if (process.env.CAMIND_MIRROR_LOCAL_ONLY !== '1') {
  const badUpstream = structuredClone(manifest)
  badUpstream.files[0].sourceSha256 = '0'.repeat(64)
  assert.throws(() => verifyManifest(badUpstream), /upstream mirror hash is stale/)
  const badFixtureHash = structuredClone(manifest)
  badFixtureHash.fixtures[0].sha256 = '0'.repeat(64)
  assert.throws(() => verifyManifest(badFixtureHash), /fixture mirror hash is stale/)
  const badSourceAncestor = structuredClone(manifest)
  badSourceAncestor.sourceCommit = badSourceAncestor.localBaseCommit
  // When localBaseCommit is not an ancestor of desktop HEAD, the ancestry assertion fires.
  // Under the current manifest (mergeBase != localBaseCommit), even if a future desktop
  // history makes localBaseCommit an ancestor of HEAD, the wrong sourceCommit is still
  // deterministically rejected by the mergeBase equality assertion; the upstream/fixture hash
  // assertions are the last line of defense only if the manifest mergeBase is also rewritten.
  assert.throws(() => verifyManifest(badSourceAncestor), /sourceCommit must be an ancestor|mergeBase does not match|mirror hash is stale/)
  const badMergeBase = structuredClone(manifest)
  badMergeBase.mergeBase = manifest.sourceCommit
  assert.throws(() => verifyManifest(badMergeBase), /mergeBase does not match/)
  const badReviewBase = structuredClone(manifest)
  badReviewBase.reviewBaseCommit = manifest.sourceCommit
  assert.throws(() => verifyManifest(badReviewBase), /reviewBaseCommit must stay pinned/)
}
console.log(`mirror manifest selfcheck passed: ${manifest.files.length} local files and local negative controls${process.env.CAMIND_MIRROR_LOCAL_ONLY === '1' ? ' (local-only mode; upstream, merge-base and review-base negative controls skipped)' : `, upstream ${manifest.sourceCommit}, ${manifest.fixtures.length} pinned fixtures and implemented negative controls`}`)
