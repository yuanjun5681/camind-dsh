// 4B-3 2D 图纸渲染器(M0-6 拍板落地):WebGL2 线段几何(shader stipple 虚线)
// + Canvas2D 文字叠层 + 视口剔除与概览抽稀 + 图层显隐 + CPU 网格拾取入口。
// 与 SceneRenderer 同一结构规矩:只依赖注入的 WebGL2 上下文与 2D 上下文,不依赖控件;
// 预览页、壳层分屏(4C)、离屏测试共用同一份。交互(wheel/pointer)与 rAF 循环归宿主,
// 本类只被动 render()。
// 虚线:M0-6 拍板的「沿线像素距离 mod 像素周期 discard」保留,但 pattern 形状走
// 256 列 R8 纹理 LUT(每行一条归一化 pattern)—— 单周期 on 占比近似会把 CENTER
// 「长划-空-短划-空」画成匀虚线(Kimi 审查必改);像素周期 clamp [4,16] 判据不变。
// 容量口径(M0-6 拍板):几何抽稀上限 6000 段;文字每帧上限 240 条(按字高降序截断)。
import { fitView, panPixels, screenToWorld, worldToScreen, zoomAt, type ViewState } from "./draft_camera.ts";
import type { LoadedDraft } from "./draft_loader.ts";
import { buildSegGrid, type SegGrid } from "./draft_pick.ts";

export interface DraftViewOptions {
    /** 概览抽稀上限(默认 6000;M0-6 实测 rAF 节拍定档) */
    targetSegs?: number;
    /** 文字层每帧上限(默认 240;超出按字高降序截断) */
    maxTexts?: number;
    /** 背景色(默认深灰,与 3D 视图一致;aci7 白线在该底上即反色效果) */
    background?: [number, number, number];
    /** 逐帧 getError 校验(ts-spike 教训:draw 被拒只表现为画面为空) */
    checkErrors?: boolean;
}

export interface DraftViewStats {
    /** 末帧实画线段(剔除+抽稀后)与抽稀步进 */
    lastDrawn: number; lastStep: number;
    /** 末帧剔除循环 CPU 耗时(GL 提交与排空另计) */
    lastCullMs: number;
    /** 末帧几何/文字层耗时(render 内分段计时,不含读回排空) */
    geomMs: number; textMs: number;
    /** 末帧文字实画条数与因上限截断的溢出条数 */
    textsDrawn: number; textsOverflow: number;
    /** 末帧 getError(checkErrors 关闭时恒 0) */
    glError: number;
}
export interface DraftViewInsets { top: number; right: number; bottom: number; left: number; }
export interface DraftViewport { x: number; y: number; width: number; height: number; }

const VS = `#version 300 es
in vec2 aPos; in vec3 aColor; in float aDist; in float aPeriod; in float aRow;
out vec3 vColor; out float vDist; flat out float vPeriod; flat out float vRow;
uniform vec3 uView; uniform float uAspect;
void main() {
    float x = (aPos.x - uView.x) / (uView.z * uAspect);
    float y = (aPos.y - uView.y) / uView.z;
    gl_Position = vec4(x, y, 0.0, 1.0);
    gl_PointSize = 2.0;
    vColor = aColor; vDist = aDist; vPeriod = aPeriod; vRow = aRow;
}`;
// stipple:像素周期 = 世界周期 × 缩放,clamp [4,16]px(M0-6 判据);周期内归一化位置
// 采样 pattern LUT(R8 256 列/行,NEAREST)—— 多元素线型形状忠实;实线 period=0 直画。
const FS = `#version 300 es
precision highp float;
in vec3 vColor; in float vDist; flat in float vPeriod; flat in float vRow;
uniform float uPix; uniform sampler2D uPat; uniform float uRows;
out vec4 frag;
void main() {
    if (vPeriod > 0.0) {
        float ppx = clamp(vPeriod * uPix, 4.0, 16.0);
        float s = mod(vDist * uPix, ppx) / ppx;
        float on = texture(uPat, vec2(s, (vRow + 0.5) / uRows)).r;
        if (on < 0.5)
            discard;
    }
    frag = vec4(vColor, 1.0);
}`;

// 顶点布局:每顶点 8 floats(每段 2 顶点)
const FLOATS_PER_VERT = 8;
const DEFAULT_BG: [number, number, number] = [0.118, 0.125, 0.137];

