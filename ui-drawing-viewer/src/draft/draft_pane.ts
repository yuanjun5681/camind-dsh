// 4C-1 2D 查看器独立模块:DraftPane —— 出身条/图层/详情/改判 UI + DraftView 渲染,
// 与宿主只走消息接口(docs/2D查看器消息表_20261015.md,全部载荷纯 JSON)。
// 两宿主同一实现:分屏(4C-2,主窗 renderer 直发)与独立窗口(4C-3,经主进程 ipc 转发)。
// 结构规矩:Pane 在给定容器内程序化建自己的 DOM(不依赖页面结构);渲染器依赖注入的
// WebGL2 上下文(SceneRenderer 同款);所有出口消息可结构化克隆。
import { loadDraft, type DraftDim, type DraftOrigin, type LoadedDraft } from "./draft_loader.ts";
import { DraftView } from "./draft_view.ts";
import { detailFor, originInfo } from "./draft_detail.ts";

export const DRAFT_PANE_MESSAGE_VERSION = 2 as const;

const DRAFT_PANE_CSS = `
.cdv-draft-pane {
  position:relative; overflow:hidden; font-size:13px; line-height:20px;
  color:var(--camind-color-text,var(--dsw-alias-label-primary,CanvasText));
  background:var(--camind-surface-page,var(--dsw-alias-bg-base,Canvas));
}
.cdv-draft-pane .cdv-draft-canvas { position:absolute; inset:0; width:100%; height:100%; }
.cdv-draft-pane .cdv-draft-text-canvas { pointer-events:none; }
.cdv-draft-pane .cdv-draft-surface {
  border:1px solid var(--camind-border-default,var(--dsw-alias-border-l2,CanvasText));
  border-radius:6px; overflow-wrap:anywhere;
  color:var(--camind-color-text,var(--dsw-alias-label-primary,CanvasText));
  background:var(--camind-surface-raised,var(--dsw-alias-bg-layer-2,var(--dsw-alias-bg-base,Canvas)));
}
.cdv-draft-pane .cdv-draft-panel { position:absolute; z-index:5; box-sizing:border-box; padding:6px 10px; }
.cdv-draft-pane .cdv-draft-origin { left:8px; top:8px; max-width:min(460px,calc(100% - 16px)); }
.cdv-draft-pane .cdv-draft-layers {
  right:8px; top:8px; max-width:calc(100% - 16px); max-height:60%; overflow:auto;
}
.cdv-draft-pane .cdv-draft-detail {
  right:8px; bottom:8px; width:min(280px,calc(100% - 16px)); max-height:40%; overflow:auto;
}
.cdv-draft-pane .cdv-draft-heading { font-weight:600; }
.cdv-draft-pane .cdv-draft-muted {
  color:var(--camind-color-text-secondary,var(--dsw-alias-label-secondary,CanvasText));
}
.cdv-draft-pane .cdv-draft-button {
  margin:6px 0 0; padding:2px 8px;
  border:1px solid var(--camind-border-default,var(--dsw-alias-border-l2,CanvasText));
  border-radius:6px; font:inherit; cursor:pointer;
  color:var(--camind-color-text,var(--dsw-alias-label-primary,CanvasText));
  background:var(--camind-surface-layer,var(--dsw-alias-bg-layer-1,var(--dsw-alias-bg-base,Canvas)));
}
.cdv-draft-pane .cdv-draft-button:hover:not(:disabled):not([aria-busy="true"]) {
  background:var(--camind-surface-hover,var(--dsw-alias-interactive-bg-hover,var(--dsw-alias-bg-layer-1,Canvas)));
}
.cdv-draft-pane .cdv-draft-button:active:not(:disabled):not([aria-busy="true"]) {
  background:var(--camind-surface-active,var(--dsw-alias-interactive-bg-active,var(--dsw-alias-bg-layer-2,Canvas)));
}
.cdv-draft-pane .cdv-draft-button:focus-visible,
.cdv-draft-pane .cdv-draft-choice-input:focus-visible {
  outline:2px solid var(--camind-focus-ring,var(--dsw-alias-state-business-primary,Highlight));
  outline-offset:2px;
}
.cdv-draft-pane .cdv-draft-button:disabled,
.cdv-draft-pane .cdv-draft-choice-input:disabled { opacity:.55; cursor:default; }
.cdv-draft-pane .cdv-draft-button[aria-busy="true"] { opacity:.65; cursor:progress; }
.cdv-draft-pane .cdv-draft-layer-row { display:block; white-space:nowrap; cursor:pointer; border-radius:4px; }
.cdv-draft-pane .cdv-draft-layer-row:hover {
  background:var(--camind-surface-hover,var(--dsw-alias-interactive-bg-hover,var(--dsw-alias-bg-layer-1,Canvas)));
}
.cdv-draft-pane .cdv-draft-layer-row:active {
  background:var(--camind-surface-active,var(--dsw-alias-interactive-bg-active,var(--dsw-alias-bg-layer-2,Canvas)));
}
.cdv-draft-pane .cdv-draft-choice-input {
  accent-color:var(--camind-color-accent,var(--dsw-alias-state-business-primary,Highlight));
}
.cdv-draft-pane .cdv-draft-origin-badge { font-weight:600; }
.cdv-draft-pane .cdv-draft-origin-badge[data-tone="ok"] {
  color:var(--camind-color-success,var(--dsw-alias-state-success-primary,CanvasText));
}
.cdv-draft-pane .cdv-draft-origin-badge[data-tone="warn"] {
  color:var(--camind-color-warning,var(--dsw-alias-state-warn-label,var(--dsw-alias-state-warn-primary,CanvasText)));
}
.cdv-draft-pane .cdv-draft-origin-badge[data-tone="unknown"] {
  color:var(--camind-color-accent,var(--dsw-alias-state-business-primary,Highlight));
}
.cdv-draft-pane .cdv-draft-rechooser {
  position:absolute; left:50%; top:30%; z-index:50; transform:translateX(-50%);
  box-sizing:border-box; width:min(520px,calc(100% - 32px)); max-height:70%; overflow:auto;
  padding:14px 18px; border-radius:14px;
}
.cdv-draft-pane .cdv-draft-dialog-title { margin:0 0 8px; font-size:16px; line-height:24px; font-weight:600; }
.cdv-draft-pane .cdv-draft-choice { display:block; cursor:pointer; }
.cdv-draft-pane .cdv-draft-choice-description {
  margin:2px 0 8px 22px; font-size:12px; line-height:18px;
  color:var(--camind-color-text-secondary,var(--dsw-alias-label-secondary,CanvasText));
}
.cdv-draft-pane .cdv-draft-dialog-actions { display:flex; justify-content:flex-end; gap:8px; margin-top:8px; }
.cdv-draft-pane .cdv-draft-dialog-actions .cdv-draft-button { margin:0; }
.cdv-draft-pane .cdv-draft-detail-value { margin:4px 0; font-size:20px; line-height:28px; }
.cdv-draft-pane .cdv-draft-detail-value[data-tone="error"] {
  color:var(--camind-color-danger,var(--dsw-alias-state-error-primary,var(--dsw-alias-label-error,CanvasText)));
}
.cdv-draft-pane .cdv-draft-detail-table { border-spacing:0; }
.cdv-draft-pane .cdv-draft-detail-key {
  padding:1px 4px; white-space:nowrap; text-align:left; font-weight:400;
  color:var(--camind-color-text-secondary,var(--dsw-alias-label-secondary,CanvasText));
}
.cdv-draft-pane .cdv-draft-detail-cell { padding:1px 4px; }
`;
let nextDraftPaneId = 0;

