// 按实体汇总面表(CAM-Agent T-435:客户端显式声明原位电极 / 补体)。
// 直译 core/src/geompack/bodies.cpp + bodies.h。
// 几何包认不出哪个实体是电极、哪个是补体(名字/层/颜色只能当提示),要用户在客户端声明;
// 声明里带的面数(n_faces)就从这里数 —— 云端拿它核对「客户端说的体和它手上的是同一个」。
import type { FaceInfo } from "./manifest.ts";
import { fidToIndex } from "./manifest.ts";

export interface BodySummary {
    body: number;      // 面表里的 body
    faceCount: number; // 这个体有几张面
    bbox: { min: number[]; max: number[] }; // 各面包围盒的并(包坐标)
}

// 面表 → 每个体一项,按 body 从小到大。空面表 ⇒ 空。
export function summarizeBodies(faces: readonly FaceInfo[]): BodySummary[] {
    const by = new Map<number, BodySummary>();
    for (const f of faces) {
        const existing = by.get(f.body);
        if (!existing) {
            by.set(f.body, { body: f.body, faceCount: 1, bbox: { min: [...f.bboxRelative.min], max: [...f.bboxRelative.max] } });
        } else {
            for (let k = 0; k < 3; ++k) {
                existing.bbox.min[k] = Math.min(existing.bbox.min[k], f.bboxRelative.min[k]);
                existing.bbox.max[k] = Math.max(existing.bbox.max[k], f.bboxRelative.max[k]);
            }
            existing.faceCount += 1;
        }
    }
    // std::map 按 key 升序迭代;Map 保持插入序,显式排序对齐。
    return [...by.values()].sort((a, b) => a.body - b.body);
}

// fids 里落在 bodies 这几个体上的那些(保持 fids 的次序);不认识的 FID 跳过(另有 FID 校验管它)。
export function fidsOnBodies(faces: readonly FaceInfo[], fids: string[], bodies: number[]): string[] {
    const wanted = new Set(bodies);
    const out: string[] = [];
    for (const fid of fids) {
        const index = fidToIndex(fid);
        if (index < 0 || index >= faces.length)
            continue;
        if (wanted.has(faces[index].body))
            out.push(fid);
    }
    return out;
}
