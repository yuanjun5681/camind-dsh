// 几何包清单与面表解析。直译 core/src/geompack/manifest.cpp。
// 格式见 docs/几何包格式_v1_客户端摘录.md;钉 format = "camind-geom" / format_version = 1。
import { PackError } from "../error.ts";
import type { PackErrorCode } from "../error.ts";
import { kPackFormatName, kPackFormatVersion } from "../version.ts";

export interface FileEntry {
    role: string; lod: string; name: string; bytes: number; sha256: string;
    encoding: string; url: string; chordTolMm: number; angleTolDeg: number;
}

export interface BodyInfo {
    body: number; nFaces: number;
    name?: string; layer?: number; color?: number; translucency?: number;
    /** 仅作初始显隐；拾取跟当前有效显隐。 */
    blanked?: boolean;
    /** 跨包标识；稳定性验证通过前不作关联依赖。 */
    stableKey?: string;
}

/** 未进包清单逐体记录；未知 reason 按 other 展示，不拒包。 */
export interface ExcludedBody {
    key: string; name: string; reason: string; detail: string;
}

export interface Manifest {
    format: string; formatVersion: number; units: string; pipelineVersion: string;
    partRef: string; partSha256: string; stampedSha256: string; nxVersion: string; workerVersion: string;
    originOffset: number[];
    bboxRelative: { min: number[]; max: number[] };
    faceCount: number; edgeCount: number;
    bodyCount?: number;
    bodies?: BodyInfo[];
    /** undefined=未提供排除信息；[] = 枚举范围内无排除。 */
    excludedBodies?: ExcludedBody[];
    enumeratedBodyCount?: number;
    exclusionPolicy?: string;
    manifestRevision?: number;
    files: FileEntry[];
}

export interface FaceInfo {
    fid: string; body: number; surfaceType: string; rgb: [number, number, number];
    layer: number; areaMm2: number;
    bboxRelative: { min: number[]; max: number[] };
    opacity: number;
}

function fail(code: PackErrorCode, msg: string, file: string): never {
    throw new PackError(code, msg, file);
}

function parseOrThrow(text: string, file: string): any {
    try {
        return JSON.parse(text);
    } catch {
        fail("BadJson", file + ":不是合法的 JSON", file);
    }
}

function req(obj: any, key: string, file: string): any {
    if (typeof obj !== "object" || obj === null || !(key in obj) || obj[key] === null)
        fail("BadJson", file + ":缺少必填字段 " + key, file);
    return obj[key];
}

function str(obj: any, key: string, file: string): string {
    const v = req(obj, key, file);
    if (typeof v !== "string")
        fail("BadJson", file + ":字段 " + key + " 类型不对", file);
    return v;
}

function strOr(obj: any, key: string, fallback: string): string {
    const v = obj?.[key];
    return typeof v === "string" ? v : fallback;
}

// 拍板 #3(2026-10-09):整数字段接受「数值为整数的任何写法」(如 300.0 / 3e2),
// 不再按 JSON 字面量形式拒收。影响分析见 docs/TS迁移评估与决策_20261009.md §5。
function intInRange(obj: any, key: string, file: string, lo: number, hi: number): number {
    const v = req(obj, key, file);
    if (typeof v !== "number" || !Number.isInteger(v) || v < lo || v > hi)
        fail("BadJson", file + ":字段 " + key + " 类型不对", file);
    return v;
}

// 整数(JSON 里数值为整数的数;布尔、字符串都不算;放宽字面量形式)。
function integer(value: any): number | null {
    if (typeof value !== "number" || !Number.isInteger(value))
        return null;
    return value;
}

function optionalInt(obj: any, key: string): number | null {
    if (typeof obj !== "object" || obj === null || !(key in obj))
        return null;
    return integer(obj[key]);
}

function vec3(value: any, what: string, file: string): number[] {
    if (!Array.isArray(value) || value.length !== 3 || !value.every((v: any) => typeof v === "number"))
        fail("BadJson", file + ":" + what + " 应为 3 个数", file);
    return value;
}

function bbox(obj: any, key: string, file: string, required: boolean): { min: number[]; max: number[] } {
    const it = obj?.[key];
    if (typeof it !== "object" || it === null) {
        if (required)
            fail("BadJson", file + ":缺少必填字段 " + key, file);
        return { min: [0, 0, 0], max: [0, 0, 0] };
    }
    if (!("min" in it) || !("max" in it))
        fail("BadJson", file + ":" + key + " 缺 min / max", file);
    return { min: vec3(it.min, key, file), max: vec3(it.max, key, file) };
}

