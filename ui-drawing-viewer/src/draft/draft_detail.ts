// 4B-4 尺寸详情与 4B-5 出身展示的纯逻辑(无 DOM,可单测)。
// 口径依据:契约 §4(dims 六子字段/display_text 权威/比对口径按 display_text)与
// §1 出身字段;类型名 = 组码 70 低三位;粗线不画等已知口径不进详情。

import type { DraftDim, DraftOrigin } from "./draft_loader.ts";

/** 组码 70 低三位 → 中文名(契约 §4)。 */
export function dimTypeLabel(type: number): string {
    switch (type) {
        case 0: return "线性";
        case 1: return "对齐";
        case 2: return "角度";
        case 3: return "直径";
        case 4: return "半径";
        case 5: return "三点角度";
        case 6: return "坐标";
        default: return `类型${type}`;
    }
}

/**
 * display_text 与 measured 比对(4B-4 验收:不一致标红)。
 * 口径:display_text 去前缀符号(Ø/R/M/°)后取首个数(负号/小数),× dimlfac 与
 * measured 按显示小数位舍入容差比对;measured 缺席按降级提示而非错判(LibreDWG subclass
 * marker 缺失是已知形态,契约 §4)。
 */
export function compareDim(dim: DraftDim): "match" | "mismatch" | "no-measured" | "unparseable" {
    if (dim.measured === undefined) return "no-measured";
    const m = dim.displayText.replace(/[ØØRrM°\s]/g, "").match(/-?\d+(?:\.\d+)?/);
    if (!m) return "unparseable";
    const shown = Number(m[0]);
    const lfac = Number.isFinite(dim.dimlfac) ? dim.dimlfac : 1; // 缺席=1;0/负保留乘算(loader 已按契约取)
    const ref = dim.measured * lfac; // 显示 = 测量 × 比例因子(契约 §4;dimlfac=0 → ref=0,不得假匹配)
    const decimals = m[0].includes(".") ? m[0].split(".")[1].length : 0;
    const rounded = decimals <= 100 ? Number(ref.toFixed(decimals)) : ref; // 与转换器同精度舍入后再比对
    return rounded === shown ? "match" : "mismatch";
}

/** 公差文案:对称 → "±x";不对称 → "+上/−下";fit 原样。 */
export function formatTolerance(dim: DraftDim): string {
    const { upper, lower, fit } = dim.tolerance;
    if (typeof fit === "string" && fit) return fit;
    if (upper !== undefined && lower !== undefined) {
        if (upper === -lower) return `±${Math.abs(upper)}`;
        return `+${upper}/−${Math.abs(lower)}`;
    }
    if (upper !== undefined) return `+${upper}`;
    if (lower !== undefined) return `−${Math.abs(lower)}`;
    return "";
}

export interface DimDetail {
    kind: "dim";
    id: string;
    displayText: string;
    measured?: number;
    compare: ReturnType<typeof compareDim>;
    toleranceText: string;
    typeLabel: string;
    inferred: boolean;
    ruleVersion?: string;
    /** 归组到该 dim 的实体数(拾取命中的组规模) */
    entityCount: number;
}

export interface EntityDetail {
    kind: "entity";
    entId: number;
    layer: string;
}

/** 点击拾取 → 详情(标注文字优先:实体带 dim_id 时归组到 dim,4B-4)。 */
export function detailFor(
    entId: number, layer: string,
    dimId: string | undefined, dims: ReadonlyMap<string, DraftDim>,
    groupSize: (dimId: string) => number,
): DimDetail | EntityDetail | null {
    if (dimId && dims.has(dimId)) {
        const dim = dims.get(dimId)!;
        return {
            kind: "dim", id: dim.id, displayText: dim.displayText,
            measured: dim.measured, compare: compareDim(dim),
            toleranceText: formatTolerance(dim), typeLabel: dimTypeLabel(dim.type),
            inferred: dim.inferred, ruleVersion: dim.ruleVersion,
            entityCount: groupSize(dimId),
        };
    }
    return { kind: "entity", entId, layer };
}

/** 出身徽标与说明(4B-5)。channel=nx 时 v1 单一 AutoCAD 转换链即降级形态,
 *  展示「补传 prt」提示(计划 §1 路由表第 3 行)。 */
export function originInfo(origin: DraftOrigin, sourceFile: string): {
    badge: string; tone: "ok" | "warn" | "unknown"; note: string;
} {
    const method = origin.method === "manual" ? "手动" : "自动";
    if (origin.channel === "autocad") {
        return { badge: `AutoCAD 出身(${method})`, tone: "ok",
            note: `源文件 ${sourceFile || "?"};判定依据:${origin.evidence[0] ?? "无"}` };
    }
    if (origin.channel === "nx") {
        return { badge: `NX 出身(${method})`, tone: "warn",
            note: `源文件 ${sourceFile || "?"};当前版本走 AutoCAD 通道转换 —— 补传对应 prt 可获得更高保真与 3D 联动` };
    }
    return { badge: `出身不明(${method})`, tone: "unknown",
        note: "转换器未能判定出身;可在下方手动指定后重新提交" };
}
