// 逐顶点属性的构建。直译 core/src/render/mesh_buffers.cpp。
import type { Mesh, Edges, FaceInfo } from "./geompack/index.ts";
import { faceToPickId } from "./pick.ts";
import { v3 } from "./math.ts";
import type { BoundingBox } from "./math.ts";

// 被改写的字节区间(局部上传用;size = 0 表示面不存在)。
export interface ByteRange { offset: number; size: number; }

/** 把一张面的顶点颜色段整体改成 color,返回被改的字节区间。颜色用 [r,g,b,a] 四元组(同 C++ Rgba 数组)。 */
export function paintFace(colors: Uint8Array, mesh: Mesh, face: number,
                         color: [number, number, number, number]): ByteRange {
    if (face >= mesh.faceCount())
        return { offset: 0, size: 0 };
    const r = mesh.faceRange(face);
    const base = r.vertexOffset * 4;
    for (let v = 0; v < r.vertexCount; ++v) {
        const o = base + v * 4;
        colors[o] = color[0]; colors[o + 1] = color[1]; colors[o + 2] = color[2]; colors[o + 3] = color[3];
    }
    return { offset: base, size: r.vertexCount * 4 };
}

export function buildFaceIdAttribute(mesh: Mesh): Uint8Array {
    const ids = new Uint8Array(mesh.vertexCount() * 4);
    const dv = new DataView(ids.buffer);
    for (let f = 0; f < mesh.faceCount(); ++f) {
        const r = mesh.faceRange(f);
        const id = faceToPickId(f);
        for (let v = 0; v < r.vertexCount; ++v)
            dv.setUint32((r.vertexOffset + v) * 4, id, true);
    }
    return ids;
}

export function buildFaceColorAttribute(mesh: Mesh, faceInfos: FaceInfo[]): Uint8Array {
    const colors = new Uint8Array(mesh.vertexCount() * 4);
    for (let f = 0; f < mesh.faceCount(); ++f) {
        const r = mesh.faceRange(f);
        let r0 = 180, g0 = 180, b0 = 180, a0 = 255;
        if (f < faceInfos.length) {
            const c = faceInfos[f];
            r0 = c.rgb[0]; g0 = c.rgb[1]; b0 = c.rgb[2]; a0 = c.opacity;
        }
        for (let v = 0; v < r.vertexCount; ++v) {
            const o = (r.vertexOffset + v) * 4;
            colors[o] = r0; colors[o + 1] = g0; colors[o + 2] = b0; colors[o + 3] = a0;
        }
    }
    return colors;
}

export function buildEdgeLineIndices(edges: Edges): Uint32Array {
    const indices = new Uint32Array(edges.segmentCount() * 2);
    let out = 0;
    const e = edges.edges();
    for (let i = 0; i < edges.edgeCount(); ++i) {
        const pointOffset = e[i * 4 + 2], pointCount = e[i * 4 + 3];
        for (let k = 1; k < pointCount; ++k) {
            indices[out++] = pointOffset + k - 1;
            indices[out++] = pointOffset + k;
        }
    }
    return indices;
}

export function meshBounds(mesh: Mesh): BoundingBox {
    const pos = mesh.positions();
    if (pos.length === 0)
        return { min: v3(-1, -1, -1), max: v3(1, 1, 1) };
    let lox = Infinity, loy = Infinity, loz = Infinity;
    let hix = -Infinity, hiy = -Infinity, hiz = -Infinity;
    for (let i = 0; i + 2 < pos.length; i += 3) {
        lox = Math.min(lox, pos[i]); hix = Math.max(hix, pos[i]);
        loy = Math.min(loy, pos[i + 1]); hiy = Math.max(hiy, pos[i + 1]);
        loz = Math.min(loz, pos[i + 2]); hiz = Math.max(hiz, pos[i + 2]);
    }
    return { min: { x: lox, y: loy, z: loz }, max: { x: hix, y: hiy, z: hiz } };
}
