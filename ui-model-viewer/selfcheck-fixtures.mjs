// Shared sourceCommit-pinned fixture loading for viewer selfchecks.
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

export function loadPinnedFixtures(root, desktop, relatives) {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'mirror-manifest.json'), 'utf8'))
  const expected = new Map(manifest.fixtures.map(fixture => [fixture.path, fixture.sha256]))
  const sources = new Map()
  const paths = new Map()
  for (const relative of relatives) {
    const absolute = fs.realpathSync(path.join(desktop, relative))
    const bytes = execFileSync('git', ['-C', desktop, 'show', `${manifest.sourceCommit}:${relative}`])
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), expected.get(relative), `${relative}: fixture hash does not match mirror-manifest`)
    sources.set(absolute, bytes.toString('utf8'))
    paths.set(relative, absolute)
  }
  return { sourceCommit: manifest.sourceCommit, sources, paths }
}

export function createPinnedFixturePlugin(pinned) {
  const expectedNames = new Set([...pinned.paths.values()].map(absolute => path.basename(absolute)))
  const loads = new Map([...pinned.sources.keys()].map(absolute => [absolute, 0]))
  const realpathOf = value => {
    if (!value) return value
    try { return fs.realpathSync(value) } catch { return path.resolve(value) }
  }
  const plugin = { name: 'source-commit-fixtures', setup(b) {
    b.onResolve({ filter: /.*/ }, args => {
      if (pinned.sources.has(realpathOf(args.importer)) && args.path !== '@camind/core')
        throw new Error(`forbidden fixture import: ${args.path}`)
      return undefined
    })
    b.onLoad({ filter: /\.ts$/ }, args => {
      const canonical = realpathOf(args.path)
      const contents = pinned.sources.get(canonical)
      if (contents === undefined) {
        if (expectedNames.has(path.basename(canonical))) throw new Error(`unexpected fixture path: ${args.path}`)
        return undefined
      }
      loads.set(canonical, loads.get(canonical) + 1)
      return { contents, loader: 'ts' }
    })
  } }
  return {
    plugin,
    assertAllLoadedOnce() {
      for (const [absolute] of pinned.sources)
        assert.equal(loads.get(absolute), 1, `${absolute}: pinned fixture was not loaded exactly once`)
    },
  }
}
