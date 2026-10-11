// 最小的向量/矩阵数学(双精度)。直译 core/src/math.cpp + math.h。
// 矩阵按列主序存 16 个数(m[col*4+row]),产出 OpenGL 风格裁剪空间(WebGL 原生同约定)。

export interface Vec3 { x: number; y: number; z: number; }

export function v3(x = 0, y = 0, z = 0): Vec3 { return { x, y, z }; }
export function add(a: Vec3, b: Vec3): Vec3 { return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }; }
export function sub(a: Vec3, b: Vec3): Vec3 { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }; }
export function scale(a: Vec3, s: number): Vec3 { return { x: a.x * s, y: a.y * s, z: a.z * s }; }
export function neg(a: Vec3): Vec3 { return { x: -a.x, y: -a.y, z: -a.z }; }
export function dot(a: Vec3, b: Vec3): number { return a.x * b.x + a.y * b.y + a.z * b.z; }
export function cross(a: Vec3, b: Vec3): Vec3 {
    return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}
export function length(a: Vec3): number { return Math.sqrt(dot(a, a)); }
export function normalized(a: Vec3): Vec3 {
    const len = length(a);
    return len > 0 ? scale(a, 1 / len) : a;
}

export class Mat4 {
    m: Float64Array = Mat4.identityArray();

    static identityArray(): Float64Array {
        const a = new Float64Array(16);
        a[0] = a[5] = a[10] = a[15] = 1;
        return a;
    }

    at(row: number, col: number): number { return this.m[col * 4 + row]; }
    set(row: number, col: number, v: number): void { this.m[col * 4 + row] = v; }

    static identity(): Mat4 { return new Mat4(); }

    static translation(t: Vec3): Mat4 {
        const r = new Mat4();
        r.set(0, 3, t.x); r.set(1, 3, t.y); r.set(2, 3, t.z);
        return r;
    }

    static scaling(sx: number, sy: number, sz: number): Mat4 {
        const r = new Mat4();
        r.set(0, 0, sx); r.set(1, 1, sy); r.set(2, 2, sz);
        return r;
    }

    static perspective(fovY: number, aspect: number, n: number, f: number): Mat4 {
        const t = 1.0 / Math.tan(fovY / 2.0);
        const r = new Mat4();
        r.m.fill(0);
        r.set(0, 0, t / aspect);
        r.set(1, 1, t);
        r.set(2, 2, (f + n) / (n - f));
        r.set(2, 3, (2.0 * f * n) / (n - f));
        r.set(3, 2, -1.0);
        return r;
    }

    static orthographic(hw: number, hh: number, n: number, f: number): Mat4 {
        const r = new Mat4();
        r.set(0, 0, 1.0 / hw);
        r.set(1, 1, 1.0 / hh);
        r.set(2, 2, -2.0 / (f - n));
        r.set(2, 3, -(f + n) / (f - n));
        return r;
    }

    mul(o: Mat4): Mat4 {
        const r = new Mat4();
        for (let col = 0; col < 4; ++col) {
            for (let row = 0; row < 4; ++row) {
                let s = 0.0;
                for (let k = 0; k < 4; ++k)
                    s += this.at(row, k) * o.at(k, col);
                r.set(row, col, s);
            }
        }
        return r;
    }

    transformPoint(p: Vec3): Vec3 {
        const m = this.m;
        const x = m[0] * p.x + m[4] * p.y + m[8] * p.z + m[12];
        const y = m[1] * p.x + m[5] * p.y + m[9] * p.z + m[13];
        const z = m[2] * p.x + m[6] * p.y + m[10] * p.z + m[14];
        const w = m[3] * p.x + m[7] * p.y + m[11] * p.z + m[15];
        if (w !== 0 && w !== 1)
            return { x: x / w, y: y / w, z: z / w };
        return { x, y, z };
    }

    transformDirection(d: Vec3): Vec3 {
        const m = this.m;
        return {
            x: m[0] * d.x + m[4] * d.y + m[8] * d.z,
            y: m[1] * d.x + m[5] * d.y + m[9] * d.z,
            z: m[2] * d.x + m[6] * d.y + m[10] * d.z,
        };
    }

