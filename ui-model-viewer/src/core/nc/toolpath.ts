// 刀路的显卡数据与工位变换、CAM 结果解析。直译 core/src/nc/toolpath.cpp + toolpath.h。
// 刀路在显示上就是一批线段:两个顶点一段,按加工先后排好,一次画完;
// 播放 = 只画前 N 段;点一段线 = 读出线段号 → 查到它在 NC 文件里的行号。
import { PackError } from "../error.ts";
import { RigidTransform, v3 } from "../math.ts";
import type { BoundingBox, Vec3 } from "../math.ts";
import { parseNc } from "./parser.ts";
import type { NcParseResult, SegmentKind } from "./parser.ts";

// 与 C++ Rgba(std::array<uint8_t,4>)同构:四元组 [r,g,b,a]。
export type Rgba = [number, number, number, number];

export interface ToolpathColors {
    rapid: Rgba; // 快移:蓝
    feed: Rgba;  // 切削:绿
    arc: Rgba;   // 圆弧:青
    cycle: Rgba; // 固定循环:琥珀
}

export function defaultToolpathColors(): ToolpathColors {
    return {
        rapid: [110, 150, 235, 255],
        feed: [70, 210, 120, 255],
        arc: [60, 200, 215, 255],
        cycle: [240, 180, 60, 255],
    };
}

export interface ToolpathBuffers {
    positions: Float32Array; // 每顶点 3 个 float(NC 坐标),两个顶点一段
    colors: Uint8Array;      // 每顶点 4 字节 RGBA
    lines: number[];         // 每段对应的 NC 行号(从 1 起)
}

export function segmentCount(path: ToolpathBuffers): number {
    return path.lines.length;
}

export function buildToolpathBuffers(parsed: NcParseResult, colors: ToolpathColors = defaultToolpathColors()): ToolpathBuffers {
    const n = parsed.segments.length;
    const positions = new Float32Array(n * 6);
    const outColors = new Uint8Array(n * 8);
    const lines: number[] = [];
    for (let i = 0; i < n; ++i) {
        const s = parsed.segments[i];
        for (const [v, p] of [[0, s.from], [1, s.to]] as Array<[number, number[]]>) {
            positions[i * 6 + v * 3 + 0] = p[0];
            positions[i * 6 + v * 3 + 1] = p[1];
            positions[i * 6 + v * 3 + 2] = p[2];
        }
        const c: Rgba = s.kind === "feed" ? colors.feed
            : s.kind === "arc" ? colors.arc
            : s.kind === "cycle" ? colors.cycle
            : colors.rapid;
        for (let v = 0; v < 2; ++v) {
            const o = i * 8 + v * 4;
            outColors[o] = c[0]; outColors[o + 1] = c[1]; outColors[o + 2] = c[2]; outColors[o + 3] = c[3];
        }
        lines.push(s.line);
    }
    return { positions, colors: outColors, lines };
}

// 行号 ≥ line 的第一段(点 NC 文本的某一行 → 播放头跳到那里)。这一行及之后都没有线段时为 null。
export function firstSegmentAtOrAfterLine(path: ToolpathBuffers, line: number): number | null {
    // 线段按加工先后排,行号单调不减,可以二分。
    let lo = 0, hi = path.lines.length;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (path.lines[mid] < line) lo = mid + 1; else hi = mid;
    }
    return lo < path.lines.length ? lo : null;
}

// 刀路在 NC 坐标下的包围盒;没有线段时返回 null。(边界在解析时已算好。)
export function toolpathBounds(parsed: NcParseResult): BoundingBox | null {
    if (!parsed.bounds)
        return null;
    return {
        min: v3(parsed.bounds.min[0], parsed.bounds.min[1], parsed.bounds.min[2]),
        max: v3(parsed.bounds.max[0], parsed.bounds.max[1], parsed.bounds.max[2]),
    };
}

// ───────────────────────────── CAM 结果(方案 §5.2⑥ 的 stations[] 等)─────────────────────────────

export interface Station {
    name: string;        // G54、G55……
    partToNc: RigidTransform; // 原样取自 part_to_nc.{r, t}
}

// part_to_nc 的输入是哪个坐标系。★2026-10-03 CAM-Agent 已定(用户拍板 D4):**包坐标**,
// MCS 用真机回读值。PartAbsolute 只留作对照(排查别家给的结果用),云端不会再按它出。
export const StationFrame = { Package: 0, PartAbsolute: 1 } as const;
export type StationFrameKind = 0 | 1;

