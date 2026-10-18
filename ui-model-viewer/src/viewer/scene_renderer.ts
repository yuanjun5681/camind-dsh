// 零件 + 刀路的 WebGL2 渲染器。直译 viewer/rhi/SceneRenderer.cpp,只依赖注入的
// WebGL2 上下文,不依赖控件:查看器控件、离屏测试、性能基准共用同一份,
// 所以离屏测过的就是窗口里跑的。
//
// 四条结构规矩(评审 v2 §4.1,决定画不画得动的就是它们):
//   ① 每档网格一个顶点缓冲 + 一个索引缓冲,整档一次绘制;
//   ② 面的身份 = 每个顶点带一个面序号;
//   ③ 拾取 = 把面序号画进一张看不见的 ID 画布,读鼠标那个像素;
//   ④ 高亮 = 只改那张面的顶点颜色段并局部上传。
// 拾取的具体做法(RGBA8 编码 + 单独离屏帧 + 拾取矩阵)见 docs/阶段1_图形后端spike报告.md。
//
// 与 C++ 的对应差异(qsb → GLSL ES、QRhi → WebGL2):
//   · clipSpaceCorrMatrix 恒等(WebGL 就是 OpenGL 裁剪空间约定);
//   · QRhiGraphicsPipeline → PipelineDesc(program + 拓扑 + 深度状态),apply() 时设 GL 全局状态;
//   · C++ 的 uploadStaticBuffer 批处理 → 脏标记,render/pick 开头 flushUploads() 统一上传;
//   · readPixels 无 BGRA 分支(WebGL 只有 RGBA 读回);
//   · debug 模式逐 draw 校验 getError(ts-spike 教训:WebGL 下 draw 被拒只表现为画面为空、JS 无异常)。
import { Mat4, RigidTransform, normalized, add, scale } from "@camind/core";
import type { Mesh, Edges, FaceInfo, OrbitCamera, PickHit } from "@camind/core";
import { buildFaceIdAttribute, buildFaceColorAttribute, buildEdgeLineIndices, NO_FACE } from "@camind/core";
import { pickMatrix, resolvePickRegion, kPickRegion, segmentToPickId } from "@camind/core";
import { MESH_VERT, MESH_FRAG, LINE_VERT, LINE_FRAG, ID_VERT, ID_FRAG, PATH_VERT, PATH_FRAG } from "./shaders.ts";

// 线画在面上时往相机方向偏多少(裁剪空间 z / w 的量)。边线贴着面,刀路再靠前一点压住边线。
// 做法是对裁剪坐标做 z' = z − bias·w,纯矩阵运算,不依赖各后端含义不一的多边形偏移。
const EDGE_DEPTH_BIAS = 3.0e-4;
const PATH_DEPTH_BIAS = 6.0e-4;

// 一次改了很多张面(比如全选)时,逐段上传不如整块重传。
const MAX_DIRTY_COLOR_RANGES = 512;

function depthBiasMatrix(bias: number): Mat4 {
    const m = new Mat4();
    m.set(2, 3, -bias); // z' = z − bias·w
    return m;
}

// Rgba 单一来源在 @camind/core(nc/toolpath.ts 定义、index.ts 导出);这里再导出保持旧导入路径兼容。
import type { Rgba } from "@camind/core";
export type { Rgba };

// paintFace / ByteRange 已提升进 @camind/core(接 A 线 HANDOFF 接线清单);此处再导出保持兼容。
import { paintFace, type ByteRange } from "@camind/core";
export { paintFace };
export type { ByteRange };

// 一帧的观察参数。viewProj 是 OpenGL 风格裁剪空间下的「投影 × 视图」(WebGL 原生同约定,
// C++ 版由 clipSpaceCorrMatrix 补的后端差异在这里恒等)。
export interface ViewParams {
    viewProj: Mat4;
    eye: [number, number, number, number]; // 透视:眼睛位置,w = 1;正交:指向眼睛的方向,w = 0
    lightDir: [number, number, number];    // 指向光源的单位向量
}

export function viewParamsFromCamera(camera: OrbitCamera, aspect: number): ViewParams {
    const b = camera.backward();
    let eye: [number, number, number, number];
    if (camera.projection() === 1) { // 透视
        const e = camera.eye();
        eye = [e.x, e.y, e.z, 1];
    } else {
        eye = [b.x, b.y, b.z, 0];
    }
    // 头灯:从相机的左上方打过来,跟着相机转,所以转到哪一面都有明暗层次。
    const l = normalized(add(b, add(scale(camera.right(), -0.45), scale(camera.up(), 0.60))));
    return { viewProj: camera.viewProjection(aspect), eye, lightDir: [l.x, l.y, l.z] };
}

export interface RenderOptions {
    showMesh: boolean;
    pickMode?: 'face' | 'path';
    showEdges: boolean;
    showToolpath: boolean;
    // 刀路不被零件遮挡(透视显示)。成品模型是实心的,切进材料里的走刀本来会被面挡住;
    // 打开后整条刀路都看得见、点得中。
    toolpathOnTop: boolean;
    background: [number, number, number];
    edgeColor: [number, number, number];
}

export function defaultRenderOptions(): RenderOptions {
    return {
        showMesh: true, showEdges: true, showToolpath: true, toolpathOnTop: false,
        background: [0.106, 0.118, 0.141], edgeColor: [0.06, 0.09, 0.13],
    };
}

