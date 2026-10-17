// service-draft-converter 自检(node service-draft-converter/selfcheck.mjs):
//   ① 合成 DXF 用例(常开):主转换路径 + 契约 writer 自检 + 关键行为断言
//      (bulge 真读/%% 解码/堆叠线性化保空白/*D 展开/INSERT 变换/对账);
//   ② 黄金对照(DRAFT_GOLDEN_DWG + DRAFT_GOLDEN_PY 两个环境变量都给才跑):
//      本端转换 dwg ↔ Python 版包逐字段比对(浮点相对容差 1e-9,
//      末位 ULP 差异豁免——numpy 矩阵乘法结合序不可复刻,契约 I2 容差 1e-3 远在其上)。
// 敏感图纸不入库:黄金对照只读环境变量指向的本地文件,不复制、不落盘。
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { basename, join } from "node:path";
import { tmpdir } from "node:os";
import { svgFromPack, drawingTargetsFromPack } from './lib/svg.js';
import { convertDwgAsync } from './lib/worker.js';
import { convertDxfText } from "./lib/convert.js";
import { dwgToDxfText, libredwgVersion } from "./lib/dwg.js";
import { checkDraftPack } from "./lib/packcheck.js";

let passed = 0;
const ok = (name) => { passed++; console.log(`ok ${passed} - ${name}`); };

// ── 合成 DXF 夹具 ──
const HEADER = `0\nSECTION\n2\nHEADER\n9\n$INSUNITS\n70\n4\n9\n$LTSCALE\n40\n1.0\n0\nENDSEC\n`;
const TABLES = `0\nSECTION\n2\nTABLES\n0\nTABLE\n2\nLAYER\n70\n2\n`
    + `0\nLAYER\n2\n0\n70\n0\n62\n7\n6\nContinuous\n`
    + `0\nLAYER\n2\nA1\n70\n0\n62\n1\n6\nHIDDEN\n`
    + `0\nENDTAB\n`
    + `0\nTABLE\n2\nLTYPE\n70\n2\n`
    + `0\nLTYPE\n2\nContinuous\n70\n0\n3\nSolid line\n72\n65\n73\n0\n40\n0.0\n`
    + `0\nLTYPE\n2\nHIDDEN\n70\n0\n3\nHidden\n72\n65\n73\n2\n40\n9.525\n49\n6.35\n49\n-3.175\n`
    + `0\nENDTAB\n`
    + `0\nTABLE\n2\nSTYLE\n70\n1\n`
    + `0\nSTYLE\n2\nStandard\n70\n0\n40\n0.0\n41\n1.0\n71\n0\n42\n2.5\n3\ntxt\n4\n\n`
    + `0\nENDTAB\n`
    + `0\nTABLE\n2\nDIMSTYLE\n70\n1\n`
    + `0\nDIMSTYLE\n2\nStandard\n144\n1.0\n271\n2\n`
    + `0\nENDTAB\n0\nENDSEC\n`;
const BLK_OPEN = (name) => `0\nBLOCK\n5\n10\n330\n0\n100\nAcDbEntity\n8\n0\n100\nAcDbBlockBegin\n2\n${name}\n70\n0\n10\n0.0\n20\n0.0\n30\n0.0\n3\n${name}\n1\n\n`;
const wrap = (blocks, ents) => HEADER + TABLES
    + `0\nSECTION\n2\nBLOCKS\n${blocks}0\nENDSEC\n`
    + `0\nSECTION\n2\nENTITIES\n${ents}0\nENDSEC\n0\nEOF\n`;

/** 全项夹具:线/圆/弧/凸度多段线/点/文字(%%c)/MTEXT(堆叠)/SOLID/LEADER/DIMENSION(*D)/INSERT(缩放旋转)。 */
const STAR_D = BLK_OPEN("*D1")
    + `0\nLINE\n5\nD1A\n100\nAcDbEntity\n8\n0\n100\nAcDbLine\n10\n0.0\n20\n0.0\n30\n0.0\n11\n50.0\n21\n0.0\n31\n0.0\n`
    + `0\nMTEXT\n5\nD1B\n100\nAcDbEntity\n8\n0\n100\nAcDbMText\n10\n5.0\n20\n2.0\n30\n0.0\n40\n3.0\n71\n1\n1\n%%c32.015{\\S+0.005^ 0;}\n`
    + `0\nENDBLK\n8\n0\n`;
