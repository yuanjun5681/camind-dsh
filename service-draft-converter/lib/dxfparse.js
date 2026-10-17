// DXF 组码解析器(ezdxf.readfile 的等价物,只覆盖转换器用到的面)。
// 输入 DXF 全文(dwg2dxf --as r2018 产物或 .dxf 直读),输出文档模型:
//   { header, appids, layers, linetypes, styles, dimstyles, blocks, entities }
// 实体统一 DxfEntity:{ type, handle, map: Map<组码, 值数组>, pairs: 原始组码对(保序,
// HATCH 边界路径等顺序敏感结构用), children: INSERT 的 ATTRIB / POLYLINE 的 VERTEX }。
// 只管解析,不做几何展开(expand.js)与出包(convert.js)。

/** 组码 → JS 类型。 */
function coerce(code, raw) {
    if (code >= 10 && code < 60) return parseFloat(raw);
    if (code >= 60 && code < 100) return parseInt(raw, 10);
    if (code >= 140 && code < 150) return parseFloat(raw);
    if (code >= 160 && code < 180) return parseInt(raw, 10);
    if (code >= 270 && code < 300) return parseInt(raw, 10);
    if (code >= 370 && code < 390) return parseInt(raw, 10);
    if (code >= 400 && code < 410) return parseInt(raw, 10);
    if (code >= 420 && code < 430) return parseInt(raw, 10);
    if (code >= 1010 && code < 1060) return parseFloat(raw);
    if (code >= 1060 && code < 1080) return parseInt(raw, 10);
    return raw;
}

export class DxfEntity {
    constructor(type) {
        this.type = type;          // "LINE" / "INSERT" / ...
        this.handle = "";
        this.map = new Map();      // code → [v1, v2, ...](重复组码按出现序)
        this.pairs = [];           // [[code, value], ...] 原始保序(HATCH 用)
        this.children = [];        // ATTRIB(INSERT)/ VERTEX(POLYLINE)
    }
    /** 首个值;缺席返回 def。 */
    get(code, def = undefined) {
        const a = this.map.get(code);
        return a && a.length ? a[0] : def;
    }
    /** 全部重复值(LWPOLYLINE 的 10/20/42、SPLINE 的 40/10/20)。 */
    getAll(code) {
        return this.map.get(code) ?? [];
    }
    /** 点对(xcode,ycode)→ [x,y];任一缺席返回 def。 */
    pt(xcode, ycode, def = undefined) {
        const x = this.get(xcode), y = this.get(ycode);
        if (x === undefined || y === undefined) return def;
        return [x, y];
    }
}

function put(e, code, value) {
    if (code === 5) e.handle = String(value);
    let a = e.map.get(code);
    if (!a) e.map.set(code, (a = []));
    a.push(value);
    e.pairs.push([code, value]);
}

/** 组码对读取器:DXF 是「码行 + 值行」两两一组;值行只右 trim(前导空格是字符串值一部分)。
 *  支持手工回压一个已消费的 pair(pushback),供各段读取器衔接。 */
function makePairReader(text) {
    const lines = text.split(/\r\n|\r|\n/);
    let i = 0;
    const pushed = [];
    return {
        next() {
            if (pushed.length) return { value: pushed.pop(), done: false };
            while (i + 1 < lines.length) {
                const code = parseInt(lines[i].trim(), 10);
                const raw = lines[i + 1].replace(/\s+$/, "");
                i += 2;
                if (Number.isNaN(code)) continue; // 尾部残缺容错
                if (code === 999) continue;       // 注释
                return { value: [code, coerce(code, raw)], done: false };
            }
            return { value: undefined, done: true };
        },
        pushback(pair) { pushed.push(pair); },
    };
}

/** 从 reader 顺序切记录(0 码开始新实体),遇 stopTypes 的 0 值停(该 pair 已消费)。
 *  firstType:调用方已消费 0 码、把首个记录类型传进来(BLOCK 段的 BLOCK 记录)。
 *  返回 { records, stop }。 */
function collectRecords(reader, stopTypes, firstType = null) {
    const records = [];
    let cur = firstType ? new DxfEntity(firstType) : null;
    for (;;) {
        const n = reader.next();
        if (n.done) break;
        const [code, value] = n.value;
        if (code === 0) {
            if (stopTypes.includes(value)) {
                if (cur) records.push(cur);
                return { records, stop: value };
            }
            if (cur) records.push(cur);
            cur = new DxfEntity(value);
            continue;
        }
        if (!cur) continue;
        put(cur, code, value);
    }
    if (cur) records.push(cur);
    return { records, stop: null };
}

/** ATTRIB/VERTEX 归并:INSERT 后连续 ATTRIB、POLYLINE 后连续 VERTEX 挂为 children
 *  (到 SEQEND 止);归并的记录不再作为顶层实体出现。 */