/** 契约 halign(组码 72):0 左/1 中/2 右/3 Aligned/4 Middle/5 Fit;3/5 v1 降级按左端(§9)。 */
export function textAlignOf(halign: number): CanvasTextAlign {
    return halign === 1 || halign === 4 ? "center" : halign === 2 ? "right" : "left";
}
/** 契约 valign(组码 73):0 基线/1 底/2 中/3 顶;halign=4(Middle)是「点居中」,
 *  垂直也居中(契约 §9 只豁免 3/5,Kimi 审查必改 10)。 */
export function textBaselineOf(valign: number, halign = 0): CanvasTextBaseline {
    if (halign === 4) return "middle";
    return valign === 1 ? "bottom" : valign === 2 ? "middle" : valign === 3 ? "top" : "alphabetic";
}

export class DraftView {
    private readonly gl: WebGL2RenderingContext;
    private readonly c2d: CanvasRenderingContext2D;
    private readonly draft: LoadedDraft;
    private readonly opts: Required<DraftViewOptions>;
    private readonly prog: WebGLProgram;
    private readonly vbo: WebGLBuffer;
    private readonly patTex: WebGLTexture | null;
    private readonly uView: WebGLUniformLocation;
    private readonly uAspect: WebGLUniformLocation;
    private readonly uPix: WebGLUniformLocation;
    private insets: DraftViewInsets = { top: 0, right: 0, bottom: 0, left: 0 };
    private readonly segVertCount: number;
    private readonly pointVertBase: number;
    private readonly verts: Float32Array;
    private readonly pointScratch: Float32Array;
    private readonly grid: SegGrid;
    /** 抽稀收集缓冲(每段 2 顶点 × 8 floats;容量 = 上限段数,大包不再整帧全量开) */
    private readonly scratch: Float32Array;
    /** 图层可见态(初始 = layers 表 off/frozen 取反;不在表内的层名兜底可见) */
    private readonly layerVis = new Map<string, boolean>();
    private segHidden: Uint8Array;
    private pointHidden: Uint8Array;
    private st: ViewState;
    private minHalfH: number;
    /** 宿主选择状态；只在帧内收集阶段改颜色，不改原始几何或图层数据。 */
    private readonly selectedEnts = new Set<number>();
    /** 末帧实际绘制的文字(屏幕坐标;与绘制同一过滤口径 —— 拾取候选集以此为准) */
    private drawnTexts: Array<{ sx: number; sy: number; entId: number; layer: string }> = [];
    private stats: DraftViewStats = { lastDrawn: 0, lastStep: 1, lastCullMs: 0, geomMs: 0, textMs: 0,
        textsDrawn: 0, textsOverflow: 0, glError: 0 };