// 一道工序(云端一张切削面一道工序、一道一份 NC)。
export interface CamOperation {
    name: string;   // 工序名
    fid: string;    // 它切的那张面
    ncFile: string; // 它的 NC 文件名(在 ncFiles 里)
    // ★CAM-Agent T-438:刀盖住了这张面的多少、刀够不着没铣到的面积/比例。老结果没有这三项。
    coverage: number | null;        // 0..1
    residueMm2: number | null;      // mm²
    residueFraction: number | null; // 0..1
}

// ★CAM-Agent T-435:请求里声明的原位电极/补体,云端回显的样子。
export interface CamAuxBodyEcho {
    body: number;      // 面表里的 body
    nFaces: number;
    role: string;      // electrode(不切、不参与过切检查)/ fill(不切、参与过切检查)/ reference(参照,T-443)
    excluded: boolean | null; // electrode / reference:零件几何读回里确实没有它;fill 恒 false;云端读不出 ⇒ null
}

export interface CamResult {
    ncFiles: string[];              // ★一张切削面一份,从高到低;全部取回来叠,不能只取第一份
    stations: Station[];            // 几份 NC 共用
    originOffset: number[] | null;
    operations: CamOperation[];     // 与 ncFiles 同序;老的结果没有这个字段
    notApplied: string[];           // 请求的 op 里云端没施加的字段(如 stepover_mm),要让用户看见
    strategy: string;               // ★T-438:云端这次用的是哪条出法(planar_face / face_mill);老结果为空
    auxBodies: CamAuxBodyEcho[] | null; // ★T-435:声明的回显;请求里声明了、这里却为 null ⇒ 云端还不认声明
}

function fail(code: "BadJson" | "InvalidValue", msg: string): never {
    throw new PackError(code, msg, "cam_result");
}

function vec3Field(v: any, what: string): number[] {
    if (!Array.isArray(v) || v.length !== 3 || !v.every((x: any) => typeof x === "number"))
        fail("BadJson", "CAM 结果:" + what + " 应为 3 个数");
    return v;
}

export function parseCamResult(text: string): CamResult {
    let doc: any;
    try {
        doc = JSON.parse(text);
    } catch {
        fail("BadJson", "CAM 结果不是合法的 JSON 对象");
    }
    if (typeof doc !== "object" || doc === null || Array.isArray(doc))
        fail("BadJson", "CAM 结果不是合法的 JSON 对象");

    const out = {} as CamResult;
    out.ncFiles = [];
    out.stations = [];
    out.operations = [];
    out.notApplied = [];
    out.strategy = "";
    out.originOffset = null;
    out.auxBodies = null;

    if (Array.isArray(doc.nc_files)) {
        for (const f of doc.nc_files) {
            if (typeof f === "string")
                out.ncFiles.push(f);
        }
    }
    if (doc.origin_offset !== undefined && doc.origin_offset !== null)
        out.originOffset = vec3Field(doc.origin_offset, "origin_offset");

    if (Array.isArray(doc.stations)) {
        for (const item of doc.stations) {
            if (typeof item !== "object" || item === null || typeof item.part_to_nc !== "object" || item.part_to_nc === null)
                fail("BadJson", "CAM 结果:stations[] 的元素缺 part_to_nc");
            const t = item.part_to_nc;
            const station = {} as Station;
            station.name = typeof item.name === "string" ? item.name : "";
            if (!("t" in t) || !("r" in t))
                fail("BadJson", "CAM 结果:part_to_nc 缺 t 或 r");
            const rt = new RigidTransform();
            rt.t = vec3Field(t.t, "part_to_nc.t");
            const r = t.r;
            if (!Array.isArray(r) || r.length !== 3)
                fail("BadJson", "CAM 结果:part_to_nc.r 应为 3×3");
            for (let row = 0; row < 3; ++row)
                rt.r[row] = vec3Field(r[row], "part_to_nc.r 的一行");
            // 归心是平移 + 90° 整数倍旋转,翻面是绕 X 转 180°:都是正交阵。不正交说明数据写错了,
            // 照着摆刀路只会摆出一个似是而非的位置,直接拒收。
            if (!rt.isOrthonormal(1e-6))
                fail("InvalidValue", "CAM 结果:工位 " + station.name + " 的 part_to_nc.r 不是正交阵");
            station.partToNc = rt;
            out.stations.push(station);
        }
    }
    if (doc.operations !== undefined && doc.operations !== null) {
        if (!Array.isArray(doc.operations))
            fail("BadJson", "CAM 结果:operations 应为数组");
        for (const item of doc.operations) {
            if (typeof item !== "object" || item === null)
                fail("BadJson", "CAM 结果:operations[] 的元素应为对象");
            const optNum = (key: string): number | null => {
                const f = item[key];
                if (f === undefined || f === null)
                    return null;
                if (typeof f !== "number")
                    fail("BadJson", "CAM 结果:operations[]." + key + " 应为数");
                return f;
            };
            out.operations.push({
                name: typeof item.name === "string" ? item.name : "",
                fid: typeof item.fid === "string" ? item.fid : "",
                ncFile: typeof item.nc_file === "string" ? item.nc_file : "",
                coverage: optNum("coverage"), // ★T-438:覆盖率与残留(worker ≥ 675 才有);有但不是数 ⇒ 拒收
                residueMm2: optNum("residue_mm2"),
                residueFraction: optNum("residue_fraction"),
            });
        }
    }
    if (doc.strategy !== undefined && doc.strategy !== null) {
        if (typeof doc.strategy !== "string")
            fail("BadJson", "CAM 结果:strategy 应为字符串");
        out.strategy = doc.strategy;
    }
    if (doc.aux_bodies !== undefined && doc.aux_bodies !== null) {
        // ★T-435:声明的回显(worker ≥ 676)。body/n_faces 按数值整数收(拍板 #3 同口径)。
        if (!Array.isArray(doc.aux_bodies))
            fail("BadJson", "CAM 结果:aux_bodies 应为数组");
        const echo: CamAuxBodyEcho[] = [];
        for (const item of doc.aux_bodies) {
            if (typeof item !== "object" || item === null
                || !Number.isInteger(item.body) || !Number.isInteger(item.n_faces) || typeof item.role !== "string") {
                fail("BadJson", "CAM 结果:aux_bodies[] 要有整数 body / n_faces 与字符串 role");
            }
            const one: CamAuxBodyEcho = { body: item.body, nFaces: item.n_faces, role: item.role, excluded: null };
            if (item.excluded !== undefined && item.excluded !== null) {
                if (typeof item.excluded !== "boolean")
                    fail("BadJson", "CAM 结果:aux_bodies[].excluded 应为布尔");
                one.excluded = item.excluded;
            }
            echo.push(one);
        }
        out.auxBodies = echo;
    }
    if (doc.not_applied !== undefined && doc.not_applied !== null) {
        if (!Array.isArray(doc.not_applied))
            fail("BadJson", "CAM 结果:not_applied 应为数组");
        for (const f of doc.not_applied) {
            if (typeof f !== "string")
                fail("BadJson", "CAM 结果:not_applied[] 应为字段名");
            out.notApplied.push(f);
        }
    }
    return out;
}