    // 一般 4×4 求逆(余子式展开,与 MESA gluInvertMatrix 同一套公式)。不可逆返回单位阵。
    inverted(): Mat4 {
        const a = this.m;
        const inv = new Float64Array(16);
        inv[0] = a[5] * a[10] * a[15] - a[5] * a[11] * a[14] - a[9] * a[6] * a[15] + a[9] * a[7] * a[14] + a[13] * a[6] * a[11] - a[13] * a[7] * a[10];
        inv[4] = -a[4] * a[10] * a[15] + a[4] * a[11] * a[14] + a[8] * a[6] * a[15] - a[8] * a[7] * a[14] - a[12] * a[6] * a[11] + a[12] * a[7] * a[10];
        inv[8] = a[4] * a[9] * a[15] - a[4] * a[11] * a[13] - a[8] * a[5] * a[15] + a[8] * a[7] * a[13] + a[12] * a[5] * a[11] - a[12] * a[7] * a[9];
        inv[12] = -a[4] * a[9] * a[14] + a[4] * a[10] * a[13] + a[8] * a[5] * a[14] - a[8] * a[6] * a[13] - a[12] * a[5] * a[10] + a[12] * a[6] * a[9];
        inv[1] = -a[1] * a[10] * a[15] + a[1] * a[11] * a[14] + a[9] * a[2] * a[15] - a[9] * a[3] * a[14] - a[13] * a[2] * a[11] + a[13] * a[3] * a[10];
        inv[5] = a[0] * a[10] * a[15] - a[0] * a[11] * a[14] - a[8] * a[2] * a[15] + a[8] * a[3] * a[14] + a[12] * a[2] * a[11] - a[12] * a[3] * a[10];
        inv[9] = -a[0] * a[9] * a[15] + a[0] * a[11] * a[13] + a[8] * a[1] * a[15] - a[8] * a[3] * a[13] - a[12] * a[1] * a[11] + a[12] * a[3] * a[9];
        inv[13] = a[0] * a[9] * a[14] - a[0] * a[10] * a[13] - a[8] * a[1] * a[14] + a[8] * a[2] * a[13] + a[12] * a[1] * a[10] - a[12] * a[2] * a[9];
        inv[2] = a[1] * a[6] * a[15] - a[1] * a[7] * a[14] - a[5] * a[2] * a[15] + a[5] * a[3] * a[14] + a[13] * a[2] * a[7] - a[13] * a[3] * a[6];
        inv[6] = -a[0] * a[6] * a[15] + a[0] * a[7] * a[14] + a[4] * a[2] * a[15] - a[4] * a[3] * a[14] - a[12] * a[2] * a[7] + a[12] * a[3] * a[6];
        inv[10] = a[0] * a[5] * a[15] - a[0] * a[7] * a[13] - a[4] * a[1] * a[15] + a[4] * a[3] * a[13] + a[12] * a[1] * a[7] - a[12] * a[3] * a[5];
        inv[14] = -a[0] * a[5] * a[14] + a[0] * a[6] * a[13] + a[4] * a[1] * a[14] - a[4] * a[2] * a[13] - a[12] * a[1] * a[6] + a[12] * a[2] * a[5];
        inv[3] = -a[1] * a[6] * a[11] + a[1] * a[7] * a[10] + a[5] * a[2] * a[11] - a[5] * a[3] * a[10] - a[9] * a[2] * a[7] + a[9] * a[3] * a[6];
        inv[7] = a[0] * a[6] * a[11] - a[0] * a[7] * a[10] - a[4] * a[2] * a[11] + a[4] * a[3] * a[10] + a[8] * a[2] * a[7] - a[8] * a[3] * a[6];
        inv[11] = -a[0] * a[5] * a[11] + a[0] * a[7] * a[9] + a[4] * a[1] * a[11] - a[4] * a[3] * a[9] - a[8] * a[1] * a[7] + a[8] * a[3] * a[5];
        inv[15] = a[0] * a[5] * a[10] - a[0] * a[6] * a[9] - a[4] * a[1] * a[10] + a[4] * a[2] * a[9] + a[8] * a[1] * a[6] - a[8] * a[2] * a[5];

        const det = a[0] * inv[0] + a[1] * inv[4] + a[2] * inv[8] + a[3] * inv[12];
        if (det === 0 || !Number.isFinite(det))
            return new Mat4();
        const r = new Mat4();
        const s = 1.0 / det;
        for (let i = 0; i < 16; ++i)
            r.m[i] = inv[i] * s;
        return r;
    }

    toFloat32(): Float32Array {
        const f = new Float32Array(16);
        for (let i = 0; i < 16; ++i)
            f[i] = this.m[i];
        return f;
    }
}

export interface BoundingBox { min: Vec3; max: Vec3; }

export function boxCenter(b: BoundingBox): Vec3 { return scale(add(b.min, b.max), 0.5); }
export function boxRadius(b: BoundingBox): number { return length(sub(b.max, b.min)) * 0.5; }

// 刚体变换 p' = R·p + t。R 按行存:r[row][col]。刀路叠回零件用:p_nc = R·p_pkg + t。
export class RigidTransform {
    r: number[][] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    t: number[] = [0, 0, 0];

    apply(p: Vec3): Vec3 {
        return {
            x: this.r[0][0] * p.x + this.r[0][1] * p.y + this.r[0][2] * p.z + this.t[0],
            y: this.r[1][0] * p.x + this.r[1][1] * p.y + this.r[1][2] * p.z + this.t[1],
            z: this.r[2][0] * p.x + this.r[2][1] * p.y + this.r[2][2] * p.z + this.t[2],
        };
    }

    // 逆变换:p = Rᵀ·(p' − t)。只对正交的 R 成立(旋转、镜像)。
    inverse(): RigidTransform {
        const inv = new RigidTransform();
        for (let i = 0; i < 3; ++i)
            for (let j = 0; j < 3; ++j)
                inv.r[i][j] = this.r[j][i];
        for (let i = 0; i < 3; ++i)
            inv.t[i] = -(inv.r[i][0] * this.t[0] + inv.r[i][1] * this.t[1] + inv.r[i][2] * this.t[2]);
        return inv;
    }

    toMat4(): Mat4 {
        const m = new Mat4();
        for (let row = 0; row < 3; ++row) {
            for (let col = 0; col < 3; ++col)
                m.set(row, col, this.r[row][col]);
            m.set(row, 3, this.t[row]);
        }
        return m;
    }

    // R 是否正交(RᵀR = I,容差内)。工位变换进来时先验一下,不正交的不收。
    isOrthonormal(tolerance = 1e-6): boolean {
        for (let i = 0; i < 3; ++i) {
            for (let j = 0; j < 3; ++j) {
                let s = 0.0;
                for (let k = 0; k < 3; ++k)
                    s += this.r[k][i] * this.r[k][j];
                if (Math.abs(s - (i === j ? 1.0 : 0.0)) > tolerance)
                    return false;
            }
        }
        return true;
    }
}
