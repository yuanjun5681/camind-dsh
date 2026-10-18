// 图纸包读端校验器(4B-3):契约 r4 §5 不变量 I1~I9 的 TS 实现。
// ★码表与两档严格度与 CAM-Agent 侧 tools/draft_packcheck.py 同源冻结(接口契约_待云端确认.md #15):
//   writer(合同包/转换侧验收):未知 type、未知顶层字段都拒;reader(客户端前向兼容):
//   未知 type 跳过计数(skipped)、未知字段忽略 —— v1.x 加字段的包必须通过。
// I3(ACI 7 反色)不配码:转换侧纪律,读端无源可验。
// 非有限数:JSON.parse 本身拒绝 NaN/Infinity 字面量,1e999 解析为 Infinity 由 isfinite 检拦。

export const DRAFT_FORMAT = "camind-draft-pack";
export const DRAFT_FORMAT_VERSION = 1;
/** I2 几何比对容差:两侧各自圆整到 0.001(契约 §0.1),极值经圆整可差 1e-3 量级。 */
export const DRAFT_TOL = 1.5e-3;

export interface DraftCheckResult {
    /** 错误码(可带 ":详情" 后缀);空 = 通过。 */
    errors: string[];
    /** reader 档跳过的未知类型(运行时统计口径,不算错误)。 */
    skipped: string[];
}

interface Pt { x: number; y: number; }
type Json = Record<string, unknown>;

const TYPES = new Set(["line", "circle", "arc", "polyline", "point", "hatch", "solid",
    "text", "mtext", "leader", "mleader", "tolerance"]);
const ROOT_KEYS = new Set(["format", "format_version", "pipeline_version", "source_file",
    "source_sha256", "origin", "conversion", "rules_version", "view_rule_version",
    "units", "source_units", "unit_factor", "ltscale", "origin_offset", "bbox", "layers",
    "linetypes", "text_styles", "self_check", "coverage", "missing", "views", "layouts",
    "entities", "dims", "tech_requirements", "title_block"]);
/** 根骨架键(§0 顶层骨架,白名单之外=writer 拒)。 */
const SKELETON = new Set(["views", "layouts", "entities", "dims", "tech_requirements", "title_block"]);

const isNum = (v: unknown): v is number =>
    typeof v === "number" && Number.isFinite(v);
const isInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);
const pt = (v: unknown): v is Pt =>
    Array.isArray(v) && v.length === 2 && isNum(v[0]) && isNum(v[1]);
const seg = (v: unknown): v is [number, number, number, number] =>
    Array.isArray(v) && v.length === 4 && v.every(isNum);
const asObj = (v: unknown): Json => (v !== null && typeof v === "object" && !Array.isArray(v) ? v as Json : {});
const asArr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** 弧上一点(弧度)。 */
const arcPt = (c: Pt, r: number, a: number): Pt => ({ x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) });
/** [x,y] 数组 → Pt 对象(geometryPoints 统一返回对象形态)。 */
const p2 = (v: unknown): Pt | null => {
    if (!pt(v)) return null;
    const a = v as unknown as [number, number];
    return { x: a[0], y: a[1] };
};

/** 实体外接范围采样点(契约 I2:圆心/def_points/align_point 豁免;
 *  arc=端点+扫掠区间轴向极值;带凸度段=端点+弧顶,正凸度弧顶在行进方向右侧)。 */