const BLK_B = BLK_OPEN("B1")
    + `0\nLINE\n5\nB1A\n100\nAcDbEntity\n8\nA1\n100\nAcDbLine\n10\n0.0\n20\n0.0\n30\n0.0\n11\n10.0\n21\n0.0\n31\n0.0\n`
    + `0\nCIRCLE\n5\nB1B\n100\nAcDbEntity\n8\n0\n100\nAcDbCircle\n10\n5.0\n20\n5.0\n30\n0.0\n40\n2.5\n`
    + `0\nATTDEF\n5\nB1C\n100\nAcDbEntity\n8\n0\n100\nAcDbText\n10\n0.0\n20\n0.0\n30\n0.0\n40\n2.0\n1\n提示\n2\nTAG1\n`
    + `0\nENDBLK\n8\n0\n`;
const ENTS
    = `0\nLINE\n5\n100\n100\nAcDbEntity\n8\n0\n100\nAcDbLine\n10\n0.0\n20\n0.0\n30\n0.0\n11\n100.0\n21\n0.0\n31\n0.0\n`
    + `0\nARC\n5\n101\n100\nAcDbEntity\n8\n0\n100\nAcDbCircle\n10\n50.0\n20\n50.0\n30\n0.0\n40\n25.0\n100\nAcDbArc\n50\n320.0\n51\n340.0\n`
    + `0\nLWPOLYLINE\n5\n102\n100\nAcDbEntity\n8\n0\n100\nAcDbPolyline\n90\n3\n70\n0\n10\n0.0\n20\n0.0\n42\n0.5\n10\n10.0\n20\n0.0\n42\n0.0\n10\n10.0\n20\n10.0\n`
    + `0\nPOINT\n5\n103\n100\nAcDbEntity\n8\n0\n100\nAcDbPoint\n10\n7.0\n20\n8.0\n30\n0.0\n`
    + `0\nTEXT\n5\n104\n100\nAcDbEntity\n8\n0\n100\nAcDbText\n10\n1.0\n20\n2.0\n30\n0.0\n40\n3.5\n1\n%%c10%%d\n50\n15.0\n`
    + `0\nMTEXT\n5\n105\n100\nAcDbEntity\n8\n0\n100\nAcDbMText\n10\n3.0\n20\n4.0\n30\n0.0\n40\n4.0\n71\n1\n1\n{\\fchineset;行一}\\P187.00{\\S 0^-0.01;}\n`
    + `0\nSOLID\n5\n106\n100\nAcDbEntity\n8\n0\n100\nAcDbTrace\n10\n0.0\n20\n0.0\n30\n0.0\n11\n10.0\n21\n0.0\n31\n0.0\n12\n0.0\n22\n10.0\n32\n0.0\n13\n10.0\n23\n10.0\n33\n0.0\n`
    + `0\nLEADER\n5\n107\n100\nAcDbEntity\n8\n0\n100\nAcDbLeader\n76\n2\n10\n0.0\n20\n0.0\n30\n0.0\n10\n20.0\n20\n20.0\n30\n0.0\n`
    + `0\nDIMENSION\n5\n432\n100\nAcDbEntity\n8\nDIM\n48\n0.2\n100\nAcDbDimension\n2\n*D1\n1\n\n42\n50.0\n70\n0\n10\n0.0\n20\n0.0\n30\n0.0\n13\n0.0\n23\n0.0\n33\n0.0\n14\n50.0\n24\n0.0\n34\n0.0\n280\n0\n`
    + `0\nINSERT\n5\n620\n100\nAcDbEntity\n8\n0\n100\nAcDbBlockReference\n2\nB1\n10\n100.0\n20\n200.0\n30\n0.0\n41\n2.0\n42\n2.0\n50\n90.0\n`;
const FIXTURE = wrap(STAR_D + BLK_B, ENTS);

// ── ① 合成用例 ──
const pack = convertDxfText(FIXTURE, { sourceName: "synthetic.dxf", sourceBytes: Buffer.from(FIXTURE) });
assert.equal(pack.format, "camind-draft-pack");
assert.equal(pack.self_check.reconciles, true);
assert.equal(pack.self_check.input_entities, pack.self_check.drawn_entities
    + Object.values(pack.self_check.dropped.by_type).reduce((a, b) => a + b, 0));
ok("合成夹具转换 + 对账");