    constructor(gl: WebGL2RenderingContext, c2d: CanvasRenderingContext2D,
                draft: LoadedDraft, opts: DraftViewOptions = {}) {
        this.gl = gl;
        this.c2d = c2d;
        this.draft = draft;
        this.opts = {
            targetSegs: opts.targetSegs ?? 6000,
            maxTexts: opts.maxTexts ?? 240,
            background: opts.background ?? DEFAULT_BG,
            checkErrors: opts.checkErrors ?? false,
        };

        for (const [name, l] of draft.layers)
            this.layerVis.set(name, !(l.off || l.frozen));

        // 顶点缓冲:线段在前(2 顶点/段),POINT 实体殿后(同 stride,dist=period=row=0 →
        // 不 stipple;drawArrays 用 first 偏移分段画,一个 VBO 一次 attrib 设置)
        const nSeg = draft.segments.length, nPt = draft.points.length;
        const verts = new Float32Array((nSeg * 2 + nPt) * FLOATS_PER_VERT);
        let v = 0;
        for (const s of draft.segments) {
            const len = Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
            verts[v++] = s.x1; verts[v++] = s.y1;
            verts[v++] = s.r; verts[v++] = s.g; verts[v++] = s.b;
            verts[v++] = s.dist0; verts[v++] = s.dashPeriod; verts[v++] = s.dashRow;
            verts[v++] = s.x2; verts[v++] = s.y2;
            verts[v++] = s.r; verts[v++] = s.g; verts[v++] = s.b;
            verts[v++] = s.dist0 + len; verts[v++] = s.dashPeriod; verts[v++] = s.dashRow;
        }
        this.segVertCount = nSeg * 2;
        this.pointVertBase = this.segVertCount;
        for (const p of draft.points) {
            verts[v++] = p.x; verts[v++] = p.y;
            verts[v++] = p.r; verts[v++] = p.g; verts[v++] = p.b;
            verts[v++] = 0; verts[v++] = 0; verts[v++] = 0;
        }
        this.verts = verts; // scratch 组包的只读源(GPU 里另有 STATIC_DRAW 副本)
        // 容量 = 全部点数 × 8 floats:视口剔除只减不增,写满即上限,不会溢出
        this.pointScratch = new Float32Array(nPt * FLOATS_PER_VERT);
        // 文字按字高降序(截断时保大字;构建时排一次,帧内线性扫)
        draft.texts.sort((a, b) => b.h - a.h);

        this.grid = buildSegGrid(draft.segments);
        this.segHidden = new Uint8Array(nSeg);
        this.pointHidden = new Uint8Array(nPt);
        this.rebuildHidden();

        this.prog = this.buildProgram();
        gl.useProgram(this.prog);
        this.patTex = this.buildPatternTexture();
        this.vbo = gl.createBuffer()!;
        gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
        gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
        const strideB = FLOATS_PER_VERT * 4;
        const attr = (name: string, size: number, offset: number): void => {
            const loc = gl.getAttribLocation(this.prog, name);
            gl.enableVertexAttribArray(loc);
            gl.vertexAttribPointer(loc, size, gl.FLOAT, false, strideB, offset);
        };
        attr("aPos", 2, 0);
        attr("aColor", 3, 8);
        attr("aDist", 1, 20);
        attr("aPeriod", 1, 24);
        attr("aRow", 1, 28);
        this.uView = gl.getUniformLocation(this.prog, "uView")!;
        this.uAspect = gl.getUniformLocation(this.prog, "uAspect")!;
        this.uPix = gl.getUniformLocation(this.prog, "uPix")!;

        this.scratch = new Float32Array((this.opts.targetSegs + 2) * FLOATS_PER_VERT * 2);
        this.st = fitView(draft.bbox, this.W, this.H);
        // 缩放下限:放大到 halfH < 1e-4×fit 档时不再深放(除零/浮点崩坏防线,必改 7)
        this.minHalfH = this.st.halfH * 1e-4;
    }

    private get W(): number { return (this.gl.canvas as HTMLCanvasElement).width; }
    private get H(): number { return (this.gl.canvas as HTMLCanvasElement).height; }
    get viewport(): DraftViewport {
        return {
            x: this.insets.left,
            y: this.insets.top,
            width: Math.max(0, this.W - this.insets.left - this.insets.right),
            height: Math.max(0, this.H - this.insets.top - this.insets.bottom),
        };
    }
    get viewportInsets(): DraftViewInsets { return { ...this.insets }; }
    setViewportInsets(insets: DraftViewInsets): void {
        if (![insets.top, insets.right, insets.bottom, insets.left].every(v => Number.isFinite(v) && v >= 0))
            throw new Error("viewport insets 须为非负有限数");
        this.insets = { ...insets };
    }