export interface DraftProvenance {
    session: string;
    source: { uri: string; sha256: string; name: string };
    pack: { sha256: string; identity: string };
}
export interface DraftTarget { type: "dim" | "entity"; id: string | number; }
export interface DraftRect { x: number; y: number; width: number; height: number; }
export interface DraftCameraState { cx: number; cy: number; halfH: number; }
export interface DraftViewportInsets { top: number; right: number; bottom: number; left: number; }
export interface DraftDegradation {
    geometryDecimated: boolean;
    textTruncated: boolean;
    skippedTypes: string[];
}

type LegacyPaneHostMessage =
    | { type: "load"; messageVersion?: 1 | 2; packText: string; name: string;
        provenance?: DraftProvenance | null }
    | { type: "setLayerVisible"; messageVersion?: 1 | 2; layer: string; visible: boolean }
    | { type: "fit"; messageVersion?: 1 | 2 }
    | { type: "zoomAt"; messageVersion?: 1 | 2; sx: number; sy: number; factor: number }
    | { type: "pan"; messageVersion?: 1 | 2; dx: number; dy: number }
    | { type: "resize"; messageVersion?: 1 | 2 }
    | { type: "setOriginOverride"; messageVersion?: 1 | 2;
        channel: "autocad" | "nx" | "unknown"; evidence: string[] }
    | { type: "getStats"; messageVersion?: 1 | 2 }
    | { type: "dispose"; messageVersion?: 1 | 2 };
type V2PaneHostMessage =
    | { type: "zoomToRect"; messageVersion: 2; rect: DraftRect }
    | { type: "locateTarget"; messageVersion: 2; target: DraftTarget; zoom: boolean }
    | { type: "setSelection"; messageVersion: 2; targets: DraftTarget[] }
    | { type: "clearSelection"; messageVersion: 2 }
    | { type: "getCamera"; messageVersion: 2 }
    | { type: "setCamera"; messageVersion: 2; state: DraftCameraState }
    | { type: "setViewportInsets"; messageVersion: 2;
        top: number; right: number; bottom: number; left: number }
    | { type: "setColorMode"; messageVersion: 2; mode: "readable" | "original" };
export type PaneHostMessage = LegacyPaneHostMessage | V2PaneHostMessage;

type WithMessageVersion<T> = T & { messageVersion: 2 };
type ViewerMessageBody =
    | { type: "ready"; width: number; height: number }
    | { type: "loaded"; name: string; entities: number; segs: number; texts: number;
        points: number;
        layers: Array<{ name: string; visible: boolean; off: boolean; frozen: boolean }>;
        dims: number; origin: DraftOrigin; sourceFile: string;
        pack: DraftProvenance["pack"] | null; degraded: DraftDegradation }
    | { type: "layerChanged"; layer: string; visible: boolean }
    | { type: "pickDetail"; detail: unknown }
    | { type: "originChanged"; origin: DraftOrigin }
    | { type: "selectionChanged"; targets: DraftTarget[] }
    | { type: "camera"; state: DraftCameraState }
    | { type: "stats"; stats: Record<string, number> }
    | { type: "error"; message: string };
