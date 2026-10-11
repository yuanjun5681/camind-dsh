// 轨道相机。直译 core/src/view/camera.cpp + camera.h:转台式,世界 Z 朝上,只有数学。
import { Mat4, dot, add, sub, scale, boxCenter, boxRadius, v3 } from "./math.ts";
import type { Vec3, BoundingBox } from "./math.ts";

export const Projection = { Orthographic: 0, Perspective: 1 } as const;
export type ProjectionKind = 0 | 1;

export const StandardView = { Iso: 0, Top: 1, Bottom: 2, Front: 3, Back: 4, Right: 5, Left: 6 } as const;
export type StandardViewKind = 0 | 1 | 2 | 3 | 4 | 5 | 6;

const PI = 3.14159265358979323846;
const HALF_PI = PI / 2;
const ORBIT_RADIANS_PER_PIXEL = 0.0075;
const MIN_DISTANCE = 1e-3;
const MAX_DISTANCE = 1e7;
const FOV_Y = 0.6108652381980153; // 35°

export class OrbitCamera {
    private targetValue: Vec3 = v3();
    private distanceValue = 500.0;
    private yawValue = -0.7853981633974483;   // −45°
    private pitchValue = 0.6154797086703873;  // 35.26°,等轴测
    private projectionValue: ProjectionKind = Projection.Orthographic;
    private scene: BoundingBox = { min: v3(-100, -100, -100), max: v3(100, 100, 100) };

    target(): Vec3 { return this.targetValue; }
    distance(): number { return this.distanceValue; }
    yaw(): number { return this.yawValue; }
    pitch(): number { return this.pitchValue; }
    projection(): ProjectionKind { return this.projectionValue; }
    setProjection(p: ProjectionKind): void { this.projectionValue = p; }
    setTarget(t: Vec3): void { this.targetValue = t; }
    setSceneBounds(b: BoundingBox): void { this.scene = b; }
    sceneBounds(): BoundingBox { return this.scene; }

    setDistance(d: number): void {
        this.distanceValue = Math.min(Math.max(d, MIN_DISTANCE), MAX_DISTANCE);
    }

    setAngles(yaw: number, pitch: number): void {
        this.yawValue = MathRemainder(yaw, 2 * PI);
        this.pitchValue = Math.min(Math.max(pitch, -HALF_PI), HALF_PI);
    }

    backward(): Vec3 {
        return v3(Math.cos(this.pitchValue) * Math.cos(this.yawValue),
                  Math.cos(this.pitchValue) * Math.sin(this.yawValue),
                  Math.sin(this.pitchValue));
    }

    right(): Vec3 { return v3(-Math.sin(this.yawValue), Math.cos(this.yawValue), 0); }

    up(): Vec3 {
        // 由方位角和仰角直接给出,不走「叉乘世界 Z」:正俯视/正仰视时那样会退化。
        return v3(-Math.sin(this.pitchValue) * Math.cos(this.yawValue),
                  -Math.sin(this.pitchValue) * Math.sin(this.yawValue),
                  Math.cos(this.pitchValue));
    }

    eye(): Vec3 { return add(this.targetValue, scale(this.backward(), this.distanceValue)); }

    viewMatrix(): Mat4 {
        const r = this.right(), u = this.up(), b = this.backward(), e = this.eye();
        const v = new Mat4();
        v.set(0, 0, r.x); v.set(0, 1, r.y); v.set(0, 2, r.z); v.set(0, 3, -dot(r, e));
        v.set(1, 0, u.x); v.set(1, 1, u.y); v.set(1, 2, u.z); v.set(1, 3, -dot(u, e));
        v.set(2, 0, b.x); v.set(2, 1, b.y); v.set(2, 2, b.z); v.set(2, 3, -dot(b, e));
        return v;
    }

    halfHeightAtTarget(): number { return this.distanceValue * Math.tan(FOV_Y / 2); }

