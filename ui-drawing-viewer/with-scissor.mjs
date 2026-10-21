// Shared test shim: the pinned upstream gl_mock (Camind-desktop packages/viewer/test/gl_mock.ts)
// has no scissor, while draft_view.ts uses it for inset clipping every frame. Record scissor
// calls locally without touching the pinned fixture. If upstream ever provides a real scissor
// implementation, fail loudly so this shim is removed instead of masking it; a bare/placeholder
// property is a different loud failure so the shim decision is re-reviewed either way.
// （本模块同时承载 gitSafeEnv——provenance 类 git 调用的环境清理。双职责是历史合并的结果；
// 拆分会牵动 4+ 个测试文件的 import，暂保持单文件并在头部如实声明。）
export function withScissor(mock) {
  if (mock.gl.scissor?.__camindShim) throw new Error('withScissor applied twice on the same mock')
  if (typeof mock.gl.scissor === 'function') throw new Error('upstream gl_mock gained scissor; remove the local shim')
  if ('scissor' in mock.gl) throw new Error('upstream gl_mock declares a non-function scissor placeholder; review whether the local shim is still appropriate')
  mock.scissorCalls = []
  const shim = (x, y, w, h) => { mock.scissorCalls.push([x, y, w, h]) }
  shim.__camindShim = true
  mock.gl.scissor = shim
  return mock
}

// GIT_DIR/GIT_WORK_TREE/GIT_INDEX_FILE 会把 git 引到别的仓库/工作树；GIT_CONFIG_PARAMETERS 与
// GIT_CONFIG_COUNT+GIT_CONFIG_KEY_<n>+GIT_CONFIG_VALUE_<n> 可注入任意 git 配置（core.excludesFile
// 等会改变 status 输出）；provenance 类 git 调用统一经本函数清理（与
// service-draft-converter/selfcheck-three-way.mjs 的 gitSafe 同语义，两处刻意各自持有运行副本、
// 不跨包共享实现；但 three-way 自检会 import 本模块做行为一致性钉——测试期硬依赖（缺失即
// ERR_MODULE_NOT_FOUND），单独打包/搬移 service-draft-converter 时必须连同本文件，或同步
// 移除该 import 钉）。
export function gitSafeEnv(env) {
  const clean = { ...(env ?? process.env) };
  for (const v of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_COMMON_DIR", "GIT_OBJECT_DIRECTORY", "GIT_ALTERNATE_OBJECT_DIRECTORIES", "GIT_NAMESPACE", "GIT_CONFIG_PARAMETERS", "GIT_CONFIG_COUNT", "GIT_EXEC_PATH"]) delete clean[v];
  for (const k of Object.keys(clean)) if (/^GIT_CONFIG_(KEY|VALUE)_\d+$/.test(k) || /^GIT_TRACE/.test(k)) delete clean[k];
  return clean;
}

// draft_view.ts drawGL issues scissor and viewport back-to-back once per frame (draft_view.ts:434-435).
// 本断言假设该 mock 上所有 viewport 调用都来自 drawGL 的帧级配对（2D 自检中 mock 仅供 draft_view），
// 要求两条调用日志全序列 1:1：计数相等且逐条同参，覆盖单帧漏调用与任意帧参数错配。
// 失败消息附带 drawArrays/drawElements 计数，便于区分「漏 scissor」与「多余 viewport」。
// 调用方传入的 assert 兼容 node:assert/strict。
export function assertScissorViewportPairing(mock, assert, label = '') {
  const prefix = label ? `${label}: ` : ''
  assert.ok(Array.isArray(mock.scissorCalls), `${prefix}pass the withScissor-instrumented mock (with .scissorCalls), not mock.gl or another wrapper`)
  const viewportCalls = mock.callsOf('viewport')
  const drawCount = mock.callsOf('drawArrays').length + mock.callsOf('drawElements').length
  assert.ok(viewportCalls.length > 0, `${prefix}viewport must be called at least once`)
  assert.ok(mock.scissorCalls.length > 0, `${prefix}inset scissor must be exercised, not shimmed away`)
  const divergeAt = Math.min(mock.scissorCalls.length, viewportCalls.length)
  assert.strictEqual(mock.scissorCalls.length, viewportCalls.length,
    `${prefix}scissor/viewport must pair 1:1 per frame (scissor=${mock.scissorCalls.length}, viewport=${viewportCalls.length}, drawCalls=${drawCount}, divergeAt=${divergeAt}, lastScissor=${JSON.stringify(mock.scissorCalls.at(-1))}, lastViewport=${JSON.stringify(viewportCalls.at(-1)?.args)}; 计数不配对 = scissor 漏调用或多余 viewport，非帧级 viewport 调用会破坏本前置假设，与同帧参数错配区分`)
  for (let i = 0; i < viewportCalls.length; ++i)
    assert.deepStrictEqual(mock.scissorCalls[i], Array.from(viewportCalls[i].args), `${prefix}scissor must match the viewport rect 1:1 at frame ${i}（参数同序；调用先后由 draft_view.ts:434-435 同帧背靠背结构保证，mock 未记录跨方法时序）`)
}
