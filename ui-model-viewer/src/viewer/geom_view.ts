// 查看器控件:自包含,零件显示与刀路显示都在里面。直译 viewer/widget/GeomViewWidget.cpp,
// QRhiWidget → DOM canvas;鼠标语义逐项照搬(4px 曼哈顿拖拽阈值、25ms 滑过节流、
// 0.88^steps 滚轮缩放、DPR 坐标换算、双击 fit、左键旋转 / 右键或 Shift+左键平移)。
//
// 对外只有四样东西(评审 v2 §4.2):
//   装载     给它一个本地几何包目录(或内存里的网格),它负责校验和上显卡
//   拾取     给屏幕坐标,还它面序号和 FID
//   选择集   给它一组 FID,它负责显示;用户点选后发回调
//   相机     旋转、平移、缩放、适应窗口、标准视图
// 它不认识云端接口、不认识对话、不认识 Camind 的壳;上传下载缓存是旁边的传输模块。
//
// 与 C++ 的对应差异:
//   · signals → callbacks 对象(可空回调);
//   · QTimer/QElapsedTimer → setTimeout/performance.now;
//   · initialize/releaseResources(QRhi 设备重建)→ webglcontextlost/restored,
//     恢复时重建渲染器并把 CPU 侧数据重新喂一遍(feedRenderer);
//   · loadNcFile 的文件读取留在壳层(Electron 主进程),这里收 parseNc 的结果(setNc)。
import { fidToIndex, meshBounds, RigidTransform, OrbitCamera, buildToolpathBuffers } from "@camind/core";
import type { Mesh, Edges, FaceInfo, BodyInfo, PickHit, ProjectionKind, StandardViewKind, NcParseResult, BoundingBox } from "@camind/core";
import { Projection, StandardView } from "@camind/core";
import { SceneRenderer, viewParamsFromCamera, toolpathSegmentCount } from "./scene_renderer.ts";
import type { ViewParams, RenderOptions, ToolpathGeometry, Rgba, RendererStats } from "./scene_renderer.ts";
import { displayFaceColor, createSelection, changeIsEmpty } from "./selection_port.ts";
import type { SelectionPort, SelectionChange, ClickMode } from "./selection_port.ts";

// 用户指向的一张面,按 Camind「当前指向对象」的稳定引用封装(camind-dsh 交互设计):
// subject_type = 面,subject_id = 零件引用 + FID。不用列表下标。
export interface FaceSubject {
    partRef: string;
    fid: string;
    faceIndex: number;
    surfaceType: string;
    areaMm2: number;
}

export function faceSubjectType(): string { return "face"; }

export function faceSubjectId(s: FaceSubject): string { return s.partRef + "#" + s.fid; }

export function faceSubjectIsValid(s: FaceSubject): boolean { return s.fid !== ""; }

const EMPTY_SUBJECT: FaceSubject = { partRef: "", fid: "", faceIndex: 0, surfaceType: "", areaMm2: 0 };

const DRAG_THRESHOLD_PIXELS = 4;
const HOVER_INTERVAL_MS = 25; // 滑过预亮的节流:每次拾取要对全部顶点跑一遍顶点着色器

export interface GeomViewCallbacks {
    partChanged?(): void;
    selectionChanged?(): void;
    /** 用户点了一张面(单击,不论它因此被选中还是被取消)。 */
    faceClicked?(subject: FaceSubject): void;
    /** 鼠标滑过的面变了;滑到背景上时 subject 无效。 */
    hoverChanged?(subject: FaceSubject): void;
    toolpathChanged?(): void;
    /** 用户点了刀路上的一段:给出线段号和它在 NC 文件里的行号。 */
    segmentClicked?(segment: number, ncLine: number): void;
    playheadChanged?(segment: number): void;
    renderingFailed?(reason: string): void;
    frameRendered?(): void;
}

