// 图纸包校验器:契约 r4 §5 不变量 I1~I9(draft_packcheck.py 逐行移植,码表同源冻结)。
// 两档严格度:writer(缺省,转换侧验收——未知 type/未知顶层字段都拒);
// reader(前向兼容——未知 type 跳过计数 "skipped:<type>",未知字段忽略)。
// I3(ACI 7 反色)不配码:转换侧纪律,读端无源可验。

export const DRAFT_FORMAT = "camind-draft-pack";
export const DRAFT_FORMAT_VERSION = 1;
/** I2 几何比对容差:两侧各自圆整 0.001,极值经圆整可差 1e-3 量级。 */
export const DRAFT_TOL = 1.5e-3;

const TYPES = new Set(["line", "circle", "arc", "polyline", "point", "hatch", "solid",
    "text", "mtext", "leader", "mleader", "tolerance"]);
const REQUIRED_TOP = ["format", "format_version", "pipeline_version", "source_file", "source_sha256",
    "origin", "conversion", "rules_version", "view_rule_version",
    "units", "source_units", "unit_factor",
    "ltscale", "origin_offset", "bbox", "layers", "linetypes", "text_styles",
    "self_check", "coverage", "missing", "views", "entities",
    "dims", "tech_requirements", "title_block"];

const _isNum = (v) => typeof v === "number" && Number.isFinite(v);
const _pt = (v) => Array.isArray(v) && v.length === 2 && v.every(_isNum);
const _seg = (v) => Array.isArray(v) && v.length === 4 && v.every(_isNum);

export function checkDraftPack(p, profile = "writer") {
    const errs = [];
    const add = (s) => errs.push(s);
    if (p === null || typeof p !== "object" || Array.isArray(p) || p.format !== DRAFT_FORMAT) {
        return ["DRAFT_E_FORMAT"];
    }
    if (p.format_version !== DRAFT_FORMAT_VERSION) {
        add(`DRAFT_E_VERSION:format_version=${JSON.stringify(p.format_version)}(未知主版本拒读)`);
    }
    for (const k of REQUIRED_TOP) if (!(k in p)) add(`DRAFT_E_SCHEMA:${k}`);
    if (profile === "writer") {
        for (const k of Object.keys(p)) {
            if (!REQUIRED_TOP.includes(k) && !["views", "entities", "dims",
                "tech_requirements", "title_block", "layouts"].includes(k)) {
                add(`DRAFT_E_SCHEMA:unknown_key ${k}`);
            }
        }
    }
    try {
        checkBodies(p, add, profile);
    } catch (e) {
        add(`DRAFT_E_SCHEMA:结构异常 ${e.constructor.name}: ${e.message}`);
    }
    return errs;
}