    private buildProgram(): WebGLProgram {
        const gl = this.gl;
        const compile = (type: number, code: string): WebGLShader => {
            const sh = gl.createShader(type)!;
            gl.shaderSource(sh, code);
            gl.compileShader(sh);
            if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS))
                throw new Error("着色器编译失败: " + gl.getShaderInfoLog(sh));
            return sh;
        };
        const prog = gl.createProgram()!;
        gl.attachShader(prog, compile(gl.VERTEX_SHADER, VS));
        gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FS));
        gl.linkProgram(prog);
        if (!gl.getProgramParameter(prog, gl.LINK_STATUS))
            throw new Error("着色程序链接失败: " + gl.getProgramInfoLog(prog));
        return prog;
    }

    /** pattern LUT → R8 纹理(256 列 × 行数,NEAREST/CLAMP;行 0 = 实线恒 on)。 */
    private buildPatternTexture(): WebGLTexture | null {
        const gl = this.gl;
        const lut = this.draft.dashLut;
        if (!lut || lut.length === 0) return null;
        const tex = gl.createTexture();
        if (!tex) return null;
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, 256, lut.length, 0, gl.RED, gl.UNSIGNED_BYTE,
            concatLut(lut));
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        const uPat = gl.getUniformLocation(this.prog, "uPat");
        const uRows = gl.getUniformLocation(this.prog, "uRows");
        if (uPat) { gl.uniform1i(uPat, 0); gl.activeTexture(gl.TEXTURE0); }
        if (uRows) gl.uniform1f(uRows, lut.length);
        return tex;
    }

    // ── 相机(纯函数在 draft_camera;宿主交互事件调这三个)──
    get view(): ViewState { return this.st; }
    setView(st: ViewState): void { this.st = st; }
    fit(): void {
        const vp = this.viewport;
        this.st = fitView(this.draft.bbox, Math.max(1, vp.width), Math.max(1, vp.height));
    }
    zoomAt(sx: number, sy: number, factor: number): void {
        // 放大方向先裁到不越下限的有效因子,再调相机纯函数 —— 先算后 clamp 会让
        // 中心按未裁因子移动,到达下限后光标锚点持续漂移(Kimi 复审必改)
        const maxFactor = this.st.halfH / this.minHalfH;
        const vp = this.viewport;
        this.st = zoomAt(this.st, Math.max(1, vp.width), Math.max(1, vp.height),
            sx - vp.x, sy - vp.y, factor > 1 ? Math.min(factor, maxFactor) : factor);
    }
    panPixels(dx: number, dy: number): void {
        this.st = panPixels(this.st, Math.max(1, this.viewport.height), dx, dy);
    }
    worldToScreen(wx: number, wy: number): [number, number] {
        const vp = this.viewport;
        const [sx, sy] = worldToScreen(this.st, Math.max(1, vp.width), Math.max(1, vp.height), wx, wy);
        return [sx + vp.x, sy + vp.y];
    }
    screenToWorld(sx: number, sy: number): [number, number] {
        const vp = this.viewport;
        return screenToWorld(this.st, Math.max(1, vp.width), Math.max(1, vp.height), sx - vp.x, sy - vp.y);
    }
    setCamera(st: ViewState): void {
        if (![st.cx, st.cy, st.halfH].every(Number.isFinite) || st.halfH <= 0)
            throw new Error("相机状态须为有限 cx/cy 且 halfH>0");
        this.st = { ...st, halfH: Math.max(st.halfH, this.minHalfH) };
    }
    zoomToWorldRect(bbox: readonly [number, number, number, number]): void {
        const vp = this.viewport;
        const next = fitView(bbox, Math.max(1, vp.width), Math.max(1, vp.height), 1.1);
        this.st = { ...next, halfH: Math.max(next.halfH, this.minHalfH) };
    }
    zoomToRect(rect: DraftViewport): void {
        if (![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite)
            || rect.width <= 0 || rect.height <= 0)
            throw new Error("zoomToRect 须为有限坐标且 width/height>0");
        const [x0, y0] = this.screenToWorld(rect.x, rect.y + rect.height);
        const [x1, y1] = this.screenToWorld(rect.x + rect.width, rect.y);
        this.zoomToWorldRect([Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1)]);
    }

    // ── 选择（公共核心入口；Pane 只负责 dim/entity 目标解析）──
    setSelectedEntities(ids: readonly number[]): void {
        const next = new Set<number>();
        for (const id of ids) {
            if (!Number.isInteger(id) || id < 0 || id >= this.draft.entityCount)
                throw new Error(`未知实体:${JSON.stringify(id)}`);
            next.add(id);
        }
        this.selectedEnts.clear();
        for (const id of next) this.selectedEnts.add(id);
    }
    selectedEntities(): number[] { return [...this.selectedEnts].sort((a, b) => a - b); }
    entityBounds(ids: readonly number[]): [number, number, number, number] | null {
        const wanted = new Set(ids);
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        const add = (x: number, y: number): void => {
            x0 = Math.min(x0, x); y0 = Math.min(y0, y);
            x1 = Math.max(x1, x); y1 = Math.max(y1, y);
        };
        const addText = (t: (typeof this.draft.texts)[number]): void => {
            const wf = this.draft.textStyles.get(t.style.toLowerCase())?.widthFactor ?? 1;
            const fontH = Math.max(1, t.h);
            this.c2d.font = `${fontH}px sans-serif`;
            const measured = typeof this.c2d.measureText === "function"
                ? this.c2d.measureText(t.text).width : Number.NaN;
            const width = (Number.isFinite(measured) ? measured * t.h / fontH : t.text.length * t.h * 0.6) * wf;
            const align = textAlignOf(t.halign ?? 0);
            const left = align === "center" ? -width / 2 : align === "right" ? -width : 0;
            const baseline = textBaselineOf(t.valign ?? 0, t.halign ?? 0);
            let bottom = -0.2 * t.h, top = 0.8 * t.h;
            if (baseline === "top") { bottom = -t.h; top = 0; }
            else if (baseline === "bottom") { bottom = 0; top = t.h; }
            else if (baseline === "middle") { bottom = -t.h / 2; top = t.h / 2; }
            const cos = Math.cos(t.rot), sin = Math.sin(t.rot);
            for (const [dx, dy] of [[left, bottom], [left, top],
                [left + width, bottom], [left + width, top]])
                add(t.x + dx * cos - dy * sin, t.y + dx * sin + dy * cos);
        };
        for (const s of this.draft.segments) if (wanted.has(s.entId)) {
            add(s.x1, s.y1); add(s.x2, s.y2);
        }
        for (const t of this.draft.texts) if (wanted.has(t.entId)) addText(t);
        for (const p of this.draft.points) if (wanted.has(p.entId)) add(p.x, p.y);
        return Number.isFinite(x0) ? [x0, y0, x1, y1] : null;
    }

    // ── 图层显隐 ──
    layerNames(): string[] { return [...this.layerVis.keys()].sort(); }
    layerVisibility(): Record<string, boolean> { return Object.fromEntries(this.layerVis); }
    isLayerVisible(name: string): boolean { return this.layerVis.get(name) ?? true; }
    setLayerVisible(name: string, visible: boolean): void {
        this.setLayerVisibility({ [name]: visible });
    }
    setLayerVisibility(states: Record<string, boolean>): void {
        let changed = false;
        for (const [name, visible] of Object.entries(states)) {
            if (this.layerVis.get(name) === visible) continue;
            this.layerVis.set(name, visible);
            changed = true;
        }
        if (changed) this.rebuildHidden();
    }
    private rebuildHidden(): void {
        const segs = this.draft.segments;
        for (let i = 0; i < segs.length; ++i)
            this.segHidden[i] = this.isLayerVisible(segs[i].layer) ? 0 : 1;
        const pts = this.draft.points;
        for (let i = 0; i < pts.length; ++i)
            this.pointHidden[i] = this.isLayerVisible(pts[i].layer) ? 0 : 1;
    }

    /** 宿主改完 canvas.width/height 后直接 render()(W/H 每帧从画布读,viewport 每帧设)。 */

    // ── 渲染 ──
    render(): void {
        const t0 = performance.now();
        this.drawGL();
        const tg = performance.now();
        this.drawTexts();
        if (this.opts.checkErrors)
            this.stats.glError = this.gl.getError();
        this.stats.geomMs = tg - t0;
        this.stats.textMs = performance.now() - tg;
    }

    private drawGL(): void {
        const gl = this.gl;
        const W = this.W, H = this.H, vp = this.viewport;
        gl.clearColor(this.opts.background[0], this.opts.background[1], this.opts.background[2], 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
        if (W < 1 || H < 1 || vp.width < 1 || vp.height < 1) return;
        gl.enable(gl.SCISSOR_TEST);
        gl.scissor(vp.x, H - vp.y - vp.height, vp.width, vp.height);
        gl.viewport(vp.x, H - vp.y - vp.height, vp.width, vp.height);
        gl.useProgram(this.prog);
        gl.uniform3f(this.uView, this.st.cx, this.st.cy, this.st.halfH);
        gl.uniform1f(this.uAspect, vp.width / vp.height);
        const pixPerWorld = vp.height / (this.st.halfH * 2);
        gl.uniform1f(this.uPix, pixPerWorld);
        this.drawSegs();
        gl.disable(gl.SCISSOR_TEST);
    }

    /** 视口剔除 + 概览抽稀(M0-6:每帧两遍线性扫,先数候选再按步进抽稀)。 */
    private drawSegs(): void {
        const gl = this.gl;
        const t0 = performance.now();
        const vp = this.viewport;
        const [vx0, vy0] = this.screenToWorld(vp.x, vp.y + vp.height);
        const [vx1, vy1] = this.screenToWorld(vp.x + vp.width, vp.y);
        const pad = (vx1 - vx0) * 0.02;
        const segs = this.draft.segments;
        const bb = this.grid.bboxes;
        const nSeg = this.segVertCount / 2;
        let vis = 0;
        for (let i = 0; i < nSeg; ++i) {
            if (this.segHidden[i]) continue;
            if (bb[i * 4 + 2] >= vx0 - pad && bb[i * 4] <= vx1 + pad
                && bb[i * 4 + 3] >= vy0 - pad && bb[i * 4 + 1] <= vy1 + pad)
                ++vis;
        }
        const step = vis > this.opts.targetSegs ? Math.ceil(vis / this.opts.targetSegs) : 1;
        const STRIDE = FLOATS_PER_VERT * 2;
        const scratch = this.scratch;
        const verts = this.verts;
        let n = 0, seen = 0;
        for (let i = 0; i < nSeg; ++i) {
            if (this.segHidden[i]) continue;
            if (bb[i * 4 + 2] < vx0 - pad || bb[i * 4] > vx1 + pad
                || bb[i * 4 + 3] < vy0 - pad || bb[i * 4 + 1] > vy1 + pad)
                continue;
            if (++seen % step !== 0) continue; // step=1 时恒过(全画)
            scratch.set(verts.subarray(i * STRIDE, i * STRIDE + STRIDE), n);
            if (this.selectedEnts.has(segs[i].entId)) {
                for (const off of [2, 10]) {
                    scratch[n + off] = 1; scratch[n + off + 1] = 0.82; scratch[n + off + 2] = 0.2;
                }
            }
            n += STRIDE;
        }
        this.stats.lastDrawn = n / STRIDE;
        this.stats.lastStep = step;
        this.stats.lastCullMs = performance.now() - t0;
        if (n > 0) {
            gl.bufferSubData(gl.ARRAY_BUFFER, 0, scratch, 0, n);
            gl.drawArrays(gl.LINES, 0, n / FLOATS_PER_VERT);
        }
        // POINT 实体:数量少,只做视口剔除,不参与抽稀
        const pts = this.draft.points;
        if (pts.length > 0) {
            const ps = this.pointScratch;
            let pn = 0;
            for (let i = 0; i < pts.length; ++i) {
                if (this.pointHidden[i]) continue;
                const p = pts[i];
                if (p.x < vx0 - pad || p.x > vx1 + pad || p.y < vy0 - pad || p.y > vy1 + pad) continue;
                const selected = this.selectedEnts.has(p.entId);
                ps[pn++] = p.x; ps[pn++] = p.y;
                ps[pn++] = selected ? 1 : p.r; ps[pn++] = selected ? 0.82 : p.g; ps[pn++] = selected ? 0.2 : p.b;
                ps[pn++] = 0; ps[pn++] = 0; ps[pn++] = 0;
            }
            if (pn > 0) {
                gl.bufferSubData(gl.ARRAY_BUFFER, this.pointVertBase * FLOATS_PER_VERT * 4,
                    ps, 0, pn);
                gl.drawArrays(gl.POINTS, this.pointVertBase, pn / FLOATS_PER_VERT);
            }
        }
    }

    private drawTexts(): void {
        const ctx = this.c2d;
        const W = this.W, H = this.H, vp = this.viewport;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, W, H);
        if (W < 1 || H < 1 || vp.width < 1 || vp.height < 1) return;
        ctx.save();
        ctx.beginPath();
        ctx.rect(vp.x, vp.y, vp.width, vp.height);
        ctx.clip();
        const scale = vp.height / (this.st.halfH * 2);
        const [vx0, vy0] = this.screenToWorld(vp.x, vp.y + vp.height);
        const [vx1, vy1] = this.screenToWorld(vp.x + vp.width, vp.y);
        let drawn = 0, overflow = 0;
        const drawnList: Array<{ sx: number; sy: number; entId: number; layer: string }> = [];
        for (const t of this.draft.texts) {
            if (!this.isLayerVisible(t.layer)) continue;
            if (t.x < vx0 || t.x > vx1 || t.y < vy0 || t.y > vy1) continue;
            const px = t.h * scale;
            if (px < 3) continue;
            if (drawn >= this.opts.maxTexts) { ++overflow; continue; } // 上限外只计数不画
            const [sx, sy] = this.worldToScreen(t.x, t.y);
            ctx.save();
            ctx.translate(sx, sy);
            if (t.rot) ctx.rotate(-t.rot); // 世界逆时针为正 → 屏幕 y 向下取负
            const wf = this.draft.textStyles.get(t.style.toLowerCase())?.widthFactor ?? 1;
            if (wf !== 1) ctx.scale(wf, 1);
            ctx.fillStyle = this.selectedEnts.has(t.entId) ? "rgb(255,209,51)"
                : `rgb(${Math.round(t.r * 255)},${Math.round(t.g * 255)},${Math.round(t.b * 255)})`;
            // SHX/TTF 一律映射系统字体 sans-serif,源样式名保留(契约 §8 行 8 行为规范)
            ctx.font = `${Math.max(8, px)}px sans-serif`;
            ctx.textAlign = textAlignOf(t.halign ?? 0);
            ctx.textBaseline = textBaselineOf(t.valign ?? 0, t.halign ?? 0);
            ctx.fillText(t.text, 0, 0);
            ctx.restore();
            drawnList.push({ sx, sy, entId: t.entId, layer: t.layer });
            ++drawn;
        }
        ctx.restore();
        this.stats.textsDrawn = drawn;
        this.stats.textsOverflow = overflow;
        // 拾取候选 = 末帧实画集合(未绘制的微小/超限文字不抢占点击,Kimi 审查必改 5)
        this.drawnTexts = drawnList;
    }


    /** 渲染器口径的「fit 态可见文字数」(视口内 + 字号 ≥3px + 层可见)。
     *  页面截断/性能判据的期望值必须与渲染同口径,独立各算一套会漂(Kimi 审查必改 9)。 */
    countVisibleTexts(st: ViewState = this.st): number {
        const vp = this.viewport;
        const scale = Math.max(1, vp.height) / (st.halfH * 2);
        const [vx0, vy0] = screenToWorld(st, Math.max(1, vp.width), Math.max(1, vp.height), 0, vp.height);
        const [vx1, vy1] = screenToWorld(st, Math.max(1, vp.width), Math.max(1, vp.height), vp.width, 0);
        let n = 0;
        for (const t of this.draft.texts) {
            if (!this.isLayerVisible(t.layer)) continue;
            if (t.x < vx0 || t.x > vx1 || t.y < vy0 || t.y > vy1) continue;
            if (t.h * scale < 3) continue;
            ++n;
        }
        return n;
    }

    /** 标注文字优先拾取(4B-4):末帧实画文字的屏幕锚点,半径 10 物理像素内最近;
     *  候选集与绘制同口径(微小/超上限文字不参与)。-1 无命中。 */
    pickText(sx: number, sy: number): number {
        const vp = this.viewport;
        if (sx < vp.x || sx > vp.x + vp.width || sy < vp.y || sy > vp.y + vp.height) return -1;
        let best = -1, bestD = 100; // 10px^2
        for (const t of this.drawnTexts) {
            const d2 = (t.sx - sx) * (t.sx - sx) + (t.sy - sy) * (t.sy - sy);
            if (d2 < bestD) { bestD = d2; best = t.entId; }
        }
        return best;
    }

    // ── 拾取(4B-4 入口;tol = 2 屏幕像素换算世界单位;hatch 整体不可拾取)──
    pick(sx: number, sy: number): { segIdx: number; entId: number; layer: string } | null {
        const vp = this.viewport;
        if (vp.width < 1 || vp.height < 1
            || sx < vp.x || sx > vp.x + vp.width || sy < vp.y || sy > vp.y + vp.height) return null;
        const [wx, wy] = this.screenToWorld(sx, sy);
        const tol = 2 / (vp.height / (this.st.halfH * 2));
        const segs = this.draft.segments;
        const got = this.grid.pick(wx, wy, tol,
            (i) => this.segHidden[i] === 0 && segs[i].pickable);
        if (got < 0) return null;
        return { segIdx: got, entId: segs[got].entId, layer: segs[got].layer };
    }

    getStats(): DraftViewStats {
        return { ...this.stats };
    }

    dispose(): void {
        const gl = this.gl;
        if (this.patTex) gl.deleteTexture(this.patTex);
        gl.deleteBuffer(this.vbo);
        gl.deleteProgram(this.prog);
    }
}

/** 行表拼一张 R8 数据(每行 256 字节,天然 4 字节对齐)。 */
function concatLut(lut: Uint8Array[]): Uint8Array {
    const out = new Uint8Array(lut.length * 256);
    for (let r = 0; r < lut.length; ++r)
        out.set(lut[r].subarray(0, 256), r * 256);
    return out;
}