function geometryPoints(e: Json): Pt[] {
    const t = e["type"];
    const out: Pt[] = [];
    const c = p2(e["c"]), r = e["r"];
    if (t === "line") {
        for (const q of [p2(e["a"]), p2(e["b"])]) if (q) out.push(q);
    } else if (t === "circle" && c && isNum(r)) {
        out.push({ x: c.x - r, y: c.y - r }, { x: c.x + r, y: c.y + r });
    } else if (t === "arc" && c && isNum(r) && isNum(e["start"]) && isNum(e["end"])) {
        const s = e["start"] as number, en = e["end"] as number, two = 2 * Math.PI;
        out.push(arcPt(c, r, s), arcPt(c, r, en));
        for (const axis of [0, Math.PI / 2, Math.PI, 3 * Math.PI / 2])
            if (((axis - s) % two + two) % two <= ((en - s) % two + two) % two)
                out.push(arcPt(c, r, axis));
    } else if (t === "polyline") {
        const verts = asArr(e["verts"]);
        verts.forEach((v, i) => {
            const vo = asObj(v);
            if (pt([vo["x"], vo["y"]])) out.push({ x: vo["x"] as number, y: vo["y"] as number });
            const b = vo["bulge"];
            const last = i === verts.length - 1;
            if (!isNum(b) || b === 0 || (last && e["closed"] !== true)) return;
            const nx = asObj(verts[(i + 1) % verts.length]);
            if (!pt([nx["x"], nx["y"]])) return;
            const dx = (nx["x"] as number) - (vo["x"] as number), dy = (nx["y"] as number) - (vo["y"] as number);
            const n = Math.hypot(dx, dy);
            if (n > 0) { // 弓高=|bulge|×弦长/2(精确);弧顶在行进方向右侧:(dy,−dx)/n
                const sag = Math.abs(b) * n / 2;
                out.push({ x: ((vo["x"] as number) + (nx["x"] as number)) / 2 + dy / n * sag,
                           y: ((vo["y"] as number) + (nx["y"] as number)) / 2 - dx / n * sag });
            }
        });
    } else if (t === "point") {
        const q = p2(e["p"]); if (q) out.push(q);
    } else if (t === "solid") {
        for (const x of asArr(e["points"])) { const q = p2(x); if (q) out.push(q); }
    } else if (t === "text" || t === "mtext") {
        const q = p2(e["p"]); if (q) out.push(q);
        for (const row of asArr(e["rows"])) { const ro = p2(asObj(row)["p"]); if (ro) out.push(ro); }
    } else if (t === "leader" || t === "mleader") {
        for (const s of asArr(e["segs"])) if (seg(s)) out.push({ x: s[0], y: s[1] }, { x: s[2], y: s[3] });
        const tObj = p2(asObj(e["text"])["p"]); if (tObj) out.push(tObj);
    } else if (t === "tolerance") {
        for (const s of asArr(e["frame_segs"])) if (seg(s)) out.push({ x: s[0], y: s[1] }, { x: s[2], y: s[3] });
        for (const c2 of asArr(e["cells"])) { const co = p2(asObj(c2)["p"]); if (co) out.push(co); }
    } else if (t === "hatch") {
        for (const s of [...asArr(e["boundary"]), ...asArr(e["generated_segs"])])
            if (seg(s)) out.push({ x: s[0], y: s[1] }, { x: s[2], y: s[3] });
    }
    return out;
}

/** 实体文本字段(顶层 text / mtext rows / tolerance cells / mleader 内嵌)。 */
function textFields(e: Json): string[] {
    const out: string[] = [];
    if (typeof e["text"] === "string") out.push(e["text"]);
    const tObj = asObj(e["text"]);
    if (typeof tObj["text"] === "string") out.push(tObj["text"]);
    for (const r of asArr(e["rows"])) { const ro = asObj(r); if (typeof ro["text"] === "string") out.push(ro["text"]); }
    for (const c of asArr(e["cells"])) { const co = asObj(c); if (typeof co["text"] === "string") out.push(co["text"]); }
    return out;
}

const stripWs = (s: string): string => s.replace(/\s+/g, "");