    private nearFar(): [number, number] {
        const radius = Math.max(boxRadius(this.scene), 1e-6) * 1.05;
        const centerDepth = dot(sub(this.eye(), boxCenter(this.scene)), this.backward());
        let n = centerDepth - radius;
        let f = centerDepth + radius;
        if (this.projectionValue === Projection.Perspective) {
            f = Math.max(f, 1e-3);
            n = Math.max(n, f * 1e-4); // 透视近平面必须为正,且不能比远平面小太多(深度精度)
        }
        return [n, f];
    }

    projectionMatrix(aspect: number): Mat4 {
        const [n, f] = this.nearFar();
        if (this.projectionValue === Projection.Perspective)
            return Mat4.perspective(FOV_Y, aspect, n, f);
        const hh = this.halfHeightAtTarget();
        return Mat4.orthographic(hh * aspect, hh, n, f);
    }

    viewProjection(aspect: number): Mat4 { return this.projectionMatrix(aspect).mul(this.viewMatrix()); }

    orbit(dxPixels: number, dyPixels: number): void {
        this.setAngles(this.yawValue - dxPixels * ORBIT_RADIANS_PER_PIXEL,
                       this.pitchValue + dyPixels * ORBIT_RADIANS_PER_PIXEL);
    }

    pan(dxPixels: number, dyPixels: number, viewportHeight: number): void {
        if (viewportHeight <= 0)
            return;
        const unitsPerPixel = (2.0 * this.halfHeightAtTarget()) / viewportHeight;
        this.targetValue = add(sub(this.targetValue, scale(this.right(), dxPixels * unitsPerPixel)),
                               scale(this.up(), dyPixels * unitsPerPixel));
    }

    zoom(factor: number, ndcX = 0, ndcY = 0, aspect = 1): void {
        if (!(factor > 0))
            return;
        const before = this.halfHeightAtTarget();
        this.setDistance(this.distanceValue * factor);
        const after = this.halfHeightAtTarget();
        const shift = before - after;
        this.targetValue = add(this.targetValue,
            add(scale(this.right(), ndcX * aspect * shift), scale(this.up(), ndcY * shift)));
    }

    fit(aspect: number): void {
        this.targetValue = boxCenter(this.scene);
        const r = this.right(), u = this.up(), b = this.backward();
        const tanHalf = Math.tan(FOV_Y / 2);
        const margin = 1.08;
        let need = 0;
        for (let i = 0; i < 8; ++i) {
            const corner = v3(i & 1 ? this.scene.max.x : this.scene.min.x,
                              i & 2 ? this.scene.max.y : this.scene.min.y,
                              i & 4 ? this.scene.max.z : this.scene.min.z);
            const rel = sub(corner, this.targetValue);
            const x = Math.abs(dot(rel, r)) * margin;
            const y = Math.abs(dot(rel, u)) * margin;
            const lateral = Math.max(x / (tanHalf * aspect), y / tanHalf);
            const depth = this.projectionValue === Projection.Perspective ? dot(rel, b) : 0;
            need = Math.max(need, lateral + depth);
        }
        this.setDistance(Math.max(need, 1e-3));
    }

    setStandardView(view: StandardViewKind): void {
        switch (view) {
            case StandardView.Iso: this.setAngles(-PI / 4, 0.6154797086703873); break;
            case StandardView.Top: this.setAngles(-HALF_PI, HALF_PI); break;
            case StandardView.Bottom: this.setAngles(-HALF_PI, -HALF_PI); break;
            case StandardView.Front: this.setAngles(-HALF_PI, 0); break;
            case StandardView.Back: this.setAngles(HALF_PI, 0); break;
            case StandardView.Right: this.setAngles(0, 0); break;
            case StandardView.Left: this.setAngles(PI, 0); break;
        }
    }
}

// C++ std::remainder(IEEE 754 remainder):n = x/y 四舍五入到最近整数、恰在 .5 时取偶。
// JS 的 % 是截断余数,不能直接用;Math.round 是 half-up,需在 .5 处修正为取偶。
export function MathRemainder(x: number, y: number): number {
    const q = x / y;
    let n = Math.round(q);
    if (Math.abs(q - n) === 0.5)
        n = 2 * Math.round(q / 2); // 最近的偶数
    return x - n * y;
}
