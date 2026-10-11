// 面表/边表区段类型(与二进制布局对应,每项 16 字节)。
export interface FaceRange {
    vertexOffset: number; vertexCount: number; indexOffset: number; indexCount: number;
}

export interface EdgeRange {
    faceA: number; faceB: number; pointOffset: number; pointCount: number;
}
