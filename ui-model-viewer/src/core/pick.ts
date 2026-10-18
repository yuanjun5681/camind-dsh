// 拾取的与图形接口无关的部分。直译 core/src/render/pick.cpp + pick.h。
import { Mat4, normalized, v3 } from "./math.ts";
import type { Vec3 } from "./math.ts";
import type { Mesh } from "./geompack/mesh.ts";

export const kPickSegmentFlag = 0x80000000;
export const kPickRegion = 9;

export const PickKind = { None: 0, Face: 1, Segment: 2 } as const;
export type PickKindValue = 0 | 1 | 2;

export interface PickHit { kind: PickKindValue; index: number; }

export function faceToPickId(faceIndex: number): number { return (faceIndex + 1) >>> 0; }
export function segmentToPickId(segment: number): number { return (kPickSegmentFlag | segment) >>> 0; }

export function decodePickId(id: number): PickHit {
    if (id === 0)
        return { kind: PickKind.None, index: 0 };
    if (id & kPickSegmentFlag)
        return { kind: PickKind.Segment, index: (id & ~kPickSegmentFlag) >>> 0 };
    return { kind: PickKind.Face, index: id - 1 };
}

// 把视口里以 (px, py) 为中心的 n×n 个像素放大成整张小画布。左乘在投影矩阵之前。
export function pickMatrix(viewportWidth: number, viewportHeight: number, px: number, py: number, n = kPickRegion): Mat4 {
    const sx = viewportWidth / n;
    const sy = viewportHeight / n;
    const cx = 2.0 * (px + 0.5) / viewportWidth - 1.0;
    const cy = 1.0 - 2.0 * (py + 0.5) / viewportHeight;
    return Mat4.translation(v3(-cx * sx, -cy * sy, 0)).mul(Mat4.scaling(sx, sy, 1));
}

// 判读读回的 n×n 小画布:邻域里有线段像素时取离中心最近的,否则取中心像素。
export function resolvePickRegion(rgba: Uint8Array, n = kPickRegion): PickHit {
    if (rgba.length < n * n * 4)
        return { kind: PickKind.None, index: 0 };
    const idAt = (x: number, y: number): number =>
        rgba[(y * n + x) * 4] | (rgba[(y * n + x) * 4 + 1] << 8) | (rgba[(y * n + x) * 4 + 2] << 16)
        | rgba[(y * n + x) * 4 + 3] * 0x1000000;
    const c = (n / 2) | 0;
    let bestDist = Number.MAX_SAFE_INTEGER;
    let bestSegment = 0;
    for (let y = 0; y < n; ++y) {
        for (let x = 0; x < n; ++x) {
            const id = idAt(x, y);
            if (!(id & kPickSegmentFlag))
                continue;
            const d = (x - c) * (x - c) + (y - c) * (y - c);
            if (d < bestDist) {
                bestDist = d;
                bestSegment = id;
            }
        }
    }
    if (bestDist !== Number.MAX_SAFE_INTEGER)
        return decodePickId(bestSegment);
    return decodePickId(idAt(c, c));
}

export interface Ray { origin: Vec3; direction: Vec3; }

export function rayThroughPixel(invViewProj: Mat4, viewportWidth: number, viewportHeight: number, px: number, py: number): Ray {
    const nx = 2.0 * (px + 0.5) / viewportWidth - 1.0;
    const ny = 1.0 - 2.0 * (py + 0.5) / viewportHeight;
    const nearPoint = invViewProj.transformPoint(v3(nx, ny, -1.0));
    const farPoint = invViewProj.transformPoint(v3(nx, ny, 1.0));
    return { origin: nearPoint, direction: normalized(v3(farPoint.x - nearPoint.x, farPoint.y - nearPoint.y, farPoint.z - nearPoint.z)) };
}

export interface CpuPickResult { hit: boolean; face: number; triangle: number; t: number; }

// 对账基准:Möller–Trumbore 逐三角形求交(双面),取最近交点。
export function cpuPick(mesh: Mesh, ray: Ray, visibleFace?: (face: number) => boolean): CpuPickResult {
    const pos = mesh.positions();
    const idx = mesh.indices();
    const best: CpuPickResult = { hit: false, face: 0, triangle: 0, t: Infinity };
    const triangles = (idx.length / 3) | 0;
    for (let t = 0; t < triangles; ++t) {
        if (visibleFace && !visibleFace(mesh.faceOfTriangle(t)))
            continue;
        const a = idx[t * 3] * 3, b = idx[t * 3 + 1] * 3, c = idx[t * 3 + 2] * 3;
        const ax = pos[a], ay = pos[a + 1], az = pos[a + 2];
        const e1x = pos[b] - ax, e1y = pos[b + 1] - ay, e1z = pos[b + 2] - az;
        const e2x = pos[c] - ax, e2y = pos[c + 1] - ay, e2z = pos[c + 2] - az;
        const px_ = ray.direction.y * e2z - ray.direction.z * e2y;
        const py_ = ray.direction.z * e2x - ray.direction.x * e2z;
        const pz_ = ray.direction.x * e2y - ray.direction.y * e2x;
        const det = e1x * px_ + e1y * py_ + e1z * pz_;
        if (Math.abs(det) < 1e-18)
            continue;
        const inv = 1 / det;
        const tvx = ray.origin.x - ax, tvy = ray.origin.y - ay, tvz = ray.origin.z - az;
        const u = (tvx * px_ + tvy * py_ + tvz * pz_) * inv;
        if (u < 0 || u > 1)
            continue;
        const qx = tvy * e1z - tvz * e1y, qy = tvz * e1x - tvx * e1z, qz = tvx * e1y - tvy * e1x;
        const v = (ray.direction.x * qx + ray.direction.y * qy + ray.direction.z * qz) * inv;
        if (v < 0 || u + v > 1)
            continue;
        const dist = (e2x * qx + e2y * qy + e2z * qz) * inv;
        if (dist >= 0 && dist < best.t) {
            best.hit = true;
            best.t = dist;
            best.triangle = t;
        }
    }
    if (best.hit)
        best.face = mesh.faceOfTriangle(best.triangle);
    return best;
}