export type PaneViewerMessage = WithMessageVersion<ViewerMessageBody>;
type WithoutMessageVersion<T> = T extends unknown ? Omit<T, "messageVersion"> : never;
type PaneViewerPayload = WithoutMessageVersion<PaneViewerMessage>;

function validateProvenance(p: DraftProvenance | null | undefined): DraftProvenance | null {
    if (p === null || p === undefined) return null;
    const text = (v: unknown): v is string => typeof v === "string" && v.length > 0;
    const sha = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{64}$/i.test(v);
    const source = p.source, pack = p.pack;
    if (!text(p.session) || !source || !pack || !text(source.uri) || !text(source.name)
        || !sha(source.sha256) || !sha(pack.sha256) || !sha(pack.identity))
        throw new Error("provenance 须含 session/source(uri,sha256,name)/pack(sha256,identity)，哈希为 64 位十六进制");
    return {
        session: p.session,
        source: { uri: source.uri, sha256: source.sha256, name: source.name },
        pack: { sha256: pack.sha256, identity: pack.identity },
    };
}

export class DraftPane {
    private readonly container: HTMLElement;
    private view: DraftView | null = null;
    private draft: LoadedDraft | null = null;
    private name = "";
    private originNow: DraftOrigin | null = null;
    private provenance: DraftProvenance | null = null;
    private selection: DraftTarget[] = [];
    private colorMode: "readable" | "original" = "readable";
    private insets: DraftViewportInsets = { top: 0, right: 0, bottom: 0, left: 0 };
    private fitOnVisible = false;
    private clickTimer: ReturnType<typeof setTimeout> | null = null;
    private contextSnapshot: {
        camera: DraftCameraState;
        selection: number[];
        layers: Record<string, boolean>;
    } | null = null;
    private readonly emit: (msg: PaneViewerPayload) => void;
    private disposers: Array<() => void> = [];
    private ro: ResizeObserver | null = null;
    private destroyed = false;
    private readonly instanceId = ++nextDraftPaneId;
    private readonly radioName = `cdv-origin-channel-${this.instanceId}`;
    private rechooserReturnFocus: HTMLElement | null = null;
    private rootClassAdded = false;

    // Pane 自建 DOM
    private glCanvas!: HTMLCanvasElement;
    private textCanvas!: HTMLCanvasElement;
    private originDiv!: HTMLElement;
    private layersDiv!: HTMLElement;
    private detailBody!: HTMLElement;
    private rechooser!: HTMLElement;

    constructor(container: HTMLElement, emit: (msg: PaneViewerMessage) => void) {
        this.container = container;
        this.emit = (msg) => emit({ ...msg, messageVersion: DRAFT_PANE_MESSAGE_VERSION } as PaneViewerMessage);
        this.buildDom();
        this.bindInteractions();
        this.applySize(); // 先定画布物理像素,ready 才是文档口径(非 CSS 尺寸)
        this.emit({ type: "ready",
            width: this.glCanvas.width, height: this.glCanvas.height });
        // 容器尺寸变化 → 重读物理像素并重绘(完整 resize 链:不依赖宿主记得发 resize;
        // resize 消息保留为兜底。Kimi 4C 审查必改 3)
        this.ro = new ResizeObserver(() => {
            if (this.destroyed) return;
            this.cancelClickTimer();
            this.applySize();
            if (this.view) this.view.render();
        });
        this.ro.observe(container);
    }

