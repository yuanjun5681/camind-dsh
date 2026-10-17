// 转换核心:DXF 文档 → 契约 r4 v1 图纸包(camind-draft-pack)。
// dwg_to_draft_v1.py 的移植;已知分歧见 README（含仅影响预览状态的辅助点分类）:
//   ① LWPOLYLINE 的 bulge 读真实凸度字段(Python pts_payload 误取起点线宽 v[2];
//      无线宽/无凸度输入下输出与 Python 逐字节一致)——契约 §3 的凸度语义靠它;
//   ② conversion.tool/commit 如实标注 TS 版身份(契约允许,码表不变)。
// 出包前内嵌 packcheck writer 档自检,坏包抛出拒写(同 Python 退 1 纪律)。

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { aciToRgb } from "./aci.js";
import { parseDxf } from "./dxfparse.js";
import {
    matIdentity, matCompose, matFromInsert, transformEntity, mtextRaw,
    flattenSpline, flattenEllipse, SPLINE_CHORD,
} from "./expand.js";
import { hatchPayload, HATCH_MAX_SEGS } from "./hatch.js";
import { decodeText, plainMtextFull, linearize, MTEXT_CODES } from "./text.js";
import { checkDraftPack } from "./packcheck.js";

const INSUNITS = { 0: ["unknown", 1.0], 1: ["inch", 25.4], 2: ["foot", 304.8], 4: ["mm", 1.0],
    5: ["cm", 10.0], 6: ["m", 1000.0], 8: ["microinch", 25.4e-6], 9: ["mil", 0.0254] };
const NX_VERSION_GUID = "{FAEB1C32-E019-11D5-929B-00C0DF256EC4}";
export const PIPELINE_VERSION = "dr-1";
export const RULES_VERSION = "sem-rules-0";
export const VIEW_RULE_VERSION = "view-rules-0";
const TOL_FRAME_H = 6.0, TOL_CELL_W = 10.0;

const round3 = (v) => Math.round(v * 1000) / 1000;
const round6 = (v) => Math.round(v * 1e6) / 1e6;

// ── 计数器(self_check 两切面 + 颜色对账 + missing;audit 残账即对账差)──
class Counters {
    constructor() {
        this.input_entities = 0;
        this.drawn_entities = 0;
        this.insert_exploded = 0;
        this.star_d_exploded = 0;
        this.by_type = {};
        this.by_reason = {};
        this.byblock_fallback = 0;
        this.truecolor_count = 0;
        this.extra_colors = {};
        this.missing = { xref: [], ole: [], image: [], proxy: [], three_d_solid: [], other: [] };
        this.audit = [];
        this.dim_found = 0;
        this.dim_parsed = 0;
    }
    addInput(tag) { this.audit.push(tag); this.input_entities++; }
    settle() { if (this.audit.length) this.audit.pop(); } // emit 销账
    drop(etype, reason) {
        if (this.audit.length) this.audit.pop();
        this.by_type[etype] = (this.by_type[etype] ?? 0) + 1;
        this.by_reason[reason] = (this.by_reason[reason] ?? 0) + 1;
    }
    noteMissing(bucket, handle, kind, reason) {
        this.missing[bucket].push({ handle, kind, reason });
    }
    asDict() {
        const total = Object.values(this.by_type).reduce((a, b) => a + b, 0);
        return {
            input_entities: this.input_entities,
            drawn_entities: this.drawn_entities,
            insert_exploded: this.insert_exploded,
            star_d_exploded: this.star_d_exploded,
            dropped: { by_type: this.by_type, by_reason: this.by_reason },
            reconciles: this.input_entities === this.drawn_entities + total && !this.audit.length,
            byblock_fallback: this.byblock_fallback,
            truecolor_count: this.truecolor_count,
            extra_colors: this.extra_colors,
        };
    }
}

// ── 颜色判序(契约 §3:420 真彩先于 ByLayer;ByBlock 沿 INSERT 链栈继承)──
class ColorResolver {
    constructor(layerAci, layerRgb, counters) {
        this.layerAci = layerAci;   // name → aci(1..255)
        this.layerRgb = layerRgb;   // name → 0xRRGGBB
        this.c = counters;
        this.ctxStack = [];         // INSERT 宿主解析色栈
    }
    resolve(e) {
        const tc = e.trueColor;
        if (tc !== null && tc !== undefined) {
            this.c.truecolor_count++;
            return { aci: -1, raw: 0x01000000 | Number(tc), rgb: Number(tc) & 0xFFFFFF };
        }
        const raw = e.color === undefined || e.color === null ? 256 : Math.trunc(Number(e.color));
        const layer = e.layer ?? "0";
        if (raw === 0) { // ByBlock
            if (this.ctxStack.length) {
                const host = this.ctxStack[this.ctxStack.length - 1];
                if (host.aci === -1) {
                    this.c.truecolor_count++;
                    return { aci: -1, raw: 0, rgb: host.rgb };
                }
                if (Number.isInteger(host.aci) && host.aci >= 1 && host.aci <= 255) {
                    return { aci: host.aci, raw: 0 };
                }
                if (host.layer) {
                    const lrgb = this.layerRgb[host.layer];
                    if (lrgb) {
                        this.c.truecolor_count++;
                        return { aci: -1, raw: 0, rgb: lrgb };
                    }
                    const aci = (Math.abs(this.layerAci[host.layer] ?? 7) & 0xFF) || 7;
                    return { aci, raw: 0 };
                }
            }
            this.c.byblock_fallback++;
            return { aci: 7, raw: 0 };
        }
        let aci;
        if (raw === 256) { // ByLayer:层真彩路径
            const lrgb = this.layerRgb[layer];
            if (lrgb) {
                this.c.truecolor_count++;
                return { aci: -1, raw, rgb: lrgb };
            }
            aci = (Math.abs(this.layerAci[layer] ?? 7) & 0xFF) || 7;
        } else {
            aci = raw > 255 ? raw & 0xFF : raw;
        }
        aci = Math.max(1, Math.min(255, aci));
        if (!(aci >= 1 && aci <= 9)) {
            const key = String(aci);
            this.c.extra_colors[key] = (this.c.extra_colors[key] ?? 0) + 1;
        }
        return { aci, raw };
    }
}