function foldChildren(records) {
    const out = [];
    let host = null;
    for (const r of records) {
        if (r.type === "SEQEND") { host = null; continue; }
        if (host && ((host.type === "INSERT" && r.type === "ATTRIB")
            || (host.type === "POLYLINE" && r.type === "VERTEX"))) {
            host.children.push(r);
            continue;
        }
        host = (r.type === "INSERT" || r.type === "POLYLINE") ? r : null;
        out.push(r);
    }
    return out;
}

export function parseDxf(text) {
    const reader = makePairReader(text);
    const doc = {
        header: new Map(),
        appids: [],
        layers: new Map(),
        linetypes: new Map(),
        styles: new Map(),
        dimstyles: new Map(),
        blocks: new Map(),
        entities: [],
    };
    for (;;) {
        const n = reader.next();
        if (n.done) break;
        const [code, value] = n.value;
        if (code !== 0) continue;
        if (value === "EOF") break;
        if (value !== "SECTION") continue;
        const namePair = reader.next();
        const section = !namePair.done && namePair.value[0] === 2 ? String(namePair.value[1]) : "";
        if (section === "HEADER") {
            // $VAR 组码 9 + 跟随的值组码;0 码(ENDSEC)止
            for (;;) {
                const p = reader.next();
                if (p.done || p.value[0] === 0) break;
                if (p.value[0] === 9) {
                    const v = reader.next();
                    if (v.done) break;
                    doc.header.set(String(p.value[1]), v.value[1]);
                }
            }
        } else if (section === "TABLES") {
            readTables(reader, doc);
        } else if (section === "BLOCKS") {
            readBlocks(reader, doc);
        } else if (section === "ENTITIES") {
            const { records } = collectRecords(reader, ["ENDSEC"]);
            doc.entities = foldChildren(records);
        } else {
            // OBJECTS 等不消费的段:顺序吃到 ENDSEC
            for (;;) {
                const p = reader.next();
                if (p.done || (p.value[0] === 0 && p.value[1] === "ENDSEC")) break;
            }
        }
    }
    return doc;
}

function readTables(reader, doc) {
    for (;;) {
        const n = reader.next();
        if (n.done) return;
        const [code, value] = n.value;
        if (code !== 0) continue;
        if (value === "ENDSEC") return;
        if (value !== "TABLE") continue;
        const namePair = reader.next();
        const tname = namePair.done ? "" : String(namePair.value[1]);
        const { records } = collectRecords(reader, ["ENDTAB"]);
        for (const r of records) {
            const name = String(r.get(2, ""));
            if (r.type === "LAYER" && tname === "LAYER") {
                doc.layers.set(name, {
                    name,
                    color: r.get(62, 7) ?? 7,          // 负 = 关(ezdxf is_off: color<0)
                    trueColor: r.get(420, null),
                    linetype: String(r.get(6, "Continuous")),
                    plot: r.get(290, 1) !== 0,
                    lineweight: r.get(370, -3) ?? -3,
                    flags: r.get(70, 0) ?? 0,           // bit1 = frozen
                });
            } else if (r.type === "LTYPE" && tname === "LTYPE") {
                doc.linetypes.set(name, {
                    name,
                    pattern: r.getAll(49).map(Number),  // 正=划 负=空 0=点
                    shapes: r.getAll(74).map(Number),   // 非 0 = complex(形)
                    texts: r.getAll(75).map(Number),    // 非 0 = complex(文字)
                });
            } else if (r.type === "STYLE" && tname === "STYLE") {
                doc.styles.set(name, {
                    name,
                    font: String(r.get(3, "") ?? ""),
                    bigfont: String(r.get(4, "") ?? ""),
                    widthFactor: r.get(41, 1.0) ?? 1.0,
                    flags: r.get(70, 0) ?? 0,
                });
            } else if (r.type === "DIMSTYLE" && tname === "DIMSTYLE") {
                // DIMSTYLE 属性保留原始组码表(转换侧按 144/271/47/48 等直取)
                doc.dimstyles.set(name, { name, attrs: r.map });
            } else if (r.type === "APPID" && tname === "APPID") {
                doc.appids.push(name);
            }
        }
    }
}

function readBlocks(reader, doc) {
    for (;;) {
        const n = reader.next();
        if (n.done) return;
        const [code, value] = n.value;
        if (code !== 0) continue;
        if (value === "ENDSEC") return;
        if (value !== "BLOCK") continue;
        // BLOCK 记录属性 + 块内实体到 ENDBLK:0/BLOCK 的 0 码上面已消费,
        // 用 firstType 把 BLOCK 记录补回 records[0],其后是块内实体。
        const { records } = collectRecords(reader, ["ENDBLK"], "BLOCK");
        const blkRec = records[0];
        const blk = {
            name: blkRec ? String(blkRec.get(2, "")) : "",
            basePoint: blkRec ? [Number(blkRec.get(10, 0)), Number(blkRec.get(20, 0))] : [0, 0],
            entities: foldChildren(records.slice(1)),
        };
        doc.blocks.set(blk.name, blk);
    }
}
