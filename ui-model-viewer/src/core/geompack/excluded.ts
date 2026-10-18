// 未进包清单的展示 helper：reason 归一、分组计数、零体文案与 detail 截断。
// 未知 reason 按 other 兜底；纯文本展示，不参与电极角色判定。
import type { ExcludedBody, Manifest } from "./manifest.ts";

export const EXCLUDED_REASON_ORDER: ReadonlyArray<string> =
    ["conversion_failed", "sheet_body", "auxiliary_body", "hidden_by_layer", "hidden_by_blank", "other"];

// Map 防原型链名称（toString/constructor/__proto__）被误当成已知 reason。
const REASON_LABELS: ReadonlyMap<string, string> = new Map([
    ["conversion_failed", "转换失败"],
    ["sheet_body", "片体"],
    ["auxiliary_body", "辅助体(加工过程体)"],
    ["hidden_by_layer", "不可见图层上的体"],
    ["hidden_by_blank", "被隐藏的体"],
    ["other", "其他原因"],
]);

export function normalizeExcludedReason(reason: string): string {
    return REASON_LABELS.has(reason) ? reason : "other";
}

export function excludedReasonLabel(reason: string): string {
    return REASON_LABELS.get(normalizeExcludedReason(reason))!;
}

export interface ExcludedReasonGroup {
    reason: string;
    label: string;
    count: number;
}

export function excludedSummary(excluded: ReadonlyArray<ExcludedBody>): ExcludedReasonGroup[] {
    const counts = new Map<string, number>();
    for (const e of excluded) {
        const key = normalizeExcludedReason(e.reason);
        counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const out: ExcludedReasonGroup[] = [];
    for (const reason of EXCLUDED_REASON_ORDER) {
        const count = counts.get(reason);
        if (count) out.push({ reason, label: excludedReasonLabel(reason), count });
    }
    return out;
}

export function excludedAllLine(excluded: ReadonlyArray<ExcludedBody>): string {
    const groups = excludedSummary(excluded).map((g) => `${g.label} ${g.count}`);
    return `全部 ${excluded.length} 个体未进入几何包:${groups.join("、")}`;
}

export function zeroBodyLine(m: Pick<Manifest, "enumeratedBodyCount" | "excludedBodies">): string {
    if (m.excludedBodies === undefined) return "";
    const enumerated = m.enumeratedBodyCount ?? 0;
    if (enumerated === 0) return "源文件没有可枚举的实体。";
    return excludedAllLine(m.excludedBodies) + "。";
}

// detail 只按纯文本展示；按 Unicode 码点截断 200，避免切断代理对。
export function clampDetail(detail: string): string {
    const chars = [...detail];
    return chars.length > 200 ? chars.slice(0, 200).join("") + "…" : detail;
}