    // ── 消息入口(宿主唯一调用点;载荷纯 JSON)──
    handle(msg: PaneHostMessage): void {
        if (this.destroyed) return;
        try {
            if (msg === null || typeof msg !== "object") throw new Error("DraftPane 消息须为对象");
            if (msg.type !== "getCamera" && msg.type !== "getStats") this.cancelClickTimer();
            const version = (msg as { messageVersion?: number }).messageVersion;
            if (version !== undefined && version !== 1 && version !== DRAFT_PANE_MESSAGE_VERSION)
                throw new Error(`不支持的 DraftPane messageVersion:${JSON.stringify(version)}`);
            const isV2 = msg.type === "zoomToRect" || msg.type === "locateTarget"
                || msg.type === "setSelection" || msg.type === "clearSelection"
                || msg.type === "getCamera" || msg.type === "setCamera"
                || msg.type === "setViewportInsets" || msg.type === "setColorMode";
            if (isV2 && version !== DRAFT_PANE_MESSAGE_VERSION)
                throw new Error(`${msg.type} 需要 messageVersion=2`);
            switch (msg.type) {
                case "load": this.load(msg.packText, msg.name, msg.provenance); return;
                case "setLayerVisible":
                    if (!this.draft) return;
                    if (!this.draft.layers.has(msg.layer)) { // 未知层按消息表回 error,不静默
                        this.emit({ type: "error", message: `未知图层:${msg.layer}` });
                        return;
                    }
                    this.view?.setLayerVisible(msg.layer, msg.visible);
                    if (this.contextSnapshot) this.contextSnapshot.layers[msg.layer] = msg.visible;
                    this.renderNow();
                    return;
                case "fit":
                    if (this.view) {
                        const rect = this.container.getBoundingClientRect();
                        if (rect.width <= 0 || rect.height <= 0) this.fitOnVisible = true;
                        this.view.fit(); this.renderNow();
                    }
                    return;
                case "zoomAt": if (this.view) { this.view.zoomAt(msg.sx, msg.sy, msg.factor); this.fitOnVisible = false; this.renderNow(); } return;
                case "pan": if (this.view) { this.view.panPixels(msg.dx, msg.dy); this.fitOnVisible = false; this.renderNow(); } return;
                case "resize": this.applySize(); this.renderNow(); return;
                case "setOriginOverride":
                    if (this.originNow) {
                        this.originNow = { ...this.originNow, channel: msg.channel, method: "manual",
                            evidence: msg.evidence };
                        this.renderOrigin();
                        this.emit({ type: "originChanged", origin: this.originNow });
                    }
                    return;
                case "getStats":
                    this.emit({ type: "stats",
                        stats: this.view ? (this.view.getStats() as unknown as Record<string, number>) : {} });
                    return;
                case "dispose": this.dispose(); return;
                case "zoomToRect":
                    if (this.view) { this.view.zoomToRect(msg.rect); this.fitOnVisible = false; this.renderNow(); }
                    return;
                case "locateTarget":
                    if (this.view && this.draft) { this.locate(msg.target, msg.zoom); if (msg.zoom) this.fitOnVisible = false; }
                    return;
                case "setSelection":
                    if (this.view && this.draft) this.applySelection(msg.targets);
                    return;
                case "clearSelection":
                    if (this.view && this.draft) this.applySelection([]);
                    return;
                case "getCamera":
                    if (this.view) this.emit({ type: "camera", state: { ...this.view.view } });
                    return;
                case "setCamera":
                    if (this.view) { this.view.setCamera(msg.state); this.fitOnVisible = false; this.renderNow(); }
                    return;
                case "setViewportInsets": {
                    const next = { top: msg.top, right: msg.right, bottom: msg.bottom, left: msg.left };
                    if (![next.top, next.right, next.bottom, next.left].every(v => Number.isFinite(v) && v >= 0))
                        throw new Error("viewport insets 须为非负有限数");
                    this.insets = next;
                    this.view?.setViewportInsets(next);
                    this.renderNow();
                    return;
                }
                case "setColorMode": this.setColorMode(msg.mode); return;
                default: throw new Error("未知 DraftPane 消息");
            }
        } catch (e) {
            this.emit({ type: "error", message: e instanceof Error ? e.message : String(e) });
        }
    }

    private setColorMode(mode: "readable" | "original"): void {
        if (mode !== "readable" && mode !== "original") throw new Error(`未知配色模式:${JSON.stringify(mode)}`);
        this.colorMode = mode;
        this.view?.setColorMode(mode);
    }

    private load(packText: string, name: string, provenance?: DraftProvenance | null): void {
        // 先解析构建到局部变量,成功后才一次性交换并 dispose 旧视图 —— 坏包不得毁掉
        // 正在显示的旧图(Kimi 4C 审查必改 1:旧 view 先毁会留下冻结画面+错乱状态)
        this.cancelClickTimer();
        const provenanceNow = validateProvenance(provenance);
        const draft = loadDraft(JSON.parse(packText)); // 坏包在此抛,旧状态不动
        const gl = this.glCanvas.getContext("webgl2", { antialias: true, depth: false });
        if (!gl) throw new Error("建不出 WebGL2 上下文");
        const c2d = this.textCanvas.getContext("2d")!;
        const hadSelection = this.selection.length > 0;
        const nextView = new DraftView(gl, c2d, draft, { checkErrors: true });
        nextView.setViewportInsets(this.insets);
        const rect = this.container.getBoundingClientRect();
        this.fitOnVisible = rect.width <= 0 || rect.height <= 0;
        nextView.fit();
        nextView.setColorMode(this.colorMode);
        this.view?.dispose();
        this.view = nextView;
        this.draft = draft;
        this.name = name;
        this.originNow = draft.origin;
        this.provenance = provenanceNow;
        this.selection = [];
        this.renderLayers();
        this.renderOrigin();
        this.detailBody.textContent = "点击实体查看详情";
        const stats = nextView.getStats();
        this.emit({
            type: "loaded", name, entities: draft.entityCount, segs: draft.segments.length,
            texts: draft.texts.length, points: draft.points.length,
            layers: [...draft.layers.entries()].map(([ln, l]) => ({
                name: ln, visible: this.view!.isLayerVisible(ln), off: l.off, frozen: l.frozen })),
            dims: draft.dims.length, origin: draft.origin, sourceFile: draft.sourceFile,
            pack: provenanceNow?.pack ?? null,
            degraded: {
                geometryDecimated: stats.lastStep > 1,
                textTruncated: stats.textsOverflow > 0,
                skippedTypes: [...draft.skippedTypes],
            },
        });
        if (hadSelection) this.emit({ type: "selectionChanged", targets: [] });
        this.contextSnapshot = null;
    }