export interface GeomViewOptions {
    /** 设备像素比(缺省取 window.devicePixelRatio;测试注入)。 */
    dpr?: () => number;
    /** 调度一帧(缺省 requestAnimationFrame;测试注入)。 */
    requestFrame?: (fn: () => void) => void;
    /** 当前时间 ms(缺省 performance.now;测试注入)。 */
    now?: () => number;
    /** 选择集实现(core 的 SelectionModel;测试可注入)。 */
    selection?: SelectionPort;
    /** debug 构建里逐 draw 校验 GL 错误(spike 教训,热路径别开)。 */
    checkErrors?: boolean;
}

export class GeomView {
    readonly canvas: HTMLCanvasElement;
    private gl: WebGL2RenderingContext | null;
    private renderer: SceneRenderer | null = null;
    private frameCount = 0;
    private lastPickMs = 0;
    private lastFrameMs = 0;
    private framePending = false;

    private dpr: () => number;
    private requestFrame: (fn: () => void) => void;
    private now: () => number;

    // 零件数据(CPU 侧留一份:上下文丢失恢复时要重新喂给渲染器)
    private partRef = "";
    private faces: FaceInfo[] = [];
    private bodies: BodyInfo[] = [];
    private mesh: Mesh | null = null;
    private edges: Edges | null = null;
    private originOffset: [number, number, number] = [0, 0, 0];

    // 刀路
    private pathBuffers: ToolpathGeometry | null = null;
    private stationTransform = new RigidTransform();
    private playhead = 0;
    private playbackStart = 0;
    private playbackEnd = 1e30;
    private futureVisible = true;

    private selection: SelectionPort;
    private hoverFace: number | null = null;
    private camera = new OrbitCamera();
    private options: RenderOptions;
    /** 逐 draw 校验 GL 错误(接 GeomViewOptions.checkErrors;此前声明了但从未传给渲染器的死接线)。 */
    private debugCheckErrors: boolean;
    private fitPending = false;
    private disposed = false;

    // 鼠标交互
    private pressPos = { x: 0, y: 0 };
    private lastPos = { x: 0, y: 0 };
    private pressButton = -1; // -1 = 无(对应 Qt::NoButton);0 左 / 1 中 / 2 右
    private dragging = false;
    private hoverTimer: ReturnType<typeof setTimeout> | null = null;
    private hoverPos = { x: 0, y: 0 };
    private underMouse = false;

    readonly callbacks: GeomViewCallbacks = {};

    constructor(canvas: HTMLCanvasElement, gl: WebGL2RenderingContext | null, opts: GeomViewOptions = {}) {
        this.canvas = canvas;
        this.gl = gl;
        this.dpr = opts.dpr ?? (() => globalThis.devicePixelRatio ?? 1);
        this.requestFrame = opts.requestFrame ?? ((fn) => requestAnimationFrame(() => fn()));
        this.now = opts.now ?? (() => performance.now());
        this.selection = opts.selection ?? createSelection();
        this.debugCheckErrors = opts.checkErrors ?? false;
        this.options = {
            showMesh: true, showEdges: true, showToolpath: true, toolpathOnTop: false,
            background: [0.106, 0.118, 0.141], edgeColor: [0.06, 0.09, 0.13],
        };
        if (gl)
            this.attachGl(gl);
        canvas.addEventListener("pointerdown", this.onPointerDown);
        canvas.addEventListener("pointermove", this.onPointerMove);
        canvas.addEventListener("pointerup", this.onPointerUp);
        canvas.addEventListener("dblclick", this.onDoubleClick);
        canvas.addEventListener("wheel", this.onWheel, { passive: false });
        canvas.addEventListener("pointerleave", this.onPointerLeave);
        canvas.addEventListener("pointerenter", this.onPointerEnter);
        canvas.addEventListener("pointercancel", this.onPointerCancel);
        // 上下文丢失恢复 = C++ 的 releaseResources/initialize:渲染器重建,数据重新喂一遍。
        canvas.addEventListener("webglcontextlost", this.onContextLost);
        canvas.addEventListener("webglcontextrestored", this.onContextRestored);
    }