const errs = checkDraftPack(pack, "writer");
assert.deepEqual(errs.filter(e => !e.startsWith("skipped:")), []);
ok("writer 档自检零错误");

const byType = {};
for (const e of pack.entities) byType[e.type] = (byType[e.type] ?? 0) + 1;
// 顶层:line×1 + dim 展开(*D line)×1 + INSERT 展开 line×1 = 3(ATTDEF 不出图)
assert.equal(byType.line, 3);
assert.equal(byType.circle, 1);
assert.equal(byType.arc, 1);
assert.equal(byType.polyline, 1);
assert.equal(byType.text, 1);   // 顶层 %%c10(*D 文字是 MTEXT)
assert.equal(byType.mtext, 2);  // 顶层 + *D 内
assert.equal(byType.point, 1);
assert.equal(byType.solid, 1);
assert.equal(byType.leader, 1);
ok(`类型分布 ${JSON.stringify(byType)}`);

// 凸度真读(分歧点①:Python 误取起点线宽;此处黄金不可区,按契约 §3 语义钉住正确行为)
const pl = pack.entities.find(e => e.type === "polyline" && e.verts.some(v => v.bulge));
assert.ok(pl, "凸度多段线应有 bulge");
assert.equal(pl.verts[0].bulge, 0.5);
ok("LWPOLYLINE bulge 真读");

// %% 解码
const t1 = pack.entities.find(e => e.type === "text" && e.handle === "104");
assert.equal(t1.text, "Ø10°");
ok("TEXT %%c/%%d 解码");

// MTEXT 堆叠线性化(空白保留)
const mt = pack.entities.find(e => e.type === "mtext");
assert.equal(mt.text, "行一\n187.00 0(-0.01)");
assert.equal(mt.rows.length, 2);
assert.equal(mt.rows[1].text, "187.00 0(-0.01)");
ok("MTEXT 剥码 + \\S 堆叠线性化(空白保留) + \\P 分行");

// INSERT 变换:块内 LINE(0,0)-(10,0) 缩放 2 旋转 90° 平移 (100,200) → (100,200)-(100,220)
// (包坐标 = 图纸坐标 − origin_offset,此处 off[1]=−4 来自 MTEXT 行段下探)
const off = pack.origin_offset;
const il = pack.entities.find(e => e.handle.startsWith("620/") && e.type === "line");
assert.ok(il, "INSERT 展开子实体在");
assert.ok(Math.abs(il.a[0] - (100 - off[0])) < 1e-6 && Math.abs(il.a[1] - (200 - off[1])) < 1e-6, `起点 ${il.a} off ${off}`);
assert.ok(Math.abs(il.b[0] - (100 - off[0])) < 1e-6 && Math.abs(il.b[1] - (220 - off[1])) < 1e-6, `终点 ${il.b}`);
const ic = pack.entities.find(e => e.handle.startsWith("620/") && e.type === "circle");
assert.equal(ic.r, 5.0); // 2.5 × 2
ok("INSERT 缩放/旋转/平移变换");

// 顶层弧不归一(320° 保持正值弧度)
const arc = pack.entities.find(e => e.type === "arc");
assert.ok(arc.start > 5.5 && arc.start < 5.6, `顶层弧 start ${arc.start}`);
ok("顶层弧角度不归一");

// DIMENSION:*D 展开 + display_text 权威(*D MTEXT 文字优先,plain_mtext+堆叠线性化)
assert.equal(pack.dims.length, 1);
const dim = pack.dims[0];
assert.equal(dim.id, "D432");
assert.equal(dim.display_text, "Ø32.015+0.005( 0)");
assert.equal(dim.measured, 50);
assert.equal(dim.dimlfac, 1);
assert.deepEqual(dim.tolerance, {}); // 48 在 AcDbEntity 段 = ltscale,不是 dimtm
assert.ok(dim.entity_ids.length === 2);
ok("DIMENSION *D 展开 + 语义层(子类标记纪律)");

// 出身/单位/附件字段
assert.equal(pack.origin.channel, "unknown");
assert.equal(pack.source_units, "mm");
assert.equal(pack.unit_factor, 1);
ok("出身/单位");