function checkBodies(p, add, profile) {
    const layers = p.layers, ltypes = p.linetypes, styles = p.text_styles;
    const views = Array.isArray(p.views) ? p.views : [];
    if (p.views !== undefined && views.some(v => v === null || typeof v !== "object" || Array.isArray(v))) {
        add("DRAFT_E_SHAPE:views 元素应为对象");
    }
    const viewIds = new Set([0, ...views.map(v => v?.id).filter(Number.isInteger)]);
    const ents = p.entities;
    const rawDims = Array.isArray(p.dims) ? p.dims : [];
    if ("dims" in p && !Array.isArray(p.dims)) add("DRAFT_E_SHAPE:dims 应为数组");
    for (const d of rawDims) {
        if (d === null || typeof d !== "object" || Array.isArray(d)) {
            add("DRAFT_E_SHAPE:dims 元素应为对象");
        }
    }
    const dims = rawDims.map(d => d !== null && typeof d === "object" && !Array.isArray(d) ? d : {});
    const dimIds = new Set(dims.map(d => d?.id));

    if (p.units !== "mm") add("DRAFT_E_UNITS:units 恒 mm(源单位见 source_units)");
    if (typeof p.source_units !== "string" || !_isNum(p.unit_factor) || !p.unit_factor) {
        add("DRAFT_E_SCHEMA:source_units/unit_factor");
    }

    // KB-2a:语义层形态校验;缺键仍由 REQUIRED_TOP 报 SCHEMA,不额外制造 SHAPE。
    if ("origin_offset" in p) {
        const oo = p.origin_offset;
        if (!Array.isArray(oo) || oo.length !== 2 || !_isNum(oo[0]) || !_isNum(oo[1])) {
            add("DRAFT_E_SHAPE:origin_offset 应为有限数二元组");
        }
    }
    if ("title_block" in p) {
        const tb = p.title_block;
        if (tb === null || typeof tb !== "object" || Array.isArray(tb)) {
            add("DRAFT_E_SHAPE:title_block 应为对象");
        } else {
            if (!Array.isArray(tb.attributes) || typeof tb.found !== "boolean") {
                add("DRAFT_E_SHAPE:title_block.attributes 应为数组且 found 应为布尔");
            }
            const attributes = Array.isArray(tb.attributes) ? tb.attributes : [];
            if (attributes.some(a => a === null || typeof a !== "object" || Array.isArray(a)
                || typeof a.tag !== "string" || typeof a.value !== "string")) {
                add("DRAFT_E_SHAPE:title_block.attributes 元素应为 {tag,value} 字符串对象");
            }
            if (typeof tb.inferred !== "boolean") add("DRAFT_E_SHAPE:title_block.inferred 应为布尔");
            if (typeof tb.rule_version !== "string") add("DRAFT_E_SHAPE:title_block.rule_version 应为字符串");
        }
    }
    if ("views" in p) {
        if (!Array.isArray(p.views)) {
            add("DRAFT_E_SHAPE:views 应为数组");
        } else {
            const validViews = p.views.filter(v => v !== null && typeof v === "object" && !Array.isArray(v));
            const ids = validViews.map(v => v.id);
            if (ids.some(id => !Number.isSafeInteger(id) || id < 1)) add("DRAFT_E_SHAPE:views 元素 id 应为正整数");
            const validIds = ids.filter(Number.isInteger);
            if (new Set(validIds).size !== validIds.length) add("DRAFT_E_SHAPE:views 元素 id 应唯一");
            if (validViews.some(v => !_seg(v.bbox))) add("DRAFT_E_SHAPE:views 元素 bbox 应为有限数四元组");
        }
    }
    if ("tech_requirements" in p) {
        const tr = p.tech_requirements;
        if (!Array.isArray(tr)) {
            add("DRAFT_E_SHAPE:tech_requirements 应为数组");
        } else {
            for (const item of tr) {
                if (item === null || typeof item !== "object" || Array.isArray(item)) {
                    add("DRAFT_E_SHAPE:tech_requirements 元素应为对象");
                    continue;
                }
                if (typeof item.text !== "string" || typeof item.source_handle !== "string") {
                    add("DRAFT_E_SHAPE:tech_requirements.text/source_handle 应为字符串");
                }
                if (typeof item.inferred !== "boolean") add("DRAFT_E_SHAPE:tech_requirements.inferred 应为布尔");
                if (typeof item.rule_version !== "string") add("DRAFT_E_SHAPE:tech_requirements.rule_version 应为字符串");
            }
        }
    }

    // ── I1/I1b 对账 ──
    const sc = p.self_check;
    const byType = sc?.dropped?.by_type ?? {};
    const byReason = sc?.dropped?.by_reason ?? {};
    const sumT = Object.values(byType).reduce((a, b) => a + b, 0);
    const sumR = Object.values(byReason).reduce((a, b) => a + b, 0);
    if (sumT !== sumR) add("DRAFT_E_SELFCHECK:dropped 两切面总数不一致");
    if (sc.input_entities !== sc.drawn_entities + sumT) add("DRAFT_E_SELFCHECK");
    if (sc.reconciles !== true) add("DRAFT_E_SELFCHECK:reconciles 应为 true(自报假=转换侧自认对账不过)");
    if (sc.drawn_entities !== ents.length) add("DRAFT_E_COUNT");

    const hist = {};
    for (const e of ents) hist[e.type] = (hist[e.type] ?? 0) + 1;
    const declared = p.coverage?.entities_by_type ?? {};
    const sameHist = Object.keys(hist).length === Object.keys(declared).length
        && Object.entries(hist).every(([k, v]) => declared[k] === v);
    if (!sameHist) add("DRAFT_E_COVERAGE:entities_by_type 与实际直方图不符");
    const rgbN = ents.filter(e => _isNum(e.color?.rgb)).length;
    if (sc.truecolor_count !== rgbN) {
        add(`DRAFT_E_COLOR:truecolor_count=${JSON.stringify(sc.truecolor_count)} 与带 rgb 实体数 ${rgbN} 不符`);
    }

    let bbox = p.bbox;
    if (!(Array.isArray(bbox) && bbox.length === 4 && bbox.every(_isNum))) {
        add("DRAFT_E_SCHEMA:bbox");
        bbox = null;
    }

    const layerKeys = new Set(Object.keys(layers).map(k => k.toLowerCase()));
    const ltypeKeys = new Set(Object.keys(ltypes).map(k => k.toLowerCase()));
    const styleKeys = new Set(Object.keys(styles).map(k => k.toLowerCase()));
    const seenIds = new Set();
    for (let idx = 0; idx < ents.length; idx++) {
        const e = ents[idx];
        if (e.id !== idx) add(`DRAFT_E_ID:实体 ${JSON.stringify(e.id)} 的 id 应为下标 ${idx}`);
        if (seenIds.has(e.id)) add(`DRAFT_E_ID:id ${JSON.stringify(e.id)} 重复`);
        seenIds.add(e.id);
        if (!TYPES.has(e.type)) {
            if (profile === "writer") add(`DRAFT_E_UNKNOWN_TYPE:${e.type}`);
            else add(`skipped:${e.type}`);
            continue;
        }
        if (!(e.layer in layers) && !layerKeys.has(String(e.layer ?? "").toLowerCase())) {
            add(`DRAFT_E_ORPHAN_REF:layer ${JSON.stringify(e.layer)}`);
        }
        const ltName = e.linetype?.name;
        if (!(ltName in ltypes) && !ltypeKeys.has(String(ltName ?? "").toLowerCase())) {
            add(`DRAFT_E_ORPHAN_REF:linetype ${JSON.stringify(ltName)}`);
        }
        if (e.type === "text" || e.type === "mtext") {
            const st = e.style;
            if (st === undefined || st === null) add("DRAFT_E_ORPHAN_REF:style 缺席");
            else if (!(st in styles) && !styleKeys.has(String(st).toLowerCase())) {
                add(`DRAFT_E_ORPHAN_REF:style ${JSON.stringify(st)}`);
            }
        }
        if (!viewIds.has(e.view_id)) add(`DRAFT_E_VIEW_REF:${JSON.stringify(e.view_id)}`);
        if ("dim_id" in e && !dimIds.has(e.dim_id)) add(`DRAFT_E_DIM_REF:${JSON.stringify(e.dim_id)}`);
        const col = e.color ?? {};
        const aci = col.aci, rgb = col.rgb;
        if (aci === -1) {
            if (!(_isNum(rgb) && rgb >= 0 && rgb <= 0xFFFFFF)) {
                add("DRAFT_E_COLOR:真彩 aci=-1 必带 rgb(0xRRGGBB 整数,契约 §3)");
            }
        } else if (!(_isNum(aci) && aci >= 1 && aci <= 255)) {
            add(`DRAFT_E_COLOR:非真彩 aci=${JSON.stringify(aci)}(0/256 已解析不出现,取值 1~255)`);
        }
        if (aci !== -1 && rgb !== undefined && rgb !== null) {
            add("DRAFT_E_COLOR:非真彩实体不得带 rgb(互斥;aci=7 带 rgb 会破反色判定)");
        }
        if (e.type === "text" || e.type === "mtext") {
            const ha = e.halign ?? 0, va = e.valign ?? 0;
            if ((ha || va) && !_pt(e.align_point)) add("DRAFT_E_SHAPE:halign/valign 非 0 必带 align_point");
        }
        if (e.type === "mtext") {
            const at = e.attach;
            if (!(Number.isInteger(at) && at >= 1 && at <= 9)) {
                add(`DRAFT_E_SHAPE:attach ${JSON.stringify(at)} 应为 1..9`);
            }
        }
        const shapeOk = shapeCheck(e);
        if (!shapeOk) add(`DRAFT_E_SHAPE:${e.type} 实体 ${JSON.stringify(e.id)} 必需载荷缺失或形状不对`);
        if (bbox && shapeOk) {
            for (const pt of geometryPoints(e)) {
                if (!(bbox[0] - DRAFT_TOL <= pt[0] && pt[0] <= bbox[2] + DRAFT_TOL
                    && bbox[1] - DRAFT_TOL <= pt[1] && pt[1] <= bbox[3] + DRAFT_TOL)) {
                    add(`DRAFT_E_BBOX:实体 ${JSON.stringify(e.id)} 出界 ${JSON.stringify(pt)}`);
                    break;
                }
            }
        }
        if (e.type === "mtext") {
            const rows = e.rows ?? [];
            if (!rows.length) add("DRAFT_E_MTEXT_ROWS:rows 空");
            else if (rows.some(r => !r.text)) add("DRAFT_E_MTEXT_ROWS:空行段");
            else {
                const strip = (s) => String(s).replace(/\s+/g, "");
                if (rows.map(r => strip(r.text ?? "")).join("") !== strip(e.text ?? "")) {
                    add("DRAFT_E_MTEXT_ROWS:rows 拼接与顶层 text 不一致");
                }
            }
        }
    }

    // ── I6 全文本零 U+FFFD(键同扫)──
    const scanStr = (obj) => {
        if (typeof obj === "string") return obj.includes("�");
        if (Array.isArray(obj)) return obj.some(scanStr);
        if (obj && typeof obj === "object") {
            return Object.entries(obj).some(([k, v]) => scanStr(k) || scanStr(v));
        }
        return false;
    };
    if (scanStr(p)) add("DRAFT_E_REPLACEMENT");

    // ── I9 双向 + dims 载荷 schema(reader 档同样拒绝畸形载荷)──
    for (const d of dims) {
        if (d.entity_ids !== undefined && !Array.isArray(d.entity_ids)) {
            add(`DRAFT_E_SHAPE:dims.${JSON.stringify(d.id)} entity_ids 应为数组`);
        }
        const entityIds = Array.isArray(d.entity_ids) ? d.entity_ids : [];
        for (const eid of entityIds) {
            if (!Number.isInteger(eid) || eid < 0) {
                add(`DRAFT_E_SHAPE:dims.${JSON.stringify(d.id)} entity_ids 应为非负整数下标`);
                continue;
            }
            const ref = eid < ents.length ? ents[eid] : null;
            if (!ref) add(`DRAFT_E_DIM_REF:dims.${JSON.stringify(d.id)} 引用不存在的实体`);
            else if (ref.dim_id !== d.id) {
                add(`DRAFT_E_DIM_REF:dims.${JSON.stringify(d.id)} 引用实体 ${JSON.stringify(eid)} 未回带 dim_id`);
            }
        }
        if (d.def_points !== undefined && !Array.isArray(d.def_points)) {
            add(`DRAFT_E_SHAPE:dims.${JSON.stringify(d.id)} def_points 应为数组`);
        }
        const defPoints = Array.isArray(d.def_points) ? d.def_points : [];
        for (const q of defPoints) {
            if (!_pt(q)) add(`DRAFT_E_SHAPE:dims.${JSON.stringify(d.id)} def_points 应为 [x,y] 有限二元组`);
        }
        if (d.dimlfac !== undefined && !_isNum(d.dimlfac)) {
            add(`DRAFT_E_SHAPE:dims.${JSON.stringify(d.id)} dimlfac 应为有限数`);
        }
        if (!viewIds.has(d.view_id)) add(`DRAFT_E_VIEW_REF:dims ${JSON.stringify(d.view_id)}`);
    }
}

