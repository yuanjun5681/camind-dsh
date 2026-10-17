// HATCH 载荷:边界段 + 45° 图案线求交配对(dwg_to_draft_v1.py hatch_payload 逐行移植)。
// v1 简化口径:不管图案名,非 SOLID 一律 45° 线族 step=3.0;截断 HATCH_MAX_SEGS 标 truncated。
import { ARC_SEG, SPLINE_CHORD, flattenSpline } from "./expand.js";

export const HATCH_MAX_SEGS = 2000;

const round3 = (v) => Math.round(v * 1000) / 1000;

/** 边界段采样:polyline 路径按顶点(含 bulge 直边近似——Python 版同样只取顶点连线),
 *  edge 路径 line 取端点、arc 按 ARC_SEG/4 采样、样条边 flattening。 */
function edgePoints(edge) {
    if (edge.type === 1) {
        return [[edge.x1 ?? 0, edge.y1 ?? 0], [edge.x2 ?? 0, edge.y2 ?? 0]];
    }
    if (edge.type === 2) {
        const c = [edge.cx ?? 0, edge.cy ?? 0], r = edge.r ?? 0;
        let a0 = (edge.a0 ?? 0) * Math.PI / 180, a1 = (edge.a1 ?? 0) * Math.PI / 180;
        const ccw = edge.ccw !== false;
        const pts = [];
        const n = Math.max(2, Math.floor(ARC_SEG / 4));
        if (ccw) {
            while (a1 <= a0) a1 += 2 * Math.PI;
            for (let i = 0; i <= n; i++) {
                const a = a0 + (a1 - a0) * i / n;
                pts.push([c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)]);
            }
        } else {
            while (a0 <= a1) a0 += 2 * Math.PI;
            for (let i = 0; i <= n; i++) {
                const a = a1 + (a0 - a1) * i / n;
                pts.push([c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)]);
            }
            pts.reverse();
        }
        // Python _edge_points 在 if/else 之后还有一段无条件的 a0→a1 全扫采样(会多一条
        // a1→a0 连接段与一遍重复扫掠)。黄金一致优先,逐行复刻;真图语料无 hatch,
        // 该路径未被黄金文件覆盖,修正归契约修订而非本移植。
        for (let i = 0; i <= n; i++) {
            const a = a0 + (a1 - a0) * i / n;
            pts.push([c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)]);
        }
        return pts;
    }
    if (edge.type === 4) {
        const cp = (edge.cpx ?? []).map((x, i) => [x, (edge.cpy ?? [])[i] ?? 0]);
        if (cp.length < 2) return [];
        return flattenSpline({
            cp, knots: edge.knots ?? [], degree: edge.degree ?? 3,
            weights: edge.weights ?? [], closed: false,
        }, SPLINE_CHORD);
    }
    return []; // type 3 椭圆弧边 v1 不采样(已知限制,见 expand.js)
}

export function hatchPayload(hatch) {
    const boundary = [];
    for (const path of hatch.paths) {
        if (path.poly) {
            const pts = path.verts;
            for (let i = 0; i + 1 < pts.length; i++) {
                boundary.push([round3(pts[i][0]), round3(pts[i][1]), round3(pts[i + 1][0]), round3(pts[i + 1][1])]);
            }
            if (path.closed && pts.length) {
                const a = pts[pts.length - 1], b = pts[0];
                boundary.push([round3(a[0]), round3(a[1]), round3(b[0]), round3(b[1])]);
            }
        } else {
            for (const edge of path.edges) {
                const pts = edgePoints(edge);
                for (let i = 0; i + 1 < pts.length; i++) {
                    boundary.push([round3(pts[i][0]), round3(pts[i][1]), round3(pts[i + 1][0]), round3(pts[i + 1][1])]);
                }
            }
        }
    }
    // 45° 线族:y = x + c 与边界段求交,交点排序配对
    const generated = [];
    const xs = boundary.flatMap(s => [s[0], s[2]]);
    const ys = boundary.flatMap(s => [s[1], s[3]]);
    const patternName = hatch.patternName || "SOLID";
    if (xs.length && boundary.length && patternName !== "SOLID") {
        const step = 3.0;
        const lo = Math.min(...ys) - Math.max(...xs);
        const nLines = Math.floor((Math.max(...ys) - Math.min(...ys) + (Math.max(...xs) - Math.min(...xs))) / step) + 1;
        for (let k = 0; k < nLines; k++) {
            const c0 = lo + k * step;
            const hits = [];
            for (const s of boundary) {
                const p = segDiagIntersect(s, c0);
                if (p !== null) hits.push(p);
            }
            hits.sort((a, b) => a - b);
            for (let i = 0; i + 1 < hits.length; i += 2) {
                const a = hits[i], b = hits[i + 1];
                if (b - a > 1e-6) generated.push([round3(a), round3(a + c0), round3(b), round3(b + c0)]);
            }
            if (generated.length > HATCH_MAX_SEGS) break;
        }
    }
    const out = {
        boundary: boundary.slice(0, HATCH_MAX_SEGS),
        pattern_name: patternName,
        generated_segs: generated,
    };
    if (generated.length > HATCH_MAX_SEGS) out.truncated = true;
    return out;
}

/** 边界段与 45° 线 y = x + c0 的交点 x 值;平行/不相交 null。 */
function segDiagIntersect(s, c0) {
    const [x1, y1, x2, y2] = s;
    const dx = x2 - x1, dy = y2 - y1;
    const den = dy - dx;
    if (Math.abs(den) < 1e-12) return null;
    const t = (c0 - (y1 - x1)) / den;
    if (t >= 0 && t <= 1) return x1 + t * dx;
    return null;
}