    /** 生产入口:从 canvas 建 WebGL2 上下文。建不出返回 null(调用方走 renderingFailed 提示)。 */
    static create(canvas: HTMLCanvasElement, opts: GeomViewOptions = {}): GeomView | null {
        const gl = canvas.getContext("webgl2", { antialias: true, depth: true }); // 对应 C++ setSampleCount(4)
        if (!gl)
            return null;
        const view = new GeomView(canvas, gl, opts);
        if (!view.renderer) {
            view.dispose();
            throw new Error("WebGL2 着色器或图形资源初始化失败");
        }
        return view;
    }

    private attachGl(gl: WebGL2RenderingContext): void {
        this.gl = gl;
        try {
            this.renderer = new SceneRenderer(gl, { checkErrors: this.debugCheckErrors });
            this.feedRenderer();
            this.scheduleRender(); // 恢复/首建后要重画一帧(对应 C++ initialize 后的 update)
        } catch (e) {
            this.renderer = null;
            this.callbacks.renderingFailed?.("图形设备初始化失败:" + (e instanceof Error ? e.message : String(e)));
        }
    }

    dispose(): void {
        this.disposed = true;
        if (this.hoverTimer !== null)
            clearTimeout(this.hoverTimer);
        this.renderer?.dispose();
        this.renderer = null;
        const c = this.canvas;
        c.removeEventListener("pointerdown", this.onPointerDown);
        c.removeEventListener("pointermove", this.onPointerMove);
        c.removeEventListener("pointerup", this.onPointerUp);
        c.removeEventListener("dblclick", this.onDoubleClick);
        c.removeEventListener("wheel", this.onWheel);
        c.removeEventListener("pointerleave", this.onPointerLeave);
        c.removeEventListener("pointerenter", this.onPointerEnter);
        c.removeEventListener("pointercancel", this.onPointerCancel);
        c.removeEventListener("webglcontextlost", this.onContextLost);
        c.removeEventListener("webglcontextrestored", this.onContextRestored);
    }

    hasRendered(): boolean { return this.frameCount > 0; }
    lastPickMilliseconds(): number { return this.lastPickMs; }
    lastFrameMilliseconds(): number { return this.lastFrameMs; }
    renderStats(): RendererStats { return this.renderer ? this.renderer.stats : { triangles: 0, vertices: 0, edgeSegments: 0, pathSegments: 0, gpuBytes: 0, drawCallsLastFrame: 0 }; }

    // ───────────────────────────────────────────── 装载

    // Browser loading is asynchronous; the plugin verifies the package before setPart/setMesh.

    /** 换零件,清空选择集。bodies = 清单的体表(CAM-Agent T-398 ②;老包没有 ⇒ 空) */
    setPart(partRef: string, faces: FaceInfo[], bodies: BodyInfo[] = []): void {
        this.partRef = partRef;
        this.faces = faces;
        this.bodies = bodies;
        this.originOffset = [0, 0, 0];
        this.mesh = null;
        this.edges = null;
        this.setHoverFace(null);
        this.selection.reset(faces.map((f) => f.surfaceType));
        this.fitPending = true;
        this.renderer?.clearPart();
        this.callbacks.partChanged?.();
        this.callbacks.selectionChanged?.();
        this.scheduleRender();
    }

    /** 换一档网格,选择集保留。 */
    setMesh(mesh: Mesh | null): void {
        if (mesh && mesh.faceCount() !== this.faces.length)
            return; // 面数与面表对不上的网格不收(装载端已经校验过,这里是最后一道)
        this.mesh = mesh;
        if (mesh) {
            this.updateSceneBounds();
            if (this.fitPending) {
                this.fitPending = false;
                this.camera.setStandardView(StandardView.Iso);
                this.camera.fit(this.aspect());
            }
        }
        if (this.renderer) {
            this.renderer.setMesh(mesh, this.faces);
            this.refreshAllFaceColors(); // 换档后面序号不变,选择集原样重新上色
        }
        this.callbacks.partChanged?.();
        this.scheduleRender();
    }

