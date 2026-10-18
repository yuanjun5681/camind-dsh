// Generated from ui-drawing-viewer/src; run node ui-drawing-viewer/build.mjs.
window.__ModuleLoader__.load({ id: 'camind-ui-drawing-viewer', factory: (require) => { var module = { exports: {} }; var exports = module.exports;
"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name2 in all)
    __defProp(target, name2, { get: all[name2], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// ui-drawing-viewer/src/client.ts
var client_exports = {};
__export(client_exports, {
  DrawingPreview: () => DrawingPreview,
  apply: () => apply,
  inject: () => inject,
  name: () => name
});
module.exports = __toCommonJS(client_exports);
var import_react = __toESM(require("react"), 1);

// ui-drawing-viewer/src/draft/packcheck.ts
var DRAFT_FORMAT = "camind-draft-pack";
var DRAFT_FORMAT_VERSION = 1;
var DRAFT_TOL = 15e-4;
var TYPES = /* @__PURE__ */ new Set([
  "line",
  "circle",
  "arc",
  "polyline",
  "point",
  "hatch",
  "solid",
  "text",
  "mtext",
  "leader",
  "mleader",
  "tolerance"
]);
var ROOT_KEYS = /* @__PURE__ */ new Set([
  "format",
  "format_version",
  "pipeline_version",
  "source_file",
  "source_sha256",
  "origin",
  "conversion",
  "rules_version",
  "view_rule_version",
  "units",
  "source_units",
  "unit_factor",
  "ltscale",
  "origin_offset",
  "bbox",
  "layers",
  "linetypes",
  "text_styles",
  "self_check",
  "coverage",
  "missing",
  "views",
  "layouts",
  "entities",
  "dims",
  "tech_requirements",
  "title_block"
]);
var SKELETON = /* @__PURE__ */ new Set(["views", "layouts", "entities", "dims", "tech_requirements", "title_block"]);
var isNum = (v) => typeof v === "number" && Number.isFinite(v);
var isInt = (v) => typeof v === "number" && Number.isInteger(v);
var pt = (v) => Array.isArray(v) && v.length === 2 && isNum(v[0]) && isNum(v[1]);
var seg = (v) => Array.isArray(v) && v.length === 4 && v.every(isNum);
var asObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v) ? v : {};
var asArr = (v) => Array.isArray(v) ? v : [];
var arcPt = (c, r, a) => ({ x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) });
var p2 = (v) => {
  if (!pt(v)) return null;
  const a = v;
  return { x: a[0], y: a[1] };
};
function geometryPoints(e) {
  const t = e["type"];
  const out = [];
  const c = p2(e["c"]), r = e["r"];
  if (t === "line") {
    for (const q of [p2(e["a"]), p2(e["b"])]) if (q) out.push(q);
  } else if (t === "circle" && c && isNum(r)) {
    out.push({ x: c.x - r, y: c.y - r }, { x: c.x + r, y: c.y + r });
  } else if (t === "arc" && c && isNum(r) && isNum(e["start"]) && isNum(e["end"])) {
    const s = e["start"], en = e["end"], two = 2 * Math.PI;
    out.push(arcPt(c, r, s), arcPt(c, r, en));
    for (const axis of [0, Math.PI / 2, Math.PI, 3 * Math.PI / 2])
      if (((axis - s) % two + two) % two <= ((en - s) % two + two) % two)
        out.push(arcPt(c, r, axis));
  } else if (t === "polyline") {
    const verts = asArr(e["verts"]);
    verts.forEach((v, i) => {
      const vo = asObj(v);
      if (pt([vo["x"], vo["y"]])) out.push({ x: vo["x"], y: vo["y"] });
      const b = vo["bulge"];
      const last = i === verts.length - 1;
      if (!isNum(b) || b === 0 || last && e["closed"] !== true) return;
      const nx = asObj(verts[(i + 1) % verts.length]);
      if (!pt([nx["x"], nx["y"]])) return;
      const dx = nx["x"] - vo["x"], dy = nx["y"] - vo["y"];
      const n = Math.hypot(dx, dy);
      if (n > 0) {
        const sag = Math.abs(b) * n / 2;
        out.push({
          x: (vo["x"] + nx["x"]) / 2 + dy / n * sag,
          y: (vo["y"] + nx["y"]) / 2 - dx / n * sag
        });
      }
    });
  } else if (t === "point") {
    const q = p2(e["p"]);
    if (q) out.push(q);
  } else if (t === "solid") {
    for (const x of asArr(e["points"])) {
      const q = p2(x);
      if (q) out.push(q);
    }
  } else if (t === "text" || t === "mtext") {
    const q = p2(e["p"]);
    if (q) out.push(q);
    for (const row of asArr(e["rows"])) {
      const ro = p2(asObj(row)["p"]);
      if (ro) out.push(ro);
    }
  } else if (t === "leader" || t === "mleader") {
    for (const s of asArr(e["segs"])) if (seg(s)) out.push({ x: s[0], y: s[1] }, { x: s[2], y: s[3] });
    const tObj = p2(asObj(e["text"])["p"]);
    if (tObj) out.push(tObj);
  } else if (t === "tolerance") {
    for (const s of asArr(e["frame_segs"])) if (seg(s)) out.push({ x: s[0], y: s[1] }, { x: s[2], y: s[3] });
    for (const c2 of asArr(e["cells"])) {
      const co = p2(asObj(c2)["p"]);
      if (co) out.push(co);
    }
  } else if (t === "hatch") {
    for (const s of [...asArr(e["boundary"]), ...asArr(e["generated_segs"])])
      if (seg(s)) out.push({ x: s[0], y: s[1] }, { x: s[2], y: s[3] });
  }
  return out;
}
function textFields(e) {
  const out = [];
  if (typeof e["text"] === "string") out.push(e["text"]);
  const tObj = asObj(e["text"]);
  if (typeof tObj["text"] === "string") out.push(tObj["text"]);
  for (const r of asArr(e["rows"])) {
    const ro = asObj(r);
    if (typeof ro["text"] === "string") out.push(ro["text"]);
  }
  for (const c of asArr(e["cells"])) {
    const co = asObj(c);
    if (typeof co["text"] === "string") out.push(co["text"]);
  }
  return out;
}
var stripWs = (s) => s.replace(/\s+/g, "");
function checkDraftPack(pack, profile = "writer") {
  const errors = [];
  const skipped = [];
  const add = (code) => {
    errors.push(code);
  };
  if (pack === null || typeof pack !== "object" || Array.isArray(pack)) {
    return { errors: ["DRAFT_E_FORMAT"], skipped };
  }
  const p = pack;
  if (p["format"] !== DRAFT_FORMAT) add("DRAFT_E_FORMAT");
  if (p["format_version"] !== DRAFT_FORMAT_VERSION)
    add(`DRAFT_E_VERSION:format_version=${JSON.stringify(p["format_version"])}(\u672A\u77E5\u4E3B\u7248\u672C\u62D2\u8BFB)`);
  for (const k of [
    "format_version",
    "pipeline_version",
    "source_file",
    "source_sha256",
    "origin",
    "conversion",
    "rules_version",
    "view_rule_version",
    "units",
    "source_units",
    "unit_factor",
    "ltscale",
    "origin_offset",
    "bbox",
    "layers",
    "linetypes",
    "text_styles",
    "self_check",
    "coverage",
    "missing",
    "views",
    "entities",
    "dims",
    "tech_requirements",
    "title_block"
  ])
    if (!(k in p)) add(`DRAFT_E_SCHEMA:${k}`);
  if (profile === "writer") {
    for (const k of Object.keys(p))
      if (!ROOT_KEYS.has(k) && !SKELETON.has(k)) add(`DRAFT_E_SCHEMA:unknown_key ${k}`);
  }
  if (errors.length && !("entities" in p)) return { errors, skipped };
  try {
    checkBodies(p, add, skipped, profile);
  } catch (err) {
    add(`DRAFT_E_SCHEMA:\u7ED3\u6784\u5F02\u5E38 ${err instanceof Error ? err.message : String(err)}`);
  }
  return { errors, skipped };
}
function checkBodies(p, add, skipped, profile) {
  const layers = asObj(p["layers"]);
  const ltypes = asObj(p["linetypes"]);
  const styles = asObj(p["text_styles"]);
  const views = asArr(p["views"]);
  const viewIds = new Set(views.map((v) => asObj(v)["id"]).filter(isInt).concat([0]));
  const ents = asArr(p["entities"]).map(asObj);
  for (const dRaw of asArr(p["dims"]))
    if (dRaw === null || typeof dRaw !== "object" || Array.isArray(dRaw))
      add("DRAFT_E_SHAPE:dims \u5143\u7D20\u5E94\u4E3A\u5BF9\u8C61");
  const dims = asArr(p["dims"]).map(asObj);
  const dimIds = new Set(dims.map((d) => d["id"]));
  const lower = (m) => new Set(Object.keys(m).map((k) => k.toLowerCase()));
  const hasCI = (m, name2, lowers) => typeof name2 === "string" && (name2 in m || lowers.has(name2.toLowerCase()));
  if (p["units"] !== "mm") add("DRAFT_E_UNITS:units \u6052 mm(\u6E90\u5355\u4F4D\u89C1 source_units)");
  if (typeof p["source_units"] !== "string" || !isNum(p["unit_factor"]))
    add("DRAFT_E_SCHEMA:source_units/unit_factor");
  const sc = asObj(p["self_check"]);
  const byType = asObj(asObj(sc["dropped"])["by_type"]);
  const byReason = asObj(asObj(sc["dropped"])["by_reason"]);
  const sumOf = (m) => Object.values(m).reduce((a, v) => a + (isNum(v) ? v : 0), 0);
  const sumT = sumOf(byType);
  const sumR = sumOf(byReason);
  if (sumT !== sumR) add("DRAFT_E_SELFCHECK:dropped \u4E24\u5207\u9762\u603B\u6570\u4E0D\u4E00\u81F4");
  const inputE = sc["input_entities"], drawnE = sc["drawn_entities"];
  if (!isNum(inputE) || !isNum(drawnE) || drawnE + sumT !== inputE) add("DRAFT_E_SELFCHECK");
  if (sc["reconciles"] !== true) add("DRAFT_E_SELFCHECK:reconciles \u5E94\u4E3A true");
  if (drawnE !== ents.length) add("DRAFT_E_COUNT");
  const hist = /* @__PURE__ */ new Map();
  let rgbN = 0;
  for (const e of ents) {
    const t = String(e["type"]);
    hist.set(t, (hist.get(t) ?? 0) + 1);
    const rgb = asObj(e["color"])["rgb"];
    if (isNum(rgb)) rgbN += 1;
  }
  const declared = asObj(asObj(p["coverage"])["entities_by_type"]);
  const histObj = Object.fromEntries(hist);
  const dKeys = Object.keys(declared), hKeys = Object.keys(histObj);
  const same = dKeys.length === hKeys.length && dKeys.every((k) => histObj[k] === declared[k]);
  if (!same) add("DRAFT_E_COVERAGE:entities_by_type \u4E0E\u5B9E\u9645\u76F4\u65B9\u56FE\u4E0D\u7B26");
  if (sc["truecolor_count"] !== rgbN)
    add(`DRAFT_E_COLOR:truecolor_count=${JSON.stringify(sc["truecolor_count"])} \u4E0E\u5E26 rgb \u5B9E\u4F53\u6570 ${rgbN} \u4E0D\u7B26`);
  const bbox = p["bbox"];
  const bboxOk = Array.isArray(bbox) && bbox.length === 4 && bbox.every(isNum);
  if (!bboxOk) add("DRAFT_E_SCHEMA:bbox");
  const bb = bboxOk ? bbox : null;
  const seen = /* @__PURE__ */ new Set();
  ents.forEach((e, idx) => {
    if (e["id"] !== idx) add(`DRAFT_E_ID:\u5B9E\u4F53 ${JSON.stringify(e["id"])} \u7684 id \u5E94\u4E3A\u4E0B\u6807 ${idx}`);
    if (seen.has(e["id"])) add(`DRAFT_E_ID:id ${JSON.stringify(e["id"])} \u91CD\u590D`);
    seen.add(e["id"]);
    const t = e["type"];
    if (typeof t !== "string" || !TYPES.has(t)) {
      if (profile === "writer") add(`DRAFT_E_UNKNOWN_TYPE:${String(t)}`);
      else skipped.push(String(t));
      return;
    }
    const lL = lower(layers), ltL = lower(ltypes), stL = lower(styles);
    if (!hasCI(layers, e["layer"], lL)) add(`DRAFT_E_ORPHAN_REF:layer ${JSON.stringify(e["layer"])}`);
    const lt = asObj(e["linetype"])["name"];
    if (!hasCI(ltypes, lt, ltL)) add(`DRAFT_E_ORPHAN_REF:linetype ${JSON.stringify(lt)}`);
    if (t === "text" || t === "mtext") {
      const st = e["style"];
      if (st === void 0) add("DRAFT_E_ORPHAN_REF:style \u7F3A\u5E2D");
      else if (!hasCI(styles, st, stL)) add(`DRAFT_E_ORPHAN_REF:style ${JSON.stringify(st)}`);
    }
    if (!viewIds.has(e["view_id"]) || typeof e["view_id"] === "boolean")
      add(`DRAFT_E_VIEW_REF:${JSON.stringify(e["view_id"])}`);
    if ("dim_id" in e && e["dim_id"] !== void 0 && !dimIds.has(e["dim_id"]))
      add(`DRAFT_E_DIM_REF:${JSON.stringify(e["dim_id"])}`);
    const col = asObj(e["color"]);
    const aci = col["aci"], rgb = col["rgb"];
    if (typeof aci === "boolean") add("DRAFT_E_COLOR:aci \u5E03\u5C14");
    if (aci === -1) {
      if (!isNum(rgb) || rgb < 0 || rgb > 16777215)
        add("DRAFT_E_COLOR:\u771F\u5F69 aci=-1 \u5FC5\u5E26 rgb(0xRRGGBB \u6574\u6570,\u5951\u7EA6 \xA73)");
    } else {
      if (!isNum(aci) || aci < 1 || aci > 255)
        add(`DRAFT_E_COLOR:\u975E\u771F\u5F69 aci=${JSON.stringify(aci)}(0/256 \u5DF2\u89E3\u6790\u4E0D\u51FA\u73B0,\u53D6\u503C 1~255)`);
      if (rgb !== void 0 && rgb !== null) add("DRAFT_E_COLOR:\u975E\u771F\u5F69\u5B9E\u4F53\u4E0D\u5F97\u5E26 rgb(\u4E92\u65A5)");
    }
    const shapeOk = {
      line: pt(e["a"]) && pt(e["b"]),
      circle: pt(e["c"]) && isNum(e["r"]),
      arc: pt(e["c"]) && isNum(e["r"]) && isNum(e["start"]) && isNum(e["end"]),
      polyline: asArr(e["verts"]).length > 0 && asArr(e["verts"]).every((v) => pt([asObj(v)["x"], asObj(v)["y"]])),
      point: pt(e["p"]),
      solid: [3, 4].includes(asArr(e["points"]).length) && asArr(e["points"]).every((x) => pt(x)),
      text: pt(e["p"]) && isNum(e["h"]) && typeof e["text"] === "string",
      mtext: pt(e["p"]) && isNum(e["h"]) && typeof e["text"] === "string" && asArr(e["rows"]).length > 0,
      tolerance: asArr(e["frame_segs"]).length > 0
    };
    if (shapeOk[t] === false) add(`DRAFT_E_SHAPE:${t} \u5B9E\u4F53 ${JSON.stringify(e["id"])} \u5FC5\u9700\u8F7D\u8377\u7F3A\u5931\u6216\u5F62\u72B6\u4E0D\u5BF9`);
    if (t === "mtext") {
      const at = e["attach"];
      if (!isInt(at) || at < 1 || at > 9)
        add(`DRAFT_E_SHAPE:attach ${JSON.stringify(at)} \u5E94\u4E3A 1..9`);
    }
    if (t === "text" || t === "mtext") {
      const ha = e["halign"], va = e["valign"];
      if ((isNum(ha) && ha !== 0 || isNum(va) && va !== 0) && !pt(e["align_point"]))
        add("DRAFT_E_SHAPE:halign/valign \u975E 0 \u5FC5\u5E26 align_point");
    }
    if (bb) {
      for (const q of geometryPoints(e))
        if (!(bb[0] - DRAFT_TOL <= q.x && q.x <= bb[2] + DRAFT_TOL && bb[1] - DRAFT_TOL <= q.y && q.y <= bb[3] + DRAFT_TOL)) {
          add(`DRAFT_E_BBOX:\u5B9E\u4F53 ${JSON.stringify(e["id"])} \u51FA\u754C [${q.x},${q.y}]`);
          break;
        }
    }
    if (t === "mtext") {
      const rows = asArr(e["rows"]).map(asObj);
      if (rows.length === 0) add("DRAFT_E_MTEXT_ROWS:rows \u7A7A");
      else if (rows.some((r2) => typeof r2["text"] !== "string" || r2["text"] === ""))
        add("DRAFT_E_MTEXT_ROWS:\u7A7A\u884C\u6BB5");
      else {
        const joined = rows.map((r2) => stripWs(String(r2["text"]))).join("");
        if (joined !== stripWs(String(e["text"] ?? "")))
          add("DRAFT_E_MTEXT_ROWS:rows \u62FC\u63A5\u4E0E\u9876\u5C42 text \u4E0D\u4E00\u81F4");
      }
    }
    for (const s of textFields(e))
      if (s.includes("\uFFFD")) add("DRAFT_E_REPLACEMENT");
  });
  const hasReplacement = (o) => {
    if (typeof o === "string") return o.includes("\uFFFD");
    if (Array.isArray(o)) return o.some(hasReplacement);
    if (o !== null && typeof o === "object")
      return Object.entries(o).some(([k, v]) => hasReplacement(k) || hasReplacement(v));
    return false;
  };
  if (hasReplacement(p)) add("DRAFT_E_REPLACEMENT");
  for (const d of dims) {
    const entityIds = d["entity_ids"];
    if (entityIds !== void 0 && !Array.isArray(entityIds))
      add(`DRAFT_E_SHAPE:dims.${JSON.stringify(d["id"])} entity_ids \u5E94\u4E3A\u6570\u7EC4`);
    for (const eid of asArr(entityIds)) {
      if (!isInt(eid) || eid < 0) {
        add(`DRAFT_E_SHAPE:dims.${JSON.stringify(d["id"])} entity_ids \u5E94\u4E3A\u975E\u8D1F\u6574\u6570\u4E0B\u6807`);
        continue;
      }
      const ref = eid < ents.length ? ents[eid] : null;
      if (!ref) add(`DRAFT_E_DIM_REF:dims.${JSON.stringify(d["id"])} \u5F15\u7528\u4E0D\u5B58\u5728\u7684\u5B9E\u4F53`);
      else if (ref["dim_id"] !== d["id"])
        add(`DRAFT_E_DIM_REF:dims.${JSON.stringify(d["id"])} \u5F15\u7528\u5B9E\u4F53\u672A\u56DE\u5E26 dim_id`);
    }
    const defPoints = d["def_points"];
    if (defPoints !== void 0 && !Array.isArray(defPoints))
      add(`DRAFT_E_SHAPE:dims.${JSON.stringify(d["id"])} def_points \u5E94\u4E3A\u6570\u7EC4`);
    for (const q of asArr(defPoints))
      if (!pt(q)) add(`DRAFT_E_SHAPE:dims.${JSON.stringify(d["id"])} def_points \u5E94\u4E3A [x,y] \u6709\u9650\u4E8C\u5143\u7EC4`);
    if (d["dimlfac"] !== void 0 && !isNum(d["dimlfac"]))
      add(`DRAFT_E_SHAPE:dims.${JSON.stringify(d["id"])} dimlfac \u5E94\u4E3A\u6709\u9650\u6570`);
    if (!viewIds.has(d["view_id"])) add(`DRAFT_E_VIEW_REF:dims ${JSON.stringify(d["view_id"])}`);
  }
}

// ui-drawing-viewer/src/draft/aci.ts
var ACI_COLORS = [
  0,
  16711680,
  16776960,
  65280,
  65535,
  255,
  16711935,
  16777215,
  8421504,
  12632256,
  16711680,
  16744319,
  10813440,
  10834514,
  8323072,
  8339263,
  4980736,
  4990502,
  2490368,
  2495251,
  16727808,
  16752511,
  10823936,
  10839890,
  8331008,
  8343359,
  4985600,
  4992806,
  2492672,
  2496275,
  16744192,
  16760703,
  10834432,
  10845266,
  8339200,
  8347455,
  4990464,
  4995366,
  2495232,
  2497555,
  16760576,
  16768895,
  10845184,
  10850642,
  8347392,
  8351551,
  4995328,
  4997670,
  2497536,
  2498835,
  16776960,
  16777087,
  10855680,
  10855762,
  8355584,
  8355647,
  5000192,
  5000230,
  2500096,
  2500115,
  12582656,
  14679935,
  8168704,
  9545042,
  6258432,
  7307071,
  3755008,
  4344870,
  1844736,
  2172435,
  8388352,
  12582783,
  5416192,
  8168786,
  4161280,
  6258495,
  2509824,
  3755046,
  1254912,
  1844755,
  4194048,
  10485631,
  2729216,
  6792530,
  2064128,
  5209919,
  1264640,
  3099686,
  599552,
  1517075,
  65280,
  8388479,
  42240,
  5416274,
  32512,
  4161343,
  19456,
  2509862,
  9728,
  1254931,
  65343,
  8388511,
  42281,
  5416295,
  32543,
  4161359,
  19475,
  2509871,
  9737,
  1267735,
  65407,
  8388543,
  42322,
  5416316,
  32575,
  4161375,
  19494,
  2509881,
  9747,
  1267740,
  65471,
  8388575,
  42364,
  5416337,
  32607,
  4161391,
  19513,
  2509890,
  9756,
  1267800,
  65535,
  8388607,
  42405,
  5416357,
  32639,
  4161407,
  19532,
  2509900,
  9766,
  1267800,
  49151,
  8380415,
  31909,
  5411237,
  24447,
  4157311,
  14668,
  2507390,
  7206,
  1267800,
  32767,
  8372223,
  21157,
  5405861,
  16255,
  4153215,
  9804,
  2505086,
  4902,
  1252440,
  16383,
  8364031,
  10661,
  5400485,
  8063,
  4149119,
  4940,
  2502526,
  2342,
  1251160,
  255,
  8355839,
  165,
  5395109,
  127,
  4145023,
  76,
  2500222,
  38,
  1250136,
  4129023,
  10452991,
  2687141,
  6771365,
  2031743,
  5193599,
  1245260,
  3090046,
  589862,
  1512280,
  8323327,
  12550143,
  5374117,
  8147621,
  4128895,
  6242175,
  2490444,
  3745406,
  1245222,
  1839960,
  12517631,
  14647295,
  8126629,
  9523877,
  6226047,
  7290751,
  3735628,
  4335180,
  1835046,
  5772120,
  16711935,
  16744447,
  10813605,
  10834597,
  8323199,
  8339327,
  4980812,
  4990540,
  2490406,
  5772120,
  16711871,
  16744415,
  10813564,
  10834577,
  8323167,
  8339311,
  4980793,
  4990530,
  2490396,
  5772120,
  16711807,
  16744383,
  10813522,
  10834556,
  8323135,
  8339295,
  4980774,
  4990521,
  2490387,
  5772060,
  16711743,
  16744351,
  10813481,
  10834535,
  8323103,
  8339279,
  4980755,
  4990511,
  2490377,
  5772055,
  0,
  6645093,
  6710886,
  10066329,
  13421772,
  16777215
];
function aciToRgb(aci) {
  const v = ACI_COLORS[aci] ?? 16777215;
  return [(v >> 16 & 255) / 255, (v >> 8 & 255) / 255, (v & 255) / 255];
}
function intToRgb(v) {
  return [(v >> 16 & 255) / 255, (v >> 8 & 255) / 255, (v & 255) / 255];
}

// ui-drawing-viewer/src/draft/draft_loader.ts
var ARC_SEG = 48;
var p22 = (v) => {
  if (!Array.isArray(v) || v.length !== 2) return null;
  const x = v[0], y = v[1];
  return typeof x === "number" && Number.isFinite(x) && typeof y === "number" && Number.isFinite(y) ? { x, y } : null;
};
var pt2 = (v) => {
  const arr2 = v;
  return { x: arr2[0], y: arr2[1] };
};
var arr = (v) => Array.isArray(v) ? v : [];
var xy = (v) => Array.isArray(v) && v.length === 2 ? v : [0, 0];
function arcPoints(cx, cy, r, start, end) {
  const two = 2 * Math.PI;
  let span = ((end - start) % two + two) % two;
  if (span === 0) span = two;
  const n = Math.max(2, Math.ceil(ARC_SEG * (span / two)));
  const pts = [];
  for (let i = 0; i <= n; ++i) {
    const a = start + span * i / n;
    pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
  }
  return pts;
}
function bulgeArc(x0, y0, x1, y1, bulge) {
  const theta = 4 * Math.atan(bulge);
  const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
  const d = Math.hypot(x1 - x0, y1 - y0) / 2;
  if (d < 1e-9)
    return [{ x: x0, y: y0 }, { x: x1, y: y1 }];
  const r = d / Math.sin(Math.abs(theta) / 2);
  const h2 = r * Math.cos(Math.abs(theta) / 2) * (bulge > 0 ? 1 : -1);
  const nx = -(y1 - y0) / (2 * d), ny = (x1 - x0) / (2 * d);
  const cx = mx + nx * h2, cy = my + ny * h2;
  const a0 = Math.atan2(y0 - cy, x0 - cx);
  let a1 = Math.atan2(y1 - cy, x1 - cx);
  if (bulge > 0) {
    while (a1 <= a0) a1 += 2 * Math.PI;
  } else {
    while (a1 >= a0) a1 -= 2 * Math.PI;
  }
  const steps = Math.max(2, Math.ceil(ARC_SEG * Math.abs(a1 - a0) / (2 * Math.PI)));
  const pts = [{ x: x0, y: y0 }];
  for (let i = 1; i < steps; ++i) {
    const a = a0 + (a1 - a0) * i / steps;
    pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
  }
  pts.push({ x: x1, y: y1 });
  return pts;
}
function entityChains(e) {
  const t = e["type"];
  const out = [];
  if (t === "line") {
    out.push([pt2(e["a"]), pt2(e["b"])]);
  } else if (t === "circle") {
    const c = pt2(e["c"]);
    out.push(arcPoints(c.x, c.y, Number(e["r"]), 0, 2 * Math.PI));
  } else if (t === "arc") {
    const c = pt2(e["c"]), r = Number(e["r"]);
    out.push(arcPoints(c.x, c.y, r, Number(e["start"] ?? 0), Number(e["end"] ?? 2 * Math.PI)));
  } else if (t === "polyline") {
    const verts = arr(e["verts"]);
    const n = verts.length;
    const loops = n - (e["closed"] ? 0 : 1);
    const chain = [];
    for (let i = 0; i < loops; ++i) {
      const a = verts[i], b = verts[(i + 1) % n];
      const ax = Number(a["x"]), ay = Number(a["y"]);
      const bx = Number(b["x"]), by = Number(b["y"]);
      const bulge = Number(a["bulge"] ?? 0);
      const seg2 = bulge ? bulgeArc(ax, ay, bx, by, bulge) : [{ x: ax, y: ay }, { x: bx, y: by }];
      for (let k = chain.length > 0 ? 1 : 0; k < seg2.length; ++k) chain.push(seg2[k]);
    }
    if (chain.length >= 2) out.push(chain);
  } else if (t === "solid") {
    const pts = arr(e["points"]).map(p22).filter((q) => q !== null);
    if (pts.length > 2) pts.push(pts[0]);
    if (pts.length >= 2) out.push(pts);
  } else if (t === "hatch") {
    for (const s of [...arr(e["boundary"]), ...arr(e["generated_segs"])])
      out.push([{ x: s[0], y: s[1] }, { x: s[2], y: s[3] }]);
  } else if (t === "leader" || t === "mleader") {
    for (const s of arr(e["segs"]))
      out.push([{ x: s[0], y: s[1] }, { x: s[2], y: s[3] }]);
  } else if (t === "tolerance") {
    for (const s of arr(e["frame_segs"]))
      out.push([{ x: s[0], y: s[1] }, { x: s[2], y: s[3] }]);
  }
  return out;
}
function entityTexts(e, rgb, layer, entId) {
  const t = e["type"];
  const h2 = Number(e["h"] ?? 2.5);
  const rot = Number(e["rot"] ?? 0);
  const style = String(e["style"] ?? "Standard");
  if (t === "text") {
    const [ax, ay] = xy(e["p"]);
    const halign = Number(e["halign"] ?? 0), valign = Number(e["valign"] ?? 0);
    const [apx, apy] = xy(e["align_point"]);
    const anchored = (halign !== 0 || valign !== 0) && e["align_point"] !== void 0;
    const [px2, py2] = anchored ? [apx, apy] : [ax, ay];
    return [{
      x: px2,
      y: py2,
      h: h2,
      text: String(e["text"] ?? ""),
      rot,
      layer,
      style,
      entId,
      r: rgb[0],
      g: rgb[1],
      b: rgb[2],
      halign,
      valign
    }];
  }
  if (t === "mtext") {
    const rows = arr(e["rows"]);
    return rows.map((r) => {
      const [rx, ry] = xy(r["p"]);
      return {
        x: Number(rx),
        y: Number(ry),
        h: h2,
        text: String(r["text"] ?? ""),
        rot,
        layer,
        style,
        entId,
        r: rgb[0],
        g: rgb[1],
        b: rgb[2]
      };
    });
  }
  if (t === "leader" || t === "mleader") {
    const tObj = e["text"];
    if (tObj !== null && typeof tObj === "object") {
      const to = tObj;
      const [tx, ty] = xy(to["p"]);
      return [{
        x: Number(tx),
        y: Number(ty),
        h: Number(to["h"] ?? 2.5),
        text: String(to["text"] ?? ""),
        rot: Number(to["rot"] ?? 0),
        layer,
        style,
        entId,
        r: rgb[0],
        g: rgb[1],
        b: rgb[2]
      }];
    }
  }
  if (t === "tolerance") {
    return arr(e["cells"]).map((c2) => {
      const [cx, cy] = xy(c2["p"]);
      return {
        x: Number(cx),
        y: Number(cy),
        h: Number(c2["h"] ?? 2.5),
        text: String(c2["text"] ?? ""),
        rot: Number(c2["rot"] ?? 0),
        layer,
        style,
        entId,
        r: rgb[0],
        g: rgb[1],
        b: rgb[2]
      };
    });
  }
  return [];
}
function resolveColor(e) {
  const c = e["color"];
  if (c && typeof c === "object" && typeof c["rgb"] === "number") return intToRgb(c["rgb"]);
  return aciToRgb(c && typeof c === "object" ? Number(c["aci"]) : 7);
}
function patternToLut(pattern) {
  const POINT_W = 0.02;
  const weights = pattern.map((p) => p === 0 ? POINT_W : Math.abs(p));
  const total = weights.reduce((a, b) => a + b, 0);
  const lut = new Uint8Array(256).fill(0);
  if (total <= 0) return lut.fill(255);
  let acc = 0;
  for (let i = 0; i < pattern.length; ++i) {
    const w = weights[i] / total;
    const on = pattern[i] >= 0;
    const lo = acc, hi = acc + w;
    const c0 = Math.max(0, Math.ceil(lo * 256 - 0.5));
    const c1 = Math.min(255, Math.floor(hi * 256 - 0.5));
    if (on) for (let c = c0; c <= c1; ++c) lut[c] = 255;
    acc = hi;
  }
  return lut;
}
function loadDraft(pack) {
  const vr = checkDraftPack(pack, "reader");
  if (vr.errors.length > 0)
    throw new Error(`\u56FE\u7EB8\u5305\u6821\u9A8C\u672A\u8FC7:${vr.errors.join(";")}`);
  const p = pack;
  const entities = p["entities"] ?? [];
  const ltscale = Number(p["ltscale"] ?? 1);
  const layersRaw = p["layers"] ?? {};
  const layers = /* @__PURE__ */ new Map();
  const normLayer = /* @__PURE__ */ new Map();
  for (const [name2, l] of Object.entries(layersRaw)) {
    layers.set(name2, { off: Boolean(l["off"]), frozen: Boolean(l["frozen"]) });
    normLayer.set(name2.toLowerCase(), name2);
  }
  const layerOf = (raw) => normLayer.get(raw.toLowerCase()) ?? raw;
  const textStyles = /* @__PURE__ */ new Map();
  for (const [name2, ts] of Object.entries(p["text_styles"] ?? {}))
    textStyles.set(name2.toLowerCase(), { widthFactor: Number(ts["width_factor"] ?? 1) });
  const dashLut = [new Uint8Array(256).fill(255)];
  const lutKey = /* @__PURE__ */ new Map();
  const dashRowOf = (pattern) => {
    const key = pattern.join(",");
    let row = lutKey.get(key);
    if (row === void 0) {
      row = dashLut.length;
      dashLut.push(patternToLut(pattern));
      lutKey.set(key, row);
    }
    return row;
  };
  const segments = [];
  const texts = [];
  const points = [];
  const segsByLayer = /* @__PURE__ */ new Map();
  for (let idx = 0; idx < entities.length; ++idx) {
    const e = entities[idx];
    const layer = layerOf(String(e["layer"] ?? "0"));
    const type = e["type"];
    const rgb = resolveColor(e);
    let dashPeriod = 0, dashRow = 0;
    if (type !== "point") {
      const lt = e["linetype"];
      const ltName = String(lt?.["name"] ?? "Continuous");
      const scale = Number(lt?.["scale"] ?? 1);
      const def = p["linetypes"] ?? {};
      const ltDef = Object.keys(def).find((k) => k.toLowerCase() === ltName.toLowerCase());
      if (ltDef) {
        let pattern = def[ltDef]["pattern"] ?? [];
        if (String(def[ltDef]["kind"] ?? "simple") === "complex") {
          const fb = def[ltDef]["simple_fallback"];
          if (Array.isArray(fb) && fb.length > 0) pattern = fb;
          else pattern = [];
        }
        let total = 0;
        for (const q of pattern) total += Math.abs(q);
        if (pattern.length > 0 && total > 0) {
          dashPeriod = total * ltscale * scale;
          dashRow = dashRowOf(pattern);
        }
      }
    }
    if (type === "point") {
      const q = pt2(e["p"]);
      points.push({ x: q.x, y: q.y, layer, entId: idx, r: rgb[0], g: rgb[1], b: rgb[2] });
      continue;
    }
    const pickable = type !== "hatch";
    for (const chain of entityChains(e)) {
      let dist = 0;
      for (let k = 0; k + 1 < chain.length; ++k) {
        const a = chain[k], b = chain[k + 1];
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        if (len <= 0) continue;
        segments.push({
          x1: a.x,
          y1: a.y,
          x2: b.x,
          y2: b.y,
          layer,
          entId: idx,
          pickable,
          r: rgb[0],
          g: rgb[1],
          b: rgb[2],
          dashPeriod,
          dashRow,
          dist0: dist
        });
        dist += len;
        segsByLayer.set(layer, (segsByLayer.get(layer) ?? 0) + 1);
      }
    }
    for (const ti of entityTexts(e, rgb, layer, idx)) texts.push(ti);
  }
  const dims = [];
  const dimIdByEnt = /* @__PURE__ */ new Map();
  for (const dm of arr(p["dims"])) {
    const tol = dm["tolerance"] ?? {};
    dims.push({
      id: String(dm["id"] ?? ""),
      displayText: String(dm["display_text"] ?? ""),
      measured: isFiniteNum(dm["measured"]) ? Number(dm["measured"]) : void 0,
      tolerance: {
        upper: isFiniteNum(tol["upper"]) ? Number(tol["upper"]) : void 0,
        lower: isFiniteNum(tol["lower"]) ? Number(tol["lower"]) : void 0,
        fit: typeof tol["fit"] === "string" ? tol["fit"] : void 0
      },
      type: Number(dm["type"] ?? 0),
      viewId: Number(dm["view_id"] ?? 0),
      defPoints: arr(dm["def_points"]).map(xy),
      entityIds: arr(dm["entity_ids"]).map(Number),
      dimlfac: isFiniteNum(dm["dimlfac"]) ? Number(dm["dimlfac"]) : 1,
      // 缺席=1(契约 §4);0/负保留(packcheck 已拒非有限)
      inferred: Boolean(dm["inferred"]),
      ruleVersion: typeof dm["rule_version"] === "string" ? dm["rule_version"] : void 0
    });
  }
  for (let idx = 0; idx < entities.length; ++idx) {
    const dimId = entities[idx]["dim_id"];
    if (typeof dimId === "string" && dimId) dimIdByEnt.set(idx, dimId);
  }
  const originRaw = p["origin"] ?? {};
  const channel = originRaw["channel"];
  const conversionRaw = p["conversion"] ?? {};
  const bboxRaw = p["bbox"] ?? [0, 0, 1, 1];
  return {
    partRef: String(p["part_ref"] ?? ""),
    segments,
    texts,
    points,
    layers,
    textStyles,
    dashLut,
    bbox: [Number(bboxRaw[0]), Number(bboxRaw[1]), Number(bboxRaw[2]), Number(bboxRaw[3])],
    entityCount: entities.length,
    segsByLayer,
    dims,
    dimIdByEnt,
    origin: {
      channel: channel === "nx" || channel === "autocad" ? channel : "unknown",
      evidence: arr(originRaw["evidence"]).map(String),
      method: originRaw["method"] === "manual" ? "manual" : "auto",
      ruleVersion: String(originRaw["rule_version"] ?? "")
    },
    conversion: {
      tool: String(conversionRaw["tool"] ?? ""),
      commit: String(conversionRaw["commit"] ?? ""),
      libredwg: String(conversionRaw["libredwg"] ?? ""),
      ezdxf: String(conversionRaw["ezdxf"] ?? "")
    },
    sourceFile: String(p["source_file"] ?? ""),
    sourceSha256: String(p["source_sha256"] ?? ""),
    skippedTypes: [...vr.skipped]
  };
}
var isFiniteNum = (v) => typeof v === "number" && Number.isFinite(v);

// ui-drawing-viewer/src/draft/draft_camera.ts
function fitView(bbox, w, h2, pad = 1.05) {
  const cx = (bbox[0] + bbox[2]) / 2;
  const cy = (bbox[1] + bbox[3]) / 2;
  let halfH = Math.max((bbox[3] - bbox[1]) / 2, (bbox[2] - bbox[0]) / 2 * (h2 / w)) * pad;
  if (!Number.isFinite(halfH) || halfH <= 0) halfH = 1;
  return { cx, cy, halfH };
}
function worldToScreen(st, w, h2, wx, wy) {
  const scale = h2 / (st.halfH * 2);
  return [(wx - st.cx) * scale + w / 2, -(wy - st.cy) * scale + h2 / 2];
}
function screenToWorld(st, w, h2, sx, sy) {
  const scale = h2 / (st.halfH * 2);
  return [(sx - w / 2) / scale + st.cx, -(sy - h2 / 2) / scale + st.cy];
}
function zoomAt(st, w, h2, sx, sy, factor) {
  const [wx, wy] = screenToWorld(st, w, h2, sx, sy);
  const halfH = st.halfH / factor;
  const k = halfH / st.halfH;
  return { cx: wx - (wx - st.cx) * k, cy: wy + (st.cy - wy) * k, halfH };
}
function panPixels(st, h2, dx, dy) {
  const scale = h2 / (st.halfH * 2);
  return { cx: st.cx - dx / scale, cy: st.cy + dy / scale, halfH: st.halfH };
}

// ui-drawing-viewer/src/draft/draft_pick.ts
function buildSegGrid(segments, grid = 64) {
  const n = segments.length;
  const bboxes = new Float32Array(n * 4);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < n; ++i) {
    const s = segments[i];
    const x0 = Math.min(s.x1, s.x2), y0 = Math.min(s.y1, s.y2);
    const x1 = Math.max(s.x1, s.x2), y1 = Math.max(s.y1, s.y2);
    bboxes[i * 4] = x0;
    bboxes[i * 4 + 1] = y0;
    bboxes[i * 4 + 2] = x1;
    bboxes[i * 4 + 3] = y1;
    if (x0 < minX) minX = x0;
    if (y0 < minY) minY = y0;
    if (x1 > maxX) maxX = x1;
    if (y1 > maxY) maxY = y1;
  }
  if (!Number.isFinite(minX)) {
    minX = minY = maxX = maxY = 0;
  }
  const bw = Math.max(maxX - minX, 1e-9), bh = Math.max(maxY - minY, 1e-9);
  const cellW = bw / grid, cellH = bh / grid;
  const cellOf = (wx, wy) => {
    const cx = Math.min(grid - 1, Math.max(0, Math.floor((wx - minX) / cellW)));
    const cy = Math.min(grid - 1, Math.max(0, Math.floor((wy - minY) / cellH)));
    return cy * grid + cx;
  };
  const counts = new Uint32Array(grid * grid);
  const cells = [];
  const cellsOf = (i) => {
    cells.length = 0;
    const xa = segments[i].x1, ya = segments[i].y1;
    const xb = segments[i].x2, yb = segments[i].y2;
    const steps = Math.max(1, Math.ceil(2 * Math.max(
      Math.abs(xb - xa) / cellW,
      Math.abs(yb - ya) / cellH
    )));
    let last = -1, prevGx = -1, prevGy = -1;
    for (let k = 0; k <= steps; ++k) {
      const t = k / steps;
      const c = cellOf(xa + (xb - xa) * t, ya + (yb - ya) * t);
      if (c === last) continue;
      const gx = c % grid, gy = c / grid | 0;
      if (last >= 0 && gx !== prevGx && gy !== prevGy) {
        cells.push(prevGy * grid + gx);
        cells.push(gy * grid + prevGx);
      }
      cells.push(c);
      last = c;
      prevGx = gx;
      prevGy = gy;
    }
  };
  for (let i = 0; i < n; ++i) {
    cellsOf(i);
    for (const c of cells) ++counts[c];
  }
  const starts = new Uint32Array(grid * grid + 1);
  for (let c = 0; c < grid * grid; ++c) starts[c + 1] = starts[c] + counts[c];
  const items = new Uint32Array(starts[grid * grid]);
  const fill = starts.slice(0, grid * grid);
  for (let i = 0; i < n; ++i) {
    cellsOf(i);
    for (const c of cells) items[fill[c]++] = i;
  }
  return {
    bboxes,
    starts,
    items,
    grid,
    minX,
    minY,
    maxX,
    maxY,
    pick(wx, wy, tol, visible) {
      const gx0 = Math.max(0, Math.floor((wx - tol - minX) / cellW));
      const gx1 = Math.min(grid - 1, Math.floor((wx + tol - minX) / cellW));
      const gy0 = Math.max(0, Math.floor((wy - tol - minY) / cellH));
      const gy1 = Math.min(grid - 1, Math.floor((wy + tol - minY) / cellH));
      let best = -1, bestD = tol * tol;
      for (let gy = gy0; gy <= gy1; ++gy)
        for (let gx = gx0; gx <= gx1; ++gx) {
          const c = gy * grid + gx;
          for (let k = starts[c]; k < starts[c + 1]; ++k) {
            const i = items[k];
            if (visible && !visible(i)) continue;
            const s = segments[i];
            const abx = s.x2 - s.x1, aby = s.y2 - s.y1;
            const t = Math.max(0, Math.min(
              1,
              ((wx - s.x1) * abx + (wy - s.y1) * aby) / (abx * abx + aby * aby || 1)
            ));
            const dx = s.x1 + abx * t - wx, dy = s.y1 + aby * t - wy;
            const d = dx * dx + dy * dy;
            if (d < bestD) {
              bestD = d;
              best = i;
            }
          }
        }
      return best;
    }
  };
}

// ui-drawing-viewer/src/draft/draft_view.ts
var VS = `#version 300 es
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
var FS = `#version 300 es
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
var FLOATS_PER_VERT = 8;
var DEFAULT_BG = [0.118, 0.125, 0.137];
function colorLuminance(rgb) {
  return rgb.map((v) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
}
function readableColor(rgb, background) {
  const contrast = (candidate) => {
    const light = Math.max(colorLuminance(candidate.map((v) => v * 255)), colorLuminance(background));
    const dark = Math.min(colorLuminance(candidate.map((v) => v * 255)), colorLuminance(background));
    return (light + 0.05) / (dark + 0.05);
  };
  let best = [rgb[0], rgb[1], rgb[2]];
  let bestContrast = contrast(best);
  if (bestContrast >= 4.5) return best;
  for (let step = 1; step <= 20; step++) {
    const brighter = best.map((v) => v + (1 - v) * step / 20);
    const darker = best.map((v) => v * (1 - step / 20));
    const brighterContrast = contrast(brighter);
    const darkerContrast = contrast(darker);
    if (brighterContrast > bestContrast || darkerContrast > bestContrast) {
      best = brighterContrast >= darkerContrast ? brighter : darker;
      bestContrast = Math.max(brighterContrast, darkerContrast);
    }
    if (bestContrast >= 4.5) return best;
  }
  return best;
}
function textAlignOf(halign) {
  return halign === 1 || halign === 4 ? "center" : halign === 2 ? "right" : "left";
}
function textBaselineOf(valign, halign = 0) {
  if (halign === 4) return "middle";
  return valign === 1 ? "bottom" : valign === 2 ? "middle" : valign === 3 ? "top" : "alphabetic";
}
var DraftView = class {
  gl;
  c2d;
  draft;
  opts;
  prog;
  vbo;
  patTex;
  uView;
  uAspect;
  uPix;
  insets = { top: 0, right: 0, bottom: 0, left: 0 };
  segVertCount;
  pointVertBase;
  verts;
  pointScratch;
  grid;
  /** 抽稀收集缓冲(每段 2 顶点 × 8 floats;容量 = max(上限段数, 当前选中段数),大包不再整帧全量开) */
  scratch;
  /** 图层可见态(初始 = layers 表 off/frozen 取反;不在表内的层名兜底可见) */
  layerVis = /* @__PURE__ */ new Map();
  segHidden;
  pointHidden;
  st;
  minHalfH;
  colorMode = "readable";
  colorCache = /* @__PURE__ */ new Map();
  /** 宿主选择状态；只在帧内收集阶段改颜色，不改原始几何或图层数据。 */
  selectedEnts = /* @__PURE__ */ new Set();
  /** 末帧实际绘制的文字(屏幕坐标;与绘制同一过滤口径 —— 拾取候选集以此为准) */
  drawnTexts = [];
  stats = {
    lastDrawn: 0,
    lastStep: 1,
    lastCullMs: 0,
    geomMs: 0,
    textMs: 0,
    textsDrawn: 0,
    textsOverflow: 0,
    glError: 0
  };
  constructor(gl, c2d, draft, opts = {}) {
    this.gl = gl;
    this.c2d = c2d;
    this.draft = draft;
    this.opts = {
      targetSegs: opts.targetSegs ?? 6e3,
      maxTexts: opts.maxTexts ?? 240,
      background: opts.background ?? DEFAULT_BG,
      checkErrors: opts.checkErrors ?? false
    };
    for (const [name2, l] of draft.layers)
      this.layerVis.set(name2, !(l.off || l.frozen));
    const nSeg = draft.segments.length, nPt = draft.points.length;
    const verts = new Float32Array((nSeg * 2 + nPt) * FLOATS_PER_VERT);
    let v = 0;
    for (const s of draft.segments) {
      const len = Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
      verts[v++] = s.x1;
      verts[v++] = s.y1;
      verts[v++] = s.r;
      verts[v++] = s.g;
      verts[v++] = s.b;
      verts[v++] = s.dist0;
      verts[v++] = s.dashPeriod;
      verts[v++] = s.dashRow;
      verts[v++] = s.x2;
      verts[v++] = s.y2;
      verts[v++] = s.r;
      verts[v++] = s.g;
      verts[v++] = s.b;
      verts[v++] = s.dist0 + len;
      verts[v++] = s.dashPeriod;
      verts[v++] = s.dashRow;
    }
    this.segVertCount = nSeg * 2;
    this.pointVertBase = this.segVertCount;
    for (const p of draft.points) {
      verts[v++] = p.x;
      verts[v++] = p.y;
      verts[v++] = p.r;
      verts[v++] = p.g;
      verts[v++] = p.b;
      verts[v++] = 0;
      verts[v++] = 0;
      verts[v++] = 0;
    }
    this.verts = verts;
    this.pointScratch = new Float32Array(nPt * FLOATS_PER_VERT);
    draft.texts.sort((a, b) => b.h - a.h);
    this.grid = buildSegGrid(draft.segments);
    this.segHidden = new Uint8Array(nSeg);
    this.pointHidden = new Uint8Array(nPt);
    this.rebuildHidden();
    this.prog = this.buildProgram();
    gl.useProgram(this.prog);
    this.patTex = this.buildPatternTexture();
    this.vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
    const strideB = FLOATS_PER_VERT * 4;
    const attr = (name2, size, offset) => {
      const loc = gl.getAttribLocation(this.prog, name2);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, strideB, offset);
    };
    attr("aPos", 2, 0);
    attr("aColor", 3, 8);
    attr("aDist", 1, 20);
    attr("aPeriod", 1, 24);
    attr("aRow", 1, 28);
    this.uView = gl.getUniformLocation(this.prog, "uView");
    this.uAspect = gl.getUniformLocation(this.prog, "uAspect");
    this.uPix = gl.getUniformLocation(this.prog, "uPix");
    this.scratch = new Float32Array((this.opts.targetSegs + 2) * FLOATS_PER_VERT * 2);
    this.st = fitView(draft.bbox, this.W, this.H);
    this.minHalfH = this.st.halfH * 1e-4;
  }
  get W() {
    return this.gl.canvas.width;
  }
  get H() {
    return this.gl.canvas.height;
  }
  get viewport() {
    return {
      x: this.insets.left,
      y: this.insets.top,
      width: Math.max(0, this.W - this.insets.left - this.insets.right),
      height: Math.max(0, this.H - this.insets.top - this.insets.bottom)
    };
  }
  get viewportInsets() {
    return { ...this.insets };
  }
  setViewportInsets(insets) {
    if (![insets.top, insets.right, insets.bottom, insets.left].every((v) => Number.isFinite(v) && v >= 0))
      throw new Error("viewport insets \u987B\u4E3A\u975E\u8D1F\u6709\u9650\u6570");
    this.insets = { ...insets };
  }
  buildProgram() {
    const gl = this.gl;
    const compile = (type, code) => {
      const sh = gl.createShader(type);
      gl.shaderSource(sh, code);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS))
        throw new Error("\u7740\u8272\u5668\u7F16\u8BD1\u5931\u8D25: " + gl.getShaderInfoLog(sh));
      return sh;
    };
    const prog = gl.createProgram();
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS))
      throw new Error("\u7740\u8272\u7A0B\u5E8F\u94FE\u63A5\u5931\u8D25: " + gl.getProgramInfoLog(prog));
    return prog;
  }
  /** pattern LUT → R8 纹理(256 列 × 行数,NEAREST/CLAMP;行 0 = 实线恒 on)。 */
  buildPatternTexture() {
    const gl = this.gl;
    const lut = this.draft.dashLut;
    if (!lut || lut.length === 0) return null;
    const tex = gl.createTexture();
    if (!tex) return null;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.R8,
      256,
      lut.length,
      0,
      gl.RED,
      gl.UNSIGNED_BYTE,
      concatLut(lut)
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const uPat = gl.getUniformLocation(this.prog, "uPat");
    const uRows = gl.getUniformLocation(this.prog, "uRows");
    if (uPat) {
      gl.uniform1i(uPat, 0);
      gl.activeTexture(gl.TEXTURE0);
    }
    if (uRows) gl.uniform1f(uRows, lut.length);
    return tex;
  }
  // ── 相机(纯函数在 draft_camera;宿主交互事件调这三个)──
  get view() {
    return this.st;
  }
  setView(st) {
    this.st = st;
  }
  fit() {
    const vp = this.viewport;
    this.st = fitView(this.draft.bbox, Math.max(1, vp.width), Math.max(1, vp.height));
  }
  zoomAt(sx, sy, factor) {
    const maxFactor = this.st.halfH / this.minHalfH;
    const vp = this.viewport;
    this.st = zoomAt(
      this.st,
      Math.max(1, vp.width),
      Math.max(1, vp.height),
      sx - vp.x,
      sy - vp.y,
      factor > 1 ? Math.min(factor, maxFactor) : factor
    );
  }
  panPixels(dx, dy) {
    this.st = panPixels(this.st, Math.max(1, this.viewport.height), dx, dy);
  }
  worldToScreen(wx, wy) {
    const vp = this.viewport;
    const [sx, sy] = worldToScreen(this.st, Math.max(1, vp.width), Math.max(1, vp.height), wx, wy);
    return [sx + vp.x, sy + vp.y];
  }
  screenToWorld(sx, sy) {
    const vp = this.viewport;
    return screenToWorld(this.st, Math.max(1, vp.width), Math.max(1, vp.height), sx - vp.x, sy - vp.y);
  }
  setCamera(st) {
    if (![st.cx, st.cy, st.halfH].every(Number.isFinite) || st.halfH <= 0)
      throw new Error("\u76F8\u673A\u72B6\u6001\u987B\u4E3A\u6709\u9650 cx/cy \u4E14 halfH>0");
    this.st = { ...st, halfH: Math.max(st.halfH, this.minHalfH) };
  }
  zoomToWorldRect(bbox) {
    const vp = this.viewport;
    const next = fitView(bbox, Math.max(1, vp.width), Math.max(1, vp.height), 1.1);
    this.st = { ...next, halfH: Math.max(next.halfH, this.minHalfH) };
  }
  zoomToRect(rect) {
    if (![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) || rect.width <= 0 || rect.height <= 0)
      throw new Error("zoomToRect \u987B\u4E3A\u6709\u9650\u5750\u6807\u4E14 width/height>0");
    const [x0, y0] = this.screenToWorld(rect.x, rect.y + rect.height);
    const [x1, y1] = this.screenToWorld(rect.x + rect.width, rect.y);
    this.zoomToWorldRect([Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1)]);
  }
  setColorMode(mode) {
    if (mode !== "readable" && mode !== "original") throw new Error(`\u672A\u77E5\u914D\u8272\u6A21\u5F0F:${JSON.stringify(mode)}`);
    this.colorMode = mode;
    this.colorCache.clear();
    this.render();
  }
  colorFor(r, g, b) {
    if (this.colorMode === "original") return [r, g, b];
    const key = `${r},${g},${b}`;
    const cached = this.colorCache.get(key);
    if (cached) return cached;
    const background = this.opts.background.map((v) => v * 255);
    const result = readableColor([r, g, b], background);
    this.colorCache.set(key, result);
    return result;
  }
  // ── 选择（公共核心入口；Pane 只负责 dim/entity 目标解析）──
  setSelectedEntities(ids) {
    const next = /* @__PURE__ */ new Set();
    for (const id of ids) {
      if (!Number.isInteger(id) || id < 0 || id >= this.draft.entityCount)
        throw new Error(`\u672A\u77E5\u5B9E\u4F53:${JSON.stringify(id)}`);
      next.add(id);
    }
    this.selectedEnts.clear();
    for (const id of next) this.selectedEnts.add(id);
  }
  selectedEntities() {
    return [...this.selectedEnts].sort((a, b) => a - b);
  }
  entityBounds(ids) {
    const wanted = new Set(ids);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const add = (x, y) => {
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    };
    const addText = (t) => {
      const wf = this.draft.textStyles.get(t.style.toLowerCase())?.widthFactor ?? 1;
      const fontH = Math.max(1, t.h);
      this.c2d.font = `${fontH}px sans-serif`;
      const measured = typeof this.c2d.measureText === "function" ? this.c2d.measureText(t.text).width : Number.NaN;
      const width = (Number.isFinite(measured) ? measured * t.h / fontH : t.text.length * t.h * 0.6) * wf;
      const align = textAlignOf(t.halign ?? 0);
      const left = align === "center" ? -width / 2 : align === "right" ? -width : 0;
      const baseline = textBaselineOf(t.valign ?? 0, t.halign ?? 0);
      let bottom = -0.2 * t.h, top = 0.8 * t.h;
      if (baseline === "top") {
        bottom = -t.h;
        top = 0;
      } else if (baseline === "bottom") {
        bottom = 0;
        top = t.h;
      } else if (baseline === "middle") {
        bottom = -t.h / 2;
        top = t.h / 2;
      }
      const cos = Math.cos(t.rot), sin = Math.sin(t.rot);
      for (const [dx, dy] of [
        [left, bottom],
        [left, top],
        [left + width, bottom],
        [left + width, top]
      ])
        add(t.x + dx * cos - dy * sin, t.y + dx * sin + dy * cos);
    };
    for (const s of this.draft.segments) if (wanted.has(s.entId)) {
      add(s.x1, s.y1);
      add(s.x2, s.y2);
    }
    for (const t of this.draft.texts) if (wanted.has(t.entId)) addText(t);
    for (const p of this.draft.points) if (wanted.has(p.entId)) add(p.x, p.y);
    return Number.isFinite(x0) ? [x0, y0, x1, y1] : null;
  }
  // ── 图层显隐 ──
  layerNames() {
    return [...this.layerVis.keys()].sort();
  }
  layerVisibility() {
    return Object.fromEntries(this.layerVis);
  }
  isLayerVisible(name2) {
    return this.layerVis.get(name2) ?? true;
  }
  setLayerVisible(name2, visible) {
    this.setLayerVisibility({ [name2]: visible });
  }
  setLayerVisibility(states) {
    let changed = false;
    for (const [name2, visible] of Object.entries(states)) {
      if (this.layerVis.get(name2) === visible) continue;
      this.layerVis.set(name2, visible);
      changed = true;
    }
    if (changed) this.rebuildHidden();
  }
  rebuildHidden() {
    const segs = this.draft.segments;
    for (let i = 0; i < segs.length; ++i)
      this.segHidden[i] = this.isLayerVisible(segs[i].layer) ? 0 : 1;
    const pts = this.draft.points;
    for (let i = 0; i < pts.length; ++i)
      this.pointHidden[i] = this.isLayerVisible(pts[i].layer) ? 0 : 1;
  }
  /** 宿主改完 canvas.width/height 后直接 render()(W/H 每帧从画布读,viewport 每帧设)。 */
  // ── 渲染 ──
  render() {
    const t0 = performance.now();
    this.drawGL();
    const tg = performance.now();
    this.drawTexts();
    if (this.opts.checkErrors)
      this.stats.glError = this.gl.getError();
    this.stats.geomMs = tg - t0;
    this.stats.textMs = performance.now() - tg;
  }
  drawGL() {
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
  drawSegs() {
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
      if (bb[i * 4 + 2] >= vx0 - pad && bb[i * 4] <= vx1 + pad && bb[i * 4 + 3] >= vy0 - pad && bb[i * 4 + 1] <= vy1 + pad)
        ++vis;
    }
    const step = vis > this.opts.targetSegs ? Math.ceil(vis / this.opts.targetSegs) : 1;
    const STRIDE = FLOATS_PER_VERT * 2;
    let scratch = this.scratch;
    const verts = this.verts;
    let n = 0, seen = 0;
    const emit = (i) => {
      scratch.set(verts.subarray(i * STRIDE, i * STRIDE + STRIDE), n);
      for (const off of [2, 10]) {
        const [r, g, b] = this.colorFor(scratch[n + off], scratch[n + off + 1], scratch[n + off + 2]);
        scratch[n + off] = r;
        scratch[n + off + 1] = g;
        scratch[n + off + 2] = b;
      }
      if (this.selectedEnts.has(segs[i].entId)) {
        for (const off of [2, 10]) {
          scratch[n + off] = 1;
          scratch[n + off + 1] = 0.82;
          scratch[n + off + 2] = 0.2;
        }
      }
      n += STRIDE;
    };
    const visible = (i) => {
      if (this.segHidden[i]) return false;
      return bb[i * 4 + 2] >= vx0 - pad && bb[i * 4] <= vx1 + pad && bb[i * 4 + 3] >= vy0 - pad && bb[i * 4 + 1] <= vy1 + pad;
    };
    const selected = [];
    for (let i = 0; i < nSeg; ++i) {
      if (visible(i) && this.selectedEnts.has(segs[i].entId)) selected.push(i);
    }
    const requiredScratch = (Math.max(this.opts.targetSegs, selected.length) + 2) * STRIDE;
    if (scratch.length < requiredScratch) {
      this.scratch = new Float32Array(requiredScratch);
      scratch = this.scratch;
    }
    const ordinaryVis = vis - selected.length;
    const ordinaryBudget = Math.max(0, this.opts.targetSegs - selected.length);
    const sampleStep = ordinaryBudget > 0 && ordinaryVis > ordinaryBudget ? Math.ceil(ordinaryVis / ordinaryBudget) : 1;
    for (let i = 0; i < nSeg; ++i) {
      if (!visible(i) || this.selectedEnts.has(segs[i].entId) || ordinaryBudget === 0) continue;
      if (++seen % sampleStep !== 0) continue;
      emit(i);
    }
    for (const i of selected) emit(i);
    this.stats.lastDrawn = n / STRIDE;
    this.stats.lastStep = step;
    this.stats.lastCullMs = performance.now() - t0;
    if (n > 0) {
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, scratch, 0, n);
      gl.drawArrays(gl.LINES, 0, n / FLOATS_PER_VERT);
    }
    const pts = this.draft.points;
    if (pts.length > 0) {
      const ps = this.pointScratch;
      let pn = 0;
      for (let i = 0; i < pts.length; ++i) {
        if (this.pointHidden[i]) continue;
        const p = pts[i];
        if (p.x < vx0 - pad || p.x > vx1 + pad || p.y < vy0 - pad || p.y > vy1 + pad) continue;
        const selected2 = this.selectedEnts.has(p.entId);
        const [r, g, b] = this.colorFor(p.r, p.g, p.b);
        ps[pn++] = p.x;
        ps[pn++] = p.y;
        ps[pn++] = selected2 ? 1 : r;
        ps[pn++] = selected2 ? 0.82 : g;
        ps[pn++] = selected2 ? 0.2 : b;
        ps[pn++] = 0;
        ps[pn++] = 0;
        ps[pn++] = 0;
      }
      if (pn > 0) {
        gl.bufferSubData(
          gl.ARRAY_BUFFER,
          this.pointVertBase * FLOATS_PER_VERT * 4,
          ps,
          0,
          pn
        );
        gl.drawArrays(gl.POINTS, this.pointVertBase, pn / FLOATS_PER_VERT);
      }
    }
  }
  drawTexts() {
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
    const drawnList = [];
    const emitText = (t) => {
      if (!this.isLayerVisible(t.layer)) return;
      if (t.x < vx0 || t.x > vx1 || t.y < vy0 || t.y > vy1) return;
      const px = t.h * scale;
      if (px < 3) return;
      const [sx, sy] = this.worldToScreen(t.x, t.y);
      ctx.save();
      ctx.translate(sx, sy);
      if (t.rot) ctx.rotate(-t.rot);
      const wf = this.draft.textStyles.get(t.style.toLowerCase())?.widthFactor ?? 1;
      if (wf !== 1) ctx.scale(wf, 1);
      const [r, g, b] = this.colorFor(t.r, t.g, t.b);
      ctx.fillStyle = this.selectedEnts.has(t.entId) ? "rgb(255,209,51)" : `rgb(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)})`;
      ctx.font = `${Math.max(8, px)}px sans-serif`;
      ctx.textAlign = textAlignOf(t.halign ?? 0);
      ctx.textBaseline = textBaselineOf(t.valign ?? 0, t.halign ?? 0);
      ctx.fillText(t.text, 0, 0);
      ctx.restore();
      drawnList.push({ sx, sy, entId: t.entId, layer: t.layer });
      ++drawn;
    };
    const eligible = (t) => {
      if (!this.isLayerVisible(t.layer)) return false;
      if (t.x < vx0 || t.x > vx1 || t.y < vy0 || t.y > vy1) return false;
      return t.h * scale >= 3;
    };
    const selected = this.draft.texts.filter((t) => this.selectedEnts.has(t.entId) && eligible(t));
    for (const t of this.draft.texts) {
      if (this.selectedEnts.has(t.entId) || !eligible(t)) continue;
      if (drawn + selected.length >= this.opts.maxTexts) {
        ++overflow;
        continue;
      }
      emitText(t);
    }
    for (const t of selected) emitText(t);
    ctx.restore();
    this.stats.textsDrawn = drawn;
    this.stats.textsOverflow = overflow;
    this.drawnTexts = drawnList;
  }
  /** 渲染器口径的「fit 态可见文字数」(视口内 + 字号 ≥3px + 层可见)。
   *  页面截断/性能判据的期望值必须与渲染同口径,独立各算一套会漂(Kimi 审查必改 9)。 */
  countVisibleTexts(st = this.st) {
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
   *  候选集与绘制同口径(微小/超上限文字不参与),同距时后绘制的顶层文字优先。-1 无命中。 */
  pickText(sx, sy) {
    const vp = this.viewport;
    if (sx < vp.x || sx > vp.x + vp.width || sy < vp.y || sy > vp.y + vp.height) return -1;
    let best = -1, bestD = 100;
    for (let i = this.drawnTexts.length - 1; i >= 0; --i) {
      const t = this.drawnTexts[i];
      const d2 = (t.sx - sx) * (t.sx - sx) + (t.sy - sy) * (t.sy - sy);
      if (d2 < bestD) {
        bestD = d2;
        best = t.entId;
      }
    }
    return best;
  }
  // ── 拾取(4B-4 入口;tol = 2 屏幕像素换算世界单位;hatch 整体不可拾取)──
  pick(sx, sy) {
    const vp = this.viewport;
    if (vp.width < 1 || vp.height < 1 || sx < vp.x || sx > vp.x + vp.width || sy < vp.y || sy > vp.y + vp.height) return null;
    const [wx, wy] = this.screenToWorld(sx, sy);
    const tol = 2 / (vp.height / (this.st.halfH * 2));
    const segs = this.draft.segments;
    const got = this.grid.pick(
      wx,
      wy,
      tol,
      (i) => this.segHidden[i] === 0 && segs[i].pickable
    );
    if (got < 0) return null;
    return { segIdx: got, entId: segs[got].entId, layer: segs[got].layer };
  }
  getStats() {
    return { ...this.stats };
  }
  dispose() {
    const gl = this.gl;
    if (this.patTex) gl.deleteTexture(this.patTex);
    gl.deleteBuffer(this.vbo);
    gl.deleteProgram(this.prog);
  }
};
function concatLut(lut) {
  const out = new Uint8Array(lut.length * 256);
  for (let r = 0; r < lut.length; ++r)
    out.set(lut[r].subarray(0, 256), r * 256);
  return out;
}