/** 主入口。pack 必须是 JSON.parse 的产物(非有限字面量在解析层已被拒)。 */
export function checkDraftPack(pack: unknown, profile: "writer" | "reader" = "writer"): DraftCheckResult {
    const errors: string[] = [];
    const skipped: string[] = [];
    const add = (code: string): void => { errors.push(code); };
    if (pack === null || typeof pack !== "object" || Array.isArray(pack)) {
        return { errors: ["DRAFT_E_FORMAT"], skipped };
    }
    const p = pack as Json;
    if (p["format"] !== DRAFT_FORMAT) add("DRAFT_E_FORMAT");
    if (p["format_version"] !== DRAFT_FORMAT_VERSION)
        add(`DRAFT_E_VERSION:format_version=${JSON.stringify(p["format_version"])}(未知主版本拒读)`);
    // (format 单独由 DRAFT_E_FORMAT 判,不进本表 —— 与 Python 版 REQUIRED_TOP 同口径)
    for (const k of ["format_version", "pipeline_version", "source_file", "source_sha256",
        "origin", "conversion", "rules_version", "view_rule_version", "units", "source_units",
        "unit_factor", "ltscale", "origin_offset", "bbox", "layers", "linetypes", "text_styles",
        "self_check", "coverage", "missing", "views", "entities", "dims", "tech_requirements", "title_block"])
        if (!(k in p)) add(`DRAFT_E_SCHEMA:${k}`);
    if (profile === "writer")
        for (const k of Object.keys(p))
            if (!ROOT_KEYS.has(k) && !SKELETON.has(k)) add(`DRAFT_E_SCHEMA:unknown_key ${k}`);
    if (errors.length && !("entities" in p)) return { errors, skipped };

    try {
        checkBodies(p, add, skipped, profile);
    } catch (err) {
        add(`DRAFT_E_SCHEMA:结构异常 ${err instanceof Error ? err.message : String(err)}`);
    }
    return { errors, skipped };
}

