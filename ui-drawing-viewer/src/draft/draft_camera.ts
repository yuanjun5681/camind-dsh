// 2D 图纸相机:world↔screen 纯函数(M0-6 第一轮审查 Kimi 必改:相机数学从页面抽出,
// 可单测;screenToWorld 即 CPU 拾取的射线入口,4B-4 预埋)。4B-3 已从 tools/ 挪入
// 正式模块(本文件为正本;tools/draft_camera.ts 只 re-export 供 spike 页面兼容)。
// 约定:world 为 DXF 图纸坐标(y 向上);screen 为画布物理像素(原点左上,y 向下)。
// 视口由 (cx, cy, halfH) 定义:世界窗口高 2*halfH、宽 2*halfH*(w/h)。

export interface ViewState {
    cx: number;
    cy: number;
    halfH: number;
}

/** 全图适配:bbox 居中且四边留 pad(默认 5% 边距),宽图高图都装得下。
 *  退化 bbox(单点/零尺寸)给最小半窗,防 halfH=0 让缩放与拾取除零(Kimi 审查必改 7)。 */
export function fitView(bbox: readonly [number, number, number, number],
                        w: number, h: number, pad = 1.05): ViewState {
    const cx = (bbox[0] + bbox[2]) / 2;
    const cy = (bbox[1] + bbox[3]) / 2;
    let halfH = Math.max((bbox[3] - bbox[1]) / 2, ((bbox[2] - bbox[0]) / 2) * (h / w)) * pad;
    if (!Number.isFinite(halfH) || halfH <= 0) halfH = 1; // 单点包/坏 bbox:1 世界单位起眼
    return { cx, cy, halfH };
}

export function worldToScreen(st: ViewState, w: number, h: number,
                              wx: number, wy: number): [number, number] {
    const scale = h / (st.halfH * 2);
    return [(wx - st.cx) * scale + w / 2, -(wy - st.cy) * scale + h / 2];
}

export function screenToWorld(st: ViewState, w: number, h: number,
                              sx: number, sy: number): [number, number] {
    const scale = h / (st.halfH * 2);
    return [(sx - w / 2) / scale + st.cx, -(sy - h / 2) / scale + st.cy];
}

/** 光标中心缩放:缩放前后 (sx,sy) 处指向同一个 world 点。factor>1 放大。 */
export function zoomAt(st: ViewState, w: number, h: number,
                       sx: number, sy: number, factor: number): ViewState {
    const [wx, wy] = screenToWorld(st, w, h, sx, sy);
    const halfH = st.halfH / factor;
    const k = halfH / st.halfH;
    return { cx: wx - (wx - st.cx) * k, cy: wy + (st.cy - wy) * k, halfH };
}

/** 平移:dx/dy 为屏幕像素位移(拖拽手势:内容跟手,world 视点反向移动)。 */
export function panPixels(st: ViewState, h: number, dx: number, dy: number): ViewState {
    const scale = h / (st.halfH * 2);
    return { cx: st.cx - dx / scale, cy: st.cy + dy / scale, halfH: st.halfH };
}