/** 主入口:DXF 文本 → 图纸包对象。opts: { sourceName, sourceBytes, libredwgVersion }。 */
export function convertDxfText(text, opts = {}) {
    const doc = parseDxf(text);
    return buildPack(doc, opts);
}

function buildPack(doc, opts) {
    const c = new Counters();

    // ── 层/线型/样式/单位表(契约 §1)──
    const layers = {};
    for (const [name, l] of doc.layers) {
        const rgb = l.trueColor ? Number(l.trueColor) : null;
        const aci = Math.abs(Math.trunc(l.color)) & 0xFF;
        const entry = {
            aci: rgb ? -1 : (aci || 7),
            off: l.color < 0,
            frozen: (l.flags & 1) !== 0,
            plot: !!l.plot,
        };
        if (rgb) entry.rgb = rgb & 0xFFFFFF;
        if (l.linetype) entry.linetype = l.linetype;
        entry.lineweight = l.lineweight >= 0 ? { value: l.lineweight } : { sentinel: l.lineweight };
        layers[name] = entry;
    }
    const layerLtype = Object.fromEntries(
        Object.entries(layers).map(([n, e]) => [n, e.linetype ?? "Continuous"]));
    const layerAci = Object.fromEntries(Object.entries(layers).map(([n, e]) => [n, e.aci === -1 ? 7 : e.aci]));
    const layerRgb = Object.fromEntries(
        Object.entries(layers).filter(([, e]) => "rgb" in e).map(([n, e]) => [n, e.rgb]));

    const linetypes = {};
    for (const [name, lt] of doc.linetypes) {
        const dashes = lt.pattern.map(v => Math.round(Number(v) * 10000) / 10000);
        let kind = "simple";
        for (const v of [...lt.shapes, ...lt.texts]) {
            if ((Math.trunc(Number(v) || 0) & 6) !== 0) { kind = "complex"; break; }
        }
        linetypes[name] = {
            pattern: dashes, kind,
            ...(kind === "complex" && dashes.length ? { simple_fallback: dashes } : {}),
        };
    }

    const textStyles = {};
    for (const [name, st] of doc.styles) {
        const wf = Number(st.widthFactor) || 1;
        const font = String(st.font ?? "");
        const kind = !font ? "empty" : (/\.(ttf|otf)$/i.test(font) ? "ttf" : "shx");
        textStyles[name] = {
            font, width_factor: wf, kind,
            ...(st.bigfont ? { bigfont: String(st.bigfont) } : {}),
        };
    }

    let insunits = 0;
    try { insunits = Math.trunc(Number(doc.header.get("$INSUNITS") ?? 0)) || 0; } catch { insunits = 0; }
    const [sourceUnits, factor] = INSUNITS[insunits] ?? ["unknown", 1.0];
    const otherPending = [];
    if (insunits === 0) {
        otherPending.push({ handle: "", kind: "units", reason: "$INSUNITS=0 无单位声明,按 mm 处理" });
    }
    let ltscale = 1.0;
    try { ltscale = Number(doc.header.get("$LTSCALE")) || 1.0; } catch { ltscale = 1.0; }

    const resolver = new ColorResolver(layerAci, layerRgb, c);
    const entities = [];
    const dims = [];
    const seq = { n: 0 };

    const handleOf = (h, chain = "") => {
        let hh = h || "";
        if (!hh || hh === "None") { seq.n++; hh = `v${seq.n}`; }
        return chain ? `${chain}/${hh}` : hh;
    };

    // ── emit ──
    const emit = (v, etype, payload, handle, dimId = null) => {
        try {
            const col = resolver.resolve(v);
            const lt = { name: v.linetype ?? "BYLAYER", scale: Number(v.ltscale) || 1.0 };
            const ref = layerLtype[v.layer ?? "0"];
            if (["BYLAYER", "BYBLOCK"].includes(lt.name.toUpperCase()) && ref) lt.name = ref;
            const ent = {
                id: entities.length, type: etype, layer: v.layer ?? "0", view_id: 0,
                color: col, linetype: lt,
                lineweight: (v.lineweight !== undefined && Number.isFinite(Number(v.lineweight)))
                    ? (Number(v.lineweight) >= 0 ? { value: Math.trunc(Number(v.lineweight)) } : { sentinel: Math.trunc(Number(v.lineweight)) })
                    : { sentinel: -3 },
                handle, ...payload,
            };
            if (dimId) ent.dim_id = dimId;
            entities.push(ent);
            c.drawn_entities++;
            c.settle();
        } catch (ex) {
            if (!globalThis.__draftEmitDbg) {
                globalThis.__draftEmitDbg = 1; // Python 同款:[首个实体异常] 打 stderr
                console.error(`[首个实体异常] ${etype}: ${ex.constructor.name}: ${ex.message}\n${ex.stack}`);
            }
            c.drop(etype, `exception:${ex.constructor.name}`);
        }
    };

    // ── 文本载荷 ──
    const entityText = (v) => {
        if (v.type === "MTEXT") return plainMtextFull(v.text ?? "") || "";
        return String(v.text ?? "");
    };

    const textPayload = (v) => {
        const p = v.insert ?? v.alignPoint ?? null;
        const h = Number(v.height) || 2.5;
        const rot = round6((Number(v.rotation) || 0) * Math.PI / 180);
        const out = {
            p: p ? [Number(p[0]), Number(p[1])] : [0.0, 0.0],
            h, text: decodeText(v.text ?? ""), rot,
            style: String(v.style ?? "Standard") || "Standard",
        };
        const halign = v.halign ?? 0, valign = v.valign ?? 0;
        if (halign || valign) {
            out.halign = halign; out.valign = valign;
            out.align_point = v.alignPoint ? [Number(v.alignPoint[0]), Number(v.alignPoint[1])] : [0.0, 0.0];
        }
        return out;
    };

    const mtextPayload = (v) => {
        const p = v.insert;
        const h = Number(v.charHeight) || 2.5;
        const rot = round6((Number(v.rotation) || 0) * Math.PI / 180);
        const style = String(v.style ?? "Standard") || "Standard";
        const attach = Math.trunc(Number(v.attachment)) || 1;
        const defWidth = Number(v.width) || 0;
        let raw;
        try { raw = plainMtextFull(v.text ?? ""); } catch { raw = String(v.text ?? ""); }
        const lineSrcs = raw.split("\n").map(ln => ln.trim()).filter(ln => ln);
        const nRows = lineSrcs.length;
        const blockH = nRows * h;
        const rowKind = Math.floor((attach - 1) / 3);
        const col = (attach - 1) % 3;
        let x = p[0];
        if ((col === 1 || col === 2) && defWidth) x -= col === 1 ? defWidth / 2 : defWidth;
        const baseDelta = rowKind === 0 ? -h : (rowKind === 1 ? blockH / 2 - h : blockH - h);
        const rows = lineSrcs.map((line, li) => {
            const d = -baseDelta + li * h;
            const wx = d * Math.sin(rot), wy = -d * Math.cos(rot);
            return { p: [round3(x + wx), round3(p[1] + wy)], text: line };
        });
        const out = {
            p: [Number(p[0]), Number(p[1])], h, text: raw, rot: round6(rot),
            style, attach, rows,
        };
        if (defWidth) out.def_width = defWidth;
        return out;
    };

    const ptsPayload = (verts) => verts.map(v => ({
        x: Number(v.x), y: Number(v.y),
        ...(v.bulge ? { bulge: Number(v.bulge) } : {}),
    }));

    const tolerancePayload = (v) => {
        const text = String(v.content ?? "");
        const parts = text.split("%%v").filter(t => t);
        const rawParts = parts.length ? parts : [text || " "];
        const rawLines = rawParts.map(part => {
            const lns = part.split("^J").filter(ln => ln);
            return lns.length ? lns : [""];
        });
        const [x0, y0] = v.insert ?? [0, 0];
        const frame = [
            [x0, y0, x0 + TOL_CELL_W * 2, y0],
            [x0 + TOL_CELL_W * 2, y0, x0 + TOL_CELL_W * 2, y0 + TOL_FRAME_H],
            [x0 + TOL_CELL_W * 2, y0 + TOL_FRAME_H, x0, y0 + TOL_FRAME_H],
            [x0, y0 + TOL_FRAME_H, x0, y0],
        ];
        const cells = [];
        rawLines.forEach((lineParts, li) => {
            const yy = y0 + li * TOL_FRAME_H;
            let cx = x0;
            for (let t of lineParts) {
                t = t.replace(/\{\\F[^;}]*;([^}]*)\}/g, "$1");
                cells.push({ p: [round3(cx + 1.0), round3(yy + 1.0)], h: TOL_FRAME_H - 2.0,
                    text: t, rot: 0.0, style: "Standard" });
                cx += Math.max(TOL_CELL_W, TOL_FRAME_H * Math.max(1, t.length) * 0.62);
            }
        });
        return { frame_segs: frame.map(([a, b, c2, d]) => [round3(a), round3(b), round3(c2), round3(d)]), cells };
    };

    // ── 普通实体分派 ──
    const dispatch = (v, t, h, chain, dimId) => {
        if (t === "LINE") {
            emit(v, "line", { a: [v.start[0], v.start[1]], b: [v.end[0], v.end[1]] }, h, dimId);
        } else if (t === "CIRCLE") {
            emit(v, "circle", { c: [v.center[0], v.center[1]], r: round3(Number(v.radius)) }, h, dimId);
        } else if (t === "ARC") {
            emit(v, "arc", { c: [v.center[0], v.center[1]], r: Number(v.radius),
                start: round6(Number(v.startAngle) * Math.PI / 180),
                end: round6(Number(v.endAngle) * Math.PI / 180) }, h, dimId);
        } else if (t === "LWPOLYLINE" || t === "POLYLINE") {
            emit(v, "polyline", { verts: ptsPayload(v.verts), closed: !!v.closed }, h, dimId);
        } else if (t === "SPLINE") {
            const pts = flattenSpline(v.spline, SPLINE_CHORD);
            emit(v, "polyline", {
                verts: pts.map(([x, y]) => ({ x: round6(x), y: round6(y) })),
                closed: !!v.spline.closed, source_type: "spline" }, h, dimId);
        } else if (t === "ELLIPSE") {
            const pts = flattenEllipse(v.ellipse, SPLINE_CHORD);
            const sp = Number(v.ellipse.startParam), ep = Number(v.ellipse.endParam);
            const closed = Math.abs(Math.abs(ep - sp) - 2 * Math.PI) < 1e-6;
            emit(v, "polyline", {
                verts: pts.map(([x, y]) => ({ x: round6(x), y: round6(y) })),
                closed, source_type: "ellipse" }, h, dimId);
        } else if (t === "POINT") {
            emit(v, "point", { p: [v.location[0], v.location[1]] }, h, dimId);
        } else if (t === "HATCH") {
            emit(v, "hatch", hatchPayload(v.hatch), h, dimId);
        } else if (t === "SOLID") {
            const raw = [v.solidPts[0], v.solidPts[1], v.solidPts[3], v.solidPts[2]]; // 蝶形序 1-2-4-3
            let pts = raw.filter(p => p != null).map(p => [round3(p[0]), round3(p[1])]);
            if (pts.length > 2 && pts[pts.length - 1][0] === pts[pts.length - 2][0]
                && pts[pts.length - 1][1] === pts[pts.length - 2][1]) pts = pts.slice(0, -1);
            emit(v, "solid", { points: pts }, h, dimId);
        } else if (t === "TEXT" || t === "ATTRIB") {
            emit(v, "text", textPayload(v), h, dimId);
        } else if (t === "MTEXT") {
            const payload = mtextPayload(v);
            if (!payload.rows.length) { c.drop(t, "empty_mtext"); return; }
            emit(v, "mtext", payload, h, dimId);
        } else if (t === "LEADER") {
            const segs = [];
            for (let i = 0; i + 1 < v.leaderVerts.length; i++) {
                const a = v.leaderVerts[i], b = v.leaderVerts[i + 1];
                segs.push([round6(a[0]), round6(a[1]), round6(b[0]), round6(b[1])]);
            }
            emit(v, "leader", { segs }, h, dimId);
        } else if (t === "TOLERANCE") {
            try {
                emit(v, "tolerance", tolerancePayload(v), h, dimId);
            } catch (ex) {
                c.drop("TOLERANCE", `exception:${ex.constructor.name}`);
            }
        } else if (t === "OLE2FRAME") {
            c.noteMissing("ole", h, "ole", "OLE 对象 v1 不支持");
            c.drop(t, "unsupported_ole");
        } else if (t === "IMAGE") {
            c.noteMissing("image", h, "image", "图像 v1 不支持");
            c.drop(t, "unsupported_image");
        } else if (t.includes("PROXY")) {
            c.noteMissing("proxy", h, "proxy", "代理实体 v1 不支持");
            c.drop(t, "unsupported_proxy");
        } else if (t.endsWith("SOLID") || ["3DSOLID", "MESH", "POLYFACE_MESH"].includes(t)) {
            c.noteMissing("three_d_solid", h, t, "三维实体 v1 不支持");
            c.drop(t, "unsupported_3d");
        } else {
            c.drop(t, "unsupported_type");
        }
    };

    // ── *D 块实体载荷(_block_entity_payload;类型白名单,其余 None)──
    const blockEntityPayload = (v) => {
        try {
            if (v.type === "LINE") {
                return ["line", { a: [v.start[0], v.start[1]], b: [v.end[0], v.end[1]] }];
            }
            if (v.type === "CIRCLE") {
                return ["circle", { c: [v.center[0], v.center[1]], r: Number(v.radius) }];
            }
            if (v.type === "ARC") {
                return ["arc", { c: [v.center[0], v.center[1]], r: Number(v.radius),
                    start: round6(Number(v.startAngle) * Math.PI / 180),
                    end: round6(Number(v.endAngle) * Math.PI / 180) }];
            }
            if (v.type === "LWPOLYLINE") {
                return ["polyline", { verts: ptsPayload(v.verts), closed: !!v.closed }];
            }
            if (v.type === "SOLID") {
                const raw = [v.solidPts[0], v.solidPts[1], v.solidPts[3], v.solidPts[2]];
                return ["solid", { points: raw.filter(p => p != null).map(p => [p[0], p[1]]) }];
            }
            if (v.type === "MTEXT") return ["mtext", mtextPayload(v)];
            if (v.type === "TEXT" || v.type === "ATTRIB") return ["text", textPayload(v)];
        } catch {
            return null;
        }
        return null;
    };

    // ── DIMENSION 语义辅助 ──
    const dimOverride = (v, key, def, asFloat, styleMap) => {
        const raw = v.dim[key];
        if (raw !== null && raw !== undefined) return asFloat ? Number(raw) : Math.trunc(Number(raw));
        const style = styleMap.get(v.dim.dimstyle || "Standard");
        const sv = style?.attrs?.get(DIM_STYLE_CODES[key]);
        if (sv !== undefined && sv.length) return asFloat ? Number(sv[0]) : Math.trunc(Number(sv[0]));
        return def;
    };
    const DIM_STYLE_CODES = { dimlfac: 144, dimdec: 271 };
    const dimDec = (v, styleMap) => {
        const dec = dimOverride(v, "dimdec", 0, false, styleMap);
        return dec && dec > 0 ? dec : -1;
    };
    const dimTolerance = (v, display) => {
        const out = {};
        const tp = v.dim.dimtp, tm = v.dim.dimtm;
        if (tp !== null && tp !== undefined) { if (Number(tp)) out.upper = round6(Number(tp)); }
        if (tm !== null && tm !== undefined) { if (Number(tm)) out.lower = round6(Number(tm)); }
        if (display.includes("%%p") || display.includes("±")) out.fit = "pm";
        return out;
    };
    const renderDimText = (raw, measured, dimlfac, dimdec) => {
        let out = String(raw);
        for (const [k, val] of Object.entries(MTEXT_CODES)) out = out.split(k).join(val);
        if (out.includes("<>") && measured !== null && measured !== undefined) {
            const val = measured * dimlfac;
            const rendered = dimdec >= 0 ? val.toFixed(dimdec) : gFormat(val);
            out = out.split("<>").join(rendered);
        }
        return out.split("%%").join("%");
    };
    const gFormat = (val) => String(parseFloat(Number(val).toPrecision(6))); // %g 近似

    // ── DIMENSION 展开 ──
    // nested:顶层 false(*D 直接遍历,子实体保留真句柄);嵌套 true(虚拟副本口径,
    // 子实体句柄 = 字面 "None" —— Python str(None) 的产物,黄金包原样)。
    const processDimension = (v, chain, handle, matrix, nested, rawDim, scaleMul = null) => {
        c.dim_found++;
        const baseHandle = handle && handle !== "None" ? handle : (v.handle || "");
        const dimId = "D" + (baseHandle || "anon");
        const geomBlock = v.dim.geometry || "";
        const texts = [];
        let nOut = 0;
        const startIdx = entities.length;
        if (!(geomBlock && doc.blocks.has(geomBlock))) {
            c.addInput("dim:no_block");
            c.drop("DIMENSION", "no_geometry_block");
            return;
        }
        if (!nested) c.star_d_exploded++; // 嵌套走虚拟展开口径,不计 star_d(黄金实证 51 vs 55)
        const src = doc.blocks.get(geomBlock).entities;
        for (const raw of src) {
            // *D 内 INSERT(箭头块):递归展开,容器不挂账(Python B5 口径;
            // depth 默认 0 → insert_exploded 会计入,与 Python 行为一致)
            if (raw.type === "INSERT") {
                process(raw, `${chain || "D"}/${baseHandle}`, dimId, 0, matrix, nested, scaleMul);
                nOut++;
                continue;
            }
            const vv = transformEntity(raw, matrix, nested, scaleMul);
            const vtype = vv.type;
            if (["TEXT", "MTEXT", "ATTRIB"].includes(vtype)) {
                texts.push(entityText(vv));
            }
            const payload = blockEntityPayload(vv);
            if (payload === null) {
                c.addInput(`dim:${dimId}:${vtype}`);
                // Defpoints inside dimensions are construction helpers, not missing visible geometry.
                c.drop(vtype, vtype === 'POINT' && vv.layer.toLowerCase() === 'defpoints'
                    ? 'ignored_dimension_defpoint' : 'unsupported_block_entity');
                continue;
            }
            if (payload[0] === "mtext" && !payload[1].rows?.length) {
                c.addInput(`dim:${dimId}:MTEXT`);
                c.drop(vtype, "empty_mtext");
                continue;
            }
            c.addInput(`dim:${dimId}:${vtype}`);
            const vh = nested ? "None" : (raw.handle || `v${nOut}`);
            emit(vv, payload[0], payload[1], `${chain || "D"}/${baseHandle}/${vh}`, dimId);
            nOut++;
        }
        const rawText = String(v.dim.text ?? "");
        const measured = (v.dim.measured !== null && v.dim.measured !== undefined)
            ? Number(v.dim.measured) : null;
        const dimlfac = dimOverride(v, "dimlfac", 1.0, true, doc.dimstyles);
        const blockTexts = texts.map(t => linearize(String(t).trim())).filter(t => t);
        let display = "";
        let inferred = false;
        if (blockTexts.length) {
            display = blockTexts.length === 1 ? blockTexts[0] : blockTexts.join(" ");
        }
        if (!display && (rawText || measured !== null)) {
            display = linearize(renderDimText(rawText, measured, dimlfac, dimDec(v, doc.dimstyles)));
            inferred = true;
        }
        const defPts = [];
        for (const key of ["defpoint", "defpoint2", "defpoint3", "defpoint4", "defpoint5", "text_midpoint"]) {
            const p = v.dim.defpoints[key];
            if (p) defPts.push([round6(p[0]), round6(p[1])]);
        }
        let dtype = 0;
        try { dtype = Math.trunc(Number(v.dim.dimtype)) & 7; } catch { dtype = 0; }
        const exactIds = entities.slice(startIdx).filter(e2 => e2.dim_id === dimId).map(e2 => e2.id);
        dims.push({
            id: dimId, display_text: display,
            ...(measured !== null ? { measured: round6(measured) } : {}),
            tolerance: dimTolerance(v, display),
            type: dtype, def_points: defPts, dimlfac,
            view_id: 0, entity_ids: exactIds,
            inferred, rule_version: `${RULES_VERSION}/dim`,
        });
        c.dim_parsed++;
    };

    // ── process:递归展开。virtual=true 表示来自 INSERT 展开的虚拟副本(丢句柄 → v{seq})。──
    const process = (raw, chain = "", dimId = null, depth = 0, matrix = matIdentity(), virtual = false, scaleMul = null) => {
        const t = raw.type;
        if (t === "INSERT") {
            const h0 = handleOf(virtual ? "" : raw.handle, chain);
            if (depth === 0) c.insert_exploded++;
            // 宿主自身解析色入栈(读 INSERT 记录自身的颜色属性)
            resolver.ctxStack.push(resolver.resolve({
                trueColor: raw.get(420, null), color: raw.get(62, undefined),
                layer: String(raw.get(8, "0")),
            }));
            try {
                const blockName = String(raw.get(2, ""));
                const blk = doc.blocks.get(blockName);
                if (!blk) throw new Error(`block not found: ${blockName}`);
                const m2 = matCompose(matrix, matFromInsert(raw, blk.basePoint));
                // 高度类标量的链式缩放:取 INSERT 组码 41 绝对值(非均匀 41≠42 时高度本就有歧义,
                // 用 sx 与 ezdxf 一致到末位;矩阵分解的 hypot 会漂)
                const childMul = (scaleMul ?? 1) * Math.abs(Number(raw.get(41, 1) ?? 1) || 1);
                for (const child of blk.entities) {
                    process(child, h0, dimId, depth + 1, m2, true, childMul);
                }
                // 注:ATTDEF 由 ezdxf 展开跳过、ATTRIB 实例不进 virtual_entities
                // (golden 实证:两类均不计 input 不出图),此处同样不处理;
                // ATTRIB 值另由 title_block 扫描直读 raw.children。
            } catch (ex) {
                c.addInput(`insfail:${h0}`);
                c.drop(t, `exception:${ex.constructor.name}`);
            } finally {
                resolver.ctxStack.pop();
            }
            return;
        }
        if (t === "ATTDEF") return; // ezdxf virtual_entities 跳过(不挂账,黄金实证)
        if (t === "DIMENSION") {
            const h = handleOf(virtual ? "" : raw.handle, chain);
            const vv = transformEntity(raw, matrix, virtual, scaleMul);
            vv.handle = virtual ? "" : (raw.handle || "");
            processDimension(vv, chain, h, matrix, virtual, raw, scaleMul);
            return;
        }
        // 普通实体(顶层或虚拟)
        const vv = transformEntity(raw, matrix, virtual, scaleMul);
        vv.handle = virtual ? "" : (raw.handle || "");
        const t2 = vv.type; // 变换可能改类型(圆/弧各向异性→椭圆),分派按变换后类型
        c.addInput(`top:${t2}`);
        const h = handleOf(virtual ? "" : raw.handle, chain);
        try {
            dispatch(vv, t2, h, chain, dimId);
        } catch (ex) {
            c.drop(t2, `exception:${ex.constructor.name}:${ex.message}`);
        }
    };

    /** 已变换虚拟实体的挂账与分派(ATTRIB 路径用)。 */
    const processOne = (vv, chain, dimId) => {
        c.addInput(`top:${vv.type}`);
        const h = handleOf("", chain);
        try {
            dispatch(vv, vv.type, h, chain, dimId);
        } catch (ex) {
            c.drop(vv.type, `exception:${ex.constructor.name}:${ex.message}`);
        }
    };

    for (const e of doc.entities) process(e);

    // ── tech_requirements / title_block(sem-rules-0)──
    const tech = [];
    const tb = { attributes: [], found: false, inferred: true, rule_version: `${RULES_VERSION}/title` };
    for (const e of doc.entities) {
        if (e.type === "INSERT" && e.children.length) {
            const attrs = e.children.filter(a => a.type === "ATTRIB")
                .map(a => ({ tag: String(a.get(2, "") ?? ""), value: String(a.get(1, "") ?? "") }));
            if (attrs.length) { tb.attributes.push(...attrs); tb.found = true; }
        }
    }
    for (const ent of entities) {
        const blob = (ent.type === "mtext" || ent.type === "text") ? ent.text : "";
        if (blob.includes("技术要求")) {
            tech.push({ text: blob, source_handle: ent.handle,
                inferred: true, rule_version: `${RULES_VERSION}/tech` });
        }
    }

    // ── bbox + origin_offset + 平移圆整 ──
    let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
    for (const e of entities) {
        for (const q of entityExtent(e)) {
            minx = Math.min(minx, q[0]); miny = Math.min(miny, q[1]);
            maxx = Math.max(maxx, q[0]); maxy = Math.max(maxy, q[1]);
        }
    }
    if (minx === Infinity) { minx = miny = maxx = maxy = 0.0; }
    const off = [Math.floor(minx * factor), Math.floor(miny * factor)];
    for (const e of entities) translateEntity(e, off, factor);
    for (const d of dims) {
        d.def_points = d.def_points.map(q => [round3(q[0] * factor - off[0]), round3(q[1] * factor - off[1])]);
    }
    const bbox = [round3(minx * factor - off[0]), round3(miny * factor - off[1]),
        round3(maxx * factor - off[0]), round3(maxy * factor - off[1])];

    const coverageHist = {};
    for (const e of entities) coverageHist[e.type] = (coverageHist[e.type] ?? 0) + 1;

    const dimIds = new Set(dims.map(d => d.id));
    const orphans = [...new Set(entities.filter(e => e.dim_id && !dimIds.has(e.dim_id)).map(e => e.dim_id))].sort();
    if (orphans.length) console.error(`[孤儿 dim_id] ${orphans.slice(0, 8).join(",")}`);

    const pack = {
        format: "camind-draft-pack", format_version: 1, pipeline_version: PIPELINE_VERSION,
        source_file: opts.sourceName ?? "unknown.dxf",
        source_sha256: opts.sourceBytes
            ? createHash("sha256").update(opts.sourceBytes).digest("hex") : "",
        origin: originRule(doc),
        conversion: {
            tool: "camind-service-draft-converter",
            commit: opts.converterVersion ?? "unknown",
            libredwg: opts.libredwgVersion ?? "n/a(dxf 直读)",
            ezdxf: "n/a(js 移植,无 ezdxf 运行时)",
        },
        rules_version: RULES_VERSION, view_rule_version: VIEW_RULE_VERSION,
        units: "mm", source_units: sourceUnits, unit_factor: factor,
        ltscale, origin_offset: off, bbox,
        layers, linetypes, text_styles: textStyles,
        self_check: c.asDict(),
        coverage: {
            entities_by_type: coverageHist,
            semantic: {
                dims: { found: c.dim_found, parsed: c.dim_parsed },
                tech_requirements: { found: tech.length, parsed: tech.length },
                title_block: { counted: tb.attributes.length, parsed: tb.attributes.length },
            },
        },
        missing: { ...c.missing, other: [...c.missing.other, ...otherPending] },
        views: [], layouts: [],
        entities, dims,
        tech_requirements: tech, title_block: tb,
    };

    // ── 出包自检(writer 档 + 异常桶非空拒)──
    const errs = checkDraftPack(pack, "writer");
    if (Object.keys(pack.self_check.dropped.by_reason).some(r => r.startsWith("exception:"))) {
        errs.push("DRAFT_E_EXCEPTION:异常桶非空(M0-6 纪律:异常必须空,单实体异常转显式丢弃理由)");
    }
    if (errs.length || !pack.self_check.reconciles) {
        const err = new Error(`REJECT ${pack.source_file}: 出包自检不过 ${[...new Set(errs)].sort().join(";") || "对账不过"}`
            + ` | dropped=${JSON.stringify(pack.self_check.dropped)}`);
        err.checkErrors = errs;
        err.pack = pack; // 诊断用(黄金对照/调试);坏包不落盘纪律不变
        throw err;
    }
    return pack;
}