// Dimension Defpoints are construction helpers; visible points on other layers remain unsupported.
{
    const dimension = `0\nDIMENSION\n5\n500\n100\nAcDbEntity\n8\n0\n100\nAcDbDimension\n2\n*D2\n70\n0\n42\n10\n`;
    const points = ['Defpoints', 'VISIBLE'].map((layer, i) => `0\nPOINT\n5\nP${i}\n100\nAcDbEntity\n8\n${layer}\n100\nAcDbPoint\n10\n${i}\n20\n0\n30\n0\n`).join('');
    const block = BLK_OPEN('*D2') + `0\nLINE\n5\nL2\n100\nAcDbEntity\n8\n0\n100\nAcDbLine\n10\n0\n20\n0\n11\n10\n21\n0\n` + points + `0\nENDBLK\n8\n0\n`;
    const result = convertDxfText(wrap(block, dimension));
    assert.equal(result.self_check.dropped.by_reason.ignored_dimension_defpoint, 1);
    assert.equal(result.self_check.dropped.by_reason.unsupported_block_entity, 1);
    assert.equal(result.self_check.reconciles, true);
    ok('标注辅助点与可见 POINT 分开统计');
}

// ② 拒绝路径:坏 dim 引用被 packcheck 拒
{
    const bad = JSON.parse(JSON.stringify(pack));
    bad.entities[0].dim_id = "D-NOPE";
    const errs2 = checkDraftPack(bad, "writer");
    assert.ok(errs2.some(e => e.startsWith("DRAFT_E_DIM_REF")), errs2.join(";"));
    ok("packcheck I9 正向拒绝");
}
// dims 载荷形状:writer/reader 都拒绝，不能只在反向引用闭合时顺带检查。
for (const profile of ["writer", "reader"]) {
    const bad = JSON.parse(JSON.stringify(pack));
    bad.dims[0].def_points = [[0, 0], [1, "bad"]];
    bad.dims[0].dimlfac = "1.0";
    const dimErrs = checkDraftPack(bad, profile);
    assert.ok(dimErrs.some(e => e.startsWith("DRAFT_E_SHAPE") && e.includes("def_points")), dimErrs.join(";"));
    assert.ok(dimErrs.some(e => e.startsWith("DRAFT_E_SHAPE") && e.includes("dimlfac")), dimErrs.join(";"));

    const badIds = JSON.parse(JSON.stringify(pack));
    badIds.dims[0].entity_ids = [-1];
    const idErrs = checkDraftPack(badIds, profile);
    assert.ok(idErrs.some(e => e.startsWith("DRAFT_E_SHAPE") && e.includes("entity_ids")), idErrs.join(";"));
}
ok("packcheck dims 载荷 writer/reader 双档拒绝");

// 未知类型:writer 拒 / reader 跳
{
    const bad = JSON.parse(JSON.stringify(pack));
    bad.entities[0].type = "mleader3d";
    assert.ok(checkDraftPack(bad, "writer").some(e => e.startsWith("DRAFT_E_UNKNOWN_TYPE")));
    assert.ok(checkDraftPack(bad, "reader").some(e => e.startsWith("skipped:")));
    ok("packcheck 两档严格度");
}

// SVG semantics: rotation, no background entity, simple dash/gap scale and escaping.
{
    const svg = svgFromPack({ ...pack, ltscale: 2, linetypes: { HIDDEN: { pattern: [3, -1] } }, entities: [
        { type: 'text', p: [0, 0], h: 3, text: '<90°>', rot: Math.PI / 2, color: { aci: 5 } },
        { type: 'line', a: [0, 0], b: [10, 0], linetype: { name: 'HIDDEN', scale: 0.5 } },
    ] });
    assert(svg.includes('rotate(-90.000 0 0)'));
    assert(svg.includes('&lt;90°&gt;'));
    assert(svg.includes('stroke-dasharray="3 1"'));
    assert(!svg.includes('<rect'));
    ok('SVG 文字旋转、转义、虚线与背景边界');
}

// Search and rendered geometry share ids; identical text is never merged or matched by proximity.
{
    const targets = drawingTargetsFromPack(pack), dimension = targets.find(t => t.kind === 'dimension');
    assert.deepEqual(dimension.entity_ids, pack.dims[0].entity_ids);
    assert.equal(targets.filter(t => t.kind === 'dimension').length, pack.dims.length);
    const svg = svgFromPack(pack);
    for (const target of targets) for (const id of target.entity_ids) assert(svg.includes(`id="dwg-e-${id}"`));
    const duplicates = drawingTargetsFromPack({ ...pack, dims: [], entities: [
        { id: 1, type: 'text', text: '85', handle: 'a' }, { id: 2, type: 'text', text: '85', handle: 'b' },
    ] });
    assert.equal(duplicates.length, 2); assert.notEqual(duplicates[0].id, duplicates[1].id);
    ok('同源目标索引、尺寸分组和重复文字隔离');
}

