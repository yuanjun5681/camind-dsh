// 4B-3 图纸包装载与展开:契约 r4 v1 包(camind-draft-pack)→ 可渲染形态。
// 职责:①装载与 packcheck 校验(reader 档;任何拒绝码都拒载,未知 type/字段由
// packcheck 按契约跳过计数不报错);②实体解析形式 → 扁平线段(圆/弧/多段线含凸度
// 客户端细分,hatch 用转换侧图案线,solid 取边界);③文字项(mtext 行段即成品)+
// point;④外观定妆:颜色(真彩 rgb / ACI 表 / 反色口径见 aci.ts)与虚线(pattern
// 折叠为「世界周期 × 纹理行」,行 LUT 保留 DXF 有序带符号 pattern —— 单周期近似会
// 把 CENTER 长短点画成匀虚线,Kimi 审查必改;complex 走 simple_fallback,无则实线);
// ⑤图层显隐过滤(层名归一到 manifest 原名,I5 匹配不区分大小写)。
// 相位口径(契约 §3):v1 从实体起点起算,polyline 跨顶点连续 —— 以 dist0 承载。

import { checkDraftPack } from "./packcheck.ts";
import { aciToRgb, intToRgb } from "./aci.ts";

export interface DraftSegment {
    x1: number; y1: number; x2: number; y2: number;
    layer: string;
    /** 所属实体(entities 数组下标;拾取归组/图层掩码用) */
    entId: number;
    /** hatch 实体整体不可拾取(契约 §3,含边界与图案线) */
    pickable: boolean;
    r: number; g: number; b: number;
    /** 虚线世界周期(图形单位;实线 = 0);像素周期 = 周期 × 缩放,clamp [4,16]px 归渲染层 */
    dashPeriod: number;
    /** 线宽(mm,M3 6-2 导出;实体 lineweight.value 优先,BYLAYER 回退层值,缺省=undefined→导出端取默认) */
    lineWidthMm?: number;
    /** pattern LUT 行(dashLut 下标;0 = 实线恒 on 行) */
    dashRow: number;
    /** 段起点沿线距离(polyline 相位连续;其余链从 0 起) */
    dist0: number;
}
export interface DraftTextItem {
    x: number; y: number; h: number; text: string; rot: number;
    layer: string;
    /** 所属实体下标(标注文字优先拾取:文字命中 → dim 归组,4B-4) */
    entId: number;
    /** 对齐信息(契约 §3):halign/valign 组码 72/73 原值,非 0 时锚点 = align_point
     *  (已在 x/y 上生效;3 Aligned/5 Fit v1 降级画法,§9) */
    halign?: number; valign?: number;
    /** 文字样式名(查 textStyles 宽度因子;SHX/TTF 一律映射 sans-serif 是渲染层行为规范) */
    style: string;
    r: number; g: number; b: number;
}
export interface DraftPoint {
    x: number; y: number; layer: string; entId: number;
    r: number; g: number; b: number;
}
/** 契约 §4 dims 语义层(4B-4 详情面板数据源)。 */
export interface DraftDim {
    id: string;
    /** 权威显示串(转换侧预处理;堆叠公差已线性化) */
    displayText: string;
    /** 测量值(组码 42;LibreDWG 缺 subclass marker 时缺席 → 4B-4 比对降级提示) */
    measured?: number;
    tolerance: { upper?: number; lower?: number; fit?: string };
    /** 组码 70 低三位:0 linear/1 aligned/2 angular/3 diameter/4 radius/5 angular3p/6 ordinate */
    type: number;
    /** 所属视图(契约 §2;0=图纸级哨兵;6-1 按视图消费) */
    viewId: number;
    defPoints: [number, number][];
    /** 关联实体下标(契约 entity_ids;与 dimIdByEnt 反向闭合,I9) */
    entityIds: number[];
    dimlfac: number;
    inferred: boolean;
    ruleVersion?: string;
}
/** 契约 §1 出身(4B-5 展示/手动兜底数据源)。 */
export interface DraftOrigin {
    channel: "autocad" | "nx" | "unknown";
    evidence: string[];
    method: "auto" | "manual";
    ruleVersion: string;
}
export interface LoadedDraft {
    partRef: string;
    segments: DraftSegment[];
    texts: DraftTextItem[];
    points: DraftPoint[];
    /** 图层名(manifest 原名)→ 默认可见(off/frozen 为不可见缺省);
     *  plot=可打印标志(KB-2a 起读,lint/导出消费,预览显隐不用它);
     *  lineWidthMm=层线宽(mm,契约 lineweight.value 1/100mm÷100;缺省/BYLAYER/标准=undefined,M3 6-2 导出线宽回退用) */
    layers: Map<string, { off: boolean; frozen: boolean; plot: boolean; lineWidthMm?: number }>;
    /** 文字样式名 → 宽度因子(契约 text_styles.width_factor) */
    textStyles: Map<string, { widthFactor: number }>;
    /** pattern LUT:每行 256 列,值 255=on/0=off;下标 0 为实线恒 on 行,虚线段 dashRow 指行 */
    dashLut: Uint8Array[];
    /** 包 bbox(偏移后坐标;渲染 fit 用) */
    bbox: [number, number, number, number];
    /** 实体计数(coverage 对账用) */
    entityCount: number;
    /** 每图层线段数(图层 UI 徽标用) */
    segsByLayer: Map<string, number>;
    /** 尺寸语义层(契约 §4;拾取按 dim_id 归组,4B-4) */
    dims: DraftDim[];
    /** 实体下标 → 所属 dim id(契约 dim_id;无标注关联的实体不在表) */
    dimIdByEnt: Map<number, string>;
    /** 标题栏语义层(契约 §4;KB-3 导出消费)。当前 reader 档缺键即拒载,正常路径恒有值;
     *  undefined 仅为类型防御兜底。found=false=图上无属性块(语料现状),两者勿混。 */
    titleBlock?: {
        attributes: { tag: string; value: string }[];
        found: boolean;
        inferred: boolean;
        ruleVersion?: string;
    };
    /** 技术要求行(契约 §4;缺席=空数组) */
    techRequirements: { text: string; sourceHandle: string; inferred: boolean; ruleVersion?: string }[];
    /** 视图层(契约 §2:推断产物;id 从 1 起,0=图纸级哨兵;name 可选——M3 6-1 联动按
     *  视图名与 3D 体名匹配) */
    views: { id: number; name?: string; bbox: [number, number, number, number] }[];
    /** 出图单位(契约 §1,packcheck 强制恒 "mm") */
    units: string;
    /** 源单位声明(组码 $INSUNITS;0=无单位时为 "unknown") */
    sourceUnits?: string;
    /** 源单位 → mm 换算系数 */
    unitFactor?: number;
    /** 坐标偏移(契约 §0.1:包内坐标 = 图纸坐标 − origin_offset;标注读数/导出时加回) */
    originOffset: [number, number];
    /** 出身(4B-5 展示/手动兜底) */
    origin: DraftOrigin;
    /** 转换指纹与源溯源(4B-5) */
    conversion: { tool: string; commit: string; libredwg: string; ezdxf: string };
    sourceFile: string;
    sourceSha256: string;
    /** reader 档跳过的未知实体类型；loaded 消息据此披露降级，不把概览冒充完整图纸。 */
    skippedTypes: string[];
}