    private restoreContext(): void {
        if (this.destroyed || !this.draft || this.view || !this.contextSnapshot) return;
        this.cancelClickTimer();
        let nextView: DraftView | null = null;
        try {
            const gl = this.glCanvas.getContext("webgl2", { antialias: true, depth: false });
            if (!gl) throw new Error("恢复 WebGL2 上下文失败");
            const c2d = this.textCanvas.getContext("2d")!;
            const snapshot = this.contextSnapshot;
            nextView = new DraftView(gl, c2d, this.draft, { checkErrors: true });
            nextView.setViewportInsets(this.insets);
            nextView.setCamera(snapshot.camera);
            nextView.setLayerVisibility(snapshot.layers);
            nextView.setSelectedEntities(snapshot.selection);
            nextView.setColorMode(this.colorMode);
            this.view = nextView;
            this.renderLayers();
            this.contextSnapshot = null;
        } catch (e) {
            nextView?.dispose();
            this.emit({ type: "error", message: e instanceof Error ? e.message : String(e) });
        }
    }

    // ── DOM 构建(出身条/图层/详情/改判对话框 + 双画布)──
    private buildDom(): void {
        const c = this.container;
        if (!c.classList.contains("cdv-draft-pane")) {
            c.classList.add("cdv-draft-pane");
            this.rootClassAdded = true;
        }
        const mk = (tag: string, className: string, parent: HTMLElement = c): HTMLElement => {
            const el = document.createElement(tag);
            el.className = className;
            parent.appendChild(el);
            return el;
        };
        this.glCanvas = mk("canvas", "cdv-draft-canvas cdv-draft-gl-canvas") as HTMLCanvasElement;
        this.textCanvas = mk("canvas", "cdv-draft-canvas cdv-draft-text-canvas") as HTMLCanvasElement;
        this.originDiv = mk("div", "cdv-draft-surface cdv-draft-panel cdv-draft-origin");
        this.layersDiv = mk("div", "cdv-draft-surface cdv-draft-panel cdv-draft-layers");
        const hd = document.createElement("div");
        hd.className = "cdv-draft-heading";
        hd.textContent = "DXF 图层";
        this.layersDiv.appendChild(hd);
        const detailDiv = mk("div", "cdv-draft-surface cdv-draft-panel cdv-draft-detail");
        const dhd = document.createElement("div");
        dhd.className = "cdv-draft-heading";
        dhd.textContent = "详情";
        detailDiv.appendChild(dhd);
        this.detailBody = mk("div", "cdv-draft-detail-body", detailDiv);
        this.detailBody.textContent = "点击实体查看详情";
        this.rechooser = mk("div", "cdv-draft-surface cdv-draft-rechooser");
        this.rechooser.id = `cdv-origin-dialog-${this.instanceId}`;
        this.rechooser.hidden = true;
        this.rechooser.tabIndex = -1;
        // 独立渲染进程没有 dsh React Modal；dialog aria/Escape/焦点恢复在此自含，升级时复核。
        this.rechooser.setAttribute("role", "dialog");
        this.rechooser.setAttribute("aria-modal", "false");
        this.rechooser.setAttribute("aria-labelledby", `${this.rechooser.id}-title`);
        const onRechooserKeyDown = (e: KeyboardEvent): void => {
            if (e.key !== "Escape" || this.rechooser.hidden) return;
            e.preventDefault();
            e.stopPropagation();
            this.closeRechooser();
        };
        this.rechooser.addEventListener("keydown", onRechooserKeyDown);
        this.disposers.push(() => this.rechooser.removeEventListener("keydown", onRechooserKeyDown));
        const style = mk("style", "cdv-draft-style");
        style.textContent = DRAFT_PANE_CSS;
    }

    private closeRechooser(restoreFocus = true): void {
        if (this.rechooser.hidden) return;
        this.rechooser.hidden = true;
        const target = this.rechooserReturnFocus;
        this.rechooserReturnFocus = null;
        target?.setAttribute("aria-expanded", "false");
        if (restoreFocus) target?.focus();
    }

    private cancelClickTimer(): void {
        if (this.clickTimer !== null) clearTimeout(this.clickTimer);
        this.clickTimer = null;
    }