// ui-drawing-viewer/src/draft/draft_detail.ts
function dimTypeLabel(type) {
  switch (type) {
    case 0:
      return "\u7EBF\u6027";
    case 1:
      return "\u5BF9\u9F50";
    case 2:
      return "\u89D2\u5EA6";
    case 3:
      return "\u76F4\u5F84";
    case 4:
      return "\u534A\u5F84";
    case 5:
      return "\u4E09\u70B9\u89D2\u5EA6";
    case 6:
      return "\u5750\u6807";
    default:
      return `\u7C7B\u578B${type}`;
  }
}
function compareDim(dim) {
  if (dim.measured === void 0) return "no-measured";
  const m = dim.displayText.replace(/[ØØRrM°\s]/g, "").match(/-?\d+(?:\.\d+)?/);
  if (!m) return "unparseable";
  const shown = Number(m[0]);
  const lfac = Number.isFinite(dim.dimlfac) ? dim.dimlfac : 1;
  const ref = dim.measured * lfac;
  const decimals = m[0].includes(".") ? m[0].split(".")[1].length : 0;
  const rounded = decimals <= 100 ? Number(ref.toFixed(decimals)) : ref;
  return rounded === shown ? "match" : "mismatch";
}
function formatTolerance(dim) {
  const { upper, lower, fit } = dim.tolerance;
  if (typeof fit === "string" && fit) return fit;
  if (upper !== void 0 && lower !== void 0) {
    if (upper === -lower) return `\xB1${Math.abs(upper)}`;
    return `+${upper}/\u2212${Math.abs(lower)}`;
  }
  if (upper !== void 0) return `+${upper}`;
  if (lower !== void 0) return `\u2212${Math.abs(lower)}`;
  return "";
}
function detailFor(entId, layer, dimId, dims, groupSize) {
  if (dimId && dims.has(dimId)) {
    const dim = dims.get(dimId);
    return {
      kind: "dim",
      id: dim.id,
      displayText: dim.displayText,
      measured: dim.measured,
      compare: compareDim(dim),
      toleranceText: formatTolerance(dim),
      typeLabel: dimTypeLabel(dim.type),
      inferred: dim.inferred,
      ruleVersion: dim.ruleVersion,
      entityCount: groupSize(dimId)
    };
  }
  return { kind: "entity", entId, layer };
}
function originInfo(origin, sourceFile) {
  const method = origin.method === "manual" ? "\u624B\u52A8" : "\u81EA\u52A8";
  if (origin.channel === "autocad") {
    return {
      badge: `AutoCAD \u51FA\u8EAB(${method})`,
      tone: "ok",
      note: `\u6E90\u6587\u4EF6 ${sourceFile || "?"};\u5224\u5B9A\u4F9D\u636E:${origin.evidence[0] ?? "\u65E0"}`
    };
  }
  if (origin.channel === "nx") {
    return {
      badge: `NX \u51FA\u8EAB(${method})`,
      tone: "warn",
      note: `\u6E90\u6587\u4EF6 ${sourceFile || "?"};\u5F53\u524D\u7248\u672C\u8D70 AutoCAD \u901A\u9053\u8F6C\u6362 \u2014\u2014 \u8865\u4F20\u5BF9\u5E94 prt \u53EF\u83B7\u5F97\u66F4\u9AD8\u4FDD\u771F\u4E0E 3D \u8054\u52A8`
    };
  }
  return {
    badge: `\u51FA\u8EAB\u4E0D\u660E(${method})`,
    tone: "unknown",
    note: "\u8F6C\u6362\u5668\u672A\u80FD\u5224\u5B9A\u51FA\u8EAB;\u53EF\u5728\u4E0B\u65B9\u624B\u52A8\u6307\u5B9A\u540E\u91CD\u65B0\u63D0\u4EA4"
  };
}

