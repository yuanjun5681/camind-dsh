// NC 刀路解析器。直译 tests/nc/reference/nc-parser.js(PARSER CORE 区,536 行规格)。
//
// 这份 JS 是本解析器的规格正本(README 见 tests/nc/reference/):C++ 版(parser.cpp)当年
// 照它逐句翻译,本 TS 版同样照它逐句翻译——回到 JS 语义是零损耗的,连告警文案的
// `${number}` 格式化都天然一致(C++ 为此专门写了 jsNumber(),TS 不需要)。
// 对账基线 tests/fixtures/nc/*.golden.json 由同一份 JS 生成;改动前先看它。
//
// 方言:Fanuc 风后处理输出(Fanuc-style postprocessor output):`%` 界符、O 程序号、
// N 段号、`(...)` 行内注释、`;` 行尾注释、可选跳段 `/`。容错:解析永不抛异常,
// 切不干净的行整行跳过并计数;段数封顶 segmentCap。

const WORD_RE = /([A-Za-z])\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)/g;

// 第 9 组固定循环(G80 取消)。label 给查看器 HUD 用。
export const CANNED_CYCLES: Record<number, string> = {
    73: "高速啄钻",
    74: "左旋攻丝",
    76: "精镗",
    81: "钻孔",
    82: "锪孔",
    83: "啄钻",
    84: "攻丝",
    85: "镗孔",
    86: "镗孔",
    87: "背镗",
    88: "镗孔",
    89: "镗孔",
};

export type SegmentKind = "rapid" | "feed" | "arc" | "cycle";

export interface NcSegment {
    from: number[];
    to: number[];
    kind: SegmentKind;
    line: number;
    feed: number | null;
}

export interface NcCycle {
    code: number;
    label: string;
    at: number[];
    r: number;
    z: number;
    line: number;
}

export interface NcSkipped {
    line: number;
    text: string;
    reason: string;
}

export interface NcParseOptions {
    segmentCap?: number;
}

export interface NcParseResult {
    meta: {
        program: string | null;
        units: string;
        tools: number[];
        lines: number;
        skipped: NcSkipped[];
        warnings: string[];
        truncated: boolean;
        feed: number | null;
        spindle: number | null;
    };
    segments: NcSegment[];
    cycles: NcCycle[];
    bounds: { min: number[]; max: number[] } | null;
    stats: Record<SegmentKind | "skipped", number>;
}

function isG(g: number, code: number): boolean {
    return Math.abs(g - code) < 0.01;
}

// 平面框架:圆弧在 (u, v) 里算,从 +n 轴看逆时针为正。
// G17: u=X v=Y(偏置 I,J)· G18: u=Z v=X(K,I)· G19: u=Y v=Z(J,K)。
interface PlaneFrame { u: number; v: number; n: number; ou: string; ov: string; }

const PLANES: Record<number, PlaneFrame> = {
    17: { u: 0, v: 1, n: 2, ou: "I", ov: "J" },
    18: { u: 2, v: 0, n: 1, ou: "K", ov: "I" },
    19: { u: 1, v: 2, n: 0, ou: "J", ov: "K" },
};

const TAU = Math.PI * 2;

const TAP_OR_BORE_FEED_OUT = new Set([74, 84, 85, 89]);
const SIMPLE_BORE = new Set([76, 87, 88]);