// 刀路图层的数据。与 core 的 ToolpathBuffers(nc/toolpath.ts)结构一致 —— 纯字段、
// 无方法,core 的 buildToolpathBuffers 产物可直接喂入。
export interface ToolpathGeometry {
    positions: Float32Array;       // 每顶点 3 个 float(NC 坐标),两个顶点一段
    colors: Uint8Array;            // 每顶点 4 字节 RGBA
    lines: Int32Array | number[];  // 每段对应的 NC 行号(从 1 起)
}

/** 段数 = 行号表的长度(core 的 segmentCount(path) 同式)。 */
export function toolpathSegmentCount(path: ToolpathGeometry | null): number {
    return path ? path.lines.length : 0;
}

export interface RendererStats {
    triangles: number;
    vertices: number;
    edgeSegments: number;
    pathSegments: number;
    gpuBytes: number;
    drawCallsLastFrame: number;
}

// C++ QRhiGraphicsPipeline 的对应物:着色器 + 拓扑 + 深度状态。GL 里这些是全局状态,
// draw 前 apply() 设一遍。
interface PipelineDesc {
    program: WebGLProgram;
    uboBlockIndex: number;
    topology: number; // gl.TRIANGLES | gl.LINES
    depthTest: boolean;
    depthWrite: boolean;
    uniforms: "main" | "path" | "pick" | "pickPath"; // 用哪个 UBO
}

interface Program {
    program: WebGLProgram;
    uboBlockIndex: number;
}

export class SceneRenderer {
    private gl: WebGL2RenderingContext;
    private checkErrors: boolean;

    private meshProg!: Program;
    private lineProg!: Program;
    private idProg!: Program;
    private pathProg!: Program;

    // CPU 侧数据
    private mesh: Mesh | null = null;
    // bodyOfFace[face] = 体号；visible* 是可见索引前缀缓冲，与 NC 播放区间完全独立。
    private bodyOfFace: Uint32Array = new Uint32Array(0);
    private hiddenBodies: Set<number> = new Set();
    private visibleIndexCount = 0;
    private visibleScratch: Uint32Array | null = null;
    private edgeVisibleIndexCount = 0;
    private edgeVisibleScratch: Uint32Array | null = null;
    private edges: Edges | null = null;
    private path: ToolpathGeometry | null = null;
    private colors: Uint8Array = new Uint8Array(0);       // 逐顶点 RGBA,高亮改的就是它
    private baseColors: Uint8Array = new Uint8Array(0);   // 每张面的本色,4 字节一张面
    private pathIds: Uint8Array = new Uint8Array(0);
    private dirtyColorRanges: ByteRange[] = [];
    private colorsFullyDirty = false;
    private meshDirty = false;
    private edgesDirty = false;
    private pathDirty = false;
    private pathModel = new Mat4(); // 工位变换的逆
    private playhead = 1e30;
    private playbackStart = 0;
    private playbackEnd = 1e30;
    private futureKeep = 0.25;

    // 显卡资源
    private posBuf: WebGLBuffer | null = null;
    private normalBuf: WebGLBuffer | null = null;
    private colorBuf: WebGLBuffer | null = null;
    private idBuf: WebGLBuffer | null = null;
    private indexBuf: WebGLBuffer | null = null;
    private edgePosBuf: WebGLBuffer | null = null;
    private edgeIndexBuf: WebGLBuffer | null = null;
    private edgeIndexCount = 0;
    private pathPosBuf: WebGLBuffer | null = null;
    private pathColorBuf: WebGLBuffer | null = null;
    private pathIdBuf: WebGLBuffer | null = null;
    private gpuBytes = 0;
    private bufferBytes = new WeakMap<WebGLBuffer, number>();

    // 顶点属性绑定打包成 VAO(每组管线一个):WebGL 的属性绑定是持久全局状态,
    // 换档删掉旧缓冲后,残留的「已启用属性指向已删缓冲」会让后续 draw 报
    // INVALID_OPERATION、画面为空(真 GPU 复现:render → setMesh → pick 全 None,
    // glErr=1282 —— spike「draw 被拒不抛 JS 异常」教训的又一实例)。
    // VAO 跟着缓冲重建,draw 只 bindVertexArray,兼得干净与正确。
    private meshVao: WebGLVertexArrayObject | null = null;
    private lineVao: WebGLVertexArrayObject | null = null;
    private idMeshVao: WebGLVertexArrayObject | null = null;
    private pathVao: WebGLVertexArrayObject | null = null;
    private idPathVao: WebGLVertexArrayObject | null = null;

    // UBO(布局 = C++ 的 MainUniforms / PathUniforms,恰好满足 std140;
    // pick 用的两个只装一个 mat4)。持久缓冲,对应 C++ 的 m_*Ubuf。
    private mainUbo: WebGLBuffer | null = null;
    private pathUbo: WebGLBuffer | null = null;
    private pickUbo: WebGLBuffer | null = null;
    private pickPathUbo: WebGLBuffer | null = null;
    private mainUboData = new Float32Array(176 / 4);
    private pathUboData = new Float32Array(96 / 4);
    private pickUboData = new Float32Array(16);
    private pickPathUboData = new Float32Array(16);