    setEdges(edges: Edges | null): void {
        this.edges = edges;
        this.renderer?.setEdges(edges);
        this.callbacks.partChanged?.();
        this.scheduleRender();
    }

    clearPart(): void {
        this.setPart("", []);
    }

    hasPart(): boolean { return this.mesh !== null; }
    partRefOf(): string { return this.partRef; }
    facesOf(): readonly FaceInfo[] { return this.faces; }
    bodiesOf(): readonly BodyInfo[] { return this.bodies; }
    meshOf(): Mesh | null { return this.mesh; }
    edgesOf(): Edges | null { return this.edges; }
    /** 当前显示的是哪一档;没有零件时为 null。 */
    displayedLod(): 0 | 1 | null {
        if (!this.mesh)
            return null;
        return this.mesh.lod() === 0 ? 0 : 1;
    }
    /** 当前零件的 origin_offset(openPackage 时从清单里取;没有零件时为零)。 */
    getOriginOffset(): [number, number, number] { return [...this.originOffset] as [number, number, number]; }
    setOriginOffset(offset: [number, number, number]): void { this.originOffset = [...offset] as [number, number, number]; }

    // ───────────────────────────────────────────── 刀路

    /**
     * 显示一条刀路(线段缓冲已建好):刚打开时整条显示。
     * lines:每段对应的 NC 行号(从 1 起)。
     */
    setToolpath(geometry: ToolpathGeometry | null): void {
        this.pathBuffers = geometry;
        this.playhead = this.segmentCount(); // 刚打开时整条显示
        if (this.renderer) {
            this.renderer.setToolpath(geometry);
            this.renderer.setPlayhead(this.playhead);
        }
        const hadPart = this.mesh !== null;
        this.updateSceneBounds();
        if (!hadPart && this.hasToolpath()) {
            // 没有零件、只看刀路:直接对着刀路取景。
            this.camera.setStandardView(StandardView.Iso);
            this.camera.fit(this.aspect());
        }
        this.callbacks.toolpathChanged?.();
        this.callbacks.playheadChanged?.(this.playhead);
        this.scheduleRender();
    }

    /**
     * 读一段 NC 程序并显示为刀路(C++ loadNcFile + setToolpath 的对应;
     * 文件读取在壳层做,这里收 parseNc 的结果 —— 解析器对任何内容都不抛异常)。
     */
    setNc(parsed: NcParseResult | null): void {
        this.setToolpath(parsed ? buildToolpathBuffers(parsed) : null);
    }

    clearToolpath(): void {
        this.setToolpath(null);
    }

    hasToolpath(): boolean { return toolpathSegmentCount(this.pathBuffers) > 0; }
    segmentCount(): number { return toolpathSegmentCount(this.pathBuffers); }
    /** 每段对应的 NC 行号;没有刀路或段号越界返回 0。 */
    ncLineOfSegment(segment: number): number {
        if (!this.pathBuffers || segment < 0 || segment >= this.pathBuffers.lines.length)
            return 0;
        return this.pathBuffers.lines[segment];
    }

    /** 工位变换,已统一成「包坐标 → NC 坐标」(p_nc = R·p_pkg + t)。刀路按它的逆摆回零件上。 */
    setStationTransform(packageToNc: RigidTransform): void {
        this.stationTransform = packageToNc;
        this.renderer?.setToolpathTransform(packageToNc);
        this.updateSceneBounds();
        this.scheduleRender();
    }

    getStationTransform(): RigidTransform { return this.stationTransform; }

    /** 播放头:正在走第几段(从 0 起);等于段数 = 全部走完。 */
    setPlayheadSegment(segment: number): void {
        segment = Math.min(Math.max(segment, 0), this.segmentCount());
        if (segment === this.playhead)
            return;
        this.playhead = segment;
        this.renderer?.setPlayhead(segment);
        this.callbacks.playheadChanged?.(segment);
        this.scheduleRender();
    }