export function parseNc(text: string, options: NcParseOptions = {}): NcParseResult {
    const segmentCap = options.segmentCap ?? 1_000_000;
    const segments: NcSegment[] = [];
    const cycles: NcCycle[] = [];
    const skipped: NcSkipped[] = [];
    const warnings: string[] = [];
    const tools: number[] = [];
    let program: string | null = null;
    let truncated = false;
    let min: number[] | null = null;
    let max: number[] | null = null;

    const stats: Record<SegmentKind | "skipped", number> = { rapid: 0, feed: 0, arc: 0, cycle: 0, skipped: 0 };

    // 模态状态。
    let pos = [0, 0, 0];
    let motion: number | null = null; // 0 | 1 | 2 | 3
    let plane = 17;
    let absolute = true; // G90
    let units = "mm"; // G21
    let returnInitial = true; // G98(对应 G99 退到 R 平面)
    let canned: { code: number; z?: number; r?: number; q?: number; p?: number; f?: number | null } | null = null;
    let cannedInitialZ = 0;
    let feed: number | null = null;
    let spindle: number | null = null;
    let pendingTool: number | null = null;
    let warnedS0 = false;
    let warnedCyclePlane = false;
    let warnedSimpleCycle = false;

    function warn(message: string): void {
        if (warnings.length < 200) warnings.push(message);
    }

    function growBounds(p: number[]): void {
        if (!min || !max) {
            min = [...p];
            max = [...p];
            return;
        }
        for (let i = 0; i < 3; i++) {
            if (p[i] < min[i]) min[i] = p[i];
            if (p[i] > max[i]) max[i] = p[i];
        }
    }

    function pushSegment(from: number[], to: number[], kind: SegmentKind, line: number): void {
        if (truncated) return;
        if (from[0] === to[0] && from[1] === to[1] && from[2] === to[2]) return;
        if (segments.length >= segmentCap) {
            truncated = true;
            warn(`轨迹段数达到上限 ${segmentCap}，显示已截断`);
            return;
        }
        // feed 快照模态 F 字(单位/分)供播放计时;快移与首个 F 之前为 null。
        segments.push({ from: [...from], to: [...to], kind, line, feed: kind === "rapid" ? null : feed });
        stats[kind] += 1;
        growBounds(from);
        growBounds(to);
    }

    // 当前距离模式下轴字给出的目标点;没写的轴保持不动。
    function targetPoint(params: Record<string, number>): number[] {
        const next = [...pos];
        for (const [axis, letter] of [[0, "X"], [1, "Y"], [2, "Z"]] as Array<[number, string]>) {
            const value = params[letter];
            if (value === undefined) continue;
            next[axis] = absolute ? value : pos[axis] + value;
        }
        return next;
    }

    function hasAxisWord(params: Record<string, number>): boolean {
        return params.X !== undefined || params.Y !== undefined || params.Z !== undefined;
    }

    // 把一个 G2/G3 段离散成 arc 线段。返回值(是否退化)在规格里未被调用方消费——
    // 退化圆弧只告警、不整行跳过,保持原样。
    function emitArc(cw: boolean, params: Record<string, number>, line: number): boolean {
        const frame = PLANES[plane];
        const end = targetPoint(params);
        const start = pos;
        const su = start[frame.u];
        const sv = start[frame.v];
        const eu = end[frame.u];
        const ev = end[frame.v];
        let cu: number;
        let cv: number;
        if (params.R !== undefined) {
            const r = Math.abs(params.R);
            const dx = eu - su;
            const dy = ev - sv;
            const chord = Math.hypot(dx, dy);
            if (chord === 0) {
                warn(`第 ${line} 行：R 圆弧弦长为 0，整圆请用 IJK`);
                return false;
            }
            if (r < chord / 2 - 1e-9) {
                warn(`第 ${line} 行：圆弧半径 ${r} 小于半弦 ${chord / 2}，已钳制`);
            }
            const h = Math.sqrt(Math.max(0, r * r - (chord / 2) ** 2));
            const mx = (su + eu) / 2;
            const my = (sv + ev) / 2;
            // 行进方向的左单位法向;顺时针劣弧圆心在右、逆时针劣弧在左,R 为负翻到优弧。
            const lx = -dy / chord;
            const ly = dx / chord;
            const sign = (cw ? -1 : 1) * (params.R >= 0 ? 1 : -1);
            cu = mx + sign * h * lx;
            cv = my + sign * h * ly;
        } else {
            const ou = params[frame.ou] ?? 0;
            const ov = params[frame.ov] ?? 0;
            if (ou === 0 && ov === 0) {
                warn(`第 ${line} 行：圆弧缺少 IJK 圆心或 R，已跳过`);
                return false;
            }
            cu = su + ou; // Fanuc:G90 下圆心偏置也是增量
            cv = sv + ov;
        }
        const radius = Math.hypot(su - cu, sv - cv);
        if (radius < 1e-9) {
            warn(`第 ${line} 行：零半径圆弧，已跳过`);
            return false;
        }
        const a0 = Math.atan2(sv - cv, su - cu);
        let a1 = Math.atan2(ev - cv, eu - cu);
        const fullCircle = su === eu && sv === ev && params.R === undefined;
        let sweep: number;
        if (fullCircle) {
            sweep = cw ? -TAU : TAU;
        } else if (cw) {
            while (a1 >= a0) a1 -= TAU;
            sweep = a1 - a0;
        } else {
            while (a1 <= a0) a1 += TAU;
            sweep = a1 - a0;
        }
        // 弦高误差驱动的步长(文件单位 0.05),夹在合理角度之间。
        const step = Math.min(Math.PI / 6, Math.max(Math.PI / 45, 2 * Math.acos(Math.max(-1, Math.min(1, 1 - 0.05 / radius)))));
        const steps = Math.min(720, Math.max(4, Math.ceil(Math.abs(sweep) / step)));
        const n0 = start[frame.n];
        const dn = end[frame.n] - n0; // 螺旋:第三轴沿扫角线性插值
        let prev = start;
        for (let i = 1; i <= steps; i++) {
            const angle = a0 + (sweep * i) / steps;
            const p = [...start];
            p[frame.u] = cu + radius * Math.cos(angle);
            p[frame.v] = cv + radius * Math.sin(angle);
            p[frame.n] = n0 + (dn * i) / steps;
            pushSegment(prev, p, "arc", line);
            prev = p;
        }
        pos = end; // 落点取编程终点本身,不取离散出来的最后一点
        return true;
    }

    // Fanuc 第 9 组固定循环在 (tx, ty) 处展开。切削段用 cycle(琥珀);定位与排屑退刀是快移。
    // G76/G87/G88 只画一段 R→Z——镗孔子动作不是查看器要管的。
    function emitCanned(params: Record<string, number>, line: number): void {
        const next = targetPoint(params);
        const tx = next[0];
        const ty = next[1];
        let rPlane: number;
        let zDepth: number;
        if (absolute) {
            rPlane = canned!.r ?? pos[2];
            zDepth = canned!.z ?? pos[2];
        } else {
            rPlane = cannedInitialZ + (canned!.r ?? 0);
            zDepth = rPlane + (canned!.z ?? 0);
        }
        const code = canned!.code;
        cycles.push({
            code,
            label: CANNED_CYCLES[code] ?? `G${code}`,
            at: [tx, ty],
            r: rPlane,
            z: zDepth,
            line,
        });

        if (plane !== 17 && !warnedCyclePlane) {
            warnedCyclePlane = true;
            warn(`第 ${line} 行：固定循环在 G${plane} 平面按 XY 孔位展开，请复核`);
        }

        if (tx !== pos[0] || ty !== pos[1]) {
            pushSegment(pos, [tx, ty, pos[2]], "rapid", line);
            pos = [tx, ty, pos[2]];
        }

        const retractZ = returnInitial ? cannedInitialZ : rPlane;

        if (SIMPLE_BORE.has(code)) {
            if (!warnedSimpleCycle) {
                warnedSimpleCycle = true;
                warn(`G${code} ${CANNED_CYCLES[code]}按 R→Z 简化显示，镗孔子步未展开`);
            }
            if (pos[2] !== rPlane) {
                pushSegment(pos, [tx, ty, rPlane], "rapid", line);
                pos = [tx, ty, rPlane];
            }
            pushSegment([tx, ty, rPlane], [tx, ty, zDepth], "cycle", line);
            if (zDepth !== retractZ) pushSegment([tx, ty, zDepth], [tx, ty, retractZ], "rapid", line);
            pos = [tx, ty, retractZ];
            return;
        }

        if (pos[2] !== rPlane) {
            pushSegment(pos, [tx, ty, rPlane], "rapid", line);
            pos = [tx, ty, rPlane];
        }

        const q = Math.abs(canned!.q ?? 0);
        const pecking = (code === 83 || code === 73) && q > 0 && rPlane !== zDepth;
        if (pecking) {
            const down = rPlane > zDepth;
            let zc = rPlane;
            let peckAt = rPlane;
            let guard = 0;
            while (guard < 10000) {
                guard += 1;
                const zn = down ? Math.max(peckAt - q, zDepth) : Math.min(peckAt + q, zDepth);
                pushSegment([tx, ty, zc], [tx, ty, zn], "cycle", line);
                pos = [tx, ty, zn];
                peckAt = zn;
                if (Math.abs(zn - zDepth) < 1e-9) break;
                if (code === 83) {
                    pushSegment([tx, ty, zn], [tx, ty, rPlane], "rapid", line);
                    zc = rPlane;
                } else {
                    const up = down ? Math.min(zn + 1, rPlane) : Math.max(zn - 1, rPlane);
                    pushSegment([tx, ty, zn], [tx, ty, up], "rapid", line);
                    zc = up;
                }
            }
        } else {
            pushSegment([tx, ty, rPlane], [tx, ty, zDepth], "cycle", line);
            pos = [tx, ty, zDepth];
        }

        if (pos[2] !== retractZ) {
            const kind = TAP_OR_BORE_FEED_OUT.has(code) ? "cycle" : "rapid";
            pushSegment(pos, [tx, ty, retractZ], kind, line);
        }
        pos = [tx, ty, retractZ];
    }

    function handleLine(rawText: string, lineNo: number): void {
        let line = rawText.replace(/\r/g, "");
        // 注释:`(...)` 成对的行内注释,`;` 到行尾。
        let stripped = "";
        let depth = 0;
        for (const ch of line) {
            if (ch === "(") {
                depth += 1;
                if (depth > 1) {
                    skipped.push({ line: lineNo, text: line.trim().slice(0, 120), reason: "nested comment" });
                    stats.skipped += 1;
                    return;
                }
                continue;
            }
            if (ch === ")") {
                if (depth === 0) {
                    skipped.push({ line: lineNo, text: line.trim().slice(0, 120), reason: "unmatched )" });
                    stats.skipped += 1;
                    return;
                }
                depth = 0;
                continue;
            }
            if (ch === ";" && depth === 0) break;
            if (depth === 0) stripped += ch;
        }
        if (depth !== 0) {
            skipped.push({ line: lineNo, text: line.trim().slice(0, 120), reason: "unterminated comment" });
            stats.skipped += 1;
            return;
        }
        line = stripped.trim();
        if (line === "" || line === "%") return;
        if (line.startsWith("/")) line = line.replace(/^\/+\s*/, ""); // 可选的跳段符

        // 切成字,并要求整行被完全覆盖——剩下任何杂散字符,整行算一次跳过
        //(方言跑偏时宁可不画,容错口径)。
        const words: Array<[string, number]> = [];
        let covered = 0;
        for (const match of line.matchAll(WORD_RE)) {
            const gap = line.slice(covered, match.index);
            if (gap.trim() !== "") {
                skipped.push({
                    line: lineNo, text: line.trim().slice(0, 120),
                    reason: `stray characters ${JSON.stringify(gap.trim())}`,
                });
                stats.skipped += 1;
                return;
            }
            covered = match.index + match[0].length;
            words.push([match[1].toUpperCase(), Number.parseFloat(match[2])]);
        }
        if (line.slice(covered).trim() !== "") {
            skipped.push({
                line: lineNo, text: line.trim().slice(0, 120),
                reason: `stray characters ${JSON.stringify(line.slice(covered).trim())}`,
            });
            stats.skipped += 1;
            return;
        }
        if (words.length === 0) return;

        const gCodes: number[] = [];
        const mCodes: number[] = [];
        const params: Record<string, number> = {};
        for (const [letter, value] of words) {
            if (letter === "G") gCodes.push(value);
            else if (letter === "M") mCodes.push(value);
            else if (letter === "N") continue; // 段号
            else if (letter === "O") { program = program ?? String(Math.trunc(value)); }
            else params[letter] = value; // 同一个字母出现多次,后面的算数
        }

        // 模态预扫(对支持的子集来说与书写顺序无关)。
        let motionHere: number | null = null;
        let cannedHere: number | null = null;
        let refReturn = false;
        for (const g of gCodes) {
            if (isG(g, 17)) plane = 17;
            else if (isG(g, 18)) plane = 18;
            else if (isG(g, 19)) plane = 19;
            else if (isG(g, 20)) {
                if (units !== "inch") warn(`第 ${lineNo} 行：G20 英制按文件数值绘制，未换算毫米`);
                units = "inch";
            } else if (isG(g, 21)) units = "mm";
            else if (isG(g, 90)) absolute = true;
            else if (isG(g, 91)) absolute = false;
            else if (isG(g, 90.1)) warn(`第 ${lineNo} 行：G90.1 绝对圆心不支持，IJK 仍按增量处理`);
            else if (isG(g, 98)) returnInitial = true;
            else if (isG(g, 99)) returnInitial = false;
            else if (isG(g, 80)) canned = null;
            else if (isG(g, 28) || isG(g, 30)) refReturn = true;
            else if (isG(g, 0) || isG(g, 1) || isG(g, 2) || isG(g, 3)) motionHere = Math.trunc(g);
            else if (CANNED_CYCLES[Math.trunc(g)] !== undefined && Math.abs(g - Math.trunc(g)) < 0.01) cannedHere = Math.trunc(g);
            // G40–G49 刀补、G53–G59 工件偏置、G61/G64、G94/G95:解析后忽略——查看器画的是编程坐标。
        }

        if (params.F !== undefined) feed = params.F;
        if (params.S !== undefined) {
            spindle = params.S;
            if (params.S === 0 && !warnedS0) {
                warnedS0 = true;
                warn(`第 ${lineNo} 行：S0 主轴转速为 0，必须回到 NC 复核`);
            }
        }
        if (params.T !== undefined) pendingTool = params.T;
        if (mCodes.some((m) => Math.trunc(m) === 6) && pendingTool !== null) {
            tools.push(pendingTool);
            pendingTool = null;
        }

        // G28/G30:只快移到中间点;最后一段去机床参考点,那个点在程序坐标里没有位置。
        if (refReturn) {
            if (hasAxisWord(params)) {
                const next = targetPoint(params);
                pushSegment(pos, next, "rapid", lineNo);
                pos = next;
            }
            return;
        }

        if (motionHere !== null) {
            motion = motionHere;
            canned = null; // 第 1 组的 G 代码会取消正在生效的固定循环
        }

        if (cannedHere !== null) {
            canned = {
                code: cannedHere,
                z: params.Z,
                r: params.R,
                q: params.Q,
                p: params.P,
                f: params.F ?? feed,
            };
            cannedInitialZ = pos[2];
            // Fanuc 在定义循环的这一段就按当前/模态的 XY 执行一次。
            emitCanned(params, lineNo);
            return;
        }

        // 循环生效期间,不带孔位的 Z/R/Q 改动只影响后续调用(Fanuc 语义)——不动、不重新执行。
        if (canned !== null && motionHere === null) {
            if (params.Q !== undefined) canned.q = params.Q;
            if (params.P !== undefined) canned.p = params.P;
            if (params.X !== undefined || params.Y !== undefined) {
                emitCanned(params, lineNo);
                return;
            }
            if (params.Z !== undefined || params.R !== undefined) {
                if (params.Z !== undefined) canned.z = params.Z;
                if (params.R !== undefined) canned.r = params.R;
                return;
            }
        }

        if (!hasAxisWord(params)) return; // 纯模态 / M 代码段
        if (motion === null) {
            skipped.push({
                line: lineNo, text: rawText.trim().slice(0, 120),
                reason: "axis words without an active motion mode",
            });
            stats.skipped += 1;
            return;
        }

        const next = targetPoint(params);
        if (motion === 0) {
            pushSegment(pos, next, "rapid", lineNo);
            pos = next;
        } else if (motion === 1) {
            pushSegment(pos, next, "feed", lineNo);
            pos = next;
        } else {
            emitArc(motion === 2, params, lineNo); // 退化圆弧在里面告警
        }
    }

    const lines = String(text ?? "").split("\n");
    for (let i = 0; i < lines.length; i++) {
        try {
            handleLine(lines[i], i + 1);
        } catch (error) {
            // 双保险:解析永不因 NC 内容抛异常。
            skipped.push({
                line: i + 1, text: lines[i].trim().slice(0, 120),
                reason: `parser error: ${error instanceof Error ? error.message : String(error)}`,
            });
            stats.skipped += 1;
        }
    }

    return {
        meta: {
            program,
            units,
            tools,
            lines: lines.length,
            skipped,
            warnings,
            truncated,
            feed,
            spindle,
        },
        segments,
        cycles,
        bounds: min && max ? { min, max } : null,
        stats,
    };
}