// 体表(CAM-Agent T-398 ②):这里核不需要面表的那几条,n_faces 与面表的对账在 checkBodies。
function parseBodies(value: any, bodyCount: number | null, file: string): BodyInfo[] {
    if (!Array.isArray(value))
        fail("BadJson", file + ":bodies 应为数组", file);
    if (bodyCount !== null && bodyCount !== value.length) {
        fail("CountMismatch",
            file + ":bodies 有 " + value.length + " 项,body_count 写的是 " + bodyCount, file);
    }
    const out: BodyInfo[] = [];
    for (let i = 0; i < value.length; ++i) {
        const item = value[i];
        if (typeof item !== "object" || item === null)
            fail("BadJson", file + ":bodies 的元素应为对象", file);
        const body = integer(item.body);
        if (body === null || body !== i)
            fail("InvalidValue", file + ":bodies 第 " + i + " 项的 body 应为 " + i + "(从 0 起连续)", file);
        const n = integer(item.n_faces);
        if (n === null || n <= 0 || n > 0xFFFFFFFF)
            fail("InvalidValue", file + ":体 " + i + " 的 n_faces 缺失或不是正整数", file);
        const b: BodyInfo = { body: i, nFaces: n };
        const t = item.translucency;
        if (t !== undefined && t !== null) {
            const ti = integer(t);
            if (ti === null || ti < 0 || ti > 100)
                fail("InvalidValue", file + ":体 " + i + " 的 translucency 应为 null 或 0 ~ 100 的整数", file);
            b.translucency = ti;
        }
        if (typeof item.name === "string")
            b.name = item.name;
        const layer = optionalInt(item, "layer");
        if (layer !== null) b.layer = layer;
        const color = optionalInt(item, "color");
        if (color !== null) b.color = color;
        if (item.blanked !== undefined && typeof item.blanked !== "boolean")
            fail("BadJson", file + ":体 " + i + " 的 blanked 应为布尔", file);
        if (typeof item.blanked === "boolean") b.blanked = item.blanked;
        if (item.stable_key !== undefined && typeof item.stable_key !== "string")
            fail("BadJson", file + ":体 " + i + " 的 stable_key 应为字符串", file);
        if (typeof item.stable_key === "string" && item.stable_key !== "") b.stableKey = item.stable_key;
        out.push(b);
    }
    return out;
}

function parseExcludedBodies(value: any, file: string): ExcludedBody[] {
    if (!Array.isArray(value))
        fail("BadJson", file + ":excluded_bodies 应为数组", file);
    const out: ExcludedBody[] = [];
    for (let i = 0; i < value.length; ++i) {
        const item = value[i];
        if (typeof item !== "object" || item === null || Array.isArray(item))
            fail("BadJson", file + ":excluded_bodies 的元素应为对象", file);
        const key = strOr(item, "key", "");
        if (!key.trim())
            fail("InvalidValue", file + ":excluded_bodies 第 " + i + " 项的 key 不能为空", file);
        out.push({
            key,
            name: strOr(item, "name", ""),
            reason: strOr(item, "reason", ""),
            detail: strOr(item, "detail", ""),
        });
    }
    return out;
}