function shapeCheck(e) {
    switch (e.type) {
        case "line": return _pt(e.a) && _pt(e.b);
        case "circle": return _pt(e.c) && _isNum(e.r);
        case "arc": return _pt(e.c) && _isNum(e.r) && _isNum(e.start) && _isNum(e.end);
        case "polyline":
            return Array.isArray(e.verts) && e.verts.length > 0
                && e.verts.every(v => _pt([v?.x, v?.y]));
        case "point": return _pt(e.p);
        case "solid":
            return Array.isArray(e.points) && [3, 4].includes(e.points.length) && e.points.every(_pt);
        case "text": return _pt(e.p) && _isNum(e.h) && typeof e.text === "string";
        case "mtext":
            return _pt(e.p) && _isNum(e.h) && typeof e.text === "string"
                && Array.isArray(e.rows) && e.rows.length > 0;
        case "tolerance": return Array.isArray(e.frame_segs) && e.frame_segs.length > 0;
        default: return true;
    }
}

function geometryPoints(e) {
    const t = e.type;
    if (t === "line") return [e.a, e.b].filter(_pt);
    if (t === "circle") {
        if (_pt(e.c) && _isNum(e.r)) {
            return [[e.c[0] - e.r, e.c[1] - e.r], [e.c[0] + e.r, e.c[1] + e.r]];
        }
        return [];
    }
    if (t === "arc") {
        const c = e.c, r = e.r, s = e.start ?? 0, en = e.end ?? 0;
        if (!(_pt(c) && _isNum(r) && _isNum(s) && _isNum(en))) return [];
        const twoPi = 2 * Math.PI;
        const arcPt = (ang) => [c[0] + r * Math.cos(ang), c[1] + r * Math.sin(ang)];
        const pts = [arcPt(s), arcPt(en)];
        const span = (((en - s) % twoPi) + twoPi) % twoPi;
        for (const axis of [0, Math.PI / 2, Math.PI, 3 * Math.PI / 2]) {
            if ((((axis - s) % twoPi) + twoPi) % twoPi <= span) pts.push(arcPt(axis));
        }
        return pts;
    }
    if (t === "polyline") {
        const pts = [];
        const verts = e.verts ?? [];
        for (let i = 0; i < verts.length; i++) {
            const v = verts[i];
            if (_pt([v.x, v.y])) pts.push([v.x, v.y]);
            const b = v.bulge ?? 0;
            if (!(_isNum(b) && b !== 0)) continue;
            if (i === verts.length - 1 && !e.closed) continue;
            const nxt = verts[(i + 1) % verts.length];
            if (!_pt([nxt.x, nxt.y])) continue;
            const dx = nxt.x - v.x, dy = nxt.y - v.y;
            const n = Math.hypot(dx, dy);
            if (n > 0) {
                const sag = Math.abs(b) * n / 2;
                pts.push([(v.x + nxt.x) / 2 + dy / n * sag, (v.y + nxt.y) / 2 - dx / n * sag]);
            }
        }
        return pts;
    }
    if (t === "point") return _pt(e.p) ? [e.p] : [];
    if (t === "solid") return (e.points ?? []).filter(_pt);
    if (t === "text" || t === "mtext") {
        return [e.p, ...(e.rows ?? []).map(r => r.p)].filter(_pt);
    }
    if (t === "leader" || t === "mleader") {
        const pts = [];
        for (const s of e.segs ?? []) if (_seg(s)) pts.push(s.slice(0, 2), s.slice(2, 4));
        if (e.text && _pt(e.text.p)) pts.push(e.text.p);
        return pts;
    }
    if (t === "tolerance") {
        const pts = [];
        for (const s of e.frame_segs ?? []) if (_seg(s)) pts.push(s.slice(0, 2), s.slice(2, 4));
        for (const c of e.cells ?? []) if (_pt(c.p)) pts.push(c.p);
        return pts;
    }
    if (t === "hatch") {
        const pts = [];
        for (const s of [...(e.boundary ?? []), ...(e.generated_segs ?? [])]) {
            if (_seg(s)) pts.push(s.slice(0, 2), s.slice(2, 4));
        }
        return pts;
    }
    return [];
}
