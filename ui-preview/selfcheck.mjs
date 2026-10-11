// Session-bound desktop path references: grammar, realpath identity, cold reads and HTTP gate.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { apply } from './index.js'
import { referencedPaths } from './lib/references.js'
const home = await fs.mkdtemp(path.join(os.tmpdir(), 'cam-reference-check-'))
const previousHome = process.env.DSH_HOME
process.env.DSH_HOME = home
try {
  const cwd = path.join(home, 'workspace'), outside = path.join(home, '零件 有空格')
  await fs.mkdir(cwd); await fs.mkdir(outside)
  const prt = path.join(outside, 'part.prt'), second = path.join(cwd, 'part.prt')
  await fs.writeFile(prt, 'external part'); await fs.writeFile(second, 'workspace part')
  const user = text => ({ type: 'user/message', data: { content: [{ type: 'text', text }] } })
  const events = [user(`显示 @"${prt}" @part.prt @part.prt @missing.prt @folder/ a@part.prt`),
    { type: 'tool/result', data: { content: [{ type: 'text', text: '@not-user.prt' }] } },
    { ...user('@injected.prt'), data: { source: { kind: 'tool' }, content: [{ type: 'text', text: '@injected.prt' }] } }]
  const live = { header: { cwd }, snapshotEvents: () => events }
  assert.deepEqual(referencedPaths(live).map(file => path.basename(file.absolute)), ['part.prt', 'part.prt', 'missing.prt'])
  let service, route, closed = 0
  apply({ agents: { get: id => id === 'live' ? { session: live } : undefined }, sessions: { get() {} },
    get: name => name === 'uploads' ? { listBatches: () => [] } : name === 'connection' ? { requestRejection: ({ headers }) => headers.cookie === 'test' ? undefined : 401 }
      : name === 'sessionPersistence' ? { open: async (id, access) => {
        assert.equal(access, 'read')
        if (!['cold', 'empty'].includes(id)) throw new Error('unknown session')
        return { header: { cwd }, read: async () => ({ events: id === 'cold' ? events : [] }), close: async () => { closed++ } }
      } } : undefined,
    provide: (name, value) => { if (name === 'previewFiles') service = value }, webServer: { register: r => { route = r.handler } },
  })
  const files = await service.list('live')
  assert.equal(files.length, 3); assert.equal(new Set(files.map(f => f.path)).size, 3)
  assert(files.every(file => file.absolute === undefined), 'Do not publish internal filesystem handles')
  assert.equal(files.filter(file => file.available).length, 2)
  const ext = files.find(file => file.displayPath === prt)
  assert.equal((await service.resolve('live', ext.path)).file, await fs.realpath(prt))
  await assert.rejects(service.resolve('empty', ext.path), { name: 'FilePreviewForbiddenError' })
  await assert.rejects(service.resolve('live', prt), { name: 'FilePreviewForbiddenError' })
  await assert.rejects(service.resolve('live', 'reference://../escape'), { name: 'FilePreviewForbiddenError' })
  await assert.rejects(service.resolve('live', files.find(file => !file.available).path), { name: 'FilePreviewNotFoundError' })
  assert.equal((await service.list('cold')).length, 3)
  assert.equal((await service.resolve('cold', ext.path)).file, await fs.realpath(prt))
  assert.equal(closed, 3, 'All cold read handles must close, including denied resolution')
  const link = path.join(cwd, 'link.prt')
  await fs.symlink(prt, link); events.push(user('@link.prt'))
  const oldLink = (await service.list('live')).find(file => file.displayPath === 'link.prt')
  await fs.unlink(link); await fs.symlink(second, link)
  await assert.rejects(service.resolve('live', oldLink.path), { name: 'FilePreviewForbiddenError' })
  const internal = path.join(home, '.dsh'); await fs.mkdir(internal); await fs.writeFile(path.join(internal, 'private.prt'), 'private')
  events.push(user(`@"${path.join(internal, 'private.prt')}"`))
  const sensitive = (await service.list('live')).find(file => file.displayPath.includes('.dsh'))
  assert.equal(sensitive.available, false)
  await assert.rejects(service.resolve('live', sensitive.path), { name: 'FilePreviewForbiddenError' })
  let status, body
  const response = () => ({ writeHead: code => { status = code }, end: data => { body = JSON.parse(data) } })
  await route({ url: '/camind/api/preview/sessions/live/files', method: 'GET', headers: {} }, response())
  assert.equal(status, 401)
  await route({ url: '/camind/api/preview/sessions/live/files', method: 'GET', headers: { cookie: 'test' } }, response())
  assert.equal(status, 200); assert.equal(body.files.length, 5)
  await route({ url: `/camind/api/preview/sessions/live/file?path=${encodeURIComponent(ext.path)}`, method: 'GET', headers: { cookie: 'test' } }, response())
  assert.equal(status, 200); assert.equal(body.name, 'part.prt'); assert.equal(body.displayPath, prt)
  await fs.unlink(prt)
  await assert.rejects(service.resolve('live', ext.path), { name: 'FilePreviewForbiddenError' })
  console.log('preview reference selfcheck passed: quoted/CJK/relative paths, duplicate names, missing files, cross-session/absolute/sensitive/symlink rejection, cold read close and HTTP gate')
} finally {
  if (previousHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = previousHome
  await fs.rm(home, { recursive: true, force: true })
}