export function parseManifest(text: string): Manifest {
    const file = "manifest.json";
    const doc = parseOrThrow(text, file);
    if (typeof doc !== "object" || doc === null || Array.isArray(doc))
        fail("BadJson", file + ":顶层应为对象", file);

    const m = {} as Manifest;
    m.format = str(doc, "format", file);
    if (m.format !== kPackFormatName)
        fail("UnsupportedFormat", '不是 Camind 几何包(format = "' + m.format + '")', file);
    m.formatVersion = intInRange(doc, "format_version", file, 0, 0xFFFFFFFF);
    if (m.formatVersion !== kPackFormatVersion)
        fail("UnsupportedFormat",
            "几何包格式版本 " + m.formatVersion + " 本程序不认识(只支持 " + kPackFormatVersion + "),请升级客户端", file);
    m.units = str(doc, "units", file);
    if (m.units !== "mm")
        fail("UnsupportedFormat", "v1 只支持毫米件,这个包的单位是 " + m.units, file);
    m.pipelineVersion = str(doc, "pipeline_version", file);
    m.partRef = strOr(doc, "part_ref", "");
    m.partSha256 = str(doc, "part_sha256", file);
    m.stampedSha256 = strOr(doc, "stamped_sha256", "");
    m.nxVersion = strOr(doc, "nx_version", "");
    m.workerVersion = strOr(doc, "worker_version", "");
    if (!("origin_offset" in doc))
        fail("BadJson", file + ":缺少必填字段 origin_offset", file);
    m.originOffset = vec3(doc.origin_offset, "origin_offset", file);
    m.bboxRelative = bbox(doc, "bbox_relative", file, true);
    m.faceCount = intInRange(doc, "face_count", file, 0, 0xFFFFFFFF);
    m.edgeCount = intInRange(doc, "edge_count", file, 0, 0xFFFFFFFF);

    const files = doc.files;
    if (!Array.isArray(files))
        fail("BadJson", file + ":缺少必填字段 files", file);
    m.files = files.map((item: any) => {
        if (typeof item !== "object" || item === null)
            fail("BadJson", file + ":files[] 的元素应为对象", file);
        const e = {} as FileEntry;
        e.role = str(item, "role", file);
        e.lod = strOr(item, "lod", "");
        e.name = str(item, "name", file);
        e.bytes = intInRange(item, "bytes", file, 0, Number.MAX_SAFE_INTEGER);
        e.sha256 = str(item, "sha256", file);
        e.encoding = strOr(item, "encoding", "none");
        e.url = strOr(item, "url", "");
        e.chordTolMm = typeof item.chord_tol_mm === "number" ? item.chord_tol_mm : 0;
        e.angleTolDeg = typeof item.angle_tol_deg === "number" ? item.angle_tol_deg : 0;
        if (e.encoding !== "gzip" && e.encoding !== "none")
            fail("UnsupportedFormat", "文件 " + e.name + " 的编码 " + e.encoding + " 本程序不认识", file);
        // 文件名只能是包目录下的普通文件名:不许带路径,防止清单把读写引到包外面去。
        if (!e.name || e.name.includes("/") || e.name.includes("\\") || e.name === "." || e.name === "..")
            fail("InvalidValue", "清单里的文件名不合法:" + e.name, file);
        return e;
    });

    // gp-1 保留旧读端：非法可选 body_count 忽略，且无零体附加约束；gp-2 起严格拒收。
    // excluded_bodies 是 gp-2 新合同，若旧包自行携带则仍须满足下面的完整对账。
    const legacyGp1 = m.pipelineVersion === "gp-1";
    if ("body_count" in doc) {
        if (legacyGp1) {
            const value = integer(doc.body_count);
            if (value !== null && value >= 0 && value <= 0xFFFFFFFF)
                m.bodyCount = value;
        } else {
            m.bodyCount = intInRange(doc, "body_count", file, 0, 0xFFFFFFFF);
        }
    }
    if ("bodies" in doc && doc.bodies !== null)
        m.bodies = parseBodies(doc.bodies, m.bodyCount ?? null, file);

    // excluded_bodies 出现时三项计数必须齐备且对账成立；undefined 与 [] 语义不同。
    if ("excluded_bodies" in doc) {
        m.excludedBodies = parseExcludedBodies(doc.excluded_bodies, file);
        if (!("enumerated_body_count" in doc) || m.bodyCount === undefined || m.bodies === undefined) {
            fail("CountMismatch",
                file + ":excluded_bodies 出现时 enumerated_body_count、body_count、bodies[] 必须齐备", file);
        }
        m.enumeratedBodyCount = intInRange(doc, "enumerated_body_count", file, 0, 0xFFFFFFFF);
        if (m.enumeratedBodyCount !== m.bodies.length + m.excludedBodies.length) {
            fail("CountMismatch",
                file + ":对账不成立 enumerated_body_count(" + m.enumeratedBodyCount
                + ") != bodies.length(" + m.bodies.length + ") + excluded_bodies(" + m.excludedBodies.length + ")", file);
        }
    }
    if (!legacyGp1 && (m.bodyCount === 0 || (m.bodies !== undefined && m.bodies.length === 0))) {
        const coords = [...m.bboxRelative.min, ...m.bboxRelative.max];
        if (coords.some(value => value !== 0))
            fail("InvalidValue", file + ":零体包的 bbox_relative 必须全为 0", file);
        if (m.faceCount !== 0 || m.edgeCount !== 0)
            fail("InvalidValue", file + ":零体包不应包含面或边线", file);
    }
    if ("exclusion_policy" in doc && typeof doc.exclusion_policy === "string")
        m.exclusionPolicy = doc.exclusion_policy;
    const revision = optionalInt(doc, "manifest_revision");
    if (revision !== null && revision >= 0) m.manifestRevision = revision;
    return m;
}

export function findEntry(manifest: Manifest, role: string, lod = ""): FileEntry | null {
    for (const e of manifest.files) {
        if (e.role === role && (lod === "" || e.lod === lod))
            return e;
    }
    return null;
}

export function lodName(lod: 0 | 1): string {
    return lod === 0 ? "coarse" : "fine";
}

export function meshEntry(manifest: Manifest, lod: 0 | 1): FileEntry | null {
    return findEntry(manifest, "mesh", lodName(lod));
}

