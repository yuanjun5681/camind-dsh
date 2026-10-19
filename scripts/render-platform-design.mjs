/**
 * 同步平台设计离线阅读版：正文来自 Markdown，关系图复用架构 HTML 的内联 SVG。
 * 只支持本文使用的标题、段落、引用、列表和表格；不执行或透传原始 HTML。
 */
import assert from 'node:assert/strict'
import { readFile, writeFile, rename, unlink } from 'node:fs/promises'

const documentUrl = new URL('../docs/camind-platform-design.md', import.meta.url)
const pageUrl = new URL('../docs/camind-platform-design.html', import.meta.url)
const architectureUrl = new URL('../docs/camind-platform-architecture.html', import.meta.url)
const escape = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;')
const decode = text => text.replaceAll('&#39;', "'").replaceAll('&quot;', '"').replaceAll('&gt;', '>').replaceAll('&lt;', '<').replaceAll('&amp;', '&')

function render(markdown, svg) {
  const lines = markdown.trimEnd().split('\n')
  const blocks = []
  let html = '', section = false
  const block = (tag, text, attrs = '') => {
    blocks.push(text)
    return `<${tag} data-source-block="${blocks.length}"${attrs}>${escape(text)}</${tag}>`
  }
  const cells = line => line.slice(1, -1).split('|').map(cell => cell.trim())
  for (let i = 0; i < lines.length;) {
    const line = lines[i]
    if (!line.trim()) { i++; continue }
    const heading = /^(#{1,3}) (.+)$/.exec(line)
    if (heading) {
      const level = heading[1].length, text = heading[2]
      if (level === 2) {
        const number = /^(\d+)\. /.exec(text)?.[1]
        assert.ok(number, `章节缺编号：${text}`)
        if (section) html += '</section>'
        html += `<section id="sec-${number}" aria-labelledby="sec-${number}-heading">`
        section = true
        html += block('h2', text, ` id="sec-${number}-heading"`)
        if (number === '2') html += `<figure data-enhancement="topology" class="enhancement"><figcaption>系统关系图 <a class="diagram-open" href="camind-platform-architecture.html" target="_blank" rel="noopener">打开独立架构图 ↗</a><span>生成示意 · 默认完整缩放，细节可打开独立架构图查看</span></figcaption><div class="figure-scroll" tabindex="0" aria-label="系统关系图，按正文宽度完整缩放">${svg}</div></figure>`
      } else html += block(`h${level}`, text)
      i++; continue
    }
    if (line.startsWith('|')) {
      assert.ok(/^\|(?:\s*:?-+:?\s*\|)+$/.test(lines[i + 1] ?? ''), '表格缺分隔行')
      const headers = cells(line)
      html += '<div class="table-scroll" tabindex="0" role="region" aria-label="设计表格，可横向滚动"><table><thead><tr>'
      html += headers.map(text => block('th', text, ' scope="col"')).join('') + '</tr></thead><tbody>'
      i += 2
      while (i < lines.length && lines[i].startsWith('|')) {
        const row = cells(lines[i++])
        assert.equal(row.length, headers.length, '表格列数不一致')
        html += '<tr>' + row.map(text => block('td', text)).join('') + '</tr>'
      }
      html += '</tbody></table></div>'; continue
    }
    const list = /^(?:\d+\. |- )(.+)$/.exec(line)
    if (list) {
      const ordered = /^\d/.test(line), tag = ordered ? 'ol' : 'ul'
      const pattern = ordered ? /^\d+\. (.+)$/ : /^- (.+)$/
      html += `<${tag} class="source-list">`
      while (i < lines.length && pattern.test(lines[i])) html += block('li', pattern.exec(lines[i++])[1])
      html += `</${tag}>`; continue
    }
    if (line.startsWith('> ')) {
      html += block('p', line.slice(2), ' class="document-status"'); i++; continue
    }
    assert.ok(!/^[#>|`~ \t]/.test(line), `不支持的 Markdown 块：${line}`)
    const paragraph = [line]
    i++
    while (i < lines.length && lines[i].trim()) {
      assert.ok(!/^(?:[#>|`~ \t]|- |\d+\. )/.test(lines[i]), '块之间需空行')
      paragraph.push(lines[i++])
    }
    html += block('p', paragraph.join('\n'))
  }
  if (section) html += '</section>'
  return { html, blocks }
}

const markdown = await readFile(documentUrl, 'utf8')
const page = await readFile(pageUrl, 'utf8')
const architecture = await readFile(architectureUrl, 'utf8')
const svgs = architecture.match(/<svg\b[\s\S]*?<\/svg>/g)
assert.equal(svgs?.length, 1, '架构页必须有一张内联 SVG')
const rendered = render(markdown, svgs[0])
assert.equal((page.match(/<article id="source-content">/g) ?? []).length, 1)
let output = page.replace(/<article id="source-content">[\s\S]*?<\/article>/, `<article id="source-content">${rendered.html}</article>`)
output = output.replace('系统关系图与版本路线为生成示意，其余正文按原文呈现。', '系统关系图为生成示意，与架构图共用；其余正文按原文呈现。')
output = output.replace('Camind 平台设计：云端 NX、设备协作、Bot APP、公共资源与版本自进化。离线阅读版。', 'Camind 平台设计：多租户服务、NX 工作台集群、现场支持闭环、设备协作与可选终端。离线阅读版。')
// 内嵌概览按正文宽度完整显示，独立架构页保留大图查看方式。
const diagramStyles = '/* Shared architecture diagram */\n.figure-scroll svg{min-width:0;width:100%;height:auto}.figure-scroll{background:#f8f8f2}.diagram-open{display:inline-block;margin-left:12px;font-size:12px;color:#cce5ef}@media print{.diagram-open{display:none}}\n'
output = output.includes('/* Shared architecture diagram */')
  ? output.replace(/\/\* Shared architecture diagram \*\/[\s\S]*?(?=<\/style>)/, diagramStyles)
  : output.replace('</style>', diagramStyles + '</style>')

// 保真断言：每个标题、段落、列表项及表格单元格按原顺序逐字保留。
const source = output.match(/<article id="source-content">([\s\S]*?)<\/article>/)[1]
const actual = [...source.matchAll(/<(h[123]|p|li|th|td) data-source-block="(\d+)"[^>]*>([\s\S]*?)<\/\1>/g)]
assert.deepEqual(actual.map(match => decode(match[3])), rendered.blocks)
assert.deepEqual(actual.map(match => Number(match[2])), rendered.blocks.map((_, i) => i + 1))
assert.deepEqual([...source.matchAll(/<section id="sec-(\d+)"/g)].map(match => Number(match[1])), [1,2,3,4,5,6,7,8,9,10])
assert.equal(escape('<script>"&'), '&lt;script&gt;&quot;&amp;')
assert.throws(() => render('# Title\n\n```js\nalert(1)\n```', ''))
assert.throws(() => render('| A | B |\n| --- | --- |\n| only |', ''))
for (const text of ['NX 工作台集群', '队列', '路由', '云端支持 Agent', '租户', '可选现场状态终端', '候选']) {
  assert.ok(output.includes(text) && architecture.includes(text), `两份 HTML 缺少：${text}`)
}
assert.ok(!/作业依次处理|ESP32 正确显示状态|云端 NX 执行端/.test(output + architecture))
const ids = [...output.matchAll(/\bid="([^"]+)"/g)].map(match => match[1])
assert.equal(new Set(ids).size, ids.length, 'HTML ID 重复')
for (const match of output.matchAll(/href="#([^"]+)"/g)) assert.ok(ids.includes(match[1]), `失效锚点：${match[1]}`)
assert.ok(!/<(?:script|link|img)\b[^>]*(?:src|href)="https?:/i.test(output + architecture), '不应加载外部资源')

if (process.argv.includes('--check')) {
  assert.equal(page, output, '阅读版过期：运行 node scripts/render-platform-design.mjs')
} else {
  const temporary = new URL(pageUrl.href + '.tmp')
  try {
    await writeFile(temporary, output)
    await rename(temporary, pageUrl)
  } finally {
    await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error })
  }
}
console.log(`平台设计${process.argv.includes('--check') ? '检查' : '同步'}通过：${rendered.blocks.length} 个原文块、10 章、共用架构图。`)