const ARC_SEG = 48; // 满圆/弧的细分段数(客户端细分口径;渲染层按像素密度再抽稀)

interface Pt2 { x: number; y: number; }

/** [x,y] 数组 → Pt2 对象(geometryPoints/solid 统一对象形态)。 */
const p2 = (v: unknown): Pt2 | null => {
    if (!Array.isArray(v) || v.length !== 2) return null;
    const x = v[0], y = v[1];
    return typeof x === "number" && Number.isFinite(x) && typeof y === "number" && Number.isFinite(y)
        ? { x, y } : null;
};

const pt = (v: unknown): Pt2 => {
    const arr = v as [number, number];
    return { x: arr[0], y: arr[1] };
};

/** unknown → 数组(载荷字段防御:非数组按空处理)。 */
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
/** unknown → [x,y](二元组防御;坏形按原点,packcheck 已在上游拒坏包)。 */
const xy = (v: unknown): [number, number] =>
    (Array.isArray(v) && v.length === 2 ? v : [0, 0]) as [number, number];

function arcPoints(cx: number, cy: number, r: number, start: number, end: number): Pt2[] {
    const two = 2 * Math.PI;
    let span = ((end - start) % two + two) % two; // 逆时针扫掠
    if (span === 0) span = two; // 满圆:start==end 不应退化成零段(Kimi B1)
    const n = Math.max(2, Math.ceil(ARC_SEG * (span / two)));
    const pts: Pt2[] = [];
    for (let i = 0; i <= n; ++i) {
        const a = start + span * i / n;
        pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
    }
    return pts;
}