    // 9×9 拾取 FBO(★永远 1× 采样、关混合:带 MSAA 会在面的边界上把两个序号混成一个不存在的序号)
    private pickFbo: WebGLFramebuffer | null = null;
    private pickTex: WebGLTexture | null = null;
    private pickDepth: WebGLRenderbuffer | null = null;
    private pickRead = new Uint8Array(kPickRegion * kPickRegion * 4);

    stats: RendererStats = { triangles: 0, vertices: 0, edgeSegments: 0, pathSegments: 0, gpuBytes: 0, drawCallsLastFrame: 0 };

    /** checkErrors:debug 构建里逐 draw 校验 getError(spike 教训,默认关,别在热路径开着)。 */
    constructor(gl: WebGL2RenderingContext, opts: { checkErrors?: boolean } = {}) {
        this.gl = gl;
        this.checkErrors = opts.checkErrors ?? false;
        this.meshProg = this.buildProgram(MESH_VERT, MESH_FRAG);
        this.lineProg = this.buildProgram(LINE_VERT, LINE_FRAG);
        this.idProg = this.buildProgram(ID_VERT, ID_FRAG);
        this.pathProg = this.buildProgram(PATH_VERT, PATH_FRAG);
        this.mainUbo = gl.createBuffer();
        this.pathUbo = gl.createBuffer();
        this.pickUbo = gl.createBuffer();
        this.pickPathUbo = gl.createBuffer();
        this.ensurePickTarget();
    }

    hasMesh(): boolean { return this.mesh !== null; }
    currentMesh(): Mesh | null { return this.mesh; }

    // ───────────────────────────────────────────── 零件

    /** 换一档网格(粗档先上,细档到了整体替换)。面序号不变,所以调用方的选择集可以原样重新上色。 */
    setMesh(mesh: Mesh | null, faces: FaceInfo[]): void {
        this.mesh = mesh;
        this.dirtyColorRanges = [];
        if (mesh) {
            this.bodyOfFace = new Uint32Array(mesh.faceCount());
            for (let f = 0; f < mesh.faceCount(); ++f)
                this.bodyOfFace[f] = faces[f] ? faces[f].body : 0;
            this.colors = buildFaceColorAttribute(mesh, faces);
            this.baseColors = new Uint8Array(mesh.faceCount() * 4);
            for (let f = 0; f < mesh.faceCount(); ++f) {
                const c: Rgba = f < faces.length
                    ? [faces[f].rgb[0], faces[f].rgb[1], faces[f].rgb[2], faces[f].opacity]
                    : [180, 180, 180, 255];
                this.baseColors.set(c, f * 4);
            }
        } else {
            this.bodyOfFace = new Uint32Array(0);
            this.colors = new Uint8Array(0);
            this.baseColors = new Uint8Array(0);
        }
        this.meshDirty = true;
        this.colorsFullyDirty = false;
    }

    setEdges(edges: Edges | null): void {
        this.edges = edges;
        this.edgesDirty = true;
    }

    /** 隐藏体集合；空/null = 全显。面与边分别按当前集合重建可见索引。 */
    setHiddenBodies(hidden: Iterable<number> | null): void {
        this.hiddenBodies = hidden ? new Set(hidden) : new Set();
        this.rebuildVisibleIndices();
        this.rebuildEdgeVisibleIndices();
    }

    visibleIndexDrawCount(): number { return this.visibleIndexCount; }
    edgeVisibleIndexDrawCount(): number { return this.edgeVisibleIndexCount; }

    private unbindVaoForElement(): void {
        this.gl.bindVertexArray(null);
    }

