// M2-02 source snapshot and encoding checks: authorization is delegated to previewFiles,
// while hash/conversion consume the same stable snapshot even if the original path is replaced.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { snapshotDrawingSource, decodeDxfSnapshot } from './lib/source.js'

const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'drawing-source-check-'))
try {
  const original = path.join(dir, 'part.dxf')
  const text = '0\nSECTION\n0\nEOF\n'
  await fs.writeFile(original, text)
  const calls = []
  const resolve = async (session, requested) => {
    calls.push([session, requested])
    return { file: original, name: 'current-name.dxf', displayPath: 'current-name.dxf' }
  }
  const snapshot = await snapshotDrawingSource({ sessionId: 's1', requested: 'part.dxf', resolve })
  assert.deepEqual(calls, [['s1', 'part.dxf']])
  assert.equal(snapshot.name, 'current-name.dxf')
  assert.equal(snapshot.source.sha256, snapshot.sha256)
  await fs.writeFile(original, 'changed after snapshot')
  assert.equal((await fs.readFile(snapshot.snapshotPath, 'utf8')), text)
  assert.equal(decodeDxfSnapshot(snapshot).text, text)
  assert.equal(snapshot.bytes.toString('utf8'), text)
  await snapshot.cleanup()
  await assert.rejects(fs.stat(snapshot.snapshotPath))
  console.log('ok - authorized stable source snapshot survives original replacement')

  const utf16 = await snapshotDrawingSource({ sessionId: 's1', requested: 'part.dxf', resolve: async () => ({ file: original }) })
  await fs.writeFile(original, Buffer.concat([Buffer.from([0xFF, 0xFE]), Buffer.from(text, 'utf16le')]))
  const le = await snapshotDrawingSource({ sessionId: 's1', requested: 'part.dxf', resolve: async () => ({ file: original }) })
  assert.equal(decodeDxfSnapshot(le).text, text)
  const beBytes = Buffer.concat([Buffer.from([0xFE, 0xFF]), Buffer.from(text, 'utf16le').swap16()])
  await fs.writeFile(original, beBytes)
  const be = await snapshotDrawingSource({ sessionId: 's1', requested: 'part.dxf', resolve: async () => ({ file: original }) })
  assert.equal(decodeDxfSnapshot(be).text, text)
  assert.throws(() => decodeDxfSnapshot({ name: 'part.txt', bytes: Buffer.from(text) }), /不支持的图纸载体/)
  await fs.writeFile(original, Buffer.from([0xC3, 0x28]))
  assert.throws(() => decodeDxfSnapshot({ name: 'bad.dxf', bytes: Buffer.from([0xC3, 0x28]) }), /utf-8|UTF/)
  await assert.rejects(
    snapshotDrawingSource({ sessionId: 's2', requested: 'secret.dxf', resolve: async () => { throw new Error('forbidden') } }),
    /forbidden/,
  )
  console.log('ok - UTF-8/UTF-16 and unsupported-input rejection')
} finally {
  await fs.rm(dir, { recursive: true, force: true })
}