// ui-drawing-viewer/src/draft/draft_pane.ts
var DRAFT_PANE_MESSAGE_VERSION = 2;
function validateProvenance(p) {
  if (p === null || p === void 0) return null;
  const text = (v) => typeof v === "string" && v.length > 0;
  const sha2 = (v) => typeof v === "string" && /^[0-9a-f]{64}$/i.test(v);
  const source = p.source, pack = p.pack;
  if (!text(p.session) || !source || !pack || !text(source.uri) || !text(source.name) || !sha2(source.sha256) || !sha2(pack.sha256) || !sha2(pack.identity))
    throw new Error("provenance \u987B\u542B session/source(uri,sha256,name)/pack(sha256,identity)\uFF0C\u54C8\u5E0C\u4E3A 64 \u4F4D\u5341\u516D\u8FDB\u5236");
  return {
    session: p.session,
    source: { uri: source.uri, sha256: source.sha256, name: source.name },
    pack: { sha256: pack.sha256, identity: pack.identity }
  };
}
var DraftPane = class {
  container;
  view = null;
  draft = null;
  name = "";
  originNow = null;
  provenance = null;
  selection = [];
  colorMode = "readable";
  insets = { top: 0, right: 0, bottom: 0, left: 0 };
  clickTimer = null;
  contextSnapshot = null;
  emit;
  disposers = [];
  ro = null;
  destroyed = false;
  // Pane 自建 DOM
  glCanvas;
  textCanvas;
  originDiv;
  layersDiv;
  detailBody;
  rechooser;
  constructor(container, emit) {
    this.container = container;
    this.emit = (msg) => emit({ ...msg, messageVersion: DRAFT_PANE_MESSAGE_VERSION });
    this.buildDom();
    this.bindInteractions();
    this.applySize();
    this.emit({
      type: "ready",
      width: this.glCanvas.width,
      height: this.glCanvas.height
    });
    this.ro = new ResizeObserver(() => {
      if (this.destroyed) return;
      this.cancelClickTimer();
      this.applySize();
      if (this.view) this.view.render();
    });
    this.ro.observe(container);
  }
  // ── 消息入口(宿主唯一调用点;载荷纯 JSON)──
  handle(msg) {
    if (this.destroyed) return;
    try {
      if (msg === null || typeof msg !== "object") throw new Error("DraftPane \u6D88\u606F\u987B\u4E3A\u5BF9\u8C61");
      if (msg.type !== "getCamera" && msg.type !== "getStats") this.cancelClickTimer();
      const version = msg.messageVersion;
      if (version !== void 0 && version !== 1 && version !== DRAFT_PANE_MESSAGE_VERSION)
        throw new Error(`\u4E0D\u652F\u6301\u7684 DraftPane messageVersion:${JSON.stringify(version)}`);
      const isV2 = msg.type === "zoomToRect" || msg.type === "locateTarget" || msg.type === "setSelection" || msg.type === "clearSelection" || msg.type === "getCamera" || msg.type === "setCamera" || msg.type === "setViewportInsets" || msg.type === "setColorMode";
      if (isV2 && version !== DRAFT_PANE_MESSAGE_VERSION)
        throw new Error(`${msg.type} \u9700\u8981 messageVersion=2`);
      switch (msg.type) {
        case "load":
          this.load(msg.packText, msg.name, msg.provenance);
          return;
        case "setLayerVisible":
          if (!this.draft) return;
          if (!this.draft.layers.has(msg.layer)) {
            this.emit({ type: "error", message: `\u672A\u77E5\u56FE\u5C42:${msg.layer}` });
            return;
          }
          this.view?.setLayerVisible(msg.layer, msg.visible);
          if (this.contextSnapshot) this.contextSnapshot.layers[msg.layer] = msg.visible;
          this.renderNow();
          return;
        case "fit":
          this.view?.fit();
          this.renderNow();
          return;
        case "zoomAt":
          this.view?.zoomAt(msg.sx, msg.sy, msg.factor);
          this.renderNow();
          return;
        case "pan":
          this.view?.panPixels(msg.dx, msg.dy);
          this.renderNow();
          return;
        case "resize":
          this.applySize();
          this.renderNow();
          return;
        case "setOriginOverride":
          if (this.originNow) {
            this.originNow = {
              ...this.originNow,
              channel: msg.channel,
              method: "manual",
              evidence: msg.evidence
            };
            this.renderOrigin();
            this.emit({ type: "originChanged", origin: this.originNow });
          }
          return;
        case "getStats":
          this.emit({
            type: "stats",
            stats: this.view ? this.view.getStats() : {}
          });
          return;
        case "dispose":
          this.dispose();
          return;
        case "zoomToRect":
          if (this.view) {
            this.view.zoomToRect(msg.rect);
            this.renderNow();
          }
          return;
        case "locateTarget":
          if (this.view && this.draft) this.locate(msg.target, msg.zoom);
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
          if (this.view) {
            this.view.setCamera(msg.state);
            this.renderNow();
          }
          return;
        case "setViewportInsets": {
          const next = { top: msg.top, right: msg.right, bottom: msg.bottom, left: msg.left };
          if (![next.top, next.right, next.bottom, next.left].every((v) => Number.isFinite(v) && v >= 0))
            throw new Error("viewport insets \u987B\u4E3A\u975E\u8D1F\u6709\u9650\u6570");
          this.insets = next;
          this.view?.setViewportInsets(next);
          this.renderNow();
          return;
        }
        case "setColorMode":
          this.setColorMode(msg.mode);
          return;
        default:
          throw new Error("\u672A\u77E5 DraftPane \u6D88\u606F");
      }
    } catch (e) {
      this.emit({ type: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }
  setColorMode(mode) {
    if (mode !== "readable" && mode !== "original") throw new Error(`\u672A\u77E5\u914D\u8272\u6A21\u5F0F:${JSON.stringify(mode)}`);
    this.colorMode = mode;
    this.view?.setColorMode(mode);
  }
  load(packText, name2, provenance) {
    this.cancelClickTimer();
    const provenanceNow = validateProvenance(provenance);
    const draft = loadDraft(JSON.parse(packText));
    const gl = this.glCanvas.getContext("webgl2", { antialias: true, depth: false });
    if (!gl) throw new Error("\u5EFA\u4E0D\u51FA WebGL2 \u4E0A\u4E0B\u6587");
    const c2d = this.textCanvas.getContext("2d");
    const hadSelection = this.selection.length > 0;
    const nextView = new DraftView(gl, c2d, draft, { checkErrors: true });
    nextView.setViewportInsets(this.insets);
    nextView.fit();
    nextView.setColorMode(this.colorMode);
    this.view?.dispose();
    this.view = nextView;
    this.draft = draft;
    this.name = name2;
    this.originNow = draft.origin;
    this.provenance = provenanceNow;
    this.selection = [];
    this.renderLayers();
    this.renderOrigin();
    this.detailBody.textContent = "\u70B9\u51FB\u5B9E\u4F53\u67E5\u770B\u8BE6\u60C5";
    const stats = nextView.getStats();
    this.emit({
      type: "loaded",
      name: name2,
      entities: draft.entityCount,
      segs: draft.segments.length,
      texts: draft.texts.length,
      points: draft.points.length,
      layers: [...draft.layers.entries()].map(([ln, l]) => ({
        name: ln,
        visible: this.view.isLayerVisible(ln),
        off: l.off,
        frozen: l.frozen
      })),
      dims: draft.dims.length,
      origin: draft.origin,
      sourceFile: draft.sourceFile,
      pack: provenanceNow?.pack ?? null,
      degraded: {
        geometryDecimated: stats.lastStep > 1,
        textTruncated: stats.textsOverflow > 0,
        skippedTypes: [...draft.skippedTypes]
      }
    });
    if (hadSelection) this.emit({ type: "selectionChanged", targets: [] });
    this.contextSnapshot = null;
  }
  restoreContext() {
    if (this.destroyed || !this.draft || this.view || !this.contextSnapshot) return;
    this.cancelClickTimer();
    let nextView = null;
    try {
      const gl = this.glCanvas.getContext("webgl2", { antialias: true, depth: false });
      if (!gl) throw new Error("\u6062\u590D WebGL2 \u4E0A\u4E0B\u6587\u5931\u8D25");
      const c2d = this.textCanvas.getContext("2d");
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
  buildDom() {
    const c = this.container;
    c.style.position = "relative";
    c.style.background = "#1e2023";
    c.style.overflow = "hidden";
    const mk = (tag, css) => {
      const el = document.createElement(tag);
      Object.assign(el.style, css);
      c.appendChild(el);
      return el;
    };
    this.glCanvas = mk("canvas", { position: "absolute", left: "0", top: "0", width: "100%", height: "100%" });
    this.textCanvas = mk("canvas", { position: "absolute", left: "0", top: "0", width: "100%", height: "100%", pointerEvents: "none" });
    this.originDiv = mk("div", {
      position: "absolute",
      left: "8px",
      top: "8px",
      maxWidth: "460px",
      background: "rgba(30,32,35,0.92)",
      border: "1px solid #3a3d42",
      padding: "6px 10px",
      zIndex: "5"
    });
    this.layersDiv = mk("div", {
      position: "absolute",
      right: "8px",
      top: "8px",
      maxHeight: "60%",
      overflowY: "auto",
      background: "rgba(30,32,35,0.92)",
      border: "1px solid #3a3d42",
      padding: "6px 10px",
      zIndex: "5"
    });
    const hd = document.createElement("div");
    hd.textContent = "DXF \u56FE\u5C42";
    hd.style.fontWeight = "bold";
    this.layersDiv.appendChild(hd);
    const detailDiv = mk("div", {
      position: "absolute",
      right: "8px",
      bottom: "8px",
      width: "280px",
      maxHeight: "40%",
      overflowY: "auto",
      background: "rgba(30,32,35,0.92)",
      border: "1px solid #3a3d42",
      padding: "6px 10px",
      zIndex: "5"
    });
    const dhd = document.createElement("div");
    dhd.textContent = "\u8BE6\u60C5";
    dhd.style.fontWeight = "bold";
    detailDiv.appendChild(dhd);
    this.detailBody = mk("div", {});
    this.detailBody.textContent = "\u70B9\u51FB\u5B9E\u4F53\u67E5\u770B\u8BE6\u60C5";
    detailDiv.appendChild(this.detailBody);
    this.rechooser = mk("div", {
      position: "absolute",
      left: "50%",
      top: "30%",
      transform: "translateX(-50%)",
      background: "#26282c",
      border: "1px solid #5a5d62",
      padding: "14px 18px",
      display: "none",
      zIndex: "50"
    });
  }
  cancelClickTimer() {
    if (this.clickTimer !== null) clearTimeout(this.clickTimer);
    this.clickTimer = null;
  }
  bindInteractions() {
    const dprOf = () => this.glCanvas.width / (this.container.clientWidth || 1);
    const onWheel = (e) => {
      e.preventDefault();
      this.cancelClickTimer();
      const r = this.glCanvas.getBoundingClientRect();
      const k = dprOf();
      this.view?.zoomAt(
        (e.clientX - r.left) * k,
        (e.clientY - r.top) * k,
        Math.exp((e.deltaY > 0 ? -1 : 1) * 0.15)
      );
      this.renderNow();
    };
    let dragging = false, moved = false, lastX = 0, lastY = 0, startX = 0, startY = 0;
    const onDown = (e) => {
      if (e.button !== 0) return;
      this.cancelClickTimer();
      dragging = true;
      moved = false;
      lastX = startX = e.clientX;
      lastY = startY = e.clientY;
    };
    const onMove = (e) => {
      if (!dragging) return;
      if (Math.hypot(e.clientX - startX, e.clientY - startY) > 4) moved = true;
      const k = dprOf();
      this.view?.panPixels((e.clientX - lastX) * k, (e.clientY - lastY) * k);
      lastX = e.clientX;
      lastY = e.clientY;
      this.renderNow();
    };
    const onUp = () => {
      dragging = false;
    };
    const onCancel = () => {
      this.cancelClickTimer();
      dragging = false;
      moved = true;
    };
    const preparePick = (e) => {
      if (moved) {
        moved = false;
        return null;
      }
      if (!this.view || !this.draft) return null;
      const r = this.glCanvas.getBoundingClientRect();
      const k = dprOf();
      const sx = (e.clientX - r.left) * k, sy = (e.clientY - r.top) * k;
      const textEnt = this.view.pickText(sx, sy);
      let entId = -1, layer = "";
      if (textEnt >= 0) {
        const t = this.draft.texts.find((t2) => t2.entId === textEnt);
        if (t) {
          entId = textEnt;
          layer = t.layer;
        }
      }
      if (entId < 0) {
        const hit = this.view.pick(sx, sy);
        if (!hit) {
          return () => {
            this.detailBody.textContent = "\u70B9\u51FB\u5B9E\u4F53\u67E5\u770B\u8BE6\u60C5";
            this.applySelection([]);
            this.emit({ type: "pickDetail", detail: null });
          };
        }
        entId = hit.entId;
        layer = hit.layer;
      }
      const dimId = this.draft.dimIdByEnt.get(entId);
      const target = { type: dimId ? "dim" : "entity", id: dimId ?? entId };
      const dimsMap = new Map(this.draft.dims.map((d2) => [d2.id, d2]));
      const groupSize = (dimId2) => {
        let n = 0;
        for (const v of this.draft.dimIdByEnt.values()) if (v === dimId2) ++n;
        return n;
      };
      const d = detailFor(entId, layer, this.draft.dimIdByEnt.get(entId), dimsMap, groupSize);
      return () => {
        this.applySelection([target]);
        this.renderDetail(d);
        this.emit({ type: "pickDetail", detail: d });
      };
    };
    const onClick = (e) => {
      if (moved) {
        moved = false;
        return;
      }
      this.cancelClickTimer();
      if (e.detail > 1) return;
      const event = { clientX: e.clientX, clientY: e.clientY, button: e.button };
      const apply2 = preparePick(event);
      if (!apply2) return;
      this.clickTimer = setTimeout(() => {
        this.clickTimer = null;
        apply2();
      }, 220);
    };
    const onDblClick = (e) => {
      e.preventDefault();
      this.cancelClickTimer();
      moved = false;
      this.view?.fit();
      this.renderNow();
    };
    const onLost = (e) => {
      e.preventDefault();
      if (this.destroyed) return;
      this.cancelClickTimer();
      if (this.view) {
        this.contextSnapshot = {
          camera: { ...this.view.view },
          selection: this.view.selectedEntities(),
          layers: this.view.layerVisibility()
        };
        this.view.dispose();
        this.view = null;
      }
    };
    const onRestored = () => {
      this.restoreContext();
    };
    this.glCanvas.addEventListener("wheel", onWheel, { passive: false });
    this.glCanvas.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    this.glCanvas.addEventListener("click", onClick);
    this.glCanvas.addEventListener("dblclick", onDblClick);
    this.glCanvas.addEventListener("webglcontextlost", onLost);
    this.glCanvas.addEventListener("webglcontextrestored", onRestored);
    this.disposers.push(() => {
      this.glCanvas.removeEventListener("wheel", onWheel);
      this.glCanvas.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      this.glCanvas.removeEventListener("click", onClick);
      this.glCanvas.removeEventListener("dblclick", onDblClick);
      this.glCanvas.removeEventListener("webglcontextlost", onLost);
      this.glCanvas.removeEventListener("webglcontextrestored", onRestored);
    });
  }
  resolveTargets(targets) {
    if (!Array.isArray(targets)) throw new Error("selection targets \u987B\u4E3A\u6570\u7EC4");
    const ids = /* @__PURE__ */ new Set(), canonical = [], keys = /* @__PURE__ */ new Set();
    for (const target of targets) {
      if (!target || target.type !== "dim" && target.type !== "entity")
        throw new Error("target.type \u987B\u4E3A dim \u6216 entity");
      if (target.type === "dim") {
        if (typeof target.id !== "string" || !target.id) throw new Error("dim target.id \u987B\u4E3A\u975E\u7A7A\u5B57\u7B26\u4E32");
        const dim = this.draft.dims.find((d) => d.id === target.id);
        if (!dim) throw new Error(`\u672A\u77E5\u5C3A\u5BF8:${target.id}`);
        for (const id of dim.entityIds) ids.add(id);
      } else {
        if (!Number.isInteger(target.id) || target.id < 0 || target.id >= this.draft.entityCount)
          throw new Error(`\u672A\u77E5\u5B9E\u4F53:${JSON.stringify(target.id)}`);
        ids.add(target.id);
      }
      const key = `${target.type}:${String(target.id)}`;
      if (!keys.has(key)) {
        keys.add(key);
        canonical.push({ type: target.type, id: target.id });
      }
    }
    return { ids: [...ids], canonical };
  }
  applySelection(targets) {
    const { ids, canonical } = this.resolveTargets(targets);
    this.view.setSelectedEntities(ids);
    this.selection = canonical;
    this.renderNow();
    this.emit({ type: "selectionChanged", targets: canonical.map((t) => ({ ...t })) });
  }
  locate(target, zoom) {
    if (typeof zoom !== "boolean") throw new Error("locateTarget.zoom \u987B\u4E3A\u5E03\u5C14\u503C");
    const { ids, canonical } = this.resolveTargets([target]);
    if (ids.length === 0) throw new Error("\u76EE\u6807\u6CA1\u6709\u5173\u8054\u5B9E\u4F53");
    const bounds = zoom ? this.view.entityBounds(ids) : null;
    if (zoom && !bounds) throw new Error("\u76EE\u6807\u6CA1\u6709\u53EF\u5B9A\u4F4D\u51E0\u4F55");
    const layers = /* @__PURE__ */ new Set();
    for (const s of this.draft.segments) if (ids.includes(s.entId)) layers.add(s.layer);
    for (const t of this.draft.texts) if (ids.includes(t.entId)) layers.add(t.layer);
    for (const p of this.draft.points) if (ids.includes(p.entId)) layers.add(p.layer);
    let reveal = false;
    for (const layer of layers) {
      if (!this.view.isLayerVisible(layer)) {
        this.view.setLayerVisible(layer, true);
        reveal = true;
      }
    }
    if (reveal) this.renderLayers();
    if (bounds) this.view.zoomToWorldRect(bounds);
    this.applySelection(canonical);
  }
  renderNow() {
    this.view?.render();
    if (this.view) {
      const s = this.view.getStats();
      this.emit({ type: "stats", stats: {
        lastDrawn: s.lastDrawn,
        lastStep: s.lastStep,
        geomMs: s.geomMs,
        textMs: s.textMs,
        textsDrawn: s.textsDrawn,
        textsOverflow: s.textsOverflow,
        glError: s.glError
      } });
    }
  }
  applySize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const r = this.container.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width * dpr)), h2 = Math.max(1, Math.round(r.height * dpr));
    this.glCanvas.width = w;
    this.glCanvas.height = h2;
    this.textCanvas.width = w;
    this.textCanvas.height = h2;
  }
  renderLayers() {
    if (!this.view || !this.draft) return;
    this.layersDiv.textContent = "";
    const hd = document.createElement("div");
    hd.textContent = "DXF \u56FE\u5C42";
    hd.style.fontWeight = "bold";
    this.layersDiv.appendChild(hd);
    for (const name2 of this.view.layerNames()) {
      const label = document.createElement("label");
      label.style.display = "block";
      label.style.whiteSpace = "nowrap";
      label.style.cursor = "pointer";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = this.view.isLayerVisible(name2);
      cb.addEventListener("change", () => {
        this.cancelClickTimer();
        this.view?.setLayerVisible(name2, cb.checked);
        if (this.contextSnapshot) this.contextSnapshot.layers[name2] = cb.checked;
        this.renderNow();
        this.emit({ type: "layerChanged", layer: name2, visible: cb.checked });
      });
      label.appendChild(cb);
      const flag = this.draft.layers.get(name2);
      const tag = flag?.frozen ? "[\u51BB]" : flag?.off ? "[\u5173]" : "";
      label.appendChild(document.createTextNode(` DXF \u56FE\u5C42: ${name2}${tag}(${this.draft.segsByLayer.get(name2) ?? 0})`));
      this.layersDiv.appendChild(label);
    }
  }
  renderOrigin() {
    if (!this.originNow || !this.draft) return;
    const info = originInfo(this.originNow, this.draft.sourceFile);
    this.originDiv.textContent = "";
    const badge = document.createElement("div");
    badge.style.fontWeight = "bold";
    badge.style.color = info.tone === "ok" ? "#7ec97e" : info.tone === "warn" ? "#e0b050" : "#b080c0";
    badge.textContent = info.badge;
    const note = document.createElement("div");
    note.style.color = "#a0a4a8";
    note.textContent = info.note;
    const btn = document.createElement("button");
    btn.textContent = "\u51FA\u8EAB\u6539\u5224\u2026";
    btn.addEventListener("click", () => {
      this.rechooser.textContent = "";
      const hd = document.createElement("div");
      hd.textContent = "\u51FA\u8EAB\u624B\u52A8\u6307\u5B9A";
      hd.style.fontWeight = "bold";
      this.rechooser.appendChild(hd);
      for (const [ch, label, desc] of [
        ["autocad", "AutoCAD \u539F\u751F\u7ED8\u5236", "\u6309 AutoCAD \u89C4\u5219\u96C6\u89E3\u6790"],
        ["nx", "NX \u5236\u56FE\u5BFC\u51FA", "\u5F53\u524D\u7248\u672C\u7EDF\u4E00\u8D70 AutoCAD \u901A\u9053;\u8865\u4F20 prt \u53EF\u83B7\u66F4\u9AD8\u4FDD\u771F\u4E0E 3D \u8054\u52A8"],
        ["unknown", "\u4E0D\u786E\u5B9A", "\u4FDD\u7559 unknown,\u540E\u7EED\u4EBA\u5DE5\u786E\u8BA4"]
      ]) {
        const lab = document.createElement("label");
        lab.style.display = "block";
        const radio = document.createElement("input");
        radio.type = "radio";
        radio.name = "pane-ch";
        radio.value = ch;
        radio.checked = ch === this.originNow.channel;
        lab.appendChild(radio);
        lab.appendChild(document.createTextNode(" " + label));
        const d = document.createElement("div");
        d.textContent = desc;
        d.style.cssText = "color:#a0a4a8;margin:2px 0 8px 22px;font-size:12px";
        lab.appendChild(d);
        this.rechooser.appendChild(lab);
      }
      const row = document.createElement("div");
      row.style.textAlign = "right";
      const cancel = document.createElement("button");
      cancel.textContent = "\u53D6\u6D88";
      cancel.addEventListener("click", () => {
        this.rechooser.style.display = "none";
      });
      const ok = document.createElement("button");
      ok.textContent = "\u786E\u8BA4\u6539\u5224";
      ok.style.marginLeft = "8px";
      ok.addEventListener("click", () => {
        const picked = this.rechooser.querySelector("input[name=pane-ch]:checked");
        if (picked && this.originNow) {
          this.handle({
            type: "setOriginOverride",
            channel: picked.value,
            evidence: [`\u4EBA\u5DE5\u6307\u8BA4(${(/* @__PURE__ */ new Date()).toISOString().slice(0, 10)})`]
          });
        }
        this.rechooser.style.display = "none";
      });
      row.appendChild(cancel);
      row.appendChild(ok);
      this.rechooser.appendChild(row);
      this.rechooser.style.display = "block";
    });
    this.originDiv.appendChild(badge);
    this.originDiv.appendChild(note);
    this.originDiv.appendChild(btn);
  }
  renderDetail(d) {
    this.detailBody.textContent = "";
    if (d === null) {
      this.detailBody.textContent = "\u70B9\u51FB\u5B9E\u4F53\u67E5\u770B\u8BE6\u60C5";
      return;
    }
    if (d.kind === "dim") {
      const big = document.createElement("div");
      big.style.cssText = "font-size:20px;margin:4px 0";
      if (d.compare === "mismatch") big.style.color = "#e06060";
      big.textContent = d.displayText + (d.inferred ? "(\u63A8\u65AD)" : "");
      this.detailBody.appendChild(big);
      const tbl = document.createElement("table");
      const row = (k, v) => {
        const tr = document.createElement("tr");
        const t1 = document.createElement("td");
        t1.style.cssText = "color:#909498;white-space:nowrap;padding:1px 4px";
        t1.textContent = k;
        const t2 = document.createElement("td");
        t2.style.padding = "1px 4px";
        t2.textContent = v;
        tr.appendChild(t1);
        tr.appendChild(t2);
        tbl.appendChild(tr);
      };
      row("\u5C3A\u5BF8 id", d.id);
      row("\u7C7B\u578B", d.typeLabel);
      row("\u6D4B\u91CF\u503C", d.measured !== void 0 ? String(d.measured) : "\u2014");
      if (d.toleranceText) row("\u516C\u5DEE", d.toleranceText);
      if (d.compare === "mismatch") row("\u6BD4\u5BF9", "\u26A0 \u663E\u793A\u4E0E\u6D4B\u91CF\u4E0D\u4E00\u81F4");
      else if (d.compare === "no-measured") row("\u6BD4\u5BF9", "\u6D4B\u91CF\u503C\u7F3A\u5E2D(LibreDWG \u5DF2\u77E5\u5F62\u6001)");
      row("\u5173\u8054\u5B9E\u4F53", `${d.entityCount} \u4E2A`);
      if (d.ruleVersion) row("\u89C4\u5219", d.ruleVersion);
      this.detailBody.appendChild(tbl);
    } else {
      const tbl = document.createElement("table");
      const row = (k, v) => {
        const tr = document.createElement("tr");
        const t1 = document.createElement("td");
        t1.style.cssText = "color:#909498;padding:1px 4px";
        t1.textContent = k;
        const t2 = document.createElement("td");
        t2.style.padding = "1px 4px";
        t2.textContent = v;
        tr.appendChild(t1);
        tr.appendChild(t2);
        tbl.appendChild(tr);
      };
      row("\u5B9E\u4F53", String(d.entId));
      row("\u56FE\u5C42", d.layer);
      this.detailBody.appendChild(tbl);
    }
  }
  /** 释放 WebGL 资源与全部监听器(4C-3 关窗回收断言的对象);此后 handle 为空操作。 */
  dispose() {
    this.destroyed = true;
    this.cancelClickTimer();
    this.ro?.disconnect();
    this.ro = null;
    for (const d of this.disposers) d();
    this.disposers = [];
    this.view?.dispose();
    this.view = null;
    this.contextSnapshot = null;
    this.container.textContent = "";
  }
};

// ui-drawing-viewer/src/adapter.ts
var sha = (value) => typeof value === "string" && /^[0-9a-f]{64}$/i.test(value);
function descriptorProvenance(descriptor) {
  const anyIdentity = descriptor.session !== void 0 || descriptor.source !== void 0 || descriptor.pack !== void 0;
  if (!anyIdentity) return null;
  if (!descriptor.session || !descriptor.source || !descriptor.pack || !descriptor.source.uri || !descriptor.source.name || !sha(descriptor.source.sha256) || !sha(descriptor.pack.sha256) || !sha(descriptor.pack.identity))
    throw new Error("descriptor \u7684 session/source/pack \u6765\u6E90\u8EAB\u4EFD\u4E0D\u5B8C\u6574\u6216\u54C8\u5E0C\u975E\u6CD5");
  return {
    session: descriptor.session,
    source: { ...descriptor.source },
    pack: { ...descriptor.pack }
  };
}
function validateDescriptor(descriptor) {
  if (!descriptor || typeof descriptor !== "object") throw new Error("descriptor \u987B\u4E3A\u5BF9\u8C61");
  if (typeof descriptor.name !== "string" || !descriptor.name.trim()) throw new Error("descriptor.name \u4E0D\u5F97\u4E3A\u7A7A");
  if (typeof descriptor.packText !== "string" || !descriptor.packText.trim()) throw new Error("descriptor.packText \u4E0D\u5F97\u4E3A\u7A7A");
  descriptorProvenance(descriptor);
}
function drawingReferences(descriptor, targets) {
  const provenance = descriptorProvenance(descriptor);
  if (!provenance) return [];
  return targets.map((target) => ({
    kind: "camind-drawing-ref",
    version: 1,
    session: provenance.session,
    source: { ...provenance.source },
    pack: { ...provenance.pack },
    target: { ...target }
  }));
}

// ui-drawing-viewer/src/styles.ts
var drawingCss = `
.cdv { position:relative; display:flex; flex-direction:column; width:100%; height:100%; min-height:0;
  color:var(--camind-color-text, var(--dsw-alias-label-primary));
  background:var(--camind-surface-page, var(--dsw-alias-background-base)); }
.cdv-meta { display:flex; flex-wrap:wrap; align-items:center; gap:6px 12px; padding:6px 8px;
  font-size:12px; line-height:1.4; color:var(--camind-color-text-secondary, var(--dsw-alias-label-secondary)); }
.cdv-meta strong { color:var(--camind-color-text, var(--dsw-alias-label-primary)); font-weight:600; }
.cdv-badge { display:inline-flex; align-items:center; border:1px solid var(--camind-border-default, var(--dsw-alias-border-l2));
  border-radius:4px; padding:1px 5px; color:var(--camind-color-warning, var(--dsw-alias-state-warn-label, var(--dsw-alias-state-warn-primary))); }
.cdv-error { margin:6px 8px; padding:8px; border:1px solid var(--camind-color-danger, var(--dsw-alias-state-error-primary));
  color:var(--camind-color-danger, var(--dsw-alias-state-error-primary)); background:var(--camind-surface-warning, transparent); }
.cdv-missing { margin:0 8px 6px; color:var(--camind-color-warning, var(--dsw-alias-state-warn-label, var(--dsw-alias-state-warn-primary))); }
.cdv-body { position:relative; display:flex; flex:1; min-height:0; min-width:0; overflow:hidden; }
.cdv-body-adapted { display:grid; grid-template-columns:minmax(0,1fr) auto; grid-template-rows:auto minmax(0,1fr); }
.cdv-body-adapted > .cdv-canvas { grid-column:1; grid-row:2; }
.cdv-canvas { position:relative; flex:1; min-height:240px; min-width:0; overflow:hidden; }
.cdv-canvas:focus-visible { outline:2px solid var(--camind-color-primary, var(--dsw-alias-state-business-primary)); outline-offset:-2px; }
/* The mirrored DraftPane uses fixed-dark panels; keep a fixed light foreground in both themes. */
.cdv-canvas > div:not(canvas) { color:#f5f5f5; }
`;

// ui-drawing-viewer/src/client.ts
var h = import_react.default.createElement;
function DrawingPreview({ descriptor, onReference, adapter }) {
  const host = (0, import_react.useRef)(null);
  const middleDrag = (0, import_react.useRef)(null);
  const lastMiddleClick = (0, import_react.useRef)(0);
  const callback = (0, import_react.useRef)(onReference);
  callback.current = onReference;
  const [loaded, setLoaded] = (0, import_react.useState)(null);
  const [degraded, setDegraded] = (0, import_react.useState)(null);
  const [error, setError] = (0, import_react.useState)("");
  const [controller, setController] = (0, import_react.useState)(null);
  const [selection, setSelectionState] = (0, import_react.useState)([]);
  (0, import_react.useEffect)(() => {
    middleDrag.current = null;
    lastMiddleClick.current = 0;
    setLoaded(null);
    setDegraded(null);
    setError("");
    setController(null);
    setSelectionState([]);
    const container = host.current;
    if (!container) return;
    let disposed = false;
    container.textContent = "";
    let pane = null, suppressReferences = 0;
    try {
      validateDescriptor(descriptor);
      const provenance = descriptorProvenance(descriptor);
      const fail = (message) => {
        if (!disposed) setError(message instanceof Error ? message.message : String(message));
      };
      pane = new DraftPane(container, (msg) => {
        if (disposed) return;
        if (msg.type === "loaded") {
          setLoaded(msg);
          setDegraded(msg.degraded);
        } else if (msg.type === "stats") setDegraded((previous) => ({
          geometryDecimated: msg.stats.lastStep > 1,
          textTruncated: msg.stats.textsOverflow > 0,
          skippedTypes: previous?.skippedTypes ?? []
        }));
        else if (msg.type === "error") fail(msg.message);
        else if (msg.type === "selectionChanged") {
          const targets = msg.targets.map((target) => ({ ...target }));
          setSelectionState(targets);
          if (suppressReferences) return;
          if (targets.length === 0) {
            void (async () => {
              try {
                await callback.current?.(null, descriptor);
              } catch (e) {
                fail(e);
              }
            })();
            return;
          }
          setError("");
          for (const reference of drawingReferences(descriptor, targets)) {
            void (async () => {
              try {
                await callback.current?.(reference, descriptor);
              } catch (e) {
                fail(e);
              }
            })();
          }
        }
      });
      const currentPane = pane;
      const dpr = () => Math.min(window.devicePixelRatio || 1, 2);
      setController({
        fit: () => {
          currentPane.handle({ type: "fit", messageVersion: 2 });
        },
        zoom: (factor) => {
          const rect = host.current?.getBoundingClientRect();
          if (!rect || rect.width <= 0 || rect.height <= 0) return;
          const scale = dpr();
          currentPane.handle({ type: "zoomAt", messageVersion: 2, sx: rect.width * scale / 2, sy: rect.height * scale / 2, factor });
        },
        pan: (dx, dy) => {
          const scale = dpr();
          currentPane.handle({ type: "pan", messageVersion: 2, dx: dx * scale, dy: dy * scale });
        },
        locateTarget: (target, zoom = true) => {
          currentPane.handle({ type: "locateTarget", messageVersion: 2, target, zoom });
        },
        setSelection: (targets, notify = true) => {
          if (!notify) suppressReferences++;
          try {
            currentPane.handle({ type: "setSelection", messageVersion: 2, targets });
          } finally {
            if (!notify) suppressReferences--;
          }
        },
        clearSelection: (notify = true) => {
          if (!notify) suppressReferences++;
          try {
            currentPane.handle({ type: "clearSelection", messageVersion: 2 });
          } finally {
            if (!notify) suppressReferences--;
          }
        },
        zoomToRect: (rect) => {
          const scale = dpr();
          currentPane.handle({ type: "zoomToRect", messageVersion: 2, rect: { x: rect.x * scale, y: rect.y * scale, width: rect.width * scale, height: rect.height * scale } });
        },
        setViewportInsets: (insets) => {
          const scale = dpr();
          currentPane.handle({ type: "setViewportInsets", messageVersion: 2, top: insets.top * scale, right: insets.right * scale, bottom: insets.bottom * scale, left: insets.left * scale });
        },
        setColorMode: (mode) => {
          currentPane.handle({ type: "setColorMode", messageVersion: 2, mode });
        }
      });
      pane.handle({ type: "load", messageVersion: 2, packText: descriptor.packText, name: descriptor.name, provenance });
    } catch (e) {
      if (!disposed) setError(e instanceof Error ? e.message : String(e));
    }
    return () => {
      disposed = true;
      void (async () => {
        try {
          await callback.current?.(null, descriptor);
        } catch {
        }
      })();
      pane?.dispose();
      container.textContent = "";
    };
  }, [descriptor]);
  const visibleDegraded = degraded ?? loaded?.degraded;
  return h(
    "section",
    { className: "cdv", "data-testid": "drawing-preview" },
    h(
      "div",
      { className: "cdv-meta" },
      h("strong", null, loaded?.name ?? descriptor.name),
      loaded ? h("span", null, `${loaded.entities} \u5B9E\u4F53 \xB7 ${loaded.dims} \u5C3A\u5BF8`) : null,
      loaded?.pack ? h("span", { title: loaded.pack.identity }, `pack ${loaded.pack.sha256.slice(0, 12)}\u2026`) : h("span", null, "\u5185\u5BB9\u6A21\u5F0F \xB7 \u53EA\u8BFB"),
      visibleDegraded?.geometryDecimated ? h("span", { className: "cdv-badge" }, "\u51E0\u4F55\u5DF2\u62BD\u7A00") : null,
      visibleDegraded?.textTruncated ? h("span", { className: "cdv-badge" }, "\u6587\u5B57\u6709\u622A\u65AD") : null,
      visibleDegraded?.skippedTypes.length ? h("span", { className: "cdv-badge" }, `\u8DF3\u8FC7\u672A\u77E5\u7C7B\u578B\uFF1A${visibleDegraded.skippedTypes.join("\u3001")}`) : null
    ),
    descriptor.missing?.length ? h("div", { className: "cdv-missing" }, `\u7F3A\u5931\u4FE1\u606F\uFF1A${descriptor.missing.join("\u3001")}`) : null,
    error ? h("div", { className: "cdv-error", role: "alert" }, error) : null,
    h(
      "div",
      { className: adapter ? "cdv-body cdv-body-adapted" : "cdv-body" },
      h("div", {
        ref: host,
        className: "cdv-canvas",
        tabIndex: 0,
        role: "region",
        "aria-label": "\u4E8C\u7EF4\u56FE\u7EB8\u753B\u5E03\uFF0C\u62D6\u52A8\u5E73\u79FB\uFF0C\u6EDA\u8F6E\u7F29\u653E\uFF0CF \u9002\u914D\u5168\u56FE",
        onPointerDown: (event) => {
          event.currentTarget.focus({ preventScroll: true });
          if (event.button !== 1) return;
          event.preventDefault();
          middleDrag.current = { x: event.clientX, y: event.clientY };
          event.currentTarget.setPointerCapture?.(event.pointerId);
        },
        onPointerMove: (event) => {
          const previous = middleDrag.current;
          if (!previous) return;
          event.preventDefault();
          middleDrag.current = { x: event.clientX, y: event.clientY };
          controller?.pan(event.clientX - previous.x, event.clientY - previous.y);
        },
        onPointerUp: (event) => {
          if (!middleDrag.current) return;
          event.preventDefault();
          middleDrag.current = null;
          event.currentTarget.releasePointerCapture?.(event.pointerId);
        },
        onPointerCancel: (event) => {
          if (!middleDrag.current) return;
          event.preventDefault();
          middleDrag.current = null;
          event.currentTarget.releasePointerCapture?.(event.pointerId);
        },
        onAuxClick: (event) => {
          if (event.button !== 1) return;
          event.preventDefault();
          const now = Date.now();
          if (now - lastMiddleClick.current < 350) {
            controller?.fit();
            lastMiddleClick.current = 0;
          } else lastMiddleClick.current = now;
        },
        onKeyDown: (event) => {
          if (!controller) return;
          if (event.key.startsWith("Arrow")) {
            const step = event.shiftKey ? 120 : 40;
            controller.pan(event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0, event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0);
          } else if (event.key.toLowerCase() === "f") controller.fit();
          else if (event.key === "+" || event.key === "=") controller.zoom(1.3);
          else if (event.key === "-" || event.key === "_") controller.zoom(1 / 1.3);
          else if (event.key === "Escape") controller.clearSelection();
          else return;
          event.preventDefault();
        }
      }),
      adapter ? h(adapter, { descriptor, controller, selection, viewportRef: host, degraded: visibleDegraded ?? null, onReference }) : null
    )
  );
}
var name = "camind-ui-drawing-viewer";
var inject = ["slots"];
function apply(ctx) {
  ctx.effect(() => {
    const style = document.createElement("style");
    style.textContent = drawingCss;
    document.head.append(style);
    return () => style.remove();
  });
  ctx.slots.inject("cam.drawing.preview", () => ctx.slots.register({ name: "cam.drawing.preview", key: "drawing-viewer" }, DrawingPreview));
}
return module.exports; } });