// 凸度 → 弧段(Camind-desktop 4A 线同款几何;bulge>0 逆时针)
function bulgeArc(x0: number, y0: number, x1: number, y1: number, bulge: number): Pt2[] {
    const theta = 4 * Math.atan(bulge);
    const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
    const d = Math.hypot(x1 - x0, y1 - y0) / 2;
    if (d < 1e-9)
        return [{ x: x0, y: y0 }, { x: x1, y: y1 }];
    const r = d / Math.sin(Math.abs(theta) / 2);
    const h = r * Math.cos(Math.abs(theta) / 2) * (bulge > 0 ? 1 : -1);
    const nx = -(y1 - y0) / (2 * d), ny = (x1 - x0) / (2 * d);
    const cx = mx + nx * h, cy = my + ny * h;
    const a0 = Math.atan2(y0 - cy, x0 - cx);
    let a1 = Math.atan2(y1 - cy, x1 - cx);
    if (bulge > 0) {
        while (a1 <= a0) a1 += 2 * Math.PI;
    } else {
        while (a1 >= a0) a1 -= 2 * Math.PI;
    }
    const steps = Math.max(2, Math.ceil(ARC_SEG * Math.abs(a1 - a0) / (2 * Math.PI)));
    const pts: Pt2[] = [{ x: x0, y: y0 }];
    for (let i = 1; i < steps; ++i) {
        const a = a0 + (a1 - a0) * i / steps;
        pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
    }
    pts.push({ x: x1, y: y1 });
    return pts;
}

/** 单实体 → 点链列表(每条链内相位连续;空数组 = 非线渲染类)。 */
function entityChains(e: Record<string, unknown>): Pt2[][] {
    const t = e["type"];
    const out: Pt2[][] = [];
    if (t === "line") {
        out.push([pt(e["a"]), pt(e["b"])]);
    } else if (t === "circle") {
        const c = pt(e["c"]);
        out.push(arcPoints(c.x, c.y, Number(e["r"]), 0, 2 * Math.PI));
    } else if (t === "arc") {
        const c = pt(e["c"]), r = Number(e["r"]);
        out.push(arcPoints(c.x, c.y, r, Number(e["start"] ?? 0), Number(e["end"] ?? 2 * Math.PI)));
    } else if (t === "polyline") {
        const verts = arr(e["verts"]) as Array<Record<string, unknown>>;
        const n = verts.length;
        const loops = n - (e["closed"] ? 0 : 1);
        const chain: Pt2[] = [];
        for (let i = 0; i < loops; ++i) {
            const a = verts[i], b = verts[(i + 1) % n];
            const ax = Number(a["x"]), ay = Number(a["y"]);
            const bx = Number(b["x"]), by = Number(b["y"]);
            const bulge = Number(a["bulge"] ?? 0);
            const seg = bulge ? bulgeArc(ax, ay, bx, by, bulge) : [{ x: ax, y: ay }, { x: bx, y: by }];
            // 相位连续:段间接缝点共享(上一段终点 = 下一段起点,不重复入链)
            for (let k = chain.length > 0 ? 1 : 0; k < seg.length; ++k) chain.push(seg[k]);
        }
        if (chain.length >= 2) out.push(chain);
    } else if (t === "solid") {
        const pts = (arr(e["points"]).map(p2).filter((q): q is Pt2 => q !== null));
        if (pts.length > 2) pts.push(pts[0]); // 闭合边(Kimi B2)并入链尾,相位自然连续
        if (pts.length >= 2) out.push(pts);
    } else if (t === "hatch") {
        // 边界与图案线是独立线段集(各自相位从 0 起)
        for (const s of [...arr(e["boundary"]), ...arr(e["generated_segs"])] as number[][])
            out.push([{ x: s[0], y: s[1] }, { x: s[2], y: s[3] }]);
    } else if (t === "leader" || t === "mleader") {
        for (const s of arr(e["segs"]) as number[][])
            out.push([{ x: s[0], y: s[1] }, { x: s[2], y: s[3] }]);
    } else if (t === "tolerance") {
        for (const s of arr(e["frame_segs"]) as number[][])
            out.push([{ x: s[0], y: s[1] }, { x: s[2], y: s[3] }]);
    }
    return out;
}