    playheadSegment(): number { return this.playhead; }
    setPlaybackRange(start: number, end: number): void {
        this.playbackStart = start; this.playbackEnd = end;
        this.renderer?.setPlaybackRange(start, end);
        this.scheduleRender();
    }
    setModelVisible(visible: boolean): void { this.options.showMesh = visible; this.scheduleRender(); }
    setPickMode(mode: 'face' | 'path'): void { this.options.pickMode = mode; this.setHoverFace(null); }

    /** 还没走到的线段是否淡淡地显示出来(关掉就是「只画前 N 段」)。 */
    setFutureSegmentsVisible(visible: boolean): void {
        this.futureVisible = visible;
        this.renderer?.setFutureVisibility(visible ? 0.25 : 0);
        this.scheduleRender();
    }

    setToolpathVisible(visible: boolean): void {
        this.options.showToolpath = visible;
        this.scheduleRender();
    }

    /** 刀路透视显示:不被零件遮挡。 */
    setToolpathOnTop(onTop: boolean): void {
        this.options.toolpathOnTop = onTop;
        this.scheduleRender();
    }

    /** 场景范围 = 零件 ∪ 摆回零件上的刀路。近远平面按它算,刀路的抬刀段(常在零件上方几十毫米)才不会被裁掉。 */
    private updateSceneBounds(): void {
        let have = false;
        let min = { x: 0, y: 0, z: 0 }, max = { x: 0, y: 0, z: 0 };
        const extend = (px: number, py: number, pz: number): void => {
            if (!have) {
                min = { x: px, y: py, z: pz };
                max = { x: px, y: py, z: pz };
                have = true;
                return;
            }
            min = { x: Math.min(min.x, px), y: Math.min(min.y, py), z: Math.min(min.z, pz) };
            max = { x: Math.max(max.x, px), y: Math.max(max.y, py), z: Math.max(max.z, pz) };
        };
        if (this.mesh) {
            const part = meshBounds(this.mesh);
            extend(part.min.x, part.min.y, part.min.z);
            extend(part.max.x, part.max.y, part.max.z);
        }
        const path = toolpathGeometryBounds(this.pathBuffers);
        if (path) {
            const toPackage = this.stationTransform.inverse();
            for (let i = 0; i < 8; ++i) {
                const p = toPackage.apply({
                    x: i & 1 ? path.max.x : path.min.x,
                    y: i & 2 ? path.max.y : path.min.y,
                    z: i & 4 ? path.max.z : path.min.z,
                });
                extend(p.x, p.y, p.z);
            }
        }
        if (have)
            this.camera.setSceneBounds({ min, max });
    }

    // ───────────────────────────────────────────── 拾取与选择

    private pixelSize(): { width: number; height: number } {
        const dpr = this.dpr();
        const w = Math.max(1, Math.round(this.canvas.clientWidth * dpr));
        const h = Math.max(1, Math.round(this.canvas.clientHeight * dpr));
        return { width: w, height: h };
    }

    private aspect(): number {
        const s = this.pixelSize();
        return s.width / s.height;
    }

    private currentView(): ViewParams {
        return viewParamsFromCamera(this.camera, this.aspect());
    }

    /** pos 是控件坐标(逻辑像素)。点在背景上返回 kind = None。 */
    pickAt(pos: { x: number; y: number }): PickHit {
        if (!this.renderer || (!this.mesh && !this.hasToolpath()))
            return { kind: 0, index: 0 };
        const dpr = this.dpr();
        const pixel = { x: Math.floor((pos.x + 0.5) * dpr), y: Math.floor((pos.y + 0.5) * dpr) };
        const t0 = this.now();
        const hit = this.renderer.pick(this.currentView(), this.pixelSize().width, this.pixelSize().height,
                                       pixel.x, pixel.y, this.options);
        this.lastPickMs = this.now() - t0;
        return this.options.pickMode === 'path' && hit.kind === 1 ? { kind: 0, index: 0 } : hit;
    }

    faceSubject(faceIndex: number): FaceSubject {
        if (faceIndex >= this.faces.length)
            return { ...EMPTY_SUBJECT };
        const f = this.faces[faceIndex];
        return {
            partRef: this.partRef,
            fid: f.fid,
            faceIndex,
            surfaceType: f.surfaceType,
            areaMm2: f.areaMm2,
        };
    }