// 带体表时:面表里每个 body 都在体表里、每体的张数与 n_faces 一致(拒绝码与 CAM-Agent 同名)。
export function checkBodies(manifest: Manifest, faces: FaceInfo[]): void {
    if (!manifest.bodies)
        return;
    const file = "manifest.json";
    const bodies = manifest.bodies;
    const counts = new Array<number>(bodies.length).fill(0);
    for (const f of faces) {
        if (f.body < 0 || f.body >= bodies.length) {
            fail("CountMismatch", file + ":面 " + f.fid + " 属于体 " + f.body + ",体表里没有这个体", file);
        }
        ++counts[f.body];
    }
    for (const b of bodies) {
        if (b.nFaces !== counts[b.body]) {
            fail("CountMismatch",
                file + ":体 " + b.body + " 的 n_faces 是 " + b.nFaces + ",面表里这个体有 " + counts[b.body] + " 张", file);
        }
    }
}

// NX 透明度原值 0~100(0 = 不透明)→ 每张面的不透明度。
export function opacityFromTranslucency(translucency: number | null | undefined): number {
    if (translucency === null || translucency === undefined)
        return 255;
    const t = Math.min(Math.max(translucency, 0), 100);
    return Math.round(255.0 * (100 - t) / 100.0);
}

export function applyBodyOpacity(manifest: Manifest, faces: FaceInfo[]): void {
    for (const f of faces) {
        f.opacity = 255;
        if (manifest.bodies && f.body >= 0 && f.body < manifest.bodies.length)
            f.opacity = opacityFromTranslucency(manifest.bodies[f.body].translucency);
    }
}

export function fidToIndex(fid: string): number {
    if (fid.length < 2 || fid[0] !== "F")
        return -1;
    let value = 0;
    for (let i = 1; i < fid.length; ++i) {
        const c = fid.charCodeAt(i);
        if (c < 0x30 || c > 0x39)
            return -1;
        value = value * 10 + (c - 0x30);
        if (value > 0xFFFFFFFF)
            return -1;
    }
    return value === 0 ? -1 : value - 1;
}

export function indexToFid(index: number): string {
    return "F" + String(index + 1).padStart(6, "0");
}

export function parseFaces(text: string, expectedCount: number): FaceInfo[] {
    const file = "faces.json";
    const doc = parseOrThrow(text, file);
    if (!Array.isArray(doc))
        fail("BadJson", file + ":顶层应为数组", file);
    if (doc.length !== expectedCount) {
        fail("CountMismatch", file + " 有 " + doc.length + " 张面,清单写的是 " + expectedCount, file);
    }
    const faces: FaceInfo[] = [];
    for (let index = 0; index < doc.length; ++index) {
        const item = doc[index];
        if (typeof item !== "object" || item === null)
            fail("BadJson", file + ":数组元素应为对象", file);
        const fid = str(item, "fid", file);
        if (fidToIndex(fid) !== index) {
            fail("InvalidValue",
                "第 " + index + " 张面的 FID 是 " + fid + ",应为 " + indexToFid(index) + "(数组下标 = FID 序号 − 1)", file);
        }
        // 面积必填、不许为空(拍板 #6):它是唯一能每张面都核的自动映射核对手段。
        const area = item.area_mm2;
        if (typeof area !== "number" || !(area > 0) || !Number.isFinite(area))
            fail("InvalidValue", "面 " + fid + " 的 area_mm2 缺失或为空", file);
        const rgb: [number, number, number] = [180, 180, 180];  // C++ manifest.h 的缺省面色
        if (Array.isArray(item.rgb) && item.rgb.length === 3) {
            for (let i = 0; i < 3; ++i) {
                if (typeof item.rgb[i] === "number")
                    rgb[i] = Math.min(255, Math.max(0, Math.trunc(item.rgb[i])));
            }
        }
        // body 非负整数(契约「第几个入选实体,从 0 起」);负数/浮点 ⇒ InvalidValue 拒——
        // 无体表老包没有 checkBodies 对账兜底,坏 body 会污染按体计数(Kimi cf4 补审必改)。
        const rawBody = item.body;
        if (typeof rawBody !== "number" || !Number.isSafeInteger(rawBody) || rawBody < 0)
            fail("InvalidValue", "面 " + fid + " 的 body 应为非负整数", file);
        faces.push({
            fid,
            body: rawBody,
            surfaceType: strOr(item, "surface_type", "other"),
            rgb,
            layer: typeof item.layer === "number" ? item.layer : 0,
            areaMm2: area,
            bboxRelative: bbox(item, "bbox_relative", file, false),
            opacity: 255,
        });
    }
    return faces;
}
