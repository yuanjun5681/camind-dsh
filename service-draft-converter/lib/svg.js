// 图纸包 → SVG 预览渲染器(纯函数;工作台 DwgPane 的 sanitize 白名单口径内产物)。
// Y 翻转在生成点处直接做(y' = −y);背景由画布承担,不计入实体边界。
// 原色保留在 SVG 中,工作台按需提高显示对比度;简单线型按图纸单位输出。
import { aciToRgb } from "./aci.js";

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
const hex = (n) => `#${(n & 0xFFFFFF).toString(16).padStart(6, "0")}`;

function colorOf(ent) {
    const c = ent.color ?? {};
    if (c.aci === -1 && Number.isFinite(c.rgb)) return hex(c.rgb);
    return hex(aciToRgb(c.aci ?? 7));
}

function strokeWidth(ent) {
    const lw = ent.lineweight;
    const v = lw && Number.isFinite(lw.value) ? lw.value : 25; // 默认 0.25mm
    return Math.max(0.08, v / 100).toFixed(3);
}

/** 世界弧(CCW,弧度) → SVG path 片段(Y 翻转后 CCW→CW,sweep=0)。 */
function arcPath(c, r, s, e) {
    const twoPi = 2 * Math.PI;
    const span = (((e - s) % twoPi) + twoPi) % twoPi;
    const p1 = [c[0] + r * Math.cos(s), -(c[1] + r * Math.sin(s))];
    const p2 = [c[0] + r * Math.cos(e), -(c[1] + r * Math.sin(e))];
    const large = span > Math.PI ? 1 : 0;
    return `M ${p1[0]} ${p1[1]} A ${r} ${r} 0 ${large} 0 ${p2[0]} ${p2[1]}`;
}

/** 凸度段 → SVG path 片段。b>0 = 世界 CCW(行进方向左凸),翻转后 sweep=0。 */
function bulgeSeg(x1, y1, x2, y2, b) {
    const dx = x2 - x1, dy = y2 - y1;
    const chord = Math.hypot(dx, dy);
    if (chord === 0) return `L ${x2} ${-y2}`;
    const r = chord * (1 + b * b) / (4 * Math.abs(b));
    const large = Math.abs(b) > 1 ? 1 : 0;
    const sweep = b > 0 ? 0 : 1;
    return `A ${r.toFixed(4)} ${r.toFixed(4)} 0 ${large} ${sweep} ${x2} ${-y2}`;
}

function polylineD(verts, closed) {
    if (!verts.length) return "";
    const parts = [`M ${verts[0].x} ${-verts[0].y}`];
    for (let i = 0; i + 1 < verts.length; i++) {
        const a = verts[i], b = verts[i + 1];
        parts.push(a.bulge ? bulgeSeg(a.x, a.y, b.x, b.y, a.bulge) : `L ${b.x} ${-b.y}`);
    }
    if (closed && verts.length > 2) {
        const last = verts[verts.length - 1], first = verts[0];
        if (last.bulge) parts.push(bulgeSeg(last.x, last.y, first.x, first.y, last.bulge));
        parts.push("Z");
    }
    return parts.join(" ");
}

function textEl(x, y, h, text, rot, color, anchor = null) {
    const deg = -(rot ?? 0) * 180 / Math.PI; // Y 翻转同时反转文字旋转角。
    const attrs = [`x="${x}"`, `y="${-y}"`, `font-size="${h}"`, `fill="${color}"`,
        `font-family="monospace"`];
    if (anchor) attrs.push(`text-anchor="${anchor}"`);
    if (deg) attrs.push(`transform="rotate(${deg.toFixed(3)} ${x} ${-y})"`);
    return `<text ${attrs.join(" ")}>${esc(text)}</text>`;
}

function textAnchorOf(ent) {
    // halign:0 左 1 中 2 右(组码 72);对齐文字锚点用 align_point
    const ha = ent.halign ?? 0;
    return ha === 1 ? "middle" : ha === 2 ? "end" : null;
}

// Search targets use the exact entity ids rendered below, never text/position matching.
export function drawingTargetsFromPack(pack) {
    const ids = new Set(pack.entities.map(e => e.id));
    const targets = [];
    for (const [index, dim] of (pack.dims ?? []).entries()) {
        if (!dim.entity_ids?.length || !dim.entity_ids.every(id => ids.has(id))) continue;
        targets.push({ id: `d:${index}`, kind: 'dimension', text: dim.display_text || '尺寸标注',
            entity_ids: [...dim.entity_ids], source_id: dim.id, layer: '' });
    }
    for (const e of pack.entities) {
        if (e.dim_id || !['text', 'mtext'].includes(e.type) || !e.text?.trim()) continue;
        targets.push({ id: `t:${e.id}`, kind: 'text', text: e.text, entity_ids: [e.id], source_id: e.handle, layer: e.layer });
    }
    return targets;
}