    selectedFids(): string[] {
        const fids: string[] = [];
        for (const face of this.selection.selection())
            fids.push(this.faces[face].fid);
        return fids;
    }

    selectedFaces(): number[] {
        return [...this.selection.selection()];
    }

    setSelectedFids(fids: string[]): void {
        const faces: number[] = [];
        for (const fid of fids) {
            const index = fidToIndex(fid);
            // FID 要与本包面表里的那一项逐字相同才算数(不靠序号硬套);不认识的 FID 跳过(C++ 同为忽略)。
            if (index >= 0 && index < this.faces.length && this.faces[index].fid === fid)
                faces.push(index);
        }
        this.applyChange(this.selection.setSelection(faces));
    }

    clearSelection(): void {
        this.applyChange(this.selection.clear());
    }

    /** 只许选这些曲面类型;空 = 不过滤。 */
    setSurfaceTypeFilter(types: string[]): void {
        const change = this.selection.setTypeFilter(new Set(types));
        this.refreshAllFaceColors(); // 不可选的面要压暗,可选范围变了就全部重新上色
        if (!changeIsEmpty(change))
            this.callbacks.selectionChanged?.();
        this.scheduleRender();
    }

    surfaceTypeFilter(): string[] { return [...this.selection.typeFilter()]; }

    availableSurfaceTypes(): string[] { return [...this.selection.availableTypes()]; }

    private applyChange(change: SelectionChange): void {
        if (changeIsEmpty(change))
            return;
        // 高亮 = 只改这几张面的顶点颜色段,下一帧局部上传。
        for (const face of change.added)
            this.refreshFaceColor(face);
        for (const face of change.removed)
            this.refreshFaceColor(face);
        this.callbacks.selectionChanged?.();
        this.scheduleRender();
    }

    private displayColorOf(face: number): Rgba {
        const selected = this.selection.isSelected(face);
        const hovered = this.hoverFace === face;
        const base = this.renderer ? this.renderer.baseFaceColor(face) : [180, 180, 180, 255] as Rgba;
        return displayFaceColor(base, selected, hovered, this.selection.isSelectable(face));
    }

    private refreshFaceColor(face: number): void {
        this.renderer?.setFaceColor(face, this.displayColorOf(face));
    }

    private refreshAllFaceColors(): void {
        if (!this.renderer || !this.mesh)
            return;
        if (this.selection.typeFilter().size > 0) {
            for (let f = 0; f < this.mesh.faceCount(); ++f)
                this.refreshFaceColor(f);
            return;
        }
        // 没有过滤时,只有选中的和滑过的不是本色;先把本色铺回去,再涂这几张。
        for (let f = 0; f < this.mesh.faceCount(); ++f) {
            if (!this.selection.isSelected(f) && this.hoverFace !== f)
                this.renderer.setFaceColor(f, this.renderer.baseFaceColor(f));
        }
        for (const f of this.selection.selection())
            this.refreshFaceColor(f);
        if (this.hoverFace !== null)
            this.refreshFaceColor(this.hoverFace);
    }

    private setHoverFace(face: number | null): void {
        if (face === this.hoverFace)
            return;
        const previous = this.hoverFace;
        this.hoverFace = face;
        if (previous !== null && previous < this.faces.length)
            this.refreshFaceColor(previous);
        if (this.hoverFace !== null)
            this.refreshFaceColor(this.hoverFace);
        this.callbacks.hoverChanged?.(this.hoverFace !== null ? this.faceSubject(this.hoverFace) : { ...EMPTY_SUBJECT });
        this.scheduleRender();
    }

    private hoverPick(): void {
        this.hoverTimer = null;
        if (this.pressButton !== -1 || !this.underMouse)
            return;
        const hit = this.pickAt(this.hoverPos);
        if (hit.kind === 1 /* Face */ && this.selection.isSelectable(hit.index))
            this.setHoverFace(hit.index);
        else
            this.setHoverFace(null);
    }