    private rebuildVisibleIndices(): void {
        if (this.meshDirty)
            return; // 等 flush 创建本档 indexBuf 后再重应用，避免写上一档缓冲。
        if (!this.mesh || !this.indexBuf) {
            this.visibleIndexCount = 0;
            return;
        }
        const total = this.mesh.indexCount();
        if (!this.visibleScratch || this.visibleScratch.length < total)
            this.visibleScratch = new Uint32Array(total);
        let n = 0;
        const indices = this.mesh.indices();
        for (let f = 0; f < this.mesh.faceCount(); ++f) {
            if (this.hiddenBodies.has(this.bodyOfFace[f]))
                continue;
            const r = this.mesh.faceRange(f);
            this.visibleScratch.set(indices.subarray(r.indexOffset, r.indexOffset + r.indexCount), n);
            n += r.indexCount;
        }
        const gl = this.gl;
        this.unbindVaoForElement();
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuf);
        // 全显恢复也必须重写：否则前段可见子集与后段旧数据会拼成错误索引。
        gl.bufferSubData(gl.ELEMENT_ARRAY_BUFFER, 0, this.visibleScratch.subarray(0, n));
        this.visibleIndexCount = n;
    }

    private rebuildEdgeVisibleIndices(): void {
        if (this.edgesDirty)
            return;
        if (!this.edges || !this.edgeIndexBuf) {
            this.edgeVisibleIndexCount = 0;
            return;
        }
        if (!this.edgeVisibleScratch || this.edgeVisibleScratch.length < this.edgeIndexCount)
            this.edgeVisibleScratch = new Uint32Array(this.edgeIndexCount);
        let n = 0;
        const view4 = this.edges.edges();
        for (let i = 0; i < this.edges.edgeCount(); ++i) {
            const o = i * 4;
            const faceA = view4[o], faceB = view4[o + 1];
            const ptOff = view4[o + 2], ptCnt = view4[o + 3];
            const aHidden = faceA !== NO_FACE && this.hiddenBodies.has(this.bodyOfFace[faceA] ?? -1);
            const bHidden = faceB !== NO_FACE && this.hiddenBodies.has(this.bodyOfFace[faceB] ?? -1);
            // 双面公共边只有两个真实关联面都隐藏才剔除；单面边跟随唯一面。
            if (faceA !== NO_FACE && aHidden && faceB !== NO_FACE && bHidden)
                continue;
            if (faceA !== NO_FACE && aHidden && faceB === NO_FACE)
                continue;
            if (faceB !== NO_FACE && bHidden && faceA === NO_FACE)
                continue;
            for (let k = 0; k + 1 < ptCnt; ++k) {
                this.edgeVisibleScratch[n++] = ptOff + k;
                this.edgeVisibleScratch[n++] = ptOff + k + 1;
            }
        }
        const gl = this.gl;
        this.unbindVaoForElement();
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.edgeIndexBuf);
        gl.bufferSubData(gl.ELEMENT_ARRAY_BUFFER, 0, this.edgeVisibleScratch.subarray(0, n));
        this.edgeVisibleIndexCount = n;
    }

    clearPart(): void {
        this.setMesh(null, []);
        this.setEdges(null);
    }

    /** 改一张面的显示颜色:只写 CPU 上那一段并记下脏区间,下一帧局部上传。 */
    setFaceColor(face: number, color: Rgba): void {
        if (!this.mesh || face >= this.mesh.faceCount())
            return;
        const range = paintFace(this.colors, this.mesh, face, color);
        if (range.size === 0 || this.meshDirty || this.colorsFullyDirty)
            return; // 整个缓冲反正要重传
        if (this.dirtyColorRanges.length >= MAX_DIRTY_COLOR_RANGES) {
            this.dirtyColorRanges = [];
            this.colorsFullyDirty = true;
            return;
        }
        this.dirtyColorRanges.push(range);
    }

    /** 这张面在 faces.json 里的本色。 */
    baseFaceColor(face: number): Rgba {
        const c: Rgba = [180, 180, 180, 255];
        if (face * 4 + 4 <= this.baseColors.length) {
            c[0] = this.baseColors[face * 4]; c[1] = this.baseColors[face * 4 + 1];
            c[2] = this.baseColors[face * 4 + 2]; c[3] = this.baseColors[face * 4 + 3];
        }
        return c;
    }

    // ───────────────────────────────────────────── 刀路

    setToolpath(path: ToolpathGeometry | null): void {
        this.path = path;
        this.pathIds = new Uint8Array(0);
        const segments = toolpathSegmentCount(path);
        if (path && segments > 0) {
            const vertices = segments * 2;
            this.pathIds = new Uint8Array(vertices * 4);
            const dv = new DataView(this.pathIds.buffer);
            for (let v = 0; v < vertices; ++v)
                dv.setUint32(v * 4, segmentToPickId((v / 2) | 0), true);
        }
        this.pathDirty = true;
    }

    clearToolpath(): void {
        this.setToolpath(null);
    }

    hasToolpath(): boolean { return toolpathSegmentCount(this.path) > 0; }

    /** 工位变换(p_nc = R·p_pkg + t)。渲染时取逆,把 NC 坐标下的刀路摆回零件上。 */
    setToolpathTransform(partToNc: RigidTransform): void {
        this.pathModel = partToNc.inverse().toMat4();
    }

    /** 播放头:正在走第几段(从 0 起)。大于等于段数 = 全部走完。 */
    setPlayhead(segment: number): void { this.playhead = segment; }
    playheadPos(): number { return this.playhead; }
    setPlaybackRange(start: number, end: number): void { this.playbackStart = start; this.playbackEnd = end; }

    /** 还没走到的线段保留多少本色:0 = 完全不显示,1 = 与走过的一样。 */
    setFutureVisibility(keep: number): void { this.futureKeep = keep; }

    // ───────────────────────────────────────────── 画

    /** 画一帧到当前绑定的帧缓冲(窗口画布或离屏 FBO 都行),画的东西完全一样。 */
    render(view: ViewParams, width: number, height: number, options: RenderOptions): void {
        const gl = this.gl;
        this.flushUploads();

        // MainUniforms:mvp / mvpLine(边线深度偏置)/ eye / lightDir / lineColor
        const mu = this.mainUboData;
        view.viewProj.toFloat32().forEach((v, i) => mu[i] = v);
        depthBiasMatrix(EDGE_DEPTH_BIAS).mul(view.viewProj).toFloat32().forEach((v, i) => mu[16 + i] = v);
        mu[32] = view.eye[0]; mu[33] = view.eye[1]; mu[34] = view.eye[2]; mu[35] = view.eye[3];
        mu[36] = view.lightDir[0]; mu[37] = view.lightDir[1]; mu[38] = view.lightDir[2]; mu[39] = 0;
        mu[40] = options.edgeColor[0]; mu[41] = options.edgeColor[1]; mu[42] = options.edgeColor[2]; mu[43] = 1;
        gl.bindBuffer(gl.UNIFORM_BUFFER, this.mainUbo);
        gl.bufferData(gl.UNIFORM_BUFFER, mu, gl.DYNAMIC_DRAW);

        // PathUniforms:mvp(刀路偏置 + 工位逆变换)/ params(playhead, futureKeep)/ background
        const pu = this.pathUboData;
        depthBiasMatrix(PATH_DEPTH_BIAS).mul(view.viewProj).mul(this.pathModel).toFloat32().forEach((v, i) => pu[i] = v);
        pu[16] = Math.min(this.playhead, 1.0e9);
        pu[17] = this.futureKeep;
        pu[18] = this.playbackStart;
        pu[19] = Math.min(this.playbackEnd, 1.0e9);
        pu[20] = options.background[0]; pu[21] = options.background[1]; pu[22] = options.background[2]; pu[23] = 1;
        gl.bindBuffer(gl.UNIFORM_BUFFER, this.pathUbo);
        gl.bufferData(gl.UNIFORM_BUFFER, pu, gl.DYNAMIC_DRAW);

        gl.viewport(0, 0, width, height);
        gl.clearColor(options.background[0], options.background[1], options.background[2], 1);
        gl.enable(gl.DEPTH_TEST);
        gl.depthFunc(gl.LEQUAL);
        gl.disable(gl.BLEND);
        // ★上一帧的「刀路透视」管线把深度写关了:掩码不清回来,clear(DEPTH) 是空操作,深度会累积。
        gl.depthMask(true);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

        let draws = 0;
        if (options.showMesh && this.posBuf && this.indexBuf && this.visibleIndexCount > 0) {
            this.applyPipeline({ program: this.meshProg.program, uboBlockIndex: this.meshProg.uboBlockIndex,
                topology: gl.TRIANGLES, depthTest: true, depthWrite: true, uniforms: "main" }, this.mainUbo);
            gl.bindVertexArray(this.meshVao);
            this.drawIndexed(gl.TRIANGLES, this.visibleIndexCount); // ★整档一次绘制(可见子集)
            ++draws;
        }
        if (options.showEdges && this.edgePosBuf && this.edgeVisibleIndexCount > 0) {
            this.applyPipeline({ program: this.lineProg.program, uboBlockIndex: this.lineProg.uboBlockIndex,
                topology: gl.LINES, depthTest: true, depthWrite: true, uniforms: "main" }, this.mainUbo);
            gl.bindVertexArray(this.lineVao);
            this.drawIndexed(gl.LINES, this.edgeVisibleIndexCount);
            ++draws;
        }
        if (options.showToolpath && this.pathPosBuf) {
            // 播放 = 只画前 N 段。未走的线段要淡显时才把整条都画出来,由着色器按线段号调暗。
            const segments = this.visibleSegmentCount();
            if (segments > 0) {
                this.applyPipeline({ program: this.pathProg.program, uboBlockIndex: this.pathProg.uboBlockIndex,
                    topology: gl.LINES, depthTest: !options.toolpathOnTop, depthWrite: !options.toolpathOnTop,
                    uniforms: "path" }, this.pathUbo);
                gl.bindVertexArray(this.pathVao);
                gl.drawArrays(gl.LINES, 0, segments * 2);
                this.checkDrawError("刀路");
                ++draws;
            }
        }
        this.stats.drawCallsLastFrame = draws;
    }

    /**
     * 拾取。在帧与帧之间调用(如鼠标事件处理里):自己起一个离屏帧,返回时结果已读回
     * (readPixels 对非多重采样 FBO 是同步的 —— 对应 QRhi「离屏帧读回在 endOffscreenFrame
     * 返回时已完成」)。pixel 是渲染目标上的像素坐标(y 朝下)。
     */
    pick(view: ViewParams, viewportWidth: number, viewportHeight: number, px: number, py: number,
         options: RenderOptions): PickHit {
        if (viewportWidth <= 0 || viewportHeight <= 0 || px < 0 || py < 0 || px >= viewportWidth || py >= viewportHeight)
            return { kind: 0, index: 0 };
        const gl = this.gl;
        this.flushUploads();

        const zoomed = pickMatrix(viewportWidth, viewportHeight, px, py, kPickRegion).mul(view.viewProj);
        zoomed.toFloat32().forEach((v, i) => this.pickUboData[i] = v);
        depthBiasMatrix(PATH_DEPTH_BIAS).mul(zoomed).mul(this.pathModel).toFloat32()
            .forEach((v, i) => this.pickPathUboData[i] = v);
        gl.bindBuffer(gl.UNIFORM_BUFFER, this.pickUbo);
        gl.bufferData(gl.UNIFORM_BUFFER, this.pickUboData, gl.DYNAMIC_DRAW);
        gl.bindBuffer(gl.UNIFORM_BUFFER, this.pickPathUbo);
        gl.bufferData(gl.UNIFORM_BUFFER, this.pickPathUboData, gl.DYNAMIC_DRAW);

        gl.bindFramebuffer(gl.FRAMEBUFFER, this.pickFbo);
        try {
            gl.viewport(0, 0, kPickRegion, kPickRegion);
            gl.clearColor(0, 0, 0, 0);
            gl.enable(gl.DEPTH_TEST);
            gl.depthFunc(gl.LEQUAL);
            gl.disable(gl.BLEND);
            gl.depthMask(true);
            gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
            if (options.showMesh && this.posBuf && this.idBuf && this.indexBuf && this.visibleIndexCount > 0) {
                this.applyPipeline({ program: this.idProg.program, uboBlockIndex: this.idProg.uboBlockIndex,
                    topology: gl.TRIANGLES, depthTest: true, depthWrite: true, uniforms: "pick" }, this.pickUbo);
                gl.bindVertexArray(this.idMeshVao);
                this.drawIndexed(gl.TRIANGLES, this.visibleIndexCount);
            }
            if (options.pickMode !== 'face' && options.showToolpath && this.pathPosBuf && this.pathIdBuf) {
                const segments = this.visibleSegmentCount();
                if (segments > 0) {
                    this.applyPipeline({ program: this.idProg.program, uboBlockIndex: this.idProg.uboBlockIndex,
                        topology: gl.LINES, depthTest: !options.toolpathOnTop, depthWrite: !options.toolpathOnTop,
                        uniforms: "pickPath" }, this.pickPathUbo);
                    gl.bindVertexArray(this.idPathVao);
                    gl.drawArrays(gl.LINES, 0, segments * 2);
                    this.checkDrawError("ID 画布刀路");
                }
            }
            gl.readPixels(0, 0, kPickRegion, kPickRegion, gl.RGBA, gl.UNSIGNED_BYTE, this.pickRead);
        } finally {
            // checkDrawError 抛错时也必须离开拾取 FBO,否则之后每帧都画进 9×9 小画布,画面冻住。
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        }

        // WebGL 的 readPixels 行序从下往上;resolvePickRegion 只用中心像素与邻域距离,翻转不影响判读。
        return resolvePickRegion(this.pickRead, kPickRegion);
    }

    dispose(): void {
        const gl = this.gl;
        for (const b of [this.posBuf, this.normalBuf, this.colorBuf, this.idBuf, this.indexBuf,
                         this.edgePosBuf, this.edgeIndexBuf, this.pathPosBuf, this.pathColorBuf, this.pathIdBuf,
                         this.mainUbo, this.pathUbo, this.pickUbo, this.pickPathUbo])
            if (b) gl.deleteBuffer(b);
        for (const p of [this.meshProg, this.lineProg, this.idProg, this.pathProg])
            if (p) gl.deleteProgram(p.program);
        for (const v of [this.meshVao, this.lineVao, this.idMeshVao, this.pathVao, this.idPathVao])
            this.deleteVao(v);
        if (this.pickTex) gl.deleteTexture(this.pickTex);
        if (this.pickDepth) gl.deleteRenderbuffer(this.pickDepth);
        if (this.pickFbo) gl.deleteFramebuffer(this.pickFbo);
    }

    // ───────────────────────────────────────────── 内部

    /** 播放头截断:未走线段不淡显(futureKeep ≤ 0)时只画到播放头所在段。 */
    private visibleSegmentCount(): number {
        const segments = toolpathSegmentCount(this.path);
        if (segments === 0)
            return 0;
        if (this.futureKeep <= 0 && this.playhead < segments)
            return Math.max(0, Math.floor(this.playhead) + 1);
        return segments;
    }

    private buildProgram(vsSrc: string, fsSrc: string): Program {
        const gl = this.gl;
        const compile = (type: number, src: string): WebGLShader => {
            const sh = gl.createShader(type)!;
            gl.shaderSource(sh, src);
            gl.compileShader(sh);
            if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS))
                throw new Error("着色器编译失败:" + gl.getShaderInfoLog(sh) + "\n源码头:\n" + src.split("\n").slice(0, 4).join("\n"));
            return sh;
        };
        const program = gl.createProgram()!;
        gl.attachShader(program, compile(gl.VERTEX_SHADER, vsSrc));
        gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fsSrc));
        gl.linkProgram(program);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS))
            throw new Error("着色器链接失败:" + gl.getProgramInfoLog(program));
        const blockIndex = gl.getUniformBlockIndex(program, "Ubuf") >= 0
            ? gl.getUniformBlockIndex(program, "Ubuf")
            : gl.getUniformBlockIndex(program, "PathUbuf");
        return { program, uboBlockIndex: blockIndex };
    }

    private applyPipeline(p: PipelineDesc, ubo: WebGLBuffer | null): void {
        const gl = this.gl;
        gl.useProgram(p.program);
        gl.uniformBlockBinding(p.program, p.uboBlockIndex, 0);
        gl.bindBufferBase(gl.UNIFORM_BUFFER, 0, ubo);
        if (p.depthTest)
            gl.enable(gl.DEPTH_TEST);
        else
            gl.disable(gl.DEPTH_TEST);
        gl.depthMask(p.depthWrite);
    }

    private bindAttribs(program: WebGLProgram,
                        attribs: Array<[string, WebGLBuffer | null, number, number] | [string, WebGLBuffer | null, number, number, boolean]>): void {
        const gl = this.gl;
        for (const a of attribs) {
            const [name, buf, size, type] = a;
            const normalized = a.length > 4 ? (a[4] as boolean) : false;
            const loc = gl.getAttribLocation(program, name);
            if (loc < 0)
                throw new Error("属性 " + name + " 不在着色器里(可能被优化掉)");
            gl.bindBuffer(gl.ARRAY_BUFFER, buf);
            gl.enableVertexAttribArray(loc);
            if (type === gl.FLOAT)
                gl.vertexAttribPointer(loc, size, type, false, 0, 0);
            else
                gl.vertexAttribPointer(loc, size, type, normalized, 0, 0);
        }
    }

    /** 建一个 VAO(属性绑定 + 可选的元素索引缓冲都封进去)。 */
    private makeVao(program: WebGLProgram,
                    attribs: Array<[string, WebGLBuffer | null, number, number] | [string, WebGLBuffer | null, number, number, boolean]>,
                    index: WebGLBuffer | null = null): WebGLVertexArrayObject | null {
        const gl = this.gl;
        const vao = gl.createVertexArray();
        gl.bindVertexArray(vao);
        this.bindAttribs(program, attribs);
        if (index)
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, index);
        gl.bindVertexArray(null);
        return vao;
    }

    private deleteVao(vao: WebGLVertexArrayObject | null): void {
        if (vao)
            this.gl.deleteVertexArray(vao);
    }

    private drawIndexed(mode: number, count: number): void {
        const gl = this.gl;
        gl.drawElements(mode, count, gl.UNSIGNED_INT, 0);
        this.checkDrawError(mode === gl.TRIANGLES ? "网格" : "边线");
    }

    private checkDrawError(what: string): void {
        if (!this.checkErrors)
            return;
        // 循环读空错误标志:每次 draw 只读一个标志,残留的错误会错位记到下一次 draw 头上。
        for (let i = 0; i < 8; ++i) {
            const err = this.gl.getError();
            if (err === this.gl.NO_ERROR)
                return;
            if (i === 0)
                throw new Error(what + "绘制报 GL 错误 " + err);
        }
    }

    private upload(data: Uint8Array, usage: number, target?: number): WebGLBuffer | null {
        // 索引缓冲必须在 ELEMENT_ARRAY_BUFFER 绑定下定义数据(WebGL 的元素索引缓冲与该 target 绑定);
        // 顶点缓冲走 ARRAY_BUFFER。
        if (data.length === 0)
            return null;
        const gl = this.gl;
        const t = target ?? gl.ARRAY_BUFFER;
        if (t === gl.ELEMENT_ARRAY_BUFFER) {
            // V-1:ELEMENT 绑定是 VAO 状态——render/pick 画完不解绑 VAO,在遗留 VAO 下绑新索引缓冲
            // 会改写那个 VAO(复现:鼠标停住遗留 lineVao,换档只重建网格,边线索引被改写成网格索引,画乱)。
            // 约定:所有 ELEMENT 上传必须走这里;makeVao 是「新建 VAO 后立刻绑定」,语义本就正确,不经此路径。
            gl.bindVertexArray(null);
        }
        const buf = gl.createBuffer();
        gl.bindBuffer(t, buf);
        gl.bufferData(t, data, usage);
        this.bufferBytes.set(buf, data.byteLength);
        this.gpuBytes += data.byteLength;
        return buf;
    }

    // 每块缓冲的字节数自己记:元素数组缓冲不允许绑到别的 target 上查 BUFFER_SIZE
    //(真 GL 报 INVALID_OPERATION —— GPU 对账第一轮抓到的,WebGL 的 draw/绑定被拒不抛 JS 异常)。
    private deleteBuffer(buf: WebGLBuffer | null): void {
        if (!buf)
            return;
        const size = this.bufferBytes.get(buf);
        if (size !== undefined) {
            this.gpuBytes -= size;
            this.bufferBytes.delete(buf);
        }
        this.gl.deleteBuffer(buf);
    }

    // C++ applyPendingUploads 的对应:脏标记统一在下一帧(或拾取)开头处理。
    // ELEMENT 绑定的 VAO 防御在 upload() 内(ELEMENT 分支),见那里的 V-1 注释。
    private flushUploads(): void {
        const gl = this.gl;
        if (this.meshDirty) {
            this.meshDirty = false;
            for (const b of [this.posBuf, this.normalBuf, this.colorBuf, this.idBuf, this.indexBuf])
                this.deleteBuffer(b);
            this.posBuf = this.normalBuf = this.colorBuf = this.idBuf = this.indexBuf = null;
            this.deleteVao(this.meshVao);
            this.deleteVao(this.idMeshVao);
            this.meshVao = this.idMeshVao = null;
            this.stats.triangles = 0;
            this.stats.vertices = 0;
            this.visibleIndexCount = 0;
            if (this.mesh && this.mesh.vertexCount() > 0 && this.mesh.indexCount() > 0) {
                const mesh = this.mesh;
                // 位置 / 法线 / 索引:几何包里的数据整段原样上显卡,不逐顶点加工。
                const posBytes = new Uint8Array(mesh.positions().buffer, mesh.positions().byteOffset, mesh.positions().byteLength);
                const nrmBytes = new Uint8Array(mesh.normals().buffer, mesh.normals().byteOffset, mesh.normals().byteLength);
                const idxBytes = new Uint8Array(mesh.indices().buffer, mesh.indices().byteOffset, mesh.indices().byteLength);
                const ids = buildFaceIdAttribute(mesh);
                this.posBuf = this.upload(posBytes, gl.STATIC_DRAW);
                this.normalBuf = this.upload(nrmBytes, gl.STATIC_DRAW);
                this.idBuf = this.upload(ids, gl.STATIC_DRAW);
                this.indexBuf = this.upload(idxBytes, gl.STATIC_DRAW, gl.ELEMENT_ARRAY_BUFFER);
                // 颜色是唯一会改的:之后按区间局部上传。
                this.colorBuf = this.upload(this.colors, gl.STATIC_DRAW);
                this.meshVao = this.makeVao(this.meshProg.program, [
                    ["aPos", this.posBuf, 3, gl.FLOAT],
                    ["aNormal", this.normalBuf, 3, gl.FLOAT],
                    ["aColor", this.colorBuf, 4, gl.UNSIGNED_BYTE, true],
                ], this.indexBuf);
                this.idMeshVao = this.makeVao(this.idProg.program, [
                    ["aPos", this.posBuf, 3, gl.FLOAT],
                    ["aId", this.idBuf, 4, gl.UNSIGNED_BYTE, true],
                ], this.indexBuf);
                this.stats.triangles = mesh.triangleCount();
                this.stats.vertices = mesh.vertexCount();
                // 换档先回全量，再按当前 hidden 重算；同时补算边线所属新网格。
                this.visibleIndexCount = mesh.indexCount();
                if (this.hiddenBodies.size > 0)
                    this.rebuildVisibleIndices();
                if (this.edges && this.edgeIndexCount > 0)
                    this.rebuildEdgeVisibleIndices();
            }
            this.colorsFullyDirty = false;
            this.dirtyColorRanges = [];
        } else if (this.colorBuf) {
            if (this.colorsFullyDirty) {
                gl.bindBuffer(gl.ARRAY_BUFFER, this.colorBuf);
                gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.colors);
            } else {
                gl.bindBuffer(gl.ARRAY_BUFFER, this.colorBuf);
                for (const r of this.dirtyColorRanges)
                    gl.bufferSubData(gl.ARRAY_BUFFER, r.offset, this.colors.subarray(r.offset, r.offset + r.size));
            }
            this.colorsFullyDirty = false;
            this.dirtyColorRanges = [];
        }

        if (this.edgesDirty) {
            this.edgesDirty = false;
            this.deleteBuffer(this.edgePosBuf);
            this.deleteBuffer(this.edgeIndexBuf);
            this.edgePosBuf = this.edgeIndexBuf = null;
            this.deleteVao(this.lineVao);
            this.lineVao = null;
            this.edgeIndexCount = 0;
            this.edgeVisibleIndexCount = 0;
            this.stats.edgeSegments = 0;
            if (this.edges && this.edges.pointCount() > 0) {
                const indices = buildEdgeLineIndices(this.edges);
                const pts = this.edges.points();
                const ptBytes = new Uint8Array(pts.buffer, pts.byteOffset, pts.byteLength);
                const idxBytes = new Uint8Array(indices.buffer, indices.byteOffset, indices.byteLength);
                this.edgePosBuf = this.upload(ptBytes, gl.STATIC_DRAW);
                this.edgeIndexBuf = this.upload(idxBytes, gl.STATIC_DRAW, gl.ELEMENT_ARRAY_BUFFER);
                this.lineVao = this.makeVao(this.lineProg.program,
                    [["aPos", this.edgePosBuf, 3, gl.FLOAT]], this.edgeIndexBuf);
                this.edgeIndexCount = indices.length;
                this.stats.edgeSegments = indices.length / 2;
                if (this.hiddenBodies.size > 0)
                    this.rebuildEdgeVisibleIndices();
                else
                    this.edgeVisibleIndexCount = this.edgeIndexCount;
            }
        }

        if (this.pathDirty) {
            this.pathDirty = false;
            for (const b of [this.pathPosBuf, this.pathColorBuf, this.pathIdBuf])
                this.deleteBuffer(b);
            this.pathPosBuf = this.pathColorBuf = this.pathIdBuf = null;
            this.deleteVao(this.pathVao);
            this.deleteVao(this.idPathVao);
            this.pathVao = this.idPathVao = null;
            this.stats.pathSegments = 0;
            const segments = toolpathSegmentCount(this.path);
            if (this.path && segments > 0 && this.path.colors.length >= segments * 8) {
                const posBytes = new Uint8Array(this.path.positions.buffer, this.path.positions.byteOffset, this.path.positions.byteLength);
                this.pathPosBuf = this.upload(posBytes, gl.STATIC_DRAW);
                this.pathColorBuf = this.upload(this.path.colors, gl.STATIC_DRAW);
                this.pathIdBuf = this.upload(this.pathIds, gl.STATIC_DRAW);
                this.pathVao = this.makeVao(this.pathProg.program, [
                    ["aPos", this.pathPosBuf, 3, gl.FLOAT],
                    ["aColor", this.pathColorBuf, 4, gl.UNSIGNED_BYTE, true],
                ]);
                this.idPathVao = this.makeVao(this.idProg.program, [
                    ["aPos", this.pathPosBuf, 3, gl.FLOAT],
                    ["aId", this.pathIdBuf, 4, gl.UNSIGNED_BYTE, true],
                ]);
                this.stats.pathSegments = segments;
            }
        }
        this.stats.gpuBytes = Math.max(0, this.gpuBytes);
    }

    private ensurePickTarget(): void {
        const gl = this.gl;
        this.pickTex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, this.pickTex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, kPickRegion, kPickRegion, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        this.pickDepth = gl.createRenderbuffer();
        gl.bindRenderbuffer(gl.RENDERBUFFER, this.pickDepth);
        gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, kPickRegion, kPickRegion);
        this.pickFbo = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.pickFbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.pickTex, 0);
        gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.pickDepth);
        if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE)
            throw new Error("拾取 FBO 不完整");
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
}