function checkBodies(p: Json, add: (c: string) => void, skipped: string[], profile: "writer" | "reader"): void {
    const layers = asObj(p["layers"]);
    const ltypes = asObj(p["linetypes"]);
    const styles = asObj(p["text_styles"]);
    const views = asArr(p["views"]);
    // M3 6-1:views 条目形态校验(asObj 抹平前拦)——null/原始值混入会被 loader 折叠丢条目
    if (p["views"] !== undefined && views.some(v => v === null || typeof v !== "object" || Array.isArray(v)))
        add("DRAFT_E_SHAPE:views 元素应为对象");
    const viewIds = new Set<number | null>(views.map(v => asObj(v)["id"]).filter(isInt).concat([0]));
    const ents = asArr(p["entities"]).map(asObj);
    // dims 元素形态在 asObj 抹平前拦(数组/原始值混入 → SHAPE;asObj 会把它们变 {})
    for (const dRaw of asArr(p["dims"]))
        if (dRaw === null || typeof dRaw !== "object" || Array.isArray(dRaw))
            add("DRAFT_E_SHAPE:dims 元素应为对象");
    const dims = asArr(p["dims"]).map(asObj);
    const dimIds = new Set(dims.map(d => d["id"]));
    const lower = (m: Json): Set<string> => new Set(Object.keys(m).map(k => k.toLowerCase()));
    const hasCI = (m: Json, name: unknown, lowers: Set<string>): boolean =>
        typeof name === "string" && (name in m || lowers.has(name.toLowerCase()));

    if (p["units"] !== "mm") add("DRAFT_E_UNITS:units 恒 mm(源单位见 source_units)");
    if (typeof p["source_units"] !== "string" || !isNum(p["unit_factor"]))
        add("DRAFT_E_SCHEMA:source_units/unit_factor");

    // KB-2a:origin_offset 与语义层形态校验(在 asObj 抹平前拦——畸形值不得伪装成
    // 合法缺省,否则 loader 兜底会把数据损坏折叠成 [0,0]/空列表,导出坐标错而无声)。
    // 只在键存在时查形态:缺键由必填校验报 DRAFT_E_SCHEMA(与 Python 侧坏包冻结表
    // 逐码排他一致,键缺失不得多出 SHAPE 码)。
    if ("origin_offset" in p) {
        const oo = p["origin_offset"];
        if (!Array.isArray(oo) || oo.length !== 2 || !isNum(oo[0]) || !isNum(oo[1]))
            add("DRAFT_E_SHAPE:origin_offset 应为有限数二元组");
    }
    if ("title_block" in p) {
        const tbRaw = p["title_block"];
        if (tbRaw === null || typeof tbRaw !== "object" || Array.isArray(tbRaw)) {
            add("DRAFT_E_SHAPE:title_block 应为对象");
        } else if (!Array.isArray((tbRaw as Json)["attributes"])
            || typeof (tbRaw as Json)["found"] !== "boolean") {
            add("DRAFT_E_SHAPE:title_block.attributes 应为数组且 found 应为布尔");
        }
    }
    if ("views" in p) {
        const vwRaw = p["views"];
        if (!Array.isArray(vwRaw))
            add("DRAFT_E_SHAPE:views 应为数组");
        else {
            const ids = vwRaw
                .filter(v => v !== null && typeof v === "object" && !Array.isArray(v))
                .map(v => (v as Json)["id"]);
            if (ids.some(x => !isInt(x)))
                add("DRAFT_E_SHAPE:views 元素 id 应为整数"); // 缺 id 会被 loader 折成 0 撞「图纸级哨兵」(复核 P2)
            const nz = (ids as Array<number | null>).filter(isInt);
            if (new Set(nz).size !== nz.length)
                add("DRAFT_E_SHAPE:views 元素 id 应唯一");
        }
    }
    if ("tech_requirements" in p) {
        const trRaw = p["tech_requirements"];
        if (!Array.isArray(trRaw))
            add("DRAFT_E_SHAPE:tech_requirements 应为数组");
        else if (trRaw.some(t => t === null || typeof t !== "object" || Array.isArray(t)))
            add("DRAFT_E_SHAPE:tech_requirements 元素应为对象");
    }

    // ── I1/I1b 对账(by_type/by_reason 是同一批丢弃的两个切面,各自总和相等)──
    const sc = asObj(p["self_check"]);
    const byType = asObj(asObj(sc["dropped"])["by_type"]);
    const byReason = asObj(asObj(sc["dropped"])["by_reason"]);
    const sumOf = (m: Json): number =>
        Object.values(m).reduce<number>((a, v) => a + (isNum(v) ? v : 0), 0);
    const sumT = sumOf(byType);
    const sumR = sumOf(byReason);
    if (sumT !== sumR) add("DRAFT_E_SELFCHECK:dropped 两切面总数不一致");
    const inputE = sc["input_entities"], drawnE = sc["drawn_entities"];
    if (!isNum(inputE) || !isNum(drawnE) || drawnE + sumT !== inputE) add("DRAFT_E_SELFCHECK");
    if (sc["reconciles"] !== true) add("DRAFT_E_SELFCHECK:reconciles 应为 true");
    if (drawnE !== ents.length) add("DRAFT_E_COUNT");

    // coverage.entities_by_type 直方图对账 + truecolor_count 对账
    const hist = new Map<string, number>();
    let rgbN = 0;
    for (const e of ents) {
        const t = String(e["type"]);
        hist.set(t, (hist.get(t) ?? 0) + 1);
        const rgb = asObj(e["color"])["rgb"];
        if (isNum(rgb)) rgbN += 1;
    }
    const declared = asObj(asObj(p["coverage"])["entities_by_type"]);
    const histObj = Object.fromEntries(hist);
    // 键序无关比较(Python dict == 不看来序;JSON.stringify 看)
    const dKeys = Object.keys(declared), hKeys = Object.keys(histObj);
    const same = dKeys.length === hKeys.length
        && dKeys.every(k => histObj[k] === declared[k]);
    if (!same) add("DRAFT_E_COVERAGE:entities_by_type 与实际直方图不符");
    if (sc["truecolor_count"] !== rgbN)
        add(`DRAFT_E_COLOR:truecolor_count=${JSON.stringify(sc["truecolor_count"])} 与带 rgb 实体数 ${rgbN} 不符`);

    const bbox = p["bbox"];
    const bboxOk = Array.isArray(bbox) && bbox.length === 4 && bbox.every(isNum);
    if (!bboxOk) add("DRAFT_E_SCHEMA:bbox");
    const bb = bboxOk ? (bbox as number[]) : null;

    const seen = new Set<unknown>();
    ents.forEach((e, idx) => {
        if (e["id"] !== idx) add(`DRAFT_E_ID:实体 ${JSON.stringify(e["id"])} 的 id 应为下标 ${idx}`);
        if (seen.has(e["id"])) add(`DRAFT_E_ID:id ${JSON.stringify(e["id"])} 重复`);
        seen.add(e["id"]);
        const t = e["type"];
        if (typeof t !== "string" || !TYPES.has(t)) {
            if (profile === "writer") add(`DRAFT_E_UNKNOWN_TYPE:${String(t)}`);
            else skipped.push(String(t));
            return; // 未知类型不做逐类型校验
        }
        const lL = lower(layers), ltL = lower(ltypes), stL = lower(styles);
        if (!hasCI(layers, e["layer"], lL)) add(`DRAFT_E_ORPHAN_REF:layer ${JSON.stringify(e["layer"])}`);
        const lt = asObj(e["linetype"])["name"];
        if (!hasCI(ltypes, lt, ltL)) add(`DRAFT_E_ORPHAN_REF:linetype ${JSON.stringify(lt)}`);
        if (t === "text" || t === "mtext") {
            const st = e["style"];
            if (st === undefined) add("DRAFT_E_ORPHAN_REF:style 缺席");
            else if (!hasCI(styles, st, stL)) add(`DRAFT_E_ORPHAN_REF:style ${JSON.stringify(st)}`);
        }
        if (!viewIds.has(e["view_id"] as number) || typeof e["view_id"] === "boolean")
            add(`DRAFT_E_VIEW_REF:${JSON.stringify(e["view_id"])}`);
        if ("dim_id" in e && e["dim_id"] !== undefined && !dimIds.has(e["dim_id"]))
            add(`DRAFT_E_DIM_REF:${JSON.stringify(e["dim_id"])}`);
        // color 值域(契约 §3):非真彩 aci 1~255 且无 rgb;真彩 aci=-1 且 rgb=0xRRGGBB
        const col = asObj(e["color"]);
        const aci = col["aci"], rgb = col["rgb"];
        if (typeof aci === "boolean") add("DRAFT_E_COLOR:aci 布尔");
        if (aci === -1) {
            if (!isNum(rgb) || rgb < 0 || rgb > 0xFFFFFF)
                add("DRAFT_E_COLOR:真彩 aci=-1 必带 rgb(0xRRGGBB 整数,契约 §3)");
        } else {
            if (!isNum(aci) || aci < 1 || aci > 255)
                add(`DRAFT_E_COLOR:非真彩 aci=${JSON.stringify(aci)}(0/256 已解析不出现,取值 1~255)`);
            if (rgb !== undefined && rgb !== null) add("DRAFT_E_COLOR:非真彩实体不得带 rgb(互斥)");
        }
        // 形状粗检(缺键/形状不对报 SHAPE,不让畸形几何静默滑过 I2)
        const shapeOk: Record<string, boolean> = {
            line: pt(e["a"]) && pt(e["b"]),
            circle: pt(e["c"]) && isNum(e["r"]),
            arc: pt(e["c"]) && isNum(e["r"]) && isNum(e["start"]) && isNum(e["end"]),
            polyline: asArr(e["verts"]).length > 0
                && asArr(e["verts"]).every(v => pt([asObj(v)["x"], asObj(v)["y"]])),
            point: pt(e["p"]),
            solid: [3, 4].includes(asArr(e["points"]).length)
                && asArr(e["points"]).every(x => pt(x)),
            text: pt(e["p"]) && isNum(e["h"]) && typeof e["text"] === "string",
            mtext: pt(e["p"]) && isNum(e["h"]) && typeof e["text"] === "string"
                && asArr(e["rows"]).length > 0,
            tolerance: asArr(e["frame_segs"]).length > 0,
        };
        if (shapeOk[t] === false) add(`DRAFT_E_SHAPE:${t} 实体 ${JSON.stringify(e["id"])} 必需载荷缺失或形状不对`);
        if (t === "mtext") {
            const at = e["attach"];
            if (!isInt(at) || (at as number) < 1 || (at as number) > 9)
                add(`DRAFT_E_SHAPE:attach ${JSON.stringify(at)} 应为 1..9`);
        }
        if (t === "text" || t === "mtext") {
            const ha = e["halign"], va = e["valign"];
            if (((isNum(ha) && ha !== 0) || (isNum(va) && va !== 0)) && !pt(e["align_point"]))
                add("DRAFT_E_SHAPE:halign/valign 非 0 必带 align_point");
        }
        // I2 外接范围
        if (bb) {
            for (const q of geometryPoints(e))
                if (!(bb[0] - DRAFT_TOL <= q.x && q.x <= bb[2] + DRAFT_TOL
                    && bb[1] - DRAFT_TOL <= q.y && q.y <= bb[3] + DRAFT_TOL)) {
                    add(`DRAFT_E_BBOX:实体 ${JSON.stringify(e["id"])} 出界 [${q.x},${q.y}]`);
                    break;
                }
        }
        // I4 mtext rows 一致性
        if (t === "mtext") {
            const rows = asArr(e["rows"]).map(asObj);
            if (rows.length === 0) add("DRAFT_E_MTEXT_ROWS:rows 空");
            else if (rows.some(r2 => typeof r2["text"] !== "string" || r2["text"] === ""))
                add("DRAFT_E_MTEXT_ROWS:空行段");
            else {
                const joined = rows.map(r2 => stripWs(String(r2["text"]))).join("");
                if (joined !== stripWs(String(e["text"] ?? "")))
                    add("DRAFT_E_MTEXT_ROWS:rows 拼接与顶层 text 不一致");
            }
        }
        // I6 替换字符(实体文本)
        for (const s of textFields(e))
            if (s.includes("\uFFFD")) add("DRAFT_E_REPLACEMENT");
    });

    // ── I6 全文本递归(含语义层与层名键)──
    const hasReplacement = (o: unknown): boolean => {
        if (typeof o === "string") return o.includes("\uFFFD");
        if (Array.isArray(o)) return o.some(hasReplacement);
        if (o !== null && typeof o === "object")
            return Object.entries(o).some(([k, v]) => hasReplacement(k) || hasReplacement(v));
        return false;
    };
    if (hasReplacement(p)) add("DRAFT_E_REPLACEMENT");

    // ── I9 双向 + dims 载荷 schema(Kimi 4B-4/5 审查必改:畸形 dims 不静默修补,
    //    reader 档显式拒;entity_ids 非整数下标/def_points 非有限二元组/dimlfac 非有限数;
    //    dims 元素对象形态已在 asArr 源头拦)──
    for (const d of dims) {
        const entityIds = d["entity_ids"];
        if (entityIds !== undefined && !Array.isArray(entityIds))
            add(`DRAFT_E_SHAPE:dims.${JSON.stringify(d["id"])} entity_ids 应为数组`);
        for (const eid of asArr(entityIds)) {
            if (!isInt(eid) || (eid as number) < 0) {
                add(`DRAFT_E_SHAPE:dims.${JSON.stringify(d["id"])} entity_ids 应为非负整数下标`);
                continue;
            }
            const ref = (eid as number) < ents.length ? ents[eid as number] : null;
            if (!ref) add(`DRAFT_E_DIM_REF:dims.${JSON.stringify(d["id"])} 引用不存在的实体`);
            else if (ref["dim_id"] !== d["id"])
                add(`DRAFT_E_DIM_REF:dims.${JSON.stringify(d["id"])} 引用实体未回带 dim_id`);
        }
        const defPoints = d["def_points"];
        if (defPoints !== undefined && !Array.isArray(defPoints))
            add(`DRAFT_E_SHAPE:dims.${JSON.stringify(d["id"])} def_points 应为数组`);
        for (const q of asArr(defPoints))
            if (!pt(q)) add(`DRAFT_E_SHAPE:dims.${JSON.stringify(d["id"])} def_points 应为 [x,y] 有限二元组`);
        if (d["dimlfac"] !== undefined && !isNum(d["dimlfac"]))
            add(`DRAFT_E_SHAPE:dims.${JSON.stringify(d["id"])} dimlfac 应为有限数`);
        if (!viewIds.has(d["view_id"] as number)) add(`DRAFT_E_VIEW_REF:dims ${JSON.stringify(d["view_id"])}`);
    }
}