    // ───────────────────────────────────────────── 相机与显示

    getCamera(): OrbitCamera { return this.camera; }

    fitView(bounds?: BoundingBox): void {
        const original = this.camera.sceneBounds();
        if (bounds) this.camera.setSceneBounds(bounds);
        this.camera.fit(this.aspect());
        if (bounds) this.camera.setSceneBounds(original);
        this.scheduleRender();
    }

    setStandardView(view: StandardViewKind): void {
        this.camera.setStandardView(view);
        this.camera.fit(this.aspect());
        this.scheduleRender();
    }

    setProjection(projection: ProjectionKind): void {
        this.camera.setProjection(projection);
        this.scheduleRender();
    }

    setEdgesVisible(visible: boolean): void {
        this.options.showEdges = visible;
        this.scheduleRender();
    }

    edgesVisible(): boolean { return this.options.showEdges; }

    // ───────────────────────────────────────────── 渲染

    private feedRenderer(): void {
        if (!this.renderer)
            return;
        this.renderer.setMesh(this.mesh, this.faces);
        this.renderer.setEdges(this.edges);
        this.renderer.setToolpath(this.pathBuffers);
        this.renderer.setToolpathTransform(this.stationTransform);
        this.renderer.setPlayhead(this.playhead);
        this.renderer.setPlaybackRange(this.playbackStart, this.playbackEnd);
        this.renderer.setFutureVisibility(this.futureVisible ? 0.25 : 0);
        this.refreshAllFaceColors();
    }

    // 外部(窗口 resize 等)请求重画一帧。
    requestRender(): void {
        this.scheduleRender();
    }

    private scheduleRender(): void {
        if (this.framePending || this.disposed)
            return;
        this.framePending = true;
        this.requestFrame(() => {
            this.framePending = false;
            this.renderNow();
        });
    }

    private renderNow(): void {
        if (this.disposed || !this.gl || !this.renderer)
            return;
        // 画布尺寸跟 CSS 走,变了先改后备存储(会清画布,反正要重画)。
        const phys = this.pixelSize();
        if (this.canvas.width !== phys.width || this.canvas.height !== phys.height) {
            this.canvas.width = phys.width;
            this.canvas.height = phys.height;
        }
        const t0 = this.now();
        try {
            this.renderer.render(this.currentView(), phys.width, phys.height, this.options);
            this.callbacks.frameRendered?.();
        } catch (e) {
            this.callbacks.renderingFailed?.(e instanceof Error ? e.message : String(e));
            return;
        }
        this.lastFrameMs = this.now() - t0;
        ++this.frameCount;
    }

    // ───────────────────────────────────────────── 鼠标(Qt 语义 → DOM 事件)

    private onPointerDown = (ev: PointerEvent): void => {
        this.pressPos = { x: ev.offsetX, y: ev.offsetY };
        this.lastPos = { x: ev.offsetX, y: ev.offsetY };
        this.pressButton = ev.button;
        this.dragging = false;
        this.canvas.setPointerCapture?.(ev.pointerId); // 拖出控件后继续收事件(Qt 的隐式 grab)
    };

    private onPointerMove = (ev: PointerEvent): void => {
        const pos = { x: ev.offsetX, y: ev.offsetY };
        if (this.pressButton === -1) {
            // 没按键:滑过预亮。节流,不是每个移动事件都拾取。
            this.hoverPos = pos;
            if (this.hoverTimer === null)
                this.hoverTimer = setTimeout(() => this.hoverPick(), HOVER_INTERVAL_MS);
            return;
        }
        if (!this.dragging && manhattanLength(pos, this.pressPos) > DRAG_THRESHOLD_PIXELS) {
            this.dragging = true;
            this.setHoverFace(null);
        }
        if (!this.dragging)
            return;
        const delta = { x: pos.x - this.lastPos.x, y: pos.y - this.lastPos.y };
        this.lastPos = pos;
        const pan = this.pressButton === 2 /* 右 */ || this.pressButton === 1 /* 中 */ || ev.shiftKey;
        if (pan)
            this.camera.pan(delta.x, delta.y, this.canvas.clientHeight);
        else
            this.camera.orbit(delta.x, delta.y);
        this.scheduleRender();
    };

