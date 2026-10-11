// 面积自检:每张面的网格面积对比 faces.json 里的 area_mm2(NX 的解析值)。
// 唯一能对每张面都做的自动面映射核对(方案 §10.1、拍板 #6);全量、不许跳过。
// 直译 core/src/geompack/selfcheck.cpp + selfcheck.h。
import { PackError } from "../error.ts";
import type { Mesh } from "./mesh.ts";
import { NO_FACE } from "./mesh.ts";
import type { FaceInfo } from "./manifest.ts";
import type { Edges } from "./mesh.ts";

export interface AreaCheckOptions {
    // 相对差上限。方案的验收线是 0.1%。
    relativeTolerance: number; // 缺省 1e-3
    // 大于 0 时,额外放宽「边界长度 × 该值」的绝对面积:边界折线离曲线最多差一个弦高,
    // 由此带来的面积误差上界就是周长 × 弦高。默认 0 = 严格按相对差判。需要同时给 edges。
    boundaryChordTolMm: number;
}

export function defaultAreaCheckOptions(): AreaCheckOptions {
    return { relativeTolerance: 1e-3, boundaryChordTolMm: 0.0 };
}

export interface FaceAreaResult {
    face: number;
    meshArea: number;
    referenceArea: number;
    relativeError: number; // |mesh − ref| / ref
    allowedAbsError: number;
    ok: boolean;
}

export interface AreaCheckReport {
    faceCount: number;
    failedCount: number;
    maxRelativeError: number;
    worstFace: number;
    failures: FaceAreaResult[]; // 只收不合格的面,按面序号升序
    ok(): boolean;
}

export function checkFaceAreas(mesh: Mesh, faces: FaceInfo[],
                               options: AreaCheckOptions = defaultAreaCheckOptions(),
                               edges: Edges | null = null): AreaCheckReport {
    if (mesh.faceCount() !== faces.length) {
        throw new PackError("CountMismatch",
            "面积自检:网格有 " + mesh.faceCount() + " 张面,faces.json 有 " + faces.length, "faces.json");
    }

    // 每张面的边界长度(只在要放宽边界误差时才算)。
    let perimeter: number[] | null = null;
    if (options.boundaryChordTolMm > 0.0 && edges) {
        perimeter = new Array<number>(faces.length).fill(0.0);
        for (let i = 0; i < edges.edgeCount(); ++i) {
            const r = edges.edgeRange(i);
            const len = edges.edgeLength(i);
            if (r.faceA !== NO_FACE)
                perimeter[r.faceA] += len;
            if (r.faceB !== NO_FACE && r.faceB !== r.faceA)
                perimeter[r.faceB] += len;
        }
    }

    const report: AreaCheckReport = {
        faceCount: mesh.faceCount(), failedCount: 0, maxRelativeError: 0, worstFace: 0, failures: [],
        ok(): boolean { return this.failedCount === 0; },
    };
    for (let f = 0; f < mesh.faceCount(); ++f) {
        const meshArea = mesh.faceArea(f);
        const referenceArea = faces[f].areaMm2;
        const absError = Math.abs(meshArea - referenceArea);
        const relativeError = absError / referenceArea;
        let allowedAbsError = options.relativeTolerance * referenceArea;
        if (perimeter)
            allowedAbsError += perimeter[f] * options.boundaryChordTolMm;
        const ok = absError <= allowedAbsError;
        if (relativeError > report.maxRelativeError) {
            report.maxRelativeError = relativeError;
            report.worstFace = f;
        }
        if (!ok) {
            ++report.failedCount;
            report.failures.push({ face: f, meshArea, referenceArea, relativeError, allowedAbsError, ok });
        }
    }
    return report;
}