/** mtext 行段 → 文字项(基线左端口径由转换侧预排,客户端只画)。
 *  layer 由调用方传归一化后的 manifest 原名(函数内不再自行取实体层名)。 */
function entityTexts(e: Record<string, unknown>, rgb: [number, number, number],
                     layer: string, entId: number): DraftTextItem[] {
    const t = e["type"];
    const h = Number(e["h"] ?? 2.5);
    const rot = Number(e["rot"] ?? 0);
    const style = String(e["style"] ?? "Standard");
    if (t === "text") {
        const [ax, ay] = xy(e["p"]);
        const halign = Number(e["halign"] ?? 0), valign = Number(e["valign"] ?? 0);
        const [apx, apy] = xy(e["align_point"]);
        const anchored = (halign !== 0 || valign !== 0) && e["align_point"] !== undefined;
        // 契约 §3:halign/valign 任一非 0 时锚点 = align_point(Kimi B4:直出 p 会确定性错位)
        const [px2, py2] = anchored ? [apx, apy] : [ax, ay];
        return [{ x: px2, y: py2, h, text: String(e["text"] ?? ""), rot, layer, style, entId,
                  r: rgb[0], g: rgb[1], b: rgb[2], halign, valign }];
    }
    if (t === "mtext") {
        const rows = arr(e["rows"]) as Array<Record<string, unknown>>;
        return rows.map(r => {
            const [rx, ry] = xy(r["p"]);
            return {
                x: Number(rx), y: Number(ry), h,
                text: String(r["text"] ?? ""), rot, layer, style, entId,
                r: rgb[0], g: rgb[1], b: rgb[2],
            };
        });
    }
    if (t === "leader" || t === "mleader") {
        const tObj = e["text"];
        if (tObj !== null && typeof tObj === "object") {
            const to = tObj as Record<string, unknown>;
            const [tx, ty] = xy(to["p"]);
            return [{ x: Number(tx), y: Number(ty), h: Number(to["h"] ?? 2.5),
                      text: String(to["text"] ?? ""), rot: Number(to["rot"] ?? 0),
                      layer, style, entId, r: rgb[0], g: rgb[1], b: rgb[2] }];
        }
    }
    if (t === "tolerance") {
        return (arr(e["cells"]) as Array<Record<string, unknown>>).map(c2 => {
            const [cx, cy] = xy(c2["p"]);
            return {
                x: Number(cx), y: Number(cy), h: Number(c2["h"] ?? 2.5),
                text: String(c2["text"] ?? ""), rot: Number(c2["rot"] ?? 0), layer, style, entId,
                r: rgb[0], g: rgb[1], b: rgb[2],
            };
        });
    }
    return [];
}

// ── 外观定妆(实体级,契约 §1/§3)──

/** 实体 color → [r,g,b]:真彩 rgb 直出;否则 ACI 表(aci7 表值白 = 深底反色口径,见 aci.ts)。 */
function resolveColor(e: Record<string, unknown>): [number, number, number] {
    const c = e["color"] as Record<string, unknown> | undefined;
    if (c && typeof c === "object" && typeof c["rgb"] === "number") return intToRgb(c["rgb"]);
    return aciToRgb(c && typeof c === "object" ? Number(c["aci"]) : 7);
}

/** DXF 原始符号 pattern(正=划、负=空、0=点)→ 256 列 LUT 行。
 *  归一化:总长(0 元素按 0.02 计,点在视觉上是极短划)→ 周期内归一化位置采样。 */