    private onPointerUp = (ev: PointerEvent): void => {
        const click = !this.dragging && this.pressButton === 0 /* 左 */ && ev.button === 0;
        this.pressButton = -1;
        this.dragging = false;
        this.canvas.releasePointerCapture?.(ev.pointerId);
        if (!click || (!this.mesh && !this.hasToolpath()))
            return;
        const hit = this.pickAt({ x: ev.offsetX, y: ev.offsetY });
        if (hit.kind === 2 /* Segment */) {
            // 点在刀路上:不动面的选择集,只报告是哪一段、NC 第几行。
            this.callbacks.segmentClicked?.(hit.index, this.ncLineOfSegment(hit.index));
            return;
        }
        if (this.options.pickMode === 'path') return;
        const toggle = ev.ctrlKey || ev.metaKey;
        const mode: ClickMode = toggle ? "toggle" : "replace";
        if (hit.kind === 1 /* Face */) {
            this.applyChange(this.selection.click(hit.index, mode));
            this.callbacks.faceClicked?.(this.faceSubject(hit.index));
        } else if (hit.kind === 0 /* None */) {
            this.applyChange(this.selection.click(null, mode));
        }
    };

    private onDoubleClick = (ev: MouseEvent): void => {
        if (ev.button === 0)
            this.fitView();
    };

    private onWheel = (ev: WheelEvent): void => {
        // 与 C++ 同手感:向上滚 = 拉近。DOM 的 deltaY 向下为正(与 Qt angleDelta 相反),取负;
        // 触控板给像素位移(deltaMode 0,每 60px 一档),鼠标滚轮给行数(deltaMode 1,一格 120)。
        let steps = 0;
        if (ev.deltaMode === 0)
            steps = -ev.deltaY / 60.0;
        else
            steps = -ev.deltaY / 120.0;
        if (steps === 0)
            return;
        const ndcX = 2.0 * ev.offsetX / Math.max(1, this.canvas.clientWidth) - 1.0;
        const ndcY = 1.0 - 2.0 * ev.offsetY / Math.max(1, this.canvas.clientHeight);
        this.camera.zoom(Math.pow(0.88, steps), ndcX, ndcY, this.aspect());
        this.scheduleRender();
        ev.preventDefault();
    };

    private onPointerEnter = (): void => { this.underMouse = true; };
    private onPointerCancel = (): void => { this.pressButton = -1; this.dragging = false; };
    private onContextLost = (ev: Event): void => {
        ev.preventDefault();
        this.renderer?.dispose();
        this.renderer = null;
    };
    private onContextRestored = (): void => {
        if (this.gl && !this.disposed) this.attachGl(this.gl);
    };

    private onPointerLeave = (): void => {
        this.underMouse = false;
        this.setHoverFace(null);
    };
}

function manhattanLength(a: { x: number; y: number }, b: { x: number; y: number }): number {
    return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

/** 刀路线段端点的包围盒(NC 坐标);没有线段时为 null。C++ 版由 core 的 nc::toolpathBounds
 *  给出(A 线),几何语义相同:全部线段端点的包围盒。 */
export function toolpathGeometryBounds(path: ToolpathGeometry | null): { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } } | null {
    if (!path || path.lines.length === 0)
        return null;
    const p = path.positions;
    let min = { x: Infinity, y: Infinity, z: Infinity }, max = { x: -Infinity, y: -Infinity, z: -Infinity };
    for (let i = 0; i + 2 < p.length; i += 3) {
        min = { x: Math.min(min.x, p[i]), y: Math.min(min.y, p[i + 1]), z: Math.min(min.z, p[i + 2]) };
        max = { x: Math.max(max.x, p[i]), y: Math.max(max.y, p[i + 1]), z: Math.max(max.z, p[i + 2]) };
    }
    return { min, max };
}