// ★T-438:有「刀够不着、没铣到」的工序(残留面积 > minResidueMm2),按 operations 的次序。
export function operationsWithResidue(result: CamResult, minResidueMm2 = 0.5): CamOperation[] {
    return result.operations.filter((op) => op.residueMm2 !== null && op.residueMm2 > minResidueMm2);
}

// 几份 NC 拼成一份:每份的刀路都在,各份原文一字不改。
// 分隔行只用 ASCII:解析器要能原样跳过它,别让注释里的多字节字符成为变数。
export function joinNcPrograms(files: Array<[string, string]>): string {
    let out = "";
    const n = files.length;
    for (let k = 0; k < n; ++k) {
        if (n > 1)
            out += "(=== " + (k + 1) + "/" + n + " " + files[k][0] + " ===)\n";
        out += files[k][1];
        if (out.length > 0 && out[out.length - 1] !== "\n")
            out += "\n";
    }
    return out;
}

// 工位变换换算到包坐标口径。Package 口径原样返回;
// PartAbsolute(只作对照):p_nc = R·(p_pkg + oo) + t = R·p_pkg + (R·oo + t)。
export function stationToPackageFrame(partToNc: RigidTransform, frame: StationFrameKind,
                                      originOffset: number[]): RigidTransform {
    if (frame === StationFrame.Package)
        return partToNc;
    const out = new RigidTransform();
    out.r = partToNc.r.map((row) => [...row]);
    out.t = [...partToNc.t];
    for (let i = 0; i < 3; ++i) {
        out.t[i] = partToNc.t[i] + partToNc.r[i][0] * originOffset[0] + partToNc.r[i][1] * originOffset[1]
                 + partToNc.r[i][2] * originOffset[2];
    }
    return out;
}

// 便捷:解析 + 建缓冲一步(C++ 侧没有,查看器装载用)。
export function buildToolpathFromText(text: string, options?: Parameters<typeof parseNc>[1]): ToolpathBuffers {
    return buildToolpathBuffers(parseNc(text, options));
}

export type { Vec3 };
