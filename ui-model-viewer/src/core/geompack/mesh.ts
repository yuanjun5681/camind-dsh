// 网格与边线的二进制解析。直译 core/src/geompack/mesh.cpp(Mesh 与 Edges 同文件)。
// 格式:magic CMGM/CMGE,小端,紧凑 u32/f32;TS 用 TypedArray 视图零拷贝
//(对齐 C++ 的 reinterpret_cast span;ArrayBuffer 天然满足 4 字节对齐)。
import { PackError } from "../error.ts";
import type { PackErrorCode } from "../error.ts";
import { kPackFormatVersion } from "../version.ts";
import type { FaceRange, EdgeRange } from "./types.ts";

const HEADER_SIZE = 32;
export const NO_FACE = 0xFFFFFFFF;

function fail(code: PackErrorCode, msg: string, file: string): never {
    throw new PackError(code, msg, file);
}

// 独立副本,保证 byteOffset = 0(TypedArray 视图要求 4 字节对齐)。
function ownBuffer(raw: Uint8Array): Uint8Array {
    if (raw.byteOffset === 0 && raw.byteLength === raw.buffer.byteLength)
        return raw;
    const copy = new Uint8Array(raw.byteLength);
    copy.set(raw);
    return copy;
}

function checkHeader(raw: Uint8Array, magic: string, file: string): void {
    if (raw.length < HEADER_SIZE)
        fail("BadLength", file + ":文件比 32 字节的头还短", file);
    const got = String.fromCharCode(raw[0], raw[1], raw[2], raw[3]);
    if (got !== magic)
        fail("BadMagic", file + ":magic 不是 " + magic, file);
    const version = raw[4] | (raw[5] << 8);
    if (version !== kPackFormatVersion)
        fail("UnsupportedFormat", "二进制格式版本 " + version + " 本程序不认识,请升级客户端", file);
}

function u32(p: Uint8Array, off: number): number {
    return (p[off] | (p[off + 1] << 8) | (p[off + 2] << 16)) + p[off + 3] * 0x1000000;
}

export class Mesh {
    private raw: Uint8Array;
    private lodValue = 0;
    private faceCountValue = 0;
    private vertexCountValue = 0;
    private indexCountValue = 0;
    private facesView!: Uint32Array;
    private positionsView!: Float32Array;
    private normalsView!: Float32Array;
    private indicesView!: Uint32Array;

    private constructor(raw: Uint8Array) {
        this.raw = raw;
    }

    static parse(input: Uint8Array, fileName: string): Mesh {
        const raw = ownBuffer(input);
        checkHeader(raw, "CMGM", fileName);
        const m = new Mesh(raw);
        m.lodValue = raw[6] | (raw[7] << 8);
        m.faceCountValue = u32(raw, 8);
        m.vertexCountValue = u32(raw, 12);
        m.indexCountValue = u32(raw, 16);
        if (m.lodValue > 1)
            fail("InvalidValue", fileName + ":lod 只能是 0(粗)或 1(细)", fileName);

        const expected = HEADER_SIZE + m.faceCountValue * 16 + m.vertexCountValue * 24 + m.indexCountValue * 4;
        if (expected !== raw.length) {
            fail("BadLength",
                fileName + ":文件长 " + raw.length + " 字节,按头里的计数应为 " + expected, fileName);
        }
        if (m.indexCountValue % 3 !== 0)
            fail("InvalidValue", fileName + ":索引数不是 3 的倍数", fileName);

        m.facesView = new Uint32Array(raw.buffer, HEADER_SIZE, m.faceCountValue * 4);
        const posOff = HEADER_SIZE + m.faceCountValue * 16;
        m.positionsView = new Float32Array(raw.buffer, posOff, m.vertexCountValue * 3);
        m.normalsView = new Float32Array(raw.buffer, posOff + m.vertexCountValue * 12, m.vertexCountValue * 3);
        m.indicesView = new Uint32Array(raw.buffer, posOff + m.vertexCountValue * 24, m.indexCountValue);

        // 面表:顶点段/索引段首尾相接不重叠,索引只指向本面顶点段。
        let nextVertex = 0, nextIndex = 0;
        for (let f = 0; f < m.faceCountValue; ++f) {
            const o = f * 4;
            const vo = m.facesView[o], vc = m.facesView[o + 1], io = m.facesView[o + 2], ic = m.facesView[o + 3];
            if (vo !== nextVertex || io !== nextIndex)
                fail("OutOfRange", fileName + ":第 " + f + " 张面的顶点段或索引段没有紧接上一张面", fileName);
            nextVertex += vc;
            nextIndex += ic;
            if (nextVertex > m.vertexCountValue || nextIndex > m.indexCountValue)
                fail("OutOfRange", fileName + ":第 " + f + " 张面的段越界", fileName);
            if (ic % 3 !== 0)
                fail("InvalidValue", fileName + ":第 " + f + " 张面的索引数不是 3 的倍数", fileName);
            const lo = vo, hi = vo + vc;
            for (let i = io; i < io + ic; ++i) {
                if (m.indicesView[i] < lo || m.indicesView[i] >= hi) {
                    fail("OutOfRange", fileName + ":第 " + f + " 张面有索引指到了本面顶点段之外", fileName);
                }
            }
        }
        if (nextVertex !== m.vertexCountValue || nextIndex !== m.indexCountValue)
            fail("OutOfRange", fileName + ":面表没有覆盖全部顶点或索引", fileName);
        return m;
    }