// A slow CLI runs in a worker: the host heartbeat must keep progressing.
if (process.platform !== 'win32') {
    const dir = mkdtempSync(join(tmpdir(), 'camind-worker-check-'));
    let ticks = 0;
    const timer = setInterval(() => ticks++, 5);
    try {
        const source = join(dir, 'source.dwg'), fixture = join(dir, 'fixture.dxf'), bin = join(dir, 'dwg2dxf');
        writeFileSync(source, 'AC1027'); writeFileSync(fixture, FIXTURE);
        writeFileSync(bin, `#!${process.execPath}\nimport fs from 'node:fs';\nif(process.argv.includes('--version')) console.log('synthetic'); else { await new Promise(r=>setTimeout(r,80)); fs.copyFileSync(${JSON.stringify(fixture)},process.argv[process.argv.indexOf('-o')+1]); }`, { mode: 0o700 });
        const result = await convertDwgAsync(source, { dwg2dxfPath: bin, timeoutMs: 2000 });
        assert.equal(result.self_check.reconciles, true);
        assert(ticks > 5, 'Host must remain responsive while conversion waits');
        await assert.rejects(convertDwgAsync(source, { dwg2dxfPath: join(dir, 'missing') }), /未找到/);
        await assert.rejects(convertDwgAsync(source, { dwg2dxfPath: bin, timeoutMs: 10 }));
        ok('异步转换成功、宿主心跳、缺工具与超时拒绝');
    } finally { clearInterval(timer); rmSync(dir, { recursive: true, force: true }); }
}

// ③ 黄金对照(环境变量给齐才跑)
const G_DWG = process.env.DRAFT_GOLDEN_DWG;
const G_PY = process.env.DRAFT_GOLDEN_PY;
if (G_DWG && G_PY) {
    const dxfText = dwgToDxfText(G_DWG, {});
    const mine = convertDxfText(dxfText, {
        sourceName: basename(G_DWG),
        sourceBytes: readFileSync(G_DWG),
        libredwgVersion: libredwgVersion({}),
    });
    const golden = JSON.parse(readFileSync(G_PY, "utf8"));
    let n = 0;
    const walk = (pa, x, y) => {
        if (typeof x === "number" && typeof y === "number") {
            const tol = Math.max(1e-9 * Math.max(Math.abs(x), Math.abs(y)), 1e-12);
            assert.ok(Math.abs(x - y) <= tol, `${pa}: ${x} vs ${y}`);
            return;
        }
        if (Array.isArray(x) && Array.isArray(y)) {
            assert.equal(x.length, y.length, `${pa}.length`);
            x.forEach((u, i) => walk(`${pa}[${i}]`, u, y[i]));
            return;
        }
        if (x && y && typeof x === "object") {
            const ka = Object.keys(x).sort(), kb = Object.keys(y).sort();
            assert.deepEqual(ka, kb, `${pa} keys`);
            for (const k of ka) walk(`${pa}.${k}`, x[k], y[k]);
            return;
        }
        assert.deepEqual(x, y, pa);
    };
    for (const k of Object.keys(golden)) {
        if (k === "conversion") continue; // 工具身份如实标注,不比
        n++;
        if (k === 'self_check') {
            // Python records Defpoints as unsupported; only their preview classification differs.
            const normalized = structuredClone(mine[k]), reasons = normalized.dropped.by_reason;
            const helpers = reasons.ignored_dimension_defpoint ?? 0;
            if (helpers) { reasons.unsupported_block_entity = (reasons.unsupported_block_entity ?? 0) + helpers; delete reasons.ignored_dimension_defpoint; }
            walk(k, normalized, golden[k]);
        } else walk(k, mine[k], golden[k]);
    }
    ok(`黄金对照(${basename(G_DWG)},${n} 个顶层字段,浮点 1e-9)`);
} else {
    console.log("skip - 黄金对照(设 DRAFT_GOLDEN_DWG 与 DRAFT_GOLDEN_PY 启用)");
}

console.log(`\nselfcheck 完成:${passed} 项通过`);