/** pack → SVG 文本。viewBox = pack.bbox + 5% 边距(Y 翻转后)。 */
export function svgFromPack(pack) {
    const [x0, y0, x1, y1] = pack.bbox;
    const w = Math.max(x1 - x0, 1e-6), h = Math.max(y1 - y0, 1e-6);
    const m = Math.max(w, h) * 0.05;
    const vb = `${x0 - m} ${-(y1 + m)} ${w + 2 * m} ${h + 2 * m}`;
    const out = [];
    for (const e of pack.entities) {
        const color = colorOf(e);
        const sw = strokeWidth(e);
        const pattern = pack.linetypes?.[e.linetype?.name]?.pattern ?? [];
        const scale = Math.abs((pack.ltscale ?? 1) * (e.linetype?.scale ?? 1));
        // DXF positive = dash, negative = gap, zero = dot; preserve alternating SVG segments.
        const dashes = [];
        for (const value of pattern) {
            const gap = value < 0;
            const length = (value === 0 ? Number(sw) : Math.abs(value)) * scale;
            if (!dashes.length && gap) dashes.push(0);
            if (dashes.length && gap === (dashes.length % 2 === 0)) dashes[dashes.length - 1] += length;
            else dashes.push(length);
        }
        if (dashes.length % 2) dashes.push(0);
        out.push(`<g id="dwg-e-${e.id}"${dashes.some(v => v > 0) ? ` stroke-dasharray="${dashes.join(' ')}"` : ''}>`);
        switch (e.type) {
            case "line":
                out.push(`<line x1="${e.a[0]}" y1="${-e.a[1]}" x2="${e.b[0]}" y2="${-e.b[1]}" stroke="${color}" stroke-width="${sw}"/>`);
                break;
            case "circle":
                out.push(`<circle cx="${e.c[0]}" cy="${-e.c[1]}" r="${e.r}" fill="none" stroke="${color}" stroke-width="${sw}"/>`);
                break;
            case "arc":
                out.push(`<path d="${arcPath(e.c, e.r, e.start, e.end)}" fill="none" stroke="${color}" stroke-width="${sw}"/>`);
                break;
            case "polyline":
                out.push(`<path d="${polylineD(e.verts, e.closed)}" fill="none" stroke="${color}" stroke-width="${sw}"/>`);
                break;
            case "point":
                out.push(`<circle cx="${e.p[0]}" cy="${-e.p[1]}" r="${(Math.max(w, h) * 0.002).toFixed(3)}" fill="${color}"/>`);
                break;
            case "solid":
                out.push(`<polygon points="${e.points.map(p => `${p[0]},${-p[1]}`).join(" ")}" fill="${color}"/>`);
                break;
            case "hatch": {
                const segs = [...(e.boundary ?? []), ...(e.generated_segs ?? [])];
                if (segs.length) {
                    const d = segs.map(s => `M ${s[0]} ${-s[1]} L ${s[2]} ${-s[3]}`).join(" ");
                    out.push(`<path d="${d}" fill="none" stroke="${color}" stroke-width="${Math.max(0.08, sw * 0.6)}"/>`);
                }
                break;
            }
            case "text": {
                const anchor = textAnchorOf(e);
                const p = anchor && e.align_point ? e.align_point : e.p;
                out.push(textEl(p[0], p[1], e.h, e.text, e.rot, color, anchor));
                break;
            }
            case "mtext":
                for (const row of e.rows ?? []) {
                    out.push(textEl(row.p[0], row.p[1], e.h, row.text, e.rot, color));
                }
                break;
            case "leader":
            case "mleader":
                out.push(`<path d="${(e.segs ?? []).map((s, i) => `${i ? "L" : "M"} ${s[0]} ${-s[1]} L ${s[2]} ${-s[3]}`).join(" ")}" fill="none" stroke="${color}" stroke-width="${sw}"/>`);
                break;
            case "tolerance": {
                const d = (e.frame_segs ?? []).map(s => `M ${s[0]} ${-s[1]} L ${s[2]} ${-s[3]}`).join(" ");
                if (d) out.push(`<path d="${d}" fill="none" stroke="${color}" stroke-width="${sw}"/>`);
                for (const c of e.cells ?? []) out.push(textEl(c.p[0], c.p[1], c.h, c.text, c.rot, color));
                break;
            }
            default:
                break; // 未知类型跳过(reader 档前向兼容口径)
        }
        out.push('</g>');
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" width="100%" height="100%" preserveAspectRatio="xMidYMid meet">`
        + `<desc>${esc(pack.source_file)} · ${pack.entities.length} 实体 · ${pack.pipeline_version}</desc>`
        + out.join("") + `</svg>`;
}