// ── 出身规则(m02-features-1 运行时实现)──
function originRule(doc) {
    const guid = String(doc.header.get("$VERSIONGUID") ?? "");
    if (guid.toUpperCase() === NX_VERSION_GUID) {
        return { channel: "nx", evidence: [`$VERSIONGUID==${NX_VERSION_GUID} 命中`],
            rule_version: "m02-features-1", method: "auto" };
    }
    const appids = doc.appids;
    const nxHits = appids.filter(a => /^(NX|UG)/i.test(a.toUpperCase()));
    if (nxHits.length) {
        return { channel: "nx", evidence: [`APPID NX 痕迹: ${JSON.stringify(nxHits)}`],
            rule_version: "m02-features-1", method: "auto" };
    }
    return { channel: "unknown", evidence: [`APPID=[${appids.slice(0, 6).map(a => `'${a}'`).join(", ")}]`],
        rule_version: "m02-features-1", method: "auto" }; // Python list repr 单引号口径
}

// ── 实体极值采样(entity_extent 移植)──
function entityExtent(e) {
    const t = e.type;
    const out = [];
    if (t === "line") {
        out.push(e.a, e.b);
    } else if (t === "circle") {
        const [cx, cy] = e.c, r = e.r;
        out.push([cx - r, cy - r], [cx + r, cy + r]);
    } else if (t === "arc") {
        const [cx, cy] = e.c, r = e.r;
        const s = e.start ?? 0, en = e.end ?? 0;
        const two = 2 * Math.PI;
        const span = (((en - s) % two) + two) % two;
        const pts = [[cx + r * Math.cos(s), cy + r * Math.sin(s)],
            [cx + r * Math.cos(en), cy + r * Math.sin(en)]];
        for (const axis of [0, Math.PI / 2, Math.PI, 3 * Math.PI / 2]) {
            if ((((axis - s) % two) + two) % two <= span) pts.push([cx + r * Math.cos(axis), cy + r * Math.sin(axis)]);
        }
        out.push(...pts);
    } else if (t === "polyline") {
        const verts = e.verts;
        for (let i = 0; i < verts.length; i++) {
            const v = verts[i];
            out.push([v.x, v.y]);
            const b = v.bulge ?? 0;
            if (!b) continue;
            if (i === verts.length - 1 && !e.closed) continue;
            const nxt = verts[(i + 1) % verts.length];
            const dx = nxt.x - v.x, dy = nxt.y - v.y;
            const n = Math.hypot(dx, dy);
            if (n > 0) {
                const sag = Math.abs(b) * n / 2;
                out.push([(v.x + nxt.x) / 2 + dy / n * sag, (v.y + nxt.y) / 2 - dx / n * sag]);
            }
        }
    } else if (t === "point") {
        out.push(e.p);
    } else if (t === "solid") {
        out.push(...e.points);
    } else if (t === "text" || t === "mtext") {
        out.push(e.p);
        for (const r of e.rows ?? []) out.push(r.p);
    } else if (t === "leader" || t === "mleader") {
        for (const s of e.segs ?? []) out.push([s[0], s[1]], [s[2], s[3]]);
        if (e.text && typeof e.text === "object") out.push(e.text.p);
    } else if (t === "tolerance") {
        for (const s of e.frame_segs ?? []) out.push([s[0], s[1]], [s[2], s[3]]);
        for (const c2 of e.cells ?? []) out.push(c2.p);
    } else if (t === "hatch") {
        for (const s of [...(e.boundary ?? []), ...(e.generated_segs ?? [])]) {
            out.push([s[0], s[1]], [s[2], s[3]]);
        }
    }
    return out.filter(q => Array.isArray(q) && q.length === 2 && q.every(Number.isFinite));
}