/** 导出供测试直测 LUT 形状(CENTER 多元素回归)。 */
export function patternToLut(pattern: number[]): Uint8Array {
    const POINT_W = 0.02;
    const weights = pattern.map(p => (p === 0 ? POINT_W : Math.abs(p)));
    const total = weights.reduce((a, b) => a + b, 0);
    const lut = new Uint8Array(256).fill(0);
    if (total <= 0) return lut.fill(255);
    let acc = 0;
    for (let i = 0; i < pattern.length; ++i) {
        const w = weights[i] / total;
        const on = pattern[i] >= 0;
        const lo = acc, hi = acc + w;
        const c0 = Math.max(0, Math.ceil(lo * 256 - 0.5));
        const c1 = Math.min(255, Math.floor(hi * 256 - 0.5));
        if (on) for (let c = c0; c <= c1; ++c) lut[c] = 255;
        acc = hi;
    }
    return lut;
}

/** 装载:校验(reader 档)→ 展开。任何拒绝码都抛(坏包不装载);未知 type/字段由
 *  packcheck reader 档按契约跳过计数,不在 errors 里(Kimi 审查必改 2:此前只拒
 *  FORMAT/VERSION,坏 I1 的包会带着错误静默通过)。 */
export function loadDraft(pack: unknown): LoadedDraft {
    const vr = checkDraftPack(pack, "reader");
    if (vr.errors.length > 0)
        throw new Error(`图纸包校验未过:${vr.errors.join(";")}`);
    const p = pack as Record<string, unknown>;
    const entities = (p["entities"] ?? []) as Array<Record<string, unknown>>;
    const ltscale = Number(p["ltscale"] ?? 1);

    // 层名归一(I5 匹配不区分大小写):实体层名 → manifest 原名,渲染与 UI 都见原名。
    // plot(KB-2a):三态独立布尔,缺席按 true(DXF 默认可打印;只有显式 false 才不可打印)
    const layersRaw = (p["layers"] ?? {}) as Record<string, Record<string, unknown>>;
    const layers = new Map<string, { off: boolean; frozen: boolean; plot: boolean; lineWidthMm?: number }>();
    const normLayer = new Map<string, string>();
    for (const [name, l] of Object.entries(layersRaw)) {
        const lwRaw = l["lineweight"] as Record<string, unknown> | undefined;
        const layerLw = lwRaw && typeof lwRaw["value"] === "number" && Number.isFinite(lwRaw["value"]) && lwRaw["value"] >= 0
            ? Number(lwRaw["value"]) / 100 : undefined; // sentinel(-1 BYLAYER/-2 BYBLOCK/-3 标准)不落值
        layers.set(name, { off: Boolean(l["off"]), frozen: Boolean(l["frozen"]),
                           plot: l["plot"] !== false, ...(layerLw !== undefined ? { lineWidthMm: layerLw } : {}) });
        normLayer.set(name.toLowerCase(), name);
    }
    const layerOf = (raw: string): string => normLayer.get(raw.toLowerCase()) ?? raw;

    const textStyles = new Map<string, { widthFactor: number }>();
    for (const [name, ts] of Object.entries((p["text_styles"] ?? {}) as Record<string, Record<string, unknown>>))
        textStyles.set(name.toLowerCase(), { widthFactor: Number(ts["width_factor"] ?? 1) });

    // pattern LUT:行 0 = 实线恒 on;虚线行按归一化形状去重(同形不同名共行,period 每段自带)
    const dashLut: Uint8Array[] = [new Uint8Array(256).fill(255)];
    const lutKey = new Map<string, number>();
    const dashRowOf = (pattern: number[]): number => {
        const key = pattern.join(",");
        let row = lutKey.get(key);
        if (row === undefined) {
            row = dashLut.length;
            dashLut.push(patternToLut(pattern));
            lutKey.set(key, row);
        }
        return row;
    };

    const segments: DraftSegment[] = [];
    const texts: DraftTextItem[] = [];
    const points: DraftPoint[] = [];
    const segsByLayer = new Map<string, number>();

    for (let idx = 0; idx < entities.length; ++idx) {
        const e = entities[idx];
        const layer = layerOf(String(e["layer"] ?? "0"));
        const type = e["type"];
        const rgb = resolveColor(e);

        // 虚线:最终周期 = pattern 总长 × ltscale × 实体 scale;complex 有 fallback 用之,
        // 无则实线(契约 §1/§3);失败/缺表按实线
        let dashPeriod = 0, dashRow = 0;
        if (type !== "point") {
            const lt = e["linetype"] as Record<string, unknown> | undefined;
            const ltName = String(lt?.["name"] ?? "Continuous");
            const scale = Number(lt?.["scale"] ?? 1);
            const def = (p["linetypes"] ?? {}) as Record<string, Record<string, unknown>>;
            const ltDef = Object.keys(def).find(k => k.toLowerCase() === ltName.toLowerCase());
            if (ltDef) {
                let pattern = (def[ltDef]["pattern"] ?? []) as number[];
                if (String(def[ltDef]["kind"] ?? "simple") === "complex") {
                    const fb = def[ltDef]["simple_fallback"];
                    if (Array.isArray(fb) && fb.length > 0) pattern = fb as number[];
                    else pattern = [];
                }
                let total = 0;
                for (const q of pattern) total += Math.abs(q);
                if (pattern.length > 0 && total > 0) {
                    dashPeriod = total * ltscale * scale;
                    dashRow = dashRowOf(pattern);
                }
            }
        }

        if (type === "point") {
            const q = pt(e["p"]);
            points.push({ x: q.x, y: q.y, layer, entId: idx, r: rgb[0], g: rgb[1], b: rgb[2] });
            continue;
        }
        const pickable = type !== "hatch"; // 契约 §3:hatch 整体不可拾取(含边界)
        // 线宽(M3 6-2 导出):实体非负 lineweight.value(1/100mm→mm)优先;BYLAYER/标准/缺省回退层值
        const eLwRaw = e["lineweight"] as Record<string, unknown> | undefined;
        const eLw = eLwRaw && typeof eLwRaw["value"] === "number" && Number.isFinite(eLwRaw["value"]) && eLwRaw["value"] >= 0
            ? Number(eLwRaw["value"]) / 100 : undefined;
        const lineWidthMm = eLw ?? layers.get(layer)?.lineWidthMm;
        for (const chain of entityChains(e)) {
            let dist = 0;
            for (let k = 0; k + 1 < chain.length; ++k) {
                const a = chain[k], b = chain[k + 1];
                const len = Math.hypot(b.x - a.x, b.y - a.y);
                if (len <= 0) continue; // 零长段画不出,不入缓冲
                segments.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y, layer, entId: idx,
                                pickable, r: rgb[0], g: rgb[1], b: rgb[2],
                                dashPeriod, dashRow, dist0: dist,
                                ...(lineWidthMm !== undefined ? { lineWidthMm } : {}) });
                dist += len;
                segsByLayer.set(layer, (segsByLayer.get(layer) ?? 0) + 1);
            }
        }
        for (const ti of entityTexts(e, rgb, layer, idx)) texts.push(ti);
    }

    // ── 语义层 dims(契约 §4)+ 实体→dim 归组表(4B-4 拾取详情)──
    const dims: DraftDim[] = [];
    const dimIdByEnt = new Map<number, string>();
    for (const dm of arr(p["dims"]) as Array<Record<string, unknown>>) {
        const tol = (dm["tolerance"] ?? {}) as Record<string, unknown>;
        dims.push({
            id: String(dm["id"] ?? ""),
            displayText: String(dm["display_text"] ?? ""),
            measured: isFiniteNum(dm["measured"]) ? Number(dm["measured"]) : undefined,
            tolerance: {
                upper: isFiniteNum(tol["upper"]) ? Number(tol["upper"]) : undefined,
                lower: isFiniteNum(tol["lower"]) ? Number(tol["lower"]) : undefined,
                fit: typeof tol["fit"] === "string" ? tol["fit"] : undefined,
            },
            type: Number(dm["type"] ?? 0),
            viewId: Number(dm["view_id"] ?? 0),
            defPoints: (arr(dm["def_points"]) as unknown[]).map(xy),
            entityIds: (arr(dm["entity_ids"]) as unknown[]).map(Number),
            dimlfac: isFiniteNum(dm["dimlfac"]) ? Number(dm["dimlfac"]) : 1, // 缺席=1(契约 §4);0/负保留(packcheck 已拒非有限)
            inferred: Boolean(dm["inferred"]),
            ruleVersion: typeof dm["rule_version"] === "string" ? dm["rule_version"] : undefined,
        });
    }
    for (let idx = 0; idx < entities.length; ++idx) {
        const dimId = entities[idx]["dim_id"];
        if (typeof dimId === "string" && dimId) dimIdByEnt.set(idx, dimId);
    }

    // ── KB-2a:标题栏/技术要求语义层 + 单位/坐标偏移(契约 §4/§1/§0.1)──
    // packcheck reader 档已校验存在性与形态(units==="mm" 等),这里只装载;
    // title_block 字段缺席(undefined)与 found=false(图上无属性块)分立,消费方(KB-3 导出)区分。
    const titleBlockRaw = p["title_block"];
    const titleBlock = titleBlockRaw !== null && typeof titleBlockRaw === "object" && !Array.isArray(titleBlockRaw)
        ? (() => {
            const tb = titleBlockRaw as Record<string, unknown>;
            return {
                attributes: (arr(tb["attributes"]) as Array<Record<string, unknown>>).map(a => ({
                    tag: String(a["tag"] ?? ""), value: String(a["value"] ?? ""),
                })),
                found: Boolean(tb["found"]),
                inferred: Boolean(tb["inferred"]),
                ruleVersion: typeof tb["rule_version"] === "string" ? tb["rule_version"] : undefined,
            };
        })()
        : undefined;
    const techRequirements = (arr(p["tech_requirements"]) as Array<Record<string, unknown>>).map(tr => ({
        text: String(tr["text"] ?? ""),
        sourceHandle: String(tr["source_handle"] ?? ""),
        inferred: Boolean(tr["inferred"]),
        ruleVersion: typeof tr["rule_version"] === "string" ? tr["rule_version"] : undefined,
    }));
    const sourceUnits = typeof p["source_units"] === "string" ? p["source_units"] : undefined;
    const unitFactor = isFiniteNum(p["unit_factor"]) ? Number(p["unit_factor"]) : undefined;

    // ── 出身与转换指纹(契约 §1;4B-5 展示/手动兜底)──
    const originRaw = (p["origin"] ?? {}) as Record<string, unknown>;
    const channel = originRaw["channel"];
    const conversionRaw = (p["conversion"] ?? {}) as Record<string, unknown>;

    const bboxRaw = (p["bbox"] ?? [0, 0, 1, 1]) as [number, number, number, number];
    return {
        partRef: String(p["part_ref"] ?? ""),
        segments, texts, points, layers, textStyles, dashLut,
        bbox: [Number(bboxRaw[0]), Number(bboxRaw[1]), Number(bboxRaw[2]), Number(bboxRaw[3])],
        entityCount: entities.length,
        segsByLayer,
        dims, dimIdByEnt,
        titleBlock, techRequirements,
        views: (arr(p["views"]) as Array<Record<string, unknown>>)
            .filter(v => v !== null && typeof v === "object" && !Array.isArray(v)
                && typeof v["id"] === "number" && Number.isSafeInteger(v["id"]) && v["id"] >= 1) // packcheck 已拒;不再用 Number() 折叠坏 id
            .map(v => {
            const viewId = v["id"] as number;
            const bboxRaw = v["bbox"] as [number, number, number, number];
            return {
                id: viewId,
                ...(typeof v["name"] === "string" && v["name"] ? { name: String(v["name"]) } : {}),
                bbox: [...bboxRaw] as [number, number, number, number],
            };
        }),
        units: String(p["units"] ?? "mm"),
        sourceUnits, unitFactor,
        originOffset: xy(p["origin_offset"]),
        origin: {
            channel: channel === "nx" || channel === "autocad" ? channel : "unknown",
            evidence: (arr(originRaw["evidence"]) as unknown[]).map(String),
            method: originRaw["method"] === "manual" ? "manual" : "auto",
            ruleVersion: String(originRaw["rule_version"] ?? ""),
        },
        conversion: {
            tool: String(conversionRaw["tool"] ?? ""),
            commit: String(conversionRaw["commit"] ?? ""),
            libredwg: String(conversionRaw["libredwg"] ?? ""),
            ezdxf: String(conversionRaw["ezdxf"] ?? ""),
        },
        sourceFile: String(p["source_file"] ?? ""),
        sourceSha256: String(p["source_sha256"] ?? ""),
        skippedTypes: [...vr.skipped],
    };
}

const isFiniteNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