    private bindInteractions(): void {
        const dprOf = (): number => this.glCanvas.width / (this.glCanvas.getBoundingClientRect().width || 1);
        const onWheel = (e: WheelEvent): void => {
            e.preventDefault();
            this.cancelClickTimer();
            const r = this.glCanvas.getBoundingClientRect();
            const k = dprOf();
            this.view?.zoomAt((e.clientX - r.left) * k, (e.clientY - r.top) * k,
                Math.exp((e.deltaY > 0 ? -1 : 1) * 0.15));
            this.renderNow();
        };
        let dragging = false, moved = false, lastX = 0, lastY = 0, startX = 0, startY = 0;
        const onDown = (e: PointerEvent): void => {
            if (e.button !== 0) return;
            this.cancelClickTimer();
            dragging = true; moved = false;
            lastX = startX = e.clientX; lastY = startY = e.clientY;
        };
        const onMove = (e: PointerEvent): void => {
            if (!dragging) return;
            if (Math.hypot(e.clientX - startX, e.clientY - startY) > 4) moved = true;
            const k = dprOf();
            this.view?.panPixels((e.clientX - lastX) * k, (e.clientY - lastY) * k);
            lastX = e.clientX; lastY = e.clientY;
            this.renderNow();
        };
        const onUp = (): void => { dragging = false; };
        const onCancel = (): void => { this.cancelClickTimer(); dragging = false; moved = true; };
        const preparePick = (e: MouseEvent): (() => void) | null => {
            if (moved) { moved = false; return null; } // 拖动后的 click 不是拾取
            if (!this.view || !this.draft) return null;
            const r = this.glCanvas.getBoundingClientRect();
            const k = dprOf();
            const sx = (e.clientX - r.left) * k, sy = (e.clientY - r.top) * k;
            const textEnt = this.view.pickText(sx, sy); // 标注文字优先(4B-4)
            let entId = -1, layer = "";
            if (textEnt >= 0) {
                const t = this.draft.texts.find(t2 => t2.entId === textEnt);
                if (t) { entId = textEnt; layer = t.layer; }
            }
            if (entId < 0) {
                const hit = this.view.pick(sx, sy);
                if (!hit) {
                    return () => {
                        this.detailBody.textContent = "点击实体查看详情";
                        this.applySelection([]);
                        this.emit({ type: "pickDetail", detail: null });
                    };
                }
                entId = hit.entId; layer = hit.layer;
            }
            const dimId = this.draft.dimIdByEnt.get(entId);
            const target: DraftTarget = { type: dimId ? "dim" : "entity", id: dimId ?? entId };
            const dimsMap = new Map(this.draft.dims.map(d => [d.id, d]));
            const groupSize = (dimId2: string): number => {
                let n = 0;
                for (const v of this.draft!.dimIdByEnt.values()) if (v === dimId2) ++n;
                return n;
            };
            const d = detailFor(entId, layer, this.draft.dimIdByEnt.get(entId), dimsMap, groupSize);
            return () => {
                this.applySelection([target]);
                this.renderDetail(d);
                this.emit({ type: "pickDetail", detail: d });
            };
        };
        const onClick = (e: MouseEvent): void => {
            if (moved) { moved = false; return; }
            this.cancelClickTimer();
            if (e.detail > 1) return;
            const event = { clientX: e.clientX, clientY: e.clientY, button: e.button } as MouseEvent;
            const apply = preparePick(event);
            if (!apply) return;
            this.clickTimer = setTimeout(() => {
                this.clickTimer = null;
                apply();
            }, 220);
        };
        const onDblClick = (e: MouseEvent): void => {
            e.preventDefault();
            this.cancelClickTimer();
            moved = false;
            this.view?.fit();
            this.renderNow();
        };
        const onLost = (e: Event): void => {
            e.preventDefault(); // 必须允许后续 webglcontextrestored
            if (this.destroyed) return;
            this.cancelClickTimer();
            if (this.view) {
                this.contextSnapshot = {
                    camera: { ...this.view.view },
                    selection: this.view.selectedEntities(),
                    layers: this.view.layerVisibility(),
                };
                this.view.dispose();
                this.view = null;
            }
        };
        const onRestored = (): void => { this.restoreContext(); };
        const onWindowResize = (): void => {
            if (this.destroyed) return;
            this.cancelClickTimer();
            this.applySize();
            if (this.view) this.view.render();
        };
        let dprQuery: MediaQueryList | null = null;
        const onDprChange = (): void => {
            if (this.destroyed) return;
            this.cancelClickTimer();
            this.applySize();
            if (this.view) this.view.render();
            watchDpr();
        };
        const watchDpr = (): void => {
            if (dprQuery) dprQuery.removeEventListener("change", onDprChange);
            if (typeof window.matchMedia !== "function") { dprQuery = null; return; }
            dprQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
            dprQuery.addEventListener("change", onDprChange);
        };
        watchDpr();
        this.glCanvas.addEventListener("wheel", onWheel, { passive: false });
        this.glCanvas.addEventListener("pointerdown", onDown);
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
        window.addEventListener("pointercancel", onCancel);
        window.addEventListener("resize", onWindowResize);
        this.glCanvas.addEventListener("click", onClick);
        this.glCanvas.addEventListener("dblclick", onDblClick);
        this.glCanvas.addEventListener("webglcontextlost", onLost);
        this.glCanvas.addEventListener("webglcontextrestored", onRestored);
        this.disposers.push(() => {
            if (dprQuery) dprQuery.removeEventListener("change", onDprChange);
            dprQuery = null;
            this.glCanvas.removeEventListener("wheel", onWheel);
            this.glCanvas.removeEventListener("pointerdown", onDown);
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onUp);
            window.removeEventListener("pointercancel", onCancel);
            window.removeEventListener("resize", onWindowResize);
            this.glCanvas.removeEventListener("click", onClick);
            this.glCanvas.removeEventListener("dblclick", onDblClick);
            this.glCanvas.removeEventListener("webglcontextlost", onLost);
            this.glCanvas.removeEventListener("webglcontextrestored", onRestored);
        });
    }

    private resolveTargets(targets: readonly DraftTarget[]): { ids: number[]; canonical: DraftTarget[] } {
        if (!Array.isArray(targets)) throw new Error("selection targets 须为数组");
        const ids = new Set<number>(), canonical: DraftTarget[] = [], keys = new Set<string>();
        for (const target of targets) {
            if (!target || (target.type !== "dim" && target.type !== "entity"))
                throw new Error("target.type 须为 dim 或 entity");
            if (target.type === "dim") {
                if (typeof target.id !== "string" || !target.id) throw new Error("dim target.id 须为非空字符串");
                const dim = this.draft!.dims.find(d => d.id === target.id);
                if (!dim) throw new Error(`未知尺寸:${target.id}`);
                for (const id of dim.entityIds) ids.add(id);
            } else {
                if (!Number.isInteger(target.id) || (target.id as number) < 0
                    || (target.id as number) >= this.draft!.entityCount)
                    throw new Error(`未知实体:${JSON.stringify(target.id)}`);
                ids.add(target.id as number);
            }
            const key = `${target.type}:${String(target.id)}`;
            if (!keys.has(key)) {
                keys.add(key);
                canonical.push({ type: target.type, id: target.id });
            }
        }
        return { ids: [...ids], canonical };
    }

    private applySelection(targets: readonly DraftTarget[]): void {
        const { ids, canonical } = this.resolveTargets(targets);
        this.view!.setSelectedEntities(ids);
        this.selection = canonical;
        this.renderNow();
        this.emit({ type: "selectionChanged", targets: canonical.map(t => ({ ...t })) });
    }

    private locate(target: DraftTarget, zoom: boolean): void {
        if (typeof zoom !== "boolean") throw new Error("locateTarget.zoom 须为布尔值");
        const { ids, canonical } = this.resolveTargets([target]);
        if (ids.length === 0) throw new Error("目标没有关联实体");
        const bounds = zoom ? this.view!.entityBounds(ids) : null;
        if (zoom && !bounds) throw new Error("目标没有可定位几何");
        const layers = new Set<string>();
        for (const s of this.draft!.segments) if (ids.includes(s.entId)) layers.add(s.layer);
        for (const t of this.draft!.texts) if (ids.includes(t.entId)) layers.add(t.layer);
        for (const p of this.draft!.points) if (ids.includes(p.entId)) layers.add(p.layer);
        let reveal = false;
        for (const layer of layers) {
            if (!this.view!.isLayerVisible(layer)) {
                this.view!.setLayerVisible(layer, true);
                reveal = true;
            }
        }
        if (reveal) this.renderLayers();
        if (bounds) this.view!.zoomToWorldRect(bounds);
        this.applySelection(canonical);
    }

    private renderNow(): void {
        this.view?.render();
        if (this.view) {
            const s = this.view.getStats();
            this.emit({ type: "stats", stats: { lastDrawn: s.lastDrawn, lastStep: s.lastStep,
                geomMs: s.geomMs, textMs: s.textMs, textsDrawn: s.textsDrawn,
                textsOverflow: s.textsOverflow, glError: s.glError } });
        }
    }

    private applySize(): void {
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const r = this.container.getBoundingClientRect();
        const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
        this.glCanvas.width = w; this.glCanvas.height = h;
        this.textCanvas.width = w; this.textCanvas.height = h;
        if (this.fitOnVisible && r.width > 0 && r.height > 0 && this.view) {
            this.view.fit();
            this.fitOnVisible = false;
        }
    }

    private renderLayers(): void {
        if (!this.view || !this.draft) return;
        this.layersDiv.textContent = "";
        const hd = document.createElement("div");
        hd.className = "cdv-draft-heading";
        hd.textContent = "DXF 图层";
        this.layersDiv.appendChild(hd);
        for (const name of this.view.layerNames()) {
            const label = document.createElement("label");
            label.className = "cdv-draft-layer-row";
            const cb = document.createElement("input");
            cb.className = "cdv-draft-choice-input";
            cb.type = "checkbox";
            cb.checked = this.view.isLayerVisible(name);
            cb.addEventListener("change", () => {
                this.cancelClickTimer();
                this.view?.setLayerVisible(name, cb.checked);
                if (this.contextSnapshot) this.contextSnapshot.layers[name] = cb.checked;
                this.renderNow();
                this.emit({ type: "layerChanged", layer: name, visible: cb.checked });
            });
            label.appendChild(cb);
            const flag = this.draft.layers.get(name);
            const tag = flag?.frozen ? "[冻]" : flag?.off ? "[关]" : "";
            label.appendChild(document.createTextNode(` DXF 图层: ${name}${tag}(${this.draft.segsByLayer.get(name) ?? 0})`));
            this.layersDiv.appendChild(label);
        }
    }

    private renderOrigin(): void {
        if (!this.originNow || !this.draft) return;
        const info = originInfo(this.originNow, this.draft.sourceFile);
        this.originDiv.textContent = "";
        const badge = document.createElement("div");
        badge.className = "cdv-draft-origin-badge";
        badge.dataset.tone = info.tone;
        badge.textContent = info.badge;
        const note = document.createElement("div");
        note.className = "cdv-draft-muted";
        note.textContent = info.note;
        const btn = document.createElement("button");
        btn.className = "cdv-draft-button cdv-draft-origin-action";
        btn.type = "button";
        btn.textContent = "出身改判…";
        btn.setAttribute("aria-haspopup", "dialog");
        btn.setAttribute("aria-controls", this.rechooser.id);
        btn.setAttribute("aria-expanded", "false");
        btn.addEventListener("click", () => {
            this.rechooserReturnFocus = btn;
            this.rechooser.textContent = "";
            const hd = document.createElement("h2");
            hd.className = "cdv-draft-dialog-title";
            hd.id = `${this.rechooser.id}-title`;
            hd.textContent = "出身手动指定";
            this.rechooser.appendChild(hd);
            for (const [ch, label, desc] of [
                ["autocad", "AutoCAD 原生绘制", "按 AutoCAD 规则集解析"],
                ["nx", "NX 制图导出", "当前版本统一走 AutoCAD 通道;补传 prt 可获更高保真与 3D 联动"],
                ["unknown", "不确定", "保留 unknown,后续人工确认"],
            ] as const) {
                const lab = document.createElement("label");
                lab.className = "cdv-draft-choice";
                const radio = document.createElement("input");
                radio.className = "cdv-draft-choice-input";
                radio.type = "radio";
                radio.name = this.radioName;
                radio.value = ch;
                radio.checked = ch === this.originNow!.channel; // 打开按当前生效出身重置
                lab.appendChild(radio);
                lab.appendChild(document.createTextNode(" " + label));
                const d = document.createElement("div");
                d.className = "cdv-draft-choice-description";
                d.textContent = desc;
                lab.appendChild(d);
                this.rechooser.appendChild(lab);
            }
            const row = document.createElement("div");
            row.className = "cdv-draft-dialog-actions";
            const cancel = document.createElement("button");
            cancel.className = "cdv-draft-button";
            cancel.type = "button";
            cancel.textContent = "取消";
            cancel.addEventListener("click", () => this.closeRechooser());
            const ok = document.createElement("button");
            ok.className = "cdv-draft-button";
            ok.type = "button";
            ok.textContent = "确认改判";
            ok.addEventListener("click", () => {
                const picked = this.rechooser.querySelector(`input[name="${this.radioName}"]:checked`) as HTMLInputElement | null;
                this.closeRechooser(false);
                if (picked && this.originNow) {
                    this.handle({ type: "setOriginOverride",
                        channel: picked.value as DraftOrigin["channel"],
                        evidence: [`人工指认(${new Date().toISOString().slice(0, 10)})`] });
                }
                const trigger = this.originDiv.querySelector(".cdv-draft-origin-action") as HTMLElement | null;
                (trigger ?? btn).focus();
            });
            row.appendChild(cancel);
            row.appendChild(ok);
            this.rechooser.appendChild(row);
            this.rechooser.hidden = false;
            btn.setAttribute("aria-expanded", "true");
            const picked = this.rechooser.querySelector(`input[name="${this.radioName}"]:checked`) as HTMLInputElement | null;
            (picked ?? this.rechooser).focus();
        });
        this.originDiv.appendChild(badge);
        this.originDiv.appendChild(note);
        this.originDiv.appendChild(btn);
    }

    private renderDetail(d: ReturnType<typeof detailFor>): void {
        this.detailBody.textContent = "";
        if (d === null) { this.detailBody.textContent = "点击实体查看详情"; return; }
        if (d.kind === "dim") {
            const big = document.createElement("div");
            big.className = "cdv-draft-detail-value";
            if (d.compare === "mismatch") big.dataset.tone = "error";
            big.textContent = d.displayText + (d.inferred ? "(推断)" : "");
            this.detailBody.appendChild(big);
            const tbl = document.createElement("table");
            tbl.className = "cdv-draft-detail-table";
            const row = (k: string, v: string): void => {
                const tr = document.createElement("tr");
                const t1 = document.createElement("td");
                t1.className = "cdv-draft-detail-key";
                t1.textContent = k;
                const t2 = document.createElement("td");
                t2.className = "cdv-draft-detail-cell";
                t2.textContent = v;
                tr.appendChild(t1); tr.appendChild(t2); tbl.appendChild(tr);
            };
            row("尺寸 id", d.id);
            row("类型", d.typeLabel);
            row("测量值", d.measured !== undefined ? String(d.measured) : "—");
            if (d.toleranceText) row("公差", d.toleranceText);
            if (d.compare === "mismatch") row("比对", "⚠ 显示与测量不一致");
            else if (d.compare === "no-measured") row("比对", "测量值缺席(LibreDWG 已知形态)");
            row("关联实体", `${d.entityCount} 个`);
            if (d.ruleVersion) row("规则", d.ruleVersion);
            this.detailBody.appendChild(tbl);
        } else {
            const tbl = document.createElement("table");
            tbl.className = "cdv-draft-detail-table";
            const row = (k: string, v: string): void => {
                const tr = document.createElement("tr");
                const t1 = document.createElement("td");
                t1.className = "cdv-draft-detail-key";
                t1.textContent = k;
                const t2 = document.createElement("td");
                t2.className = "cdv-draft-detail-cell";
                t2.textContent = v;
                tr.appendChild(t1); tr.appendChild(t2); tbl.appendChild(tr);
            };
            row("实体", String(d.entId));
            row("图层", d.layer);
            this.detailBody.appendChild(tbl);
        }
    }

    /** 释放 WebGL 资源与全部监听器(4C-3 关窗回收断言的对象);此后 handle 为空操作。 */
    dispose(): void {
        this.destroyed = true;
        this.cancelClickTimer();
        this.ro?.disconnect();
        this.ro = null;
        for (const d of this.disposers) d();
        this.disposers = [];
        this.view?.dispose();
        this.view = null;
        this.contextSnapshot = null;
        this.rechooserReturnFocus = null;
        this.container.textContent = "";
        if (this.rootClassAdded) this.container.classList.remove("cdv-draft-pane");
        this.rootClassAdded = false;
    }
}