    lod(): number { return this.lodValue; }
    faceCount(): number { return this.faceCountValue; }
    vertexCount(): number { return this.vertexCountValue; }
    indexCount(): number { return this.indexCountValue; }
    triangleCount(): number { return (this.indexCountValue / 3) | 0; }

    faceRange(f: number): FaceRange {
        const o = f * 4;
        return { vertexOffset: this.facesView[o], vertexCount: this.facesView[o + 1],
                 indexOffset: this.facesView[o + 2], indexCount: this.facesView[o + 3] };
    }
    faces(): Uint32Array { return this.facesView; }
    positions(): Float32Array { return this.positionsView; }
    normals(): Float32Array { return this.normalsView; }
    indices(): Uint32Array { return this.indicesView; }

    faceArea(face: number): number {
        const r = this.faceRange(face);
        const pos = this.positionsView, idx = this.indicesView;
        let total = 0.0;
        for (let i = r.indexOffset; i + 2 < r.indexOffset + r.indexCount; i += 3) {
            const a = idx[i] * 3, b = idx[i + 1] * 3, c = idx[i + 2] * 3;
            const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
            const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
            const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
            total += 0.5 * Math.sqrt(nx * nx + ny * ny + nz * nz);
        }
        return total;
    }

    faceOfTriangle(triangle: number): number {
        // 找第一张 indexOffset > indexPos 的面(直译 upper_bound;空面自然被跳过)。
        const indexPos = triangle * 3;
        let lo = 0, hi = this.faceCountValue;
        while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (this.facesView[mid * 4 + 2] > indexPos) hi = mid; else lo = mid + 1;
        }
        return lo - 1;
    }
}

export class Edges {
    private raw: Uint8Array;
    private edgeCountValue = 0;
    private pointCountValue = 0;
    private edgesView!: Uint32Array;
    private pointsView!: Float32Array;

    private constructor(raw: Uint8Array) { this.raw = raw; }

    static parse(input: Uint8Array, faceCount: number, fileName: string): Edges {
        const raw = ownBuffer(input);
        checkHeader(raw, "CMGE", fileName);
        const e = new Edges(raw);
        e.edgeCountValue = u32(raw, 8);
        e.pointCountValue = u32(raw, 12);
        const expected = HEADER_SIZE + e.edgeCountValue * 16 + e.pointCountValue * 12;
        if (expected !== raw.length) {
            fail("BadLength", fileName + ":文件长 " + raw.length + " 字节,按头里的计数应为 " + expected, fileName);
        }

        e.edgesView = new Uint32Array(raw.buffer, HEADER_SIZE, e.edgeCountValue * 4);
        e.pointsView = new Float32Array(raw.buffer, HEADER_SIZE + e.edgeCountValue * 16, e.pointCountValue * 3);
        for (let i = 0; i < e.edgeCountValue; ++i) {
            const o = i * 4;
            const faceA = e.edgesView[o], faceB = e.edgesView[o + 1];
            const pointOffset = e.edgesView[o + 2], pointCount = e.edgesView[o + 3];
            if (pointOffset + pointCount > e.pointCountValue)
                fail("OutOfRange", fileName + ":第 " + i + " 条边的折线点段越界", fileName);
            if ((faceA !== NO_FACE && faceA >= faceCount) || (faceB !== NO_FACE && faceB >= faceCount)) {
                fail("OutOfRange", fileName + ":第 " + i + " 条边引用的面序号超出面数 " + faceCount, fileName);
            }
        }
        return e;
    }

    edgeCount(): number { return this.edgeCountValue; }
    pointCount(): number { return this.pointCountValue; }
    edges(): Uint32Array { return this.edgesView; }
    points(): Float32Array { return this.pointsView; }

    edgeRange(i: number): EdgeRange {
        const o = i * 4;
        return { faceA: this.edgesView[o], faceB: this.edgesView[o + 1],
                 pointOffset: this.edgesView[o + 2], pointCount: this.edgesView[o + 3] };
    }

    segmentCount(): number {
        let total = 0;
        for (let i = 0; i < this.edgeCountValue; ++i) {
            const c = this.edgesView[i * 4 + 3];
            total += c > 1 ? c - 1 : 0;
        }
        return total;
    }

    edgeLength(edge: number): number {
        const r = this.edgeRange(edge);
        const pts = this.pointsView;
        let total = 0.0;
        for (let i = 1; i < r.pointCount; ++i) {
            const a = (r.pointOffset + i - 1) * 3, b = (r.pointOffset + i) * 3;
            const dx = pts[b] - pts[a], dy = pts[b + 1] - pts[a + 1], dz = pts[b + 2] - pts[a + 2];
            total += Math.sqrt(dx * dx + dy * dy + dz * dz);
        }
        return total;
    }
}
