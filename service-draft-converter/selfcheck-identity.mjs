// M2-01 identity contract checks: real converter release, real build fingerprint,
// deterministic six-field pack identity and output-affecting option sensitivity.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { apply } from './index.js'

const services = new Map()
apply({ provide: (name, service) => services.set(name, service) }, {})
const converter = services.get('draftConverter')
const HEADER = `0\nSECTION\n2\nHEADER\n9\n$INSUNITS\n70\n4\n0\nENDSEC\n`
const TABLES = `0\nSECTION\n2\nTABLES\n0\nTABLE\n2\nLAYER\n70\n1\n0\nLAYER\n2\n0\n70\n0\n62\n7\n6\nContinuous\n0\nENDTAB\n0\nTABLE\n2\nLTYPE\n70\n1\n0\nLTYPE\n2\nContinuous\n70\n0\n3\nSolid line\n72\n65\n73\n0\n40\n0.0\n0\nENDTAB\n0\nTABLE\n2\nSTYLE\n70\n1\n0\nSTYLE\n2\nStandard\n70\n0\n40\n0.0\n41\n1.0\n71\n0\n42\n2.5\n3\ntxt\n4\n\n0\nENDTAB\n0\nENDSEC\n`
const dxf = `${HEADER}${TABLES}0\nSECTION\n2\nENTITIES\n0\nLINE\n5\n100\n100\nAcDbEntity\n8\n0\n100\nAcDbLine\n10\n0.0\n20\n0.0\n30\n0.0\n11\n100.0\n21\n0.0\n31\n0.0\n0\nENDSEC\n0\nEOF\n`
const pack = await converter.convertDxf(dxf, { sourceName: 'identity.dxf', sourceBytes: Buffer.from(dxf) })
const info = await converter.info()
assert.match(info.converter, /^[0-9a-f]{40}$/i)
assert.equal(pack.conversion.commit, info.converter)
assert.equal(info.conversionFingerprint, await converter.conversionIdentity())
assert.equal(info.conversionFingerprint.length, 64)
assert.notEqual(await converter.conversionIdentity({ libredwgVersion: 'cli-a' }), await converter.conversionIdentity({ libredwgVersion: 'cli-b' }), 'dwg2dxf 版本变化必须改变转换指纹')

const first = await converter.identity(pack, { options: { ltscale: 1, nested: { b: 1, a: 2 } } })
const second = await converter.identity(pack, { options: { nested: { a: 2, b: 1 }, ltscale: 1 } })
assert.equal(first.identity, second.identity, '规范化选项的键顺序不得影响身份')
assert.equal(first.fields.length, 6)
assert.match(first.fields[3], /^[0-9a-f]{64}$/i)
assert.equal(first.identity.length, 64)
assert.equal('identity' in pack, false, 'pack.identity 不得写入 pack JSON')
const candidates = await converter.identities(pack.source_sha256)
assert.equal(candidates.length, 3)
assert.equal(new Set(candidates.map(item => item.identity)).size, 3)
assert.equal(candidates.find(item => item.channel === pack.origin.channel).identity, (await converter.identity(pack)).identity,
  '缓存候选必须包含实际 pack 的六项身份')
const frozenFingerprint = 'b'.repeat(64)
assert.equal((await converter.identity(pack, { conversionFingerprint: frozenFingerprint })).fields[3], frozenFingerprint,
  '发布时必须能使用本次转换冻结的指纹')

const differentOptions = await converter.identity(pack, { options: { ltscale: 2 } })
assert.notEqual(first.identity, differentOptions.identity)
const differentSource = await converter.identity({ ...pack, source_sha256: '0'.repeat(64) })
assert.notEqual(first.identity, differentSource.identity, 'source_sha256 改变必须改变 pack.identity')
console.log('ok - conversion release, build fingerprint and six-field pack identity')

const slowHome = await fs.mkdtemp(path.join(os.tmpdir(), 'drawing-identity-probe-'))
const slowTool = path.join(slowHome, 'slow-dwg2dxf')
await fs.writeFile(slowTool, '#!/usr/bin/env node\nsetTimeout(() => { console.log("dwg2dxf slow") }, 500)\n', { mode: 0o755 })
const slowServices = new Map()
apply({ provide: (name, service) => slowServices.set(name, service) }, { dwg2dxfPath: slowTool })
const slowConverter = slowServices.get('draftConverter')
const controller = new AbortController()
let ticks = 0
const timer = setInterval(() => { ticks++ }, 5)
const probing = slowConverter.identities(pack.source_sha256, { signal: controller.signal })
setTimeout(() => controller.abort(), 20)
await assert.rejects(probing, /取消/)
clearInterval(timer)
assert.ok(ticks > 0, '异步版本探测不得阻塞 Host 事件循环')
await fs.rm(slowHome, { recursive: true, force: true })
console.log('ok - asynchronous version probe stays responsive and cancellable')