// ── 平移圆整(_translate_entity 移植):包坐标 = 图纸坐标 × factor − origin_offset ──
function translateEntity(e, off, factor) {
    const T = (q) => [round3(q[0] * factor - off[0]), round3(q[1] * factor - off[1])];
    const T4 = (s) => [round3(s[0] * factor - off[0]), round3(s[1] * factor - off[1]),
        round3(s[2] * factor - off[0]), round3(s[3] * factor - off[1])];
    const t = e.type;
    if (t === "line") {
        e.a = T(e.a); e.b = T(e.b);
    } else if (t === "circle" || t === "arc") {
        e.c = T(e.c);
        if (factor !== 1.0) e.r = round3(e.r * factor);
    } else if (t === "polyline") {
        for (const v of e.verts) { [v.x, v.y] = T([v.x, v.y]); }
    } else if (t === "point") {
        e.p = T(e.p);
    } else if (t === "solid") {
        e.points = e.points.map(T);
    } else if (t === "text" || t === "mtext") {
        e.p = T(e.p);
        if ("align_point" in e) e.align_point = T(e.align_point);
        if (factor !== 1.0) e.h = round3(e.h * factor);
        for (const r of e.rows ?? []) r.p = T(r.p);
        if (t === "mtext" && e.def_width && factor !== 1.0) e.def_width = round3(e.def_width * factor);
    } else if (t === "leader" || t === "mleader") {
        e.segs = (e.segs ?? []).map(T4);
        if (e.text && typeof e.text === "object") e.text.p = T(e.text.p);
    } else if (t === "tolerance") {
        e.frame_segs = (e.frame_segs ?? []).map(T4);
        for (const c2 of e.cells ?? []) c2.p = T(c2.p);
    } else if (t === "hatch") {
        e.boundary = (e.boundary ?? []).map(T4);
        e.generated_segs = (e.generated_segs ?? []).map(T4);
    }
}
