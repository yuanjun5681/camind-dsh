// 4B-3/4B-4 CPU 空间索引拾取:64×64 CSR 网格 + 点到线段距离,纯函数不碰 GL
// (M0-6 拍板 §4:网格只用于拾取;剔除另有 segBBox 直扫)。
// 构建 = 「沿线段走格」插入(步长半格,对角跨格补两正交邻格):包围盒全格插入使
// 全图随机线段平均盖 ~499 格,是 M0-6 300 万档内存事故根因;半格步长采样漏登
// 10.2% 段-格关系(对角擦角),补邻格后网格 vs 全量暴力对照无损(M0-6 判据四件套)。

export interface SegLike {
    x1: number; y1: number; x2: number; y2: number;
}

export interface SegGrid {
    /** 每段 bbox [minx,miny,maxx,maxy](渲染层视口剔除共用同一份) */
    bboxes: Float32Array;
    readonly starts: Uint32Array; // GRID*GRID+1
    readonly items: Uint32Array;  // 段下标(CSR)
    readonly grid: number;
    readonly minX: number; readonly minY: number; readonly maxX: number; readonly maxY: number;
    /** 查询:world 点 + 容差(世界单位)→ 最近段下标;-1 无命中。
     *  visible(segIdx)=false 的段跳过(图层显隐过滤在调用方)。 */
    pick(wx: number, wy: number, tol: number, visible?: (segIdx: number) => boolean): number;
}

export function buildSegGrid(segments: readonly SegLike[], grid = 64): SegGrid {
    const n = segments.length;
    const bboxes = new Float32Array(n * 4);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i < n; ++i) {
        const s = segments[i];
        const x0 = Math.min(s.x1, s.x2), y0 = Math.min(s.y1, s.y2);
        const x1 = Math.max(s.x1, s.x2), y1 = Math.max(s.y1, s.y2);
        bboxes[i * 4] = x0; bboxes[i * 4 + 1] = y0;
        bboxes[i * 4 + 2] = x1; bboxes[i * 4 + 3] = y1;
        if (x0 < minX) minX = x0;
        if (y0 < minY) minY = y0;
        if (x1 > maxX) maxX = x1;
        if (y1 > maxY) maxY = y1;
    }
    if (!Number.isFinite(minX)) { minX = minY = maxX = maxY = 0; } // 空段集
    const bw = Math.max(maxX - minX, 1e-9), bh = Math.max(maxY - minY, 1e-9);
    const cellW = bw / grid, cellH = bh / grid;

    // 沿线段走格:半格步长采样,跨格才登记;对角跨格补两正交邻格
    const cellOf = (wx: number, wy: number): number => {
        const cx = Math.min(grid - 1, Math.max(0, Math.floor((wx - minX) / cellW)));
        const cy = Math.min(grid - 1, Math.max(0, Math.floor((wy - minY) / cellH)));
        return cy * grid + cx;
    };
    const counts = new Uint32Array(grid * grid);
    const cells: number[] = [];
    const cellsOf = (i: number): void => {
        cells.length = 0;
        const xa = segments[i].x1, ya = segments[i].y1;
        const xb = segments[i].x2, yb = segments[i].y2;
        // 步数按「跨格数较大轴 × 2(半格步长)」:除以 min(cellW,cellH) 会让水平/垂直段
        // 在退化轴(宽/高≈0 → cell 夹 1e-9)上产生百亿次采样(Kimi 审查实测 1s 不终止)
        const steps = Math.max(1, Math.ceil(2 * Math.max(
            Math.abs(xb - xa) / cellW, Math.abs(yb - ya) / cellH)));
        let last = -1, prevGx = -1, prevGy = -1;
        for (let k = 0; k <= steps; ++k) {
            const t = k / steps;
            const c = cellOf(xa + (xb - xa) * t, ya + (yb - ya) * t);
            if (c === last) continue;
            const gx = c % grid, gy = (c / grid) | 0;
            if (last >= 0 && gx !== prevGx && gy !== prevGy) {
                cells.push(prevGy * grid + gx); // 水平邻格
                cells.push(gy * grid + prevGx); // 垂直邻格
            }
            cells.push(c);
            last = c; prevGx = gx; prevGy = gy;
        }
    };
    for (let i = 0; i < n; ++i) {
        cellsOf(i);
        for (const c of cells) ++counts[c];
    }
    const starts = new Uint32Array(grid * grid + 1);
    for (let c = 0; c < grid * grid; ++c) starts[c + 1] = starts[c] + counts[c];
    const items = new Uint32Array(starts[grid * grid]);
    const fill = starts.slice(0, grid * grid);
    for (let i = 0; i < n; ++i) {
        cellsOf(i);
        for (const c of cells) items[fill[c]++] = i;
    }

    return {
        bboxes, starts, items, grid, minX, minY, maxX, maxY,
        pick(wx: number, wy: number, tol: number, visible?: (segIdx: number) => boolean): number {
            const gx0 = Math.max(0, Math.floor((wx - tol - minX) / cellW));
            const gx1 = Math.min(grid - 1, Math.floor((wx + tol - minX) / cellW));
            const gy0 = Math.max(0, Math.floor((wy - tol - minY) / cellH));
            const gy1 = Math.min(grid - 1, Math.floor((wy + tol - minY) / cellH));
            let best = -1, bestD = tol * tol;
            for (let gy = gy0; gy <= gy1; ++gy)
                for (let gx = gx0; gx <= gx1; ++gx) {
                    const c = gy * grid + gx;
                    for (let k = starts[c]; k < starts[c + 1]; ++k) {
                        const i = items[k];
                        if (visible && !visible(i)) continue;
                        const s = segments[i];
                        const abx = s.x2 - s.x1, aby = s.y2 - s.y1;
                        const t = Math.max(0, Math.min(1,
                            ((wx - s.x1) * abx + (wy - s.y1) * aby) / (abx * abx + aby * aby || 1)));
                        const dx = s.x1 + abx * t - wx, dy = s.y1 + aby * t - wy;
                        const d = dx * dx + dy * dy;
                        if (d < bestD) { bestD = d; best = i; }
                    }
                }
            return best;
        },
    };
}

/** 点到线段距离(拾取判据与调用方对账用)。 */
export function distToSeg(s: SegLike, qx: number, qy: number): number {
    const abx = s.x2 - s.x1, aby = s.y2 - s.y1;
    const t = Math.max(0, Math.min(1,
        ((qx - s.x1) * abx + (qy - s.y1) * aby) / (abx * abx + aby * aby || 1)));
    return Math.hypot(s.x1 + abx * t - qx, s.y1 + aby * t - qy);
}
