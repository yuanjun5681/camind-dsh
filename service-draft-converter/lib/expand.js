// INSERT/*D 虚拟展开与几何变换(ezdxf virtual_entities / flattening 的等价物)。
// 坐标系:v1 全程图纸坐标(OCS/三维变换不支持——dwg2dxf 出的 2D 图 Z 恒 0,
// 非平面 INSERT 形态落 unsupported,与 Python 版 drop 口径一致)。
// 2D 仿射:[a,b,c,d,e,f] → x' = a·x + c·y + e; y' = b·x + d·y + f。

export const SPLINE_CHORD = 0.05;  // spline/ellipse 离散弦高 mm(随 conversion.commit 记录)
export const ARC_SEG = 48;

// ── 矩阵 ──
export const matIdentity = () => [1, 0, 0, 1, 0, 0];

/** m∘n:先 n 后 m。 */
export function matCompose(m, n) {
    return [
        m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
        m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
        m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
    ];
}

export function matApply(m, x, y) {
    return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

/** INSERT 放置矩阵:T(insert)·R(rot)·S(sx,sy)·T(-base)。 */
export function matFromInsert(insertEnt, basePoint) {
    const [ix, iy] = insertEnt.pt(10, 20, [0, 0]);
    const sx = insertEnt.get(41, 1) ?? 1;
    const sy = insertEnt.get(42, 1) ?? 1;
    const rot = (insertEnt.get(50, 0) ?? 0) * Math.PI / 180;
    const cos = Math.cos(rot), sin = Math.sin(rot);
    const [bx, by] = basePoint;
    // T(insert)·R·S·T(-base),统一走 matCompose(手写展开曾丢 −sin·sy 项致 y 塌缩)
    const rotM = [cos, sin, -sin, cos, 0, 0];
    const scM = [sx, 0, 0, sy, -sx * bx, -sy * by];
    return matCompose([1, 0, 0, 1, ix, iy], matCompose(rotM, scM));
}

/** 分解:相似情形(等比缩放+旋转±镜像)给 sx/sy/rot/uniform;det<0 = 镜像。 */
function matDecompose(m) {
    const [a, b, c, d] = m;
    const sx = Math.hypot(a, b), sy = Math.hypot(c, d);
    const det = a * d - b * c;
    const rot = Math.atan2(b, a);
    const ortho = Math.abs(a * c + b * d) <= 1e-9 * sx * sy;
    const uniform = ortho && Math.abs(sx - sy) <= 1e-9 * Math.max(sx, sy);
    return { sx, sy, rot, det, uniform };
}

// ── 实体属性提取(原样,不变换)──
function commonAttrs(e) {
    return {
        layer: String(e.get(8, "0")),
        color: e.get(62, undefined),        // 组码 62 原值;缺省 undefined(=256 ByLayer 语义)
        trueColor: e.get(420, null),
        linetype: String(e.get(6, "BYLAYER") ?? "BYLAYER"),
        ltscale: e.get(48, undefined),
        lineweight: e.get(370, undefined),
    };
}

const DEG = 180 / Math.PI;
/** 虚拟弧角度归一化到 (−180°,180°](ezdxf transform 口径,黄金实证;顶层弧不归一)。 */
const normDeg = (a) => {
    let r = a % 360;
    if (r > 180) r -= 360;
    if (r <= -180) r += 360;
    return r;
};

/** 单个实体 → 规范化虚拟实体(vEnt),应用矩阵 m。
 *  virtual:来自 INSERT 展开/嵌套维度(ezdxf virtual_entities 口径,弧角度归一)。
 *  scaleMul:INSERT 链累积的统一缩放乘积(高度/宽度类标量用,避开 hypot 末位漂移;
 *  缺席退回矩阵分解值)。 */
export function transformEntity(e, m, virtual = false, scaleMul = null) {
    const base = { type: e.type, handle: e.handle || "", ...commonAttrs(e) };
    const P = (x, y) => matApply(m, x, y);
    const dec = matDecompose(m);
    const rotDeg = dec.rot * 180 / Math.PI;
    const s = scaleMul ?? dec.sx; // 统一缩放(非相似时为 x 列近似;剪切见文件头口径)
    switch (e.type) {
        case "LINE": {
            const a = P(e.get(10, 0), e.get(20, 0)), b = P(e.get(11, 0), e.get(21, 0));
            return { ...base, start: a, end: b };
        }
        case "CIRCLE":
        case "ARC": {
            const c = P(e.get(10, 0), e.get(20, 0));
            const r = Number(e.get(40, 0));
            if (!dec.uniform) {
                // 各向异性:圆/弧变椭圆,按椭圆参数法重算轴,落 ELLIPSE 离散
                return { ...base, type: "ELLIPSE", ellipse: circleToEllipse(c, r, m) };
            }
            if (e.type === "CIRCLE") return { ...base, center: c, radius: r * s };
            let sa = Number(e.get(50, 0)), ea = Number(e.get(51, 0));
            if (dec.det < 0) { // 镜像:角关于 2φ 翻转并交换(保 CCW)
                const phi = 2 * rotDeg;
                [sa, ea] = [phi - ea, phi - sa];
            } else {
                sa += rotDeg; ea += rotDeg;
            }
            if (virtual) { sa = normDeg(sa); ea = normDeg(ea); }
            return { ...base, center: c, radius: r * s, startAngle: sa, endAngle: ea };
        }
        case "LWPOLYLINE": {
            const xs = e.getAll(10), ys = e.getAll(20), bs = e.getAll(42);
            const verts = xs.map((x, i) => {
                const [vx, vy] = P(x, ys[i] ?? 0);
                let bulge = bs[i] ?? 0;
                if (dec.det < 0) bulge = -bulge; // 镜像翻转凸度方向
                return { x: vx, y: vy, bulge };
            });
            return { ...base, verts, closed: ((e.get(70, 0) ?? 0) & 1) !== 0 };
        }
        case "POLYLINE": { // 老式:VERTEX 子实体(Python 口径:只取 x,y,不读 bulge)
            const verts = e.children.filter(c => c.type === "VERTEX").map(v => {
                const [vx, vy] = P(v.get(10, 0), v.get(20, 0));
                return { x: vx, y: vy };
            });
            return { ...base, verts, closed: ((e.get(70, 0) ?? 0) & 1) !== 0 };
        }
        case "SPLINE": {
            const cps = e.getAll(10).map((x, i) => P(x, e.getAll(20)[i] ?? 0));
            return {
                ...base,
                spline: {
                    cp: cps, knots: e.getAll(40).map(Number),
                    degree: e.get(71, 3) ?? 3,
                    weights: e.getAll(41).map(Number),
                    closed: ((e.get(70, 0) ?? 0) & 1) !== 0,
                },
            };
        }
        case "ELLIPSE": {
            const c0 = [e.get(10, 0), e.get(20, 0)];
            const major = [e.get(11, 0), e.get(21, 0)];
            const ratio = Number(e.get(40, 1));
            const sp = Number(e.get(41, 0)), ep = Number(e.get(42, 2 * Math.PI));
            return { ...base, ellipse: transformEllipse(c0, major, ratio, sp, ep, m) };
        }
        case "POINT": {
            return { ...base, location: P(e.get(10, 0), e.get(20, 0)) };
        }
        case "SOLID": {
            const pts = [e.pt(10, 20), e.pt(11, 21), e.pt(12, 22), e.pt(13, 23)]
                .map(p => (p ? P(p[0], p[1]) : null));
            return { ...base, solidPts: pts };
        }
        case "TEXT":
        case "ATTRIB": {
            const ins = e.pt(10, 20) ?? e.pt(11, 21) ?? [0, 0];
            const out = {
                ...base,
                insert: P(ins[0], ins[1]),
                height: (Number(e.get(40, 0)) || 2.5) * s,  // Python: height or char_height or 2.5
                text: String(e.get(1, "") ?? ""),
                rotation: Number(e.get(50, 0) ?? 0) + rotDeg,
                style: String(e.get(7, "Standard") ?? "Standard"),
            };
            const ap = e.pt(11, 21);
            const halign = e.get(72, 0) ?? 0, valign = e.get(73, 0) ?? 0;
            if (halign || valign) {
                out.halign = halign; out.valign = valign;
                out.alignPoint = ap ? P(ap[0], ap[1]) : [0, 0];
            }
            if (e.type === "ATTRIB") out.tag = String(e.get(2, "") ?? "");
            return out;
        }
        case "MTEXT": {
            const ins = e.pt(10, 20, [0, 0]);
            let rot;
            const xd = e.pt(11, 21);
            if (xd && (xd[0] || xd[1])) {
                const [tx, ty] = matApply([m[0], m[1], m[2], m[3], 0, 0], xd[0], xd[1]);
                rot = Math.atan2(ty, tx) * 180 / Math.PI;
            } else {
                rot = Number(e.get(50, 0) ?? 0) + rotDeg;
            }
            const w = Number(e.get(41, 0) ?? 0);
            return {
                ...base,
                insert: P(ins[0], ins[1]),
                charHeight: Number(e.get(40, 2.5) ?? 2.5) * s,
                text: mtextRaw(e),
                rotation: rot,
                style: String(e.get(7, "Standard") ?? "Standard"),
                attachment: e.get(71, 1) ?? 1,
                width: w ? w * s : 0,
            };
        }
        case "LEADER": {
            const xs = e.getAll(10), ys = e.getAll(20);
            return { ...base, leaderVerts: xs.map((x, i) => P(x, ys[i] ?? 0)) };
        }
        case "TOLERANCE": {
            return {
                ...base,
                insert: P(...(e.pt(10, 20) ?? [0, 0])),
                content: String(e.get(1, "") ?? ""),
            };
        }
        case "HATCH": {
            const h = parseHatch(e);
            transformHatch(h, m, dec, P);
            return { ...base, hatch: h };
        }
        case "DIMENSION": {
            // 几何块名原样保留(展开时按当前矩阵变换 *D 内容);defpoints 变换
            const dim = readDimAttrs(e);
            for (const k of Object.keys(dim.defpoints)) dim.defpoints[k] = P(...dim.defpoints[k]);
            return { ...base, dim };
        }
        default:
            return base; // 不识类型原样透传(convert 落 unsupported)
    }
}

/** MTEXT 原串:组码 3 续行在前、1 收尾,按序拼接。 */
export function mtextRaw(e) {
    const parts = [];
    for (const [code, value] of e.pairs) {
        if (code === 3 || code === 1) parts.push(String(value));
    }
    return parts.join("");
}

/** 圆/弧在各向异性矩阵下的椭圆参数化。 */
function circleToEllipse(c, r, m) {
    const u = matApply([m[0], m[1], m[2], m[3], 0, 0], r, 0); // 变换后的共轭半径
    const v = matApply([m[0], m[1], m[2], m[3], 0, 0], 0, r);
    return conjToEllipse(c, u, v, 0, 2 * Math.PI);
}

/** 椭圆仿射变换:共轭半径法。 */
function transformEllipse(c0, major, ratio, sp, ep, m) {
    const c = matApply(m, c0[0], c0[1]);
    const L = [m[0], m[1], m[2], m[3], 0, 0];
    const rx = Math.hypot(major[0], major[1]);
    const ux = [major[0] / rx, major[1] / rx];      // 主轴单位向量
    const uy = [-ux[1], ux[0]];                      // 副轴 = 主轴旋 90°(ezdxf 口径)
    const p = matApply(L, ux[0] * rx, ux[1] * rx);          // 共轭半径 p
    const q = matApply(L, uy[0] * rx * ratio, uy[1] * rx * ratio); // 共轭半径 q
    return conjToEllipse(c, p, q, sp, ep);
}

/** 共轭半径 p,q → 主副轴椭圆参数;t0 为参数偏移(P(φ)=major·cosφ+minor·sinφ,φ=θ−t0)。 */
function conjToEllipse(c, p, q, sp, ep) {
    const pp = p[0] * p[0] + p[1] * p[1], qq = q[0] * q[0] + q[1] * q[1];
    const pq = p[0] * q[0] + p[1] * q[1];
    const t0 = 0.5 * Math.atan2(2 * pq, pp - qq);
    const ct = Math.cos(t0), st = Math.sin(t0);
    const major = [p[0] * ct + q[0] * st, p[1] * ct + q[1] * st];
    const minor = [-p[0] * st + q[0] * ct, -p[1] * st + q[1] * ct];
    const rx = Math.hypot(major[0], major[1]);
    const ry = Math.hypot(minor[0], minor[1]);
    return {
        center: c, major, ratio: rx > 0 ? ry / rx : 1,
        startParam: sp - t0, endParam: ep - t0,
    };
}

// ── HATCH 解析(顺序敏感,走 pairs;口径 = ezdxf boundary_paths)──
export function parseHatch(e) {
    const h = { paths: [], patternName: "SOLID", solidFill: true };
    let path = null, edge = null;
    const pairs = e.pairs;
    let started = false;
    for (let i = 0; i < pairs.length; i++) {
        const [code, value] = pairs[i];
        if (code === 91) { started = true; continue; }
        if (!started) {
            if (code === 70) h.solidFill = Number(value) !== 0;
            if (code === 2 && !started) h.patternName = String(value);
            continue;
        }
        if (code === 75) break; // 路径区结束
        if (code === 97) {      // 源边界对象计数:跳 n 个 330
            let n = Number(value) || 0;
            while (n > 0 && i + 1 < pairs.length) {
                i++;
                if (pairs[i][0] === 330) n--;
            }
            continue;
        }
        if (code === 92) {
            path = { poly: (Number(value) & 2) !== 0, verts: [], edges: [], closed: false };
            h.paths.push(path);
            edge = null;
            continue;
        }
        if (!path) continue;
        if (path.poly) {
            if (code === 10) { path.verts.push([Number(value), 0, 0]); continue; }
            if (code === 20 && path.verts.length) { path.verts[path.verts.length - 1][1] = Number(value); continue; }
            if (code === 42 && path.verts.length) { path.verts[path.verts.length - 1][2] = Number(value); continue; }
            if (code === 73) { path.closed = Number(value) !== 0; continue; }
        } else {
            if (code === 72) {
                const t = Number(value);
                edge = { type: t };
                path.edges.push(edge);
                continue;
            }
            if (!edge) continue;
            assignEdge(edge, code, value);
        }
    }
    return h;
}

function assignEdge(edge, code, value) {
    const v = Number(value);
    if (edge.type === 1) { // line
        if (code === 10) edge.x1 = v; else if (code === 20) edge.y1 = v;
        else if (code === 11) edge.x2 = v; else if (code === 21) edge.y2 = v;
    } else if (edge.type === 2) { // circular arc
        if (code === 10) edge.cx = v; else if (code === 20) edge.cy = v;
        else if (code === 40) edge.r = v;
        else if (code === 50) edge.a0 = v; else if (code === 51) edge.a1 = v;
        else if (code === 73) edge.ccw = Number(value) !== 0;
    } else if (edge.type === 3) { // elliptic arc
        if (code === 10) edge.cx = v; else if (code === 20) edge.cy = v;
        else if (code === 11) edge.mx = v; else if (code === 21) edge.my = v;
        else if (code === 40) edge.ratio = v;
        else if (code === 50) edge.a0 = v; else if (code === 51) edge.a1 = v;
        else if (code === 73) edge.ccw = Number(value) !== 0;
    } else if (edge.type === 4) { // spline
        if (code === 94) edge.degree = v;
        else if (code === 40) (edge.knots ??= []).push(v);
        else if (code === 10) (edge.cpx ??= []).push(v);
        else if (code === 20) (edge.cpy ??= []).push(v);
        else if (code === 42) (edge.weights ??= []).push(v);
    }
}

function transformHatch(h, m, dec, P) {
    for (const p of h.paths) {
        if (p.poly) {
            p.verts = p.verts.map(([x, y, b]) => {
                const [nx, ny] = P(x, y);
                return [nx, ny, dec.det < 0 ? -b : b];
            });
        } else {
            for (const ed of p.edges) {
                if (ed.type === 1) {
                    [ed.x1, ed.y1] = P(ed.x1 ?? 0, ed.y1 ?? 0);
                    [ed.x2, ed.y2] = P(ed.x2 ?? 0, ed.y2 ?? 0);
                } else if (ed.type === 2) {
                    [ed.cx, ed.cy] = P(ed.cx ?? 0, ed.cy ?? 0);
                    ed.r = (ed.r ?? 0) * dec.sx;
                    const rotDeg = dec.rot * 180 / Math.PI;
                    if (dec.det < 0) {
                        // 镜像:θ → 2φ−θ,起止交换保点集(求交只关心点集,方向无关)
                        const a0 = 2 * rotDeg - (ed.a1 ?? 0), a1 = 2 * rotDeg - (ed.a0 ?? 0);
                        ed.a0 = a0; ed.a1 = a1;
                    } else {
                        ed.a0 = (ed.a0 ?? 0) + rotDeg;
                        ed.a1 = (ed.a1 ?? 0) + rotDeg;
                    }
                } else if (ed.type === 4) {
                    const cpx = ed.cpx ?? [], cpy = ed.cpy ?? [];
                    const pts = cpx.map((x, i) => P(x, cpy[i] ?? 0));
                    ed.cpx = pts.map(q => q[0]); ed.cpy = pts.map(q => q[1]);
                }
                // type 3 椭圆弧边:剪切/旋转下近似不转(真图罕见,缺省按原参;
                // 出现即影响 hatch 边界精度,与 Python 版异常落桶口径分开,记此处已知限制)
            }
        }
    }
}

// ── DIMENSION 属性(实体层)──
// ★子类标记纪律(黄金实证):AcDbEntity 段的 48 是 ltscale 不是 dimtm——
// dimtp/dimtm/dimlfac/dimdec/actual_measurement 只认 AcDbDimension 标记之后的组码;
// text/geometry/defpoints/dimtype 全记录直读(这些码在公共段不出现)。
const DIM_GATED_CODES = { measured: 42, dimlfac: 144, dimdec: 271, dimtp: 47, dimtm: 48 };
export function readDimAttrs(e) {
    const g = (c, d) => e.get(c, d);
    let markerIdx = -1;
    e.pairs.forEach(([code, value], i) => {
        if (code === 100 && String(value) === "AcDbDimension") markerIdx = i;
    });
    const gated = {};
    for (const [key, code] of Object.entries(DIM_GATED_CODES)) {
        gated[key] = null;
        for (let i = markerIdx + 1; i < e.pairs.length; i++) {
            if (e.pairs[i][0] === code) { gated[key] = e.pairs[i][1]; break; }
        }
    }
    return {
        geometry: String(g(2, "") ?? ""),
        text: String(g(1, "") ?? ""),
        measured: gated.measured,
        dimtype: g(70, 0) ?? 0,
        dimstyle: String(g(3, "Standard") ?? "Standard"),
        dimlfac: gated.dimlfac,
        dimdec: gated.dimdec,
        dimtp: gated.dimtp,
        dimtm: gated.dimtm,
        defpoints: Object.fromEntries(
            [["defpoint", e.pt(10, 20)], ["text_midpoint", e.pt(11, 21)],
             ["defpoint2", e.pt(13, 23)], ["defpoint3", e.pt(14, 24)],
             ["defpoint4", e.pt(15, 25)], ["defpoint5", e.pt(16, 26)]]
                .filter(([, p]) => p != null)),
    };
}

// ── B 样条求值(de Boor;weights 非空按 NURBS)──
export function bsplinePoint(cp, knots, degree, weights, t) {
    const n = cp.length - 1;
    const p = degree;
    // 找 knot span
    let span = -1;
    const m = knots.length - 1;
    if (t >= knots[m - p - 0]) span = m - p - 1;
    // 标准查找
    if (span < 0) {
        let lo = p, hi = n + 1;
        span = Math.floor((lo + hi) / 2);
        while (t < knots[span] || t >= knots[span + 1]) {
            if (t < knots[span]) hi = span; else lo = span;
            span = Math.floor((lo + hi) / 2);
        }
    }
    // de Boor
    const d = [];
    for (let j = 0; j <= p; j++) {
        const idx = span - p + j;
        const w = weights.length ? (weights[idx] ?? 1) : 1;
        d.push([cp[idx][0] * w, cp[idx][1] * w, w]);
    }
    for (let r = 1; r <= p; r++) {
        for (let j = p; j >= r; j--) {
            const i = span - p + j;
            const den = knots[i + p - r + 1] - knots[i];
            const a = den === 0 ? 0 : (t - knots[i]) / den;
            d[j] = [
                (1 - a) * d[j - 1][0] + a * d[j][0],
                (1 - a) * d[j - 1][1] + a * d[j][1],
                (1 - a) * d[j - 1][2] + a * d[j][2],
            ];
        }
    }
    const w = d[p][2] || 1;
    return [d[p][0] / w, d[p][1] / w];
}

const isclose = (a, b) => Math.abs(a - b) <= 1e-9 * Math.max(Math.abs(a), Math.abs(b));
const distPointLine = (m, s, e) => {
    const dx = e[0] - s[0], dy = e[1] - s[1];
    const n = Math.hypot(dx, dy);
    if (n === 0) return Math.hypot(m[0] - s[0], m[1] - s[1]);
    return Math.abs(dx * (m[1] - s[1]) - dy * (m[0] - s[0])) / n;
};

/** spline 自适应离散(ezdxf BSpline.flattening 逐行复刻:unique knots × 4 段起,
 *  中点弦距 ≥ distance 递归二分)。 */
export function flattenSpline(sp, distance = SPLINE_CHORD) {
    const { cp, knots, degree, weights } = sp;
    const evalP = (t) => bsplinePoint(cp, knots, degree, weights ?? [], t);
    const uniq = [...new Set(knots)];
    const out = [];
    function* subdiv(s, e, t0, t1) {
        const tm = (t0 + t1) * 0.5;
        const m = evalP(tm);
        if (distPointLine(m, s, e) < distance) {
            yield e;
        } else {
            yield* subdiv(s, m, t0, tm);
            yield* subdiv(m, e, tm, t1);
        }
    }
    let t = uniq[0];
    let start = evalP(t);
    out.push(start);
    for (const t1 of uniq.slice(1)) {
        const delta = (t1 - t) / 4;
        while (t < t1) {
            let nextT = t + delta;
            if (isclose(nextT, t1) || nextT > t1) nextT = t1;
            const end = evalP(nextT);
            for (const p of subdiv(start, end, t, nextT)) out.push(p);
            t = nextT;
            start = end;
        }
    }
    return out;
}

/** ellipse 自适应离散(ezdxf ConstructionEllipse.flattening 逐行复刻)。 */
export function flattenEllipse(el, distance = SPLINE_CHORD) {
    const tau = 2 * Math.PI;
    const rx = Math.hypot(el.major[0], el.major[1]);
    const ux = [el.major[0] / rx, el.major[1] / rx];
    const uy = [-ux[1], ux[0]];
    const ry = rx * el.ratio;
    const vertex = (p) => [
        el.center[0] + Math.cos(p) * rx * ux[0] + Math.sin(p) * ry * uy[0],
        el.center[1] + Math.cos(p) * rx * ux[1] + Math.sin(p) * ry * uy[1],
    ];
    let span = el.endParam - el.startParam;
    const delta = span / 4;
    if (delta === 0) return [];
    let param = ((el.startParam % tau) + tau) % tau;
    let endParam = isclose(el.endParam, tau) ? tau : ((el.endParam % tau) + tau) % tau;
    if (isclose(param, endParam)) return [];
    if (param > endParam) endParam += tau;
    const out = [];
    function* subdiv(s, e, p0, p1) {
        const pm = (p0 + p1) * 0.5;
        const m = vertex(pm);
        if (distPointLine(m, s, e) < distance) {
            yield e;
        } else {
            yield* subdiv(s, m, p0, pm);
            yield* subdiv(m, e, pm, p1);
        }
    }
    let start = vertex(param);
    out.push(start);
    while (param < endParam) {
        let nextP = param + delta;
        if (isclose(nextP, endParam) || nextP > endParam) nextP = endParam;
        const end = vertex(nextP);
        for (const p of subdiv(start, end, param, nextP)) out.push(p);
        param = nextP;
        start = end;
    }
    return out;
}
