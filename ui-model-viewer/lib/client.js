// Generated from ui-model-viewer/src; run node ui-model-viewer/build.mjs.
window.__ModuleLoader__.load({ id: 'camind-ui-model-viewer', factory: (require) => { var module = { exports: {} }; var exports = module.exports;
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

// ui-model-viewer/src/client.ts
var client_exports = {};
__export(client_exports, {
  ModelViewer: () => ModelViewer,
  ToolpathViewer: () => ToolpathViewer,
  apply: () => apply,
  inject: () => inject,
  name: () => name
});
module.exports = __toCommonJS(client_exports);
var import_react2 = __toESM(require("react"), 1);
var import_dsh_client_ui_primitives2 = require("@deepseek-ai/dsh-client-ui-primitives");

// ui-model-viewer/src/core/version.ts
var kPackFormatName = "camind-geom";
var kPackFormatVersion = 1;

// ui-model-viewer/src/core/error.ts
var PackError = class extends Error {
  code;
  file;
  constructor(code, message, file) {
    super(message);
    this.code = code;
    this.file = file;
  }
};

// ui-model-viewer/src/core/math.ts
function v3(x = 0, y = 0, z = 0) {
  return { x, y, z };
}
function add(a, b) {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}
function sub(a, b) {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}
function scale(a, s) {
  return { x: a.x * s, y: a.y * s, z: a.z * s };
}
function dot(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}
function length(a) {
  return Math.sqrt(dot(a, a));
}
function normalized(a) {
  const len = length(a);
  return len > 0 ? scale(a, 1 / len) : a;
}
var Mat4 = class _Mat4 {
  m = _Mat4.identityArray();
  static identityArray() {
    const a = new Float64Array(16);
    a[0] = a[5] = a[10] = a[15] = 1;
    return a;
  }
  at(row, col) {
    return this.m[col * 4 + row];
  }
  set(row, col, v) {
    this.m[col * 4 + row] = v;
  }
  static identity() {
    return new _Mat4();
  }
  static translation(t) {
    const r = new _Mat4();
    r.set(0, 3, t.x);
    r.set(1, 3, t.y);
    r.set(2, 3, t.z);
    return r;
  }
  static scaling(sx, sy, sz) {
    const r = new _Mat4();
    r.set(0, 0, sx);
    r.set(1, 1, sy);
    r.set(2, 2, sz);
    return r;
  }
  static perspective(fovY, aspect, n, f) {
    const t = 1 / Math.tan(fovY / 2);
    const r = new _Mat4();
    r.m.fill(0);
    r.set(0, 0, t / aspect);
    r.set(1, 1, t);
    r.set(2, 2, (f + n) / (n - f));
    r.set(2, 3, 2 * f * n / (n - f));
    r.set(3, 2, -1);
    return r;
  }
  static orthographic(hw, hh, n, f) {
    const r = new _Mat4();
    r.set(0, 0, 1 / hw);
    r.set(1, 1, 1 / hh);
    r.set(2, 2, -2 / (f - n));
    r.set(2, 3, -(f + n) / (f - n));
    return r;
  }
  mul(o) {
    const r = new _Mat4();
    for (let col = 0; col < 4; ++col) {
      for (let row = 0; row < 4; ++row) {
        let s = 0;
        for (let k = 0; k < 4; ++k)
          s += this.at(row, k) * o.at(k, col);
        r.set(row, col, s);
      }
    }
    return r;
  }
  transformPoint(p) {
    const m = this.m;
    const x = m[0] * p.x + m[4] * p.y + m[8] * p.z + m[12];
    const y = m[1] * p.x + m[5] * p.y + m[9] * p.z + m[13];
    const z = m[2] * p.x + m[6] * p.y + m[10] * p.z + m[14];
    const w = m[3] * p.x + m[7] * p.y + m[11] * p.z + m[15];
    if (w !== 0 && w !== 1)
      return { x: x / w, y: y / w, z: z / w };
    return { x, y, z };
  }
  transformDirection(d) {
    const m = this.m;
    return {
      x: m[0] * d.x + m[4] * d.y + m[8] * d.z,
      y: m[1] * d.x + m[5] * d.y + m[9] * d.z,
      z: m[2] * d.x + m[6] * d.y + m[10] * d.z
    };
  }
  // 一般 4×4 求逆(余子式展开,与 MESA gluInvertMatrix 同一套公式)。不可逆返回单位阵。
  inverted() {
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
      return new _Mat4();
    const r = new _Mat4();
    const s = 1 / det;
    for (let i = 0; i < 16; ++i)
      r.m[i] = inv[i] * s;
    return r;
  }
  toFloat32() {
    const f = new Float32Array(16);
    for (let i = 0; i < 16; ++i)
      f[i] = this.m[i];
    return f;
  }
};
function boxCenter(b) {
  return scale(add(b.min, b.max), 0.5);
}
function boxRadius(b) {
  return length(sub(b.max, b.min)) * 0.5;
}
var RigidTransform = class _RigidTransform {
  r = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  t = [0, 0, 0];
  apply(p) {
    return {
      x: this.r[0][0] * p.x + this.r[0][1] * p.y + this.r[0][2] * p.z + this.t[0],
      y: this.r[1][0] * p.x + this.r[1][1] * p.y + this.r[1][2] * p.z + this.t[1],
      z: this.r[2][0] * p.x + this.r[2][1] * p.y + this.r[2][2] * p.z + this.t[2]
    };
  }
  // 逆变换:p = Rᵀ·(p' − t)。只对正交的 R 成立(旋转、镜像)。
  inverse() {
    const inv = new _RigidTransform();
    for (let i = 0; i < 3; ++i)
      for (let j = 0; j < 3; ++j)
        inv.r[i][j] = this.r[j][i];
    for (let i = 0; i < 3; ++i)
      inv.t[i] = -(inv.r[i][0] * this.t[0] + inv.r[i][1] * this.t[1] + inv.r[i][2] * this.t[2]);
    return inv;
  }
  toMat4() {
    const m = new Mat4();
    for (let row = 0; row < 3; ++row) {
      for (let col = 0; col < 3; ++col)
        m.set(row, col, this.r[row][col]);
      m.set(row, 3, this.t[row]);
    }
    return m;
  }
  // R 是否正交(RᵀR = I,容差内)。工位变换进来时先验一下,不正交的不收。
  isOrthonormal(tolerance = 1e-6) {
    for (let i = 0; i < 3; ++i) {
      for (let j = 0; j < 3; ++j) {
        let s = 0;
        for (let k = 0; k < 3; ++k)
          s += this.r[k][i] * this.r[k][j];
        if (Math.abs(s - (i === j ? 1 : 0)) > tolerance)
          return false;
      }
    }
    return true;
  }
};

// ui-model-viewer/src/core/geompack/manifest.ts
function fail(code, msg, file) {
  throw new PackError(code, msg, file);
}
function parseOrThrow(text, file) {
  try {
    return JSON.parse(text);
  } catch {
    fail("BadJson", file + ":\u4E0D\u662F\u5408\u6CD5\u7684 JSON", file);
  }
}
function req(obj, key, file) {
  if (typeof obj !== "object" || obj === null || !(key in obj) || obj[key] === null)
    fail("BadJson", file + ":\u7F3A\u5C11\u5FC5\u586B\u5B57\u6BB5 " + key, file);
  return obj[key];
}
function str(obj, key, file) {
  const v = req(obj, key, file);
  if (typeof v !== "string")
    fail("BadJson", file + ":\u5B57\u6BB5 " + key + " \u7C7B\u578B\u4E0D\u5BF9", file);
  return v;
}
function strOr(obj, key, fallback) {
  const v = obj?.[key];
  return typeof v === "string" ? v : fallback;
}
function intInRange(obj, key, file, lo, hi) {
  const v = req(obj, key, file);
  if (typeof v !== "number" || !Number.isInteger(v) || v < lo || v > hi)
    fail("BadJson", file + ":\u5B57\u6BB5 " + key + " \u7C7B\u578B\u4E0D\u5BF9", file);
  return v;
}
function integer(value) {
  if (typeof value !== "number" || !Number.isInteger(value))
    return null;
  return value;
}
function optionalInt(obj, key) {
  if (typeof obj !== "object" || obj === null || !(key in obj))
    return null;
  return integer(obj[key]);
}
function vec3(value, what, file) {
  if (!Array.isArray(value) || value.length !== 3 || !value.every((v) => typeof v === "number"))
    fail("BadJson", file + ":" + what + " \u5E94\u4E3A 3 \u4E2A\u6570", file);
  return value;
}
function bbox(obj, key, file, required) {
  const it = obj?.[key];
  if (typeof it !== "object" || it === null) {
    if (required)
      fail("BadJson", file + ":\u7F3A\u5C11\u5FC5\u586B\u5B57\u6BB5 " + key, file);
    return { min: [0, 0, 0], max: [0, 0, 0] };
  }
  if (!("min" in it) || !("max" in it))
    fail("BadJson", file + ":" + key + " \u7F3A min / max", file);
  return { min: vec3(it.min, key, file), max: vec3(it.max, key, file) };
}
function parseBodies(value, bodyCount, file) {
  if (!Array.isArray(value))
    fail("BadJson", file + ":bodies \u5E94\u4E3A\u6570\u7EC4", file);
  if (bodyCount !== null && bodyCount !== value.length) {
    fail(
      "CountMismatch",
      file + ":bodies \u6709 " + value.length + " \u9879,body_count \u5199\u7684\u662F " + bodyCount,
      file
    );
  }
  const out = [];
  for (let i = 0; i < value.length; ++i) {
    const item = value[i];
    if (typeof item !== "object" || item === null)
      fail("BadJson", file + ":bodies \u7684\u5143\u7D20\u5E94\u4E3A\u5BF9\u8C61", file);
    const body = integer(item.body);
    if (body === null || body !== i)
      fail("InvalidValue", file + ":bodies \u7B2C " + i + " \u9879\u7684 body \u5E94\u4E3A " + i + "(\u4ECE 0 \u8D77\u8FDE\u7EED)", file);
    const n = integer(item.n_faces);
    if (n === null || n <= 0 || n > 4294967295)
      fail("InvalidValue", file + ":\u4F53 " + i + " \u7684 n_faces \u7F3A\u5931\u6216\u4E0D\u662F\u6B63\u6574\u6570", file);
    const b = { body: i, nFaces: n };
    const t = item.translucency;
    if (t !== void 0 && t !== null) {
      const ti = integer(t);
      if (ti === null || ti < 0 || ti > 100)
        fail("InvalidValue", file + ":\u4F53 " + i + " \u7684 translucency \u5E94\u4E3A null \u6216 0 ~ 100 \u7684\u6574\u6570", file);
      b.translucency = ti;
    }
    if (typeof item.name === "string")
      b.name = item.name;
    const layer = optionalInt(item, "layer");
    if (layer !== null) b.layer = layer;
    const color = optionalInt(item, "color");
    if (color !== null) b.color = color;
    out.push(b);
  }
  return out;
}
function parseManifest(text) {
  const file = "manifest.json";
  const doc = parseOrThrow(text, file);
  if (typeof doc !== "object" || doc === null || Array.isArray(doc))
    fail("BadJson", file + ":\u9876\u5C42\u5E94\u4E3A\u5BF9\u8C61", file);
  const m = {};
  m.format = str(doc, "format", file);
  if (m.format !== kPackFormatName)
    fail("UnsupportedFormat", '\u4E0D\u662F Camind \u51E0\u4F55\u5305(format = "' + m.format + '")', file);
  m.formatVersion = intInRange(doc, "format_version", file, 0, 4294967295);
  if (m.formatVersion !== kPackFormatVersion)
    fail(
      "UnsupportedFormat",
      "\u51E0\u4F55\u5305\u683C\u5F0F\u7248\u672C " + m.formatVersion + " \u672C\u7A0B\u5E8F\u4E0D\u8BA4\u8BC6(\u53EA\u652F\u6301 " + kPackFormatVersion + "),\u8BF7\u5347\u7EA7\u5BA2\u6237\u7AEF",
      file
    );
  m.units = str(doc, "units", file);
  if (m.units !== "mm")
    fail("UnsupportedFormat", "v1 \u53EA\u652F\u6301\u6BEB\u7C73\u4EF6,\u8FD9\u4E2A\u5305\u7684\u5355\u4F4D\u662F " + m.units, file);
  m.pipelineVersion = str(doc, "pipeline_version", file);
  m.partRef = strOr(doc, "part_ref", "");
  m.partSha256 = str(doc, "part_sha256", file);
  m.stampedSha256 = strOr(doc, "stamped_sha256", "");
  m.nxVersion = strOr(doc, "nx_version", "");
  m.workerVersion = strOr(doc, "worker_version", "");
  if (!("origin_offset" in doc))
    fail("BadJson", file + ":\u7F3A\u5C11\u5FC5\u586B\u5B57\u6BB5 origin_offset", file);
  m.originOffset = vec3(doc.origin_offset, "origin_offset", file);
  m.bboxRelative = bbox(doc, "bbox_relative", file, true);
  m.faceCount = intInRange(doc, "face_count", file, 0, 4294967295);
  m.edgeCount = intInRange(doc, "edge_count", file, 0, 4294967295);
  const files = doc.files;
  if (!Array.isArray(files))
    fail("BadJson", file + ":\u7F3A\u5C11\u5FC5\u586B\u5B57\u6BB5 files", file);
  m.files = files.map((item) => {
    if (typeof item !== "object" || item === null)
      fail("BadJson", file + ":files[] \u7684\u5143\u7D20\u5E94\u4E3A\u5BF9\u8C61", file);
    const e = {};
    e.role = str(item, "role", file);
    e.lod = strOr(item, "lod", "");
    e.name = str(item, "name", file);
    e.bytes = intInRange(item, "bytes", file, 0, Number.MAX_SAFE_INTEGER);
    e.sha256 = str(item, "sha256", file);
    e.encoding = strOr(item, "encoding", "none");
    e.url = strOr(item, "url", "");
    e.chordTolMm = typeof item.chord_tol_mm === "number" ? item.chord_tol_mm : 0;
    e.angleTolDeg = typeof item.angle_tol_deg === "number" ? item.angle_tol_deg : 0;
    if (e.encoding !== "gzip" && e.encoding !== "none")
      fail("UnsupportedFormat", "\u6587\u4EF6 " + e.name + " \u7684\u7F16\u7801 " + e.encoding + " \u672C\u7A0B\u5E8F\u4E0D\u8BA4\u8BC6", file);
    if (!e.name || e.name.includes("/") || e.name.includes("\\") || e.name === "." || e.name === "..")
      fail("InvalidValue", "\u6E05\u5355\u91CC\u7684\u6587\u4EF6\u540D\u4E0D\u5408\u6CD5:" + e.name, file);
    return e;
  });
  if ("body_count" in doc) {
    const v = integer(doc.body_count);
    if (v !== null && v >= 0 && v <= 4294967295)
      m.bodyCount = v;
  }
  if ("bodies" in doc && doc.bodies !== null)
    m.bodies = parseBodies(doc.bodies, m.bodyCount ?? null, file);
  return m;
}
function fidToIndex(fid) {
  if (fid.length < 2 || fid[0] !== "F")
    return -1;
  let value = 0;
  for (let i = 1; i < fid.length; ++i) {
    const c = fid.charCodeAt(i);
    if (c < 48 || c > 57)
      return -1;
    value = value * 10 + (c - 48);
    if (value > 4294967295)
      return -1;
  }
  return value === 0 ? -1 : value - 1;
}

// ui-model-viewer/src/core/geompack/mesh.ts
var HEADER_SIZE = 32;
var NO_FACE = 4294967295;
function fail2(code, msg, file) {
  throw new PackError(code, msg, file);
}
function ownBuffer(raw) {
  if (raw.byteOffset === 0 && raw.byteLength === raw.buffer.byteLength)
    return raw;
  const copy = new Uint8Array(raw.byteLength);
  copy.set(raw);
  return copy;
}
function checkHeader(raw, magic, file) {
  if (raw.length < HEADER_SIZE)
    fail2("BadLength", file + ":\u6587\u4EF6\u6BD4 32 \u5B57\u8282\u7684\u5934\u8FD8\u77ED", file);
  const got = String.fromCharCode(raw[0], raw[1], raw[2], raw[3]);
  if (got !== magic)
    fail2("BadMagic", file + ":magic \u4E0D\u662F " + magic, file);
  const version = raw[4] | raw[5] << 8;
  if (version !== kPackFormatVersion)
    fail2("UnsupportedFormat", "\u4E8C\u8FDB\u5236\u683C\u5F0F\u7248\u672C " + version + " \u672C\u7A0B\u5E8F\u4E0D\u8BA4\u8BC6,\u8BF7\u5347\u7EA7\u5BA2\u6237\u7AEF", file);
}
function u32(p, off) {
  return (p[off] | p[off + 1] << 8 | p[off + 2] << 16) + p[off + 3] * 16777216;
}
var Mesh = class _Mesh {
  raw;
  lodValue = 0;
  faceCountValue = 0;
  vertexCountValue = 0;
  indexCountValue = 0;
  facesView;
  positionsView;
  normalsView;
  indicesView;
  constructor(raw) {
    this.raw = raw;
  }
  static parse(input, fileName) {
    const raw = ownBuffer(input);
    checkHeader(raw, "CMGM", fileName);
    const m = new _Mesh(raw);
    m.lodValue = raw[6] | raw[7] << 8;
    m.faceCountValue = u32(raw, 8);
    m.vertexCountValue = u32(raw, 12);
    m.indexCountValue = u32(raw, 16);
    if (m.lodValue > 1)
      fail2("InvalidValue", fileName + ":lod \u53EA\u80FD\u662F 0(\u7C97)\u6216 1(\u7EC6)", fileName);
    const expected = HEADER_SIZE + m.faceCountValue * 16 + m.vertexCountValue * 24 + m.indexCountValue * 4;
    if (expected !== raw.length) {
      fail2(
        "BadLength",
        fileName + ":\u6587\u4EF6\u957F " + raw.length + " \u5B57\u8282,\u6309\u5934\u91CC\u7684\u8BA1\u6570\u5E94\u4E3A " + expected,
        fileName
      );
    }
    if (m.indexCountValue % 3 !== 0)
      fail2("InvalidValue", fileName + ":\u7D22\u5F15\u6570\u4E0D\u662F 3 \u7684\u500D\u6570", fileName);
    m.facesView = new Uint32Array(raw.buffer, HEADER_SIZE, m.faceCountValue * 4);
    const posOff = HEADER_SIZE + m.faceCountValue * 16;
    m.positionsView = new Float32Array(raw.buffer, posOff, m.vertexCountValue * 3);
    m.normalsView = new Float32Array(raw.buffer, posOff + m.vertexCountValue * 12, m.vertexCountValue * 3);
    m.indicesView = new Uint32Array(raw.buffer, posOff + m.vertexCountValue * 24, m.indexCountValue);
    let nextVertex = 0, nextIndex = 0;
    for (let f = 0; f < m.faceCountValue; ++f) {
      const o = f * 4;
      const vo = m.facesView[o], vc = m.facesView[o + 1], io = m.facesView[o + 2], ic = m.facesView[o + 3];
      if (vo !== nextVertex || io !== nextIndex)
        fail2("OutOfRange", fileName + ":\u7B2C " + f + " \u5F20\u9762\u7684\u9876\u70B9\u6BB5\u6216\u7D22\u5F15\u6BB5\u6CA1\u6709\u7D27\u63A5\u4E0A\u4E00\u5F20\u9762", fileName);
      nextVertex += vc;
      nextIndex += ic;
      if (nextVertex > m.vertexCountValue || nextIndex > m.indexCountValue)
        fail2("OutOfRange", fileName + ":\u7B2C " + f + " \u5F20\u9762\u7684\u6BB5\u8D8A\u754C", fileName);
      if (ic % 3 !== 0)
        fail2("InvalidValue", fileName + ":\u7B2C " + f + " \u5F20\u9762\u7684\u7D22\u5F15\u6570\u4E0D\u662F 3 \u7684\u500D\u6570", fileName);
      const lo = vo, hi = vo + vc;
      for (let i = io; i < io + ic; ++i) {
        if (m.indicesView[i] < lo || m.indicesView[i] >= hi) {
          fail2("OutOfRange", fileName + ":\u7B2C " + f + " \u5F20\u9762\u6709\u7D22\u5F15\u6307\u5230\u4E86\u672C\u9762\u9876\u70B9\u6BB5\u4E4B\u5916", fileName);
        }
      }
    }
    if (nextVertex !== m.vertexCountValue || nextIndex !== m.indexCountValue)
      fail2("OutOfRange", fileName + ":\u9762\u8868\u6CA1\u6709\u8986\u76D6\u5168\u90E8\u9876\u70B9\u6216\u7D22\u5F15", fileName);
    return m;
  }
  lod() {
    return this.lodValue;
  }
  faceCount() {
    return this.faceCountValue;
  }
  vertexCount() {
    return this.vertexCountValue;
  }
  indexCount() {
    return this.indexCountValue;
  }
  triangleCount() {
    return this.indexCountValue / 3 | 0;
  }
  faceRange(f) {
    const o = f * 4;
    return {
      vertexOffset: this.facesView[o],
      vertexCount: this.facesView[o + 1],
      indexOffset: this.facesView[o + 2],
      indexCount: this.facesView[o + 3]
    };
  }
  faces() {
    return this.facesView;
  }
  positions() {
    return this.positionsView;
  }
  normals() {
    return this.normalsView;
  }
  indices() {
    return this.indicesView;
  }
  faceArea(face) {
    const r = this.faceRange(face);
    const pos = this.positionsView, idx = this.indicesView;
    let total = 0;
    for (let i = r.indexOffset; i + 2 < r.indexOffset + r.indexCount; i += 3) {
      const a = idx[i] * 3, b = idx[i + 1] * 3, c = idx[i + 2] * 3;
      const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
      const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      total += 0.5 * Math.sqrt(nx * nx + ny * ny + nz * nz);
    }
    return total;
  }
  faceOfTriangle(triangle) {
    const indexPos = triangle * 3;
    let lo = 0, hi = this.faceCountValue;
    while (lo < hi) {
      const mid = lo + hi >> 1;
      if (this.facesView[mid * 4 + 2] > indexPos) hi = mid;
      else lo = mid + 1;
    }
    return lo - 1;
  }
};
var Edges = class _Edges {
  raw;
  edgeCountValue = 0;
  pointCountValue = 0;
  edgesView;
  pointsView;
  constructor(raw) {
    this.raw = raw;
  }
  static parse(input, faceCount, fileName) {
    const raw = ownBuffer(input);
    checkHeader(raw, "CMGE", fileName);
    const e = new _Edges(raw);
    e.edgeCountValue = u32(raw, 8);
    e.pointCountValue = u32(raw, 12);
    const expected = HEADER_SIZE + e.edgeCountValue * 16 + e.pointCountValue * 12;
    if (expected !== raw.length) {
      fail2("BadLength", fileName + ":\u6587\u4EF6\u957F " + raw.length + " \u5B57\u8282,\u6309\u5934\u91CC\u7684\u8BA1\u6570\u5E94\u4E3A " + expected, fileName);
    }
    e.edgesView = new Uint32Array(raw.buffer, HEADER_SIZE, e.edgeCountValue * 4);
    e.pointsView = new Float32Array(raw.buffer, HEADER_SIZE + e.edgeCountValue * 16, e.pointCountValue * 3);
    for (let i = 0; i < e.edgeCountValue; ++i) {
      const o = i * 4;
      const faceA = e.edgesView[o], faceB = e.edgesView[o + 1];
      const pointOffset = e.edgesView[o + 2], pointCount = e.edgesView[o + 3];
      if (pointOffset + pointCount > e.pointCountValue)
        fail2("OutOfRange", fileName + ":\u7B2C " + i + " \u6761\u8FB9\u7684\u6298\u7EBF\u70B9\u6BB5\u8D8A\u754C", fileName);
      if (faceA !== NO_FACE && faceA >= faceCount || faceB !== NO_FACE && faceB >= faceCount) {
        fail2("OutOfRange", fileName + ":\u7B2C " + i + " \u6761\u8FB9\u5F15\u7528\u7684\u9762\u5E8F\u53F7\u8D85\u51FA\u9762\u6570 " + faceCount, fileName);
      }
    }
    return e;
  }
  edgeCount() {
    return this.edgeCountValue;
  }
  pointCount() {
    return this.pointCountValue;
  }
  edges() {
    return this.edgesView;
  }
  points() {
    return this.pointsView;
  }
  edgeRange(i) {
    const o = i * 4;
    return {
      faceA: this.edgesView[o],
      faceB: this.edgesView[o + 1],
      pointOffset: this.edgesView[o + 2],
      pointCount: this.edgesView[o + 3]
    };
  }
  segmentCount() {
    let total = 0;
    for (let i = 0; i < this.edgeCountValue; ++i) {
      const c = this.edgesView[i * 4 + 3];
      total += c > 1 ? c - 1 : 0;
    }
    return total;
  }
  edgeLength(edge) {
    const r = this.edgeRange(edge);
    const pts = this.pointsView;
    let total = 0;
    for (let i = 1; i < r.pointCount; ++i) {
      const a = (r.pointOffset + i - 1) * 3, b = (r.pointOffset + i) * 3;
      const dx = pts[b] - pts[a], dy = pts[b + 1] - pts[a + 1], dz = pts[b + 2] - pts[a + 2];
      total += Math.sqrt(dx * dx + dy * dy + dz * dz);
    }
    return total;
  }
};

// ui-model-viewer/src/core/camera.ts
var Projection = { Orthographic: 0, Perspective: 1 };
var StandardView = { Iso: 0, Top: 1, Bottom: 2, Front: 3, Back: 4, Right: 5, Left: 6 };
var PI = 3.141592653589793;
var HALF_PI = PI / 2;
var ORBIT_RADIANS_PER_PIXEL = 75e-4;
var MIN_DISTANCE = 1e-3;
var MAX_DISTANCE = 1e7;
var FOV_Y = 0.6108652381980153;
var OrbitCamera = class {
  targetValue = v3();
  distanceValue = 500;
  yawValue = -0.7853981633974483;
  // −45°
  pitchValue = 0.6154797086703873;
  // 35.26°,等轴测
  projectionValue = Projection.Orthographic;
  scene = { min: v3(-100, -100, -100), max: v3(100, 100, 100) };
  target() {
    return this.targetValue;
  }
  distance() {
    return this.distanceValue;
  }
  yaw() {
    return this.yawValue;
  }
  pitch() {
    return this.pitchValue;
  }
  projection() {
    return this.projectionValue;
  }
  setProjection(p) {
    this.projectionValue = p;
  }
  setTarget(t) {
    this.targetValue = t;
  }
  setSceneBounds(b) {
    this.scene = b;
  }
  sceneBounds() {
    return this.scene;
  }
  setDistance(d) {
    this.distanceValue = Math.min(Math.max(d, MIN_DISTANCE), MAX_DISTANCE);
  }
  setAngles(yaw, pitch) {
    this.yawValue = MathRemainder(yaw, 2 * PI);
    this.pitchValue = Math.min(Math.max(pitch, -HALF_PI), HALF_PI);
  }
  backward() {
    return v3(
      Math.cos(this.pitchValue) * Math.cos(this.yawValue),
      Math.cos(this.pitchValue) * Math.sin(this.yawValue),
      Math.sin(this.pitchValue)
    );
  }
  right() {
    return v3(-Math.sin(this.yawValue), Math.cos(this.yawValue), 0);
  }
  up() {
    return v3(
      -Math.sin(this.pitchValue) * Math.cos(this.yawValue),
      -Math.sin(this.pitchValue) * Math.sin(this.yawValue),
      Math.cos(this.pitchValue)
    );
  }
  eye() {
    return add(this.targetValue, scale(this.backward(), this.distanceValue));
  }
  viewMatrix() {
    const r = this.right(), u = this.up(), b = this.backward(), e = this.eye();
    const v = new Mat4();
    v.set(0, 0, r.x);
    v.set(0, 1, r.y);
    v.set(0, 2, r.z);
    v.set(0, 3, -dot(r, e));
    v.set(1, 0, u.x);
    v.set(1, 1, u.y);
    v.set(1, 2, u.z);
    v.set(1, 3, -dot(u, e));
    v.set(2, 0, b.x);
    v.set(2, 1, b.y);
    v.set(2, 2, b.z);
    v.set(2, 3, -dot(b, e));
    return v;
  }
  halfHeightAtTarget() {
    return this.distanceValue * Math.tan(FOV_Y / 2);
  }
  nearFar() {
    const radius = Math.max(boxRadius(this.scene), 1e-6) * 1.05;
    const centerDepth = dot(sub(this.eye(), boxCenter(this.scene)), this.backward());
    let n = centerDepth - radius;
    let f = centerDepth + radius;
    if (this.projectionValue === Projection.Perspective) {
      f = Math.max(f, 1e-3);
      n = Math.max(n, f * 1e-4);
    }
    return [n, f];
  }
  projectionMatrix(aspect) {
    const [n, f] = this.nearFar();
    if (this.projectionValue === Projection.Perspective)
      return Mat4.perspective(FOV_Y, aspect, n, f);
    const hh = this.halfHeightAtTarget();
    return Mat4.orthographic(hh * aspect, hh, n, f);
  }
  viewProjection(aspect) {
    return this.projectionMatrix(aspect).mul(this.viewMatrix());
  }
  orbit(dxPixels, dyPixels) {
    this.setAngles(
      this.yawValue - dxPixels * ORBIT_RADIANS_PER_PIXEL,
      this.pitchValue + dyPixels * ORBIT_RADIANS_PER_PIXEL
    );
  }
  pan(dxPixels, dyPixels, viewportHeight) {
    if (viewportHeight <= 0)
      return;
    const unitsPerPixel = 2 * this.halfHeightAtTarget() / viewportHeight;
    this.targetValue = add(
      sub(this.targetValue, scale(this.right(), dxPixels * unitsPerPixel)),
      scale(this.up(), dyPixels * unitsPerPixel)
    );
  }
  zoom(factor, ndcX = 0, ndcY = 0, aspect = 1) {
    if (!(factor > 0))
      return;
    const before = this.halfHeightAtTarget();
    this.setDistance(this.distanceValue * factor);
    const after = this.halfHeightAtTarget();
    const shift = before - after;
    this.targetValue = add(
      this.targetValue,
      add(scale(this.right(), ndcX * aspect * shift), scale(this.up(), ndcY * shift))
    );
  }
  fit(aspect) {
    this.targetValue = boxCenter(this.scene);
    const r = this.right(), u = this.up(), b = this.backward();
    const tanHalf = Math.tan(FOV_Y / 2);
    const margin = 1.08;
    let need = 0;
    for (let i = 0; i < 8; ++i) {
      const corner = v3(
        i & 1 ? this.scene.max.x : this.scene.min.x,
        i & 2 ? this.scene.max.y : this.scene.min.y,
        i & 4 ? this.scene.max.z : this.scene.min.z
      );
      const rel = sub(corner, this.targetValue);
      const x = Math.abs(dot(rel, r)) * margin;
      const y = Math.abs(dot(rel, u)) * margin;
      const lateral = Math.max(x / (tanHalf * aspect), y / tanHalf);
      const depth = this.projectionValue === Projection.Perspective ? dot(rel, b) : 0;
      need = Math.max(need, lateral + depth);
    }
    this.setDistance(Math.max(need, 1e-3));
  }
  setStandardView(view) {
    switch (view) {
      case StandardView.Iso:
        this.setAngles(-PI / 4, 0.6154797086703873);
        break;
      case StandardView.Top:
        this.setAngles(-HALF_PI, HALF_PI);
        break;
      case StandardView.Bottom:
        this.setAngles(-HALF_PI, -HALF_PI);
        break;
      case StandardView.Front:
        this.setAngles(-HALF_PI, 0);
        break;
      case StandardView.Back:
        this.setAngles(HALF_PI, 0);
        break;
      case StandardView.Right:
        this.setAngles(0, 0);
        break;
      case StandardView.Left:
        this.setAngles(PI, 0);
        break;
    }
  }
};
function MathRemainder(x, y) {
  const q = x / y;
  let n = Math.round(q);
  if (Math.abs(q - n) === 0.5)
    n = 2 * Math.round(q / 2);
  return x - n * y;
}

// ui-model-viewer/src/core/pick.ts
var kPickSegmentFlag = 2147483648;
var kPickRegion = 9;
var PickKind = { None: 0, Face: 1, Segment: 2 };
function faceToPickId(faceIndex) {
  return faceIndex + 1 >>> 0;
}
function segmentToPickId(segment) {
  return (kPickSegmentFlag | segment) >>> 0;
}
function decodePickId(id) {
  if (id === 0)
    return { kind: PickKind.None, index: 0 };
  if (id & kPickSegmentFlag)
    return { kind: PickKind.Segment, index: (id & ~kPickSegmentFlag) >>> 0 };
  return { kind: PickKind.Face, index: id - 1 };
}
function pickMatrix(viewportWidth, viewportHeight, px, py, n = kPickRegion) {
  const sx = viewportWidth / n;
  const sy = viewportHeight / n;
  const cx = 2 * (px + 0.5) / viewportWidth - 1;
  const cy = 1 - 2 * (py + 0.5) / viewportHeight;
  return Mat4.translation(v3(-cx * sx, -cy * sy, 0)).mul(Mat4.scaling(sx, sy, 1));
}
function resolvePickRegion(rgba, n = kPickRegion) {
  if (rgba.length < n * n * 4)
    return { kind: PickKind.None, index: 0 };
  const idAt = (x, y) => rgba[(y * n + x) * 4] | rgba[(y * n + x) * 4 + 1] << 8 | rgba[(y * n + x) * 4 + 2] << 16 | rgba[(y * n + x) * 4 + 3] * 16777216;
  const c = n / 2 | 0;
  let bestDist = Number.MAX_SAFE_INTEGER;
  let bestSegment = 0;
  for (let y = 0; y < n; ++y) {
    for (let x = 0; x < n; ++x) {
      const id = idAt(x, y);
      if (!(id & kPickSegmentFlag))
        continue;
      const d = (x - c) * (x - c) + (y - c) * (y - c);
      if (d < bestDist) {
        bestDist = d;
        bestSegment = id;
      }
    }
  }
  if (bestDist !== Number.MAX_SAFE_INTEGER)
    return decodePickId(bestSegment);
  return decodePickId(idAt(c, c));
}

// ui-model-viewer/src/core/buffers.ts
function paintFace(colors, mesh, face, color) {
  if (face >= mesh.faceCount())
    return { offset: 0, size: 0 };
  const r = mesh.faceRange(face);
  const base2 = r.vertexOffset * 4;
  for (let v = 0; v < r.vertexCount; ++v) {
    const o = base2 + v * 4;
    colors[o] = color[0];
    colors[o + 1] = color[1];
    colors[o + 2] = color[2];
    colors[o + 3] = color[3];
  }
  return { offset: base2, size: r.vertexCount * 4 };
}
function buildFaceIdAttribute(mesh) {
  const ids = new Uint8Array(mesh.vertexCount() * 4);
  const dv = new DataView(ids.buffer);
  for (let f = 0; f < mesh.faceCount(); ++f) {
    const r = mesh.faceRange(f);
    const id = faceToPickId(f);
    for (let v = 0; v < r.vertexCount; ++v)
      dv.setUint32((r.vertexOffset + v) * 4, id, true);
  }
  return ids;
}
function buildFaceColorAttribute(mesh, faceInfos) {
  const colors = new Uint8Array(mesh.vertexCount() * 4);
  for (let f = 0; f < mesh.faceCount(); ++f) {
    const r = mesh.faceRange(f);
    let r0 = 180, g0 = 180, b0 = 180, a0 = 255;
    if (f < faceInfos.length) {
      const c = faceInfos[f];
      r0 = c.rgb[0];
      g0 = c.rgb[1];
      b0 = c.rgb[2];
      a0 = c.opacity;
    }
    for (let v = 0; v < r.vertexCount; ++v) {
      const o = (r.vertexOffset + v) * 4;
      colors[o] = r0;
      colors[o + 1] = g0;
      colors[o + 2] = b0;
      colors[o + 3] = a0;
    }
  }
  return colors;
}
function buildEdgeLineIndices(edges) {
  const indices = new Uint32Array(edges.segmentCount() * 2);
  let out = 0;
  const e = edges.edges();
  for (let i = 0; i < edges.edgeCount(); ++i) {
    const pointOffset = e[i * 4 + 2], pointCount = e[i * 4 + 3];
    for (let k = 1; k < pointCount; ++k) {
      indices[out++] = pointOffset + k - 1;
      indices[out++] = pointOffset + k;
    }
  }
  return indices;
}
function meshBounds(mesh) {
  const pos = mesh.positions();
  if (pos.length === 0)
    return { min: v3(-1, -1, -1), max: v3(1, 1, 1) };
  let lox = Infinity, loy = Infinity, loz = Infinity;
  let hix = -Infinity, hiy = -Infinity, hiz = -Infinity;
  for (let i = 0; i + 2 < pos.length; i += 3) {
    lox = Math.min(lox, pos[i]);
    hix = Math.max(hix, pos[i]);
    loy = Math.min(loy, pos[i + 1]);
    hiy = Math.max(hiy, pos[i + 1]);
    loz = Math.min(loz, pos[i + 2]);
    hiz = Math.max(hiz, pos[i + 2]);
  }
  return { min: { x: lox, y: loy, z: loz }, max: { x: hix, y: hiy, z: hiz } };
}

// ui-model-viewer/src/core/select/selection.ts
function emptyChange() {
  return { added: [], removed: [] };
}
function changeIsEmpty(c) {
  return c.added.length === 0 && c.removed.length === 0;
}
var SelectionModel = class {
  types = [];
  filter = /* @__PURE__ */ new Set();
  selected = [];
  order = [];
  // 换零件:给出每张面的曲面类型(下标 = 面序号)。清空选择集与过滤条件。
  reset(surfaceTypes) {
    this.types = surfaceTypes;
    this.filter = /* @__PURE__ */ new Set();
    this.selected = new Array(surfaceTypes.length).fill(false);
    this.order = [];
  }
  faceCount() {
    return this.types.length;
  }
  // 类型过滤:只有这些类型的面可以被选中;空集 = 不过滤。
  // 已选中但不再符合过滤条件的面会被移出选择集。
  setTypeFilter(allowed) {
    this.filter = allowed;
    const change = emptyChange();
    const current = [...this.order];
    for (const face of current) {
      if (!this.isSelectable(face))
        this.remove(face, change);
    }
    return change;
  }
  typeFilter() {
    return [...this.filter].sort();
  }
  isSelectable(face) {
    if (face >= this.types.length)
      return false;
    return this.filter.size === 0 || this.filter.has(this.types[face]);
  }
  // 这个零件里出现过的全部曲面类型(去重、按字典序)。
  availableTypes() {
    return [...new Set(this.types)].sort();
  }
  click(face, mode) {
    const change = emptyChange();
    const valid = face !== null && this.isSelectable(face);
    if (mode === "toggle") {
      if (!valid)
        return change;
      if (this.selected[face])
        this.remove(face, change);
      else
        this.add(face, change);
      return change;
    }
    const current = [...this.order];
    for (const f of current) {
      if (!valid || f !== face)
        this.remove(f, change);
    }
    if (valid)
      this.add(face, change);
    return change;
  }
  // 直接指定选择集(不可选的面与越界的面序号被忽略)。
  setSelection(faces) {
    const change = emptyChange();
    const wanted = new Array(this.types.length).fill(false);
    for (const f of faces) {
      if (this.isSelectable(f))
        wanted[f] = true;
    }
    const current = [...this.order];
    for (const f of current) {
      if (!wanted[f])
        this.remove(f, change);
    }
    for (const f of faces) {
      if (f < wanted.length && wanted[f])
        this.add(f, change);
    }
    return change;
  }
  clear() {
    const change = emptyChange();
    change.removed = [...this.order];
    this.order = [];
    this.selected.fill(false);
    return change;
  }
  isSelected(face) {
    return face < this.selected.length && this.selected[face];
  }
  // 按选中的先后顺序。
  selection() {
    return this.order;
  }
  add(face, change) {
    if (this.selected[face])
      return;
    this.selected[face] = true;
    this.order.push(face);
    change.added.push(face);
  }
  remove(face, change) {
    if (!this.selected[face])
      return;
    this.selected[face] = false;
    const i = this.order.indexOf(face);
    if (i >= 0)
      this.order.splice(i, 1);
    change.removed.push(face);
  }
};

// ui-model-viewer/src/core/nc/parser.ts
var WORD_RE = /([A-Za-z])\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)/g;
var CANNED_CYCLES = {
  73: "\u9AD8\u901F\u5544\u94BB",
  74: "\u5DE6\u65CB\u653B\u4E1D",
  76: "\u7CBE\u9557",
  81: "\u94BB\u5B54",
  82: "\u952A\u5B54",
  83: "\u5544\u94BB",
  84: "\u653B\u4E1D",
  85: "\u9557\u5B54",
  86: "\u9557\u5B54",
  87: "\u80CC\u9557",
  88: "\u9557\u5B54",
  89: "\u9557\u5B54"
};
function isG(g, code) {
  return Math.abs(g - code) < 0.01;
}
var PLANES = {
  17: { u: 0, v: 1, n: 2, ou: "I", ov: "J" },
  18: { u: 2, v: 0, n: 1, ou: "K", ov: "I" },
  19: { u: 1, v: 2, n: 0, ou: "J", ov: "K" }
};
var TAU = Math.PI * 2;
var TAP_OR_BORE_FEED_OUT = /* @__PURE__ */ new Set([74, 84, 85, 89]);
var SIMPLE_BORE = /* @__PURE__ */ new Set([76, 87, 88]);
function parseNc(text, options = {}) {
  const segmentCap = options.segmentCap ?? 1e6;
  const segments = [];
  const cycles = [];
  const skipped = [];
  const warnings = [];
  const tools = [];
  let program = null;
  let truncated = false;
  let min = null;
  let max = null;
  const stats = { rapid: 0, feed: 0, arc: 0, cycle: 0, skipped: 0 };
  let pos = [0, 0, 0];
  let motion = null;
  let plane = 17;
  let absolute = true;
  let units = "mm";
  let returnInitial = true;
  let canned = null;
  let cannedInitialZ = 0;
  let feed = null;
  let spindle = null;
  let pendingTool = null;
  let warnedS0 = false;
  let warnedCyclePlane = false;
  let warnedSimpleCycle = false;
  function warn(message) {
    if (warnings.length < 200) warnings.push(message);
  }
  function growBounds(p) {
    if (!min || !max) {
      min = [...p];
      max = [...p];
      return;
    }
    for (let i = 0; i < 3; i++) {
      if (p[i] < min[i]) min[i] = p[i];
      if (p[i] > max[i]) max[i] = p[i];
    }
  }
  function pushSegment(from, to, kind, line) {
    if (truncated) return;
    if (from[0] === to[0] && from[1] === to[1] && from[2] === to[2]) return;
    if (segments.length >= segmentCap) {
      truncated = true;
      warn(`\u8F68\u8FF9\u6BB5\u6570\u8FBE\u5230\u4E0A\u9650 ${segmentCap}\uFF0C\u663E\u793A\u5DF2\u622A\u65AD`);
      return;
    }
    segments.push({ from: [...from], to: [...to], kind, line, feed: kind === "rapid" ? null : feed });
    stats[kind] += 1;
    growBounds(from);
    growBounds(to);
  }
  function targetPoint(params) {
    const next = [...pos];
    for (const [axis, letter] of [[0, "X"], [1, "Y"], [2, "Z"]]) {
      const value = params[letter];
      if (value === void 0) continue;
      next[axis] = absolute ? value : pos[axis] + value;
    }
    return next;
  }
  function hasAxisWord(params) {
    return params.X !== void 0 || params.Y !== void 0 || params.Z !== void 0;
  }
  function emitArc(cw, params, line) {
    const frame = PLANES[plane];
    const end = targetPoint(params);
    const start = pos;
    const su = start[frame.u];
    const sv = start[frame.v];
    const eu = end[frame.u];
    const ev = end[frame.v];
    let cu;
    let cv;
    if (params.R !== void 0) {
      const r = Math.abs(params.R);
      const dx = eu - su;
      const dy = ev - sv;
      const chord = Math.hypot(dx, dy);
      if (chord === 0) {
        warn(`\u7B2C ${line} \u884C\uFF1AR \u5706\u5F27\u5F26\u957F\u4E3A 0\uFF0C\u6574\u5706\u8BF7\u7528 IJK`);
        return false;
      }
      if (r < chord / 2 - 1e-9) {
        warn(`\u7B2C ${line} \u884C\uFF1A\u5706\u5F27\u534A\u5F84 ${r} \u5C0F\u4E8E\u534A\u5F26 ${chord / 2}\uFF0C\u5DF2\u94B3\u5236`);
      }
      const h3 = Math.sqrt(Math.max(0, r * r - (chord / 2) ** 2));
      const mx = (su + eu) / 2;
      const my = (sv + ev) / 2;
      const lx = -dy / chord;
      const ly = dx / chord;
      const sign = (cw ? -1 : 1) * (params.R >= 0 ? 1 : -1);
      cu = mx + sign * h3 * lx;
      cv = my + sign * h3 * ly;
    } else {
      const ou = params[frame.ou] ?? 0;
      const ov = params[frame.ov] ?? 0;
      if (ou === 0 && ov === 0) {
        warn(`\u7B2C ${line} \u884C\uFF1A\u5706\u5F27\u7F3A\u5C11 IJK \u5706\u5FC3\u6216 R\uFF0C\u5DF2\u8DF3\u8FC7`);
        return false;
      }
      cu = su + ou;
      cv = sv + ov;
    }
    const radius = Math.hypot(su - cu, sv - cv);
    if (radius < 1e-9) {
      warn(`\u7B2C ${line} \u884C\uFF1A\u96F6\u534A\u5F84\u5706\u5F27\uFF0C\u5DF2\u8DF3\u8FC7`);
      return false;
    }
    const a0 = Math.atan2(sv - cv, su - cu);
    let a1 = Math.atan2(ev - cv, eu - cu);
    const fullCircle = su === eu && sv === ev && params.R === void 0;
    let sweep;
    if (fullCircle) {
      sweep = cw ? -TAU : TAU;
    } else if (cw) {
      while (a1 >= a0) a1 -= TAU;
      sweep = a1 - a0;
    } else {
      while (a1 <= a0) a1 += TAU;
      sweep = a1 - a0;
    }
    const step = Math.min(Math.PI / 6, Math.max(Math.PI / 45, 2 * Math.acos(Math.max(-1, Math.min(1, 1 - 0.05 / radius)))));
    const steps = Math.min(720, Math.max(4, Math.ceil(Math.abs(sweep) / step)));
    const n0 = start[frame.n];
    const dn = end[frame.n] - n0;
    let prev = start;
    for (let i = 1; i <= steps; i++) {
      const angle = a0 + sweep * i / steps;
      const p = [...start];
      p[frame.u] = cu + radius * Math.cos(angle);
      p[frame.v] = cv + radius * Math.sin(angle);
      p[frame.n] = n0 + dn * i / steps;
      pushSegment(prev, p, "arc", line);
      prev = p;
    }
    pos = end;
    return true;
  }
  function emitCanned(params, line) {
    const next = targetPoint(params);
    const tx = next[0];
    const ty = next[1];
    let rPlane;
    let zDepth;
    if (absolute) {
      rPlane = canned.r ?? pos[2];
      zDepth = canned.z ?? pos[2];
    } else {
      rPlane = cannedInitialZ + (canned.r ?? 0);
      zDepth = rPlane + (canned.z ?? 0);
    }
    const code = canned.code;
    cycles.push({
      code,
      label: CANNED_CYCLES[code] ?? `G${code}`,
      at: [tx, ty],
      r: rPlane,
      z: zDepth,
      line
    });
    if (plane !== 17 && !warnedCyclePlane) {
      warnedCyclePlane = true;
      warn(`\u7B2C ${line} \u884C\uFF1A\u56FA\u5B9A\u5FAA\u73AF\u5728 G${plane} \u5E73\u9762\u6309 XY \u5B54\u4F4D\u5C55\u5F00\uFF0C\u8BF7\u590D\u6838`);
    }
    if (tx !== pos[0] || ty !== pos[1]) {
      pushSegment(pos, [tx, ty, pos[2]], "rapid", line);
      pos = [tx, ty, pos[2]];
    }
    const retractZ = returnInitial ? cannedInitialZ : rPlane;
    if (SIMPLE_BORE.has(code)) {
      if (!warnedSimpleCycle) {
        warnedSimpleCycle = true;
        warn(`G${code} ${CANNED_CYCLES[code]}\u6309 R\u2192Z \u7B80\u5316\u663E\u793A\uFF0C\u9557\u5B54\u5B50\u6B65\u672A\u5C55\u5F00`);
      }
      if (pos[2] !== rPlane) {
        pushSegment(pos, [tx, ty, rPlane], "rapid", line);
        pos = [tx, ty, rPlane];
      }
      pushSegment([tx, ty, rPlane], [tx, ty, zDepth], "cycle", line);
      if (zDepth !== retractZ) pushSegment([tx, ty, zDepth], [tx, ty, retractZ], "rapid", line);
      pos = [tx, ty, retractZ];
      return;
    }
    if (pos[2] !== rPlane) {
      pushSegment(pos, [tx, ty, rPlane], "rapid", line);
      pos = [tx, ty, rPlane];
    }
    const q = Math.abs(canned.q ?? 0);
    const pecking = (code === 83 || code === 73) && q > 0 && rPlane !== zDepth;
    if (pecking) {
      const down = rPlane > zDepth;
      let zc = rPlane;
      let peckAt = rPlane;
      let guard = 0;
      while (guard < 1e4) {
        guard += 1;
        const zn = down ? Math.max(peckAt - q, zDepth) : Math.min(peckAt + q, zDepth);
        pushSegment([tx, ty, zc], [tx, ty, zn], "cycle", line);
        pos = [tx, ty, zn];
        peckAt = zn;
        if (Math.abs(zn - zDepth) < 1e-9) break;
        if (code === 83) {
          pushSegment([tx, ty, zn], [tx, ty, rPlane], "rapid", line);
          zc = rPlane;
        } else {
          const up = down ? Math.min(zn + 1, rPlane) : Math.max(zn - 1, rPlane);
          pushSegment([tx, ty, zn], [tx, ty, up], "rapid", line);
          zc = up;
        }
      }
    } else {
      pushSegment([tx, ty, rPlane], [tx, ty, zDepth], "cycle", line);
      pos = [tx, ty, zDepth];
    }
    if (pos[2] !== retractZ) {
      const kind = TAP_OR_BORE_FEED_OUT.has(code) ? "cycle" : "rapid";
      pushSegment(pos, [tx, ty, retractZ], kind, line);
    }
    pos = [tx, ty, retractZ];
  }
  function handleLine(rawText, lineNo) {
    let line = rawText.replace(/\r/g, "");
    let stripped = "";
    let depth = 0;
    for (const ch of line) {
      if (ch === "(") {
        depth += 1;
        if (depth > 1) {
          skipped.push({ line: lineNo, text: line.trim().slice(0, 120), reason: "nested comment" });
          stats.skipped += 1;
          return;
        }
        continue;
      }
      if (ch === ")") {
        if (depth === 0) {
          skipped.push({ line: lineNo, text: line.trim().slice(0, 120), reason: "unmatched )" });
          stats.skipped += 1;
          return;
        }
        depth = 0;
        continue;
      }
      if (ch === ";" && depth === 0) break;
      if (depth === 0) stripped += ch;
    }
    if (depth !== 0) {
      skipped.push({ line: lineNo, text: line.trim().slice(0, 120), reason: "unterminated comment" });
      stats.skipped += 1;
      return;
    }
    line = stripped.trim();
    if (line === "" || line === "%") return;
    if (line.startsWith("/")) line = line.replace(/^\/+\s*/, "");
    const words = [];
    let covered = 0;
    for (const match of line.matchAll(WORD_RE)) {
      const gap = line.slice(covered, match.index);
      if (gap.trim() !== "") {
        skipped.push({
          line: lineNo,
          text: line.trim().slice(0, 120),
          reason: `stray characters ${JSON.stringify(gap.trim())}`
        });
        stats.skipped += 1;
        return;
      }
      covered = match.index + match[0].length;
      words.push([match[1].toUpperCase(), Number.parseFloat(match[2])]);
    }
    if (line.slice(covered).trim() !== "") {
      skipped.push({
        line: lineNo,
        text: line.trim().slice(0, 120),
        reason: `stray characters ${JSON.stringify(line.slice(covered).trim())}`
      });
      stats.skipped += 1;
      return;
    }
    if (words.length === 0) return;
    const gCodes = [];
    const mCodes = [];
    const params = {};
    for (const [letter, value] of words) {
      if (letter === "G") gCodes.push(value);
      else if (letter === "M") mCodes.push(value);
      else if (letter === "N") continue;
      else if (letter === "O") {
        program = program ?? String(Math.trunc(value));
      } else params[letter] = value;
    }
    let motionHere = null;
    let cannedHere = null;
    let refReturn = false;
    for (const g of gCodes) {
      if (isG(g, 17)) plane = 17;
      else if (isG(g, 18)) plane = 18;
      else if (isG(g, 19)) plane = 19;
      else if (isG(g, 20)) {
        if (units !== "inch") warn(`\u7B2C ${lineNo} \u884C\uFF1AG20 \u82F1\u5236\u6309\u6587\u4EF6\u6570\u503C\u7ED8\u5236\uFF0C\u672A\u6362\u7B97\u6BEB\u7C73`);
        units = "inch";
      } else if (isG(g, 21)) units = "mm";
      else if (isG(g, 90)) absolute = true;
      else if (isG(g, 91)) absolute = false;
      else if (isG(g, 90.1)) warn(`\u7B2C ${lineNo} \u884C\uFF1AG90.1 \u7EDD\u5BF9\u5706\u5FC3\u4E0D\u652F\u6301\uFF0CIJK \u4ECD\u6309\u589E\u91CF\u5904\u7406`);
      else if (isG(g, 98)) returnInitial = true;
      else if (isG(g, 99)) returnInitial = false;
      else if (isG(g, 80)) canned = null;
      else if (isG(g, 28) || isG(g, 30)) refReturn = true;
      else if (isG(g, 0) || isG(g, 1) || isG(g, 2) || isG(g, 3)) motionHere = Math.trunc(g);
      else if (CANNED_CYCLES[Math.trunc(g)] !== void 0 && Math.abs(g - Math.trunc(g)) < 0.01) cannedHere = Math.trunc(g);
    }
    if (params.F !== void 0) feed = params.F;
    if (params.S !== void 0) {
      spindle = params.S;
      if (params.S === 0 && !warnedS0) {
        warnedS0 = true;
        warn(`\u7B2C ${lineNo} \u884C\uFF1AS0 \u4E3B\u8F74\u8F6C\u901F\u4E3A 0\uFF0C\u5FC5\u987B\u56DE\u5230 NC \u590D\u6838`);
      }
    }
    if (params.T !== void 0) pendingTool = params.T;
    if (mCodes.some((m) => Math.trunc(m) === 6) && pendingTool !== null) {
      tools.push(pendingTool);
      pendingTool = null;
    }
    if (refReturn) {
      if (hasAxisWord(params)) {
        const next2 = targetPoint(params);
        pushSegment(pos, next2, "rapid", lineNo);
        pos = next2;
      }
      return;
    }
    if (motionHere !== null) {
      motion = motionHere;
      canned = null;
    }
    if (cannedHere !== null) {
      canned = {
        code: cannedHere,
        z: params.Z,
        r: params.R,
        q: params.Q,
        p: params.P,
        f: params.F ?? feed
      };
      cannedInitialZ = pos[2];
      emitCanned(params, lineNo);
      return;
    }
    if (canned !== null && motionHere === null) {
      if (params.Q !== void 0) canned.q = params.Q;
      if (params.P !== void 0) canned.p = params.P;
      if (params.X !== void 0 || params.Y !== void 0) {
        emitCanned(params, lineNo);
        return;
      }
      if (params.Z !== void 0 || params.R !== void 0) {
        if (params.Z !== void 0) canned.z = params.Z;
        if (params.R !== void 0) canned.r = params.R;
        return;
      }
    }
    if (!hasAxisWord(params)) return;
    if (motion === null) {
      skipped.push({
        line: lineNo,
        text: rawText.trim().slice(0, 120),
        reason: "axis words without an active motion mode"
      });
      stats.skipped += 1;
      return;
    }
    const next = targetPoint(params);
    if (motion === 0) {
      pushSegment(pos, next, "rapid", lineNo);
      pos = next;
    } else if (motion === 1) {
      pushSegment(pos, next, "feed", lineNo);
      pos = next;
    } else {
      emitArc(motion === 2, params, lineNo);
    }
  }
  const lines = String(text ?? "").split("\n");
  for (let i = 0; i < lines.length; i++) {
    try {
      handleLine(lines[i], i + 1);
    } catch (error) {
      skipped.push({
        line: i + 1,
        text: lines[i].trim().slice(0, 120),
        reason: `parser error: ${error instanceof Error ? error.message : String(error)}`
      });
      stats.skipped += 1;
    }
  }
  return {
    meta: {
      program,
      units,
      tools,
      lines: lines.length,
      skipped,
      warnings,
      truncated,
      feed,
      spindle
    },
    segments,
    cycles,
    bounds: min && max ? { min, max } : null,
    stats
  };
}

// ui-model-viewer/src/core/nc/toolpath.ts
function defaultToolpathColors() {
  return {
    rapid: [110, 150, 235, 255],
    feed: [70, 210, 120, 255],
    arc: [60, 200, 215, 255],
    cycle: [240, 180, 60, 255]
  };
}
function buildToolpathBuffers(parsed, colors = defaultToolpathColors()) {
  const n = parsed.segments.length;
  const positions = new Float32Array(n * 6);
  const outColors = new Uint8Array(n * 8);
  const lines = [];
  for (let i = 0; i < n; ++i) {
    const s = parsed.segments[i];
    for (const [v, p] of [[0, s.from], [1, s.to]]) {
      positions[i * 6 + v * 3 + 0] = p[0];
      positions[i * 6 + v * 3 + 1] = p[1];
      positions[i * 6 + v * 3 + 2] = p[2];
    }
    const c = s.kind === "feed" ? colors.feed : s.kind === "arc" ? colors.arc : s.kind === "cycle" ? colors.cycle : colors.rapid;
    for (let v = 0; v < 2; ++v) {
      const o = i * 8 + v * 4;
      outColors[o] = c[0];
      outColors[o + 1] = c[1];
      outColors[o + 2] = c[2];
      outColors[o + 3] = c[3];
    }
    lines.push(s.line);
  }
  return { positions, colors: outColors, lines };
}

// ui-model-viewer/src/viewer/shaders.ts
var MESH_VERT = `#version 300 es
// \u96F6\u4EF6\u7F51\u683C\u3002\u4F4D\u7F6E\u3001\u6CD5\u7EBF\u76F4\u63A5\u6765\u81EA\u51E0\u4F55\u5305;\u989C\u8272\u662F\u9010\u9876\u70B9\u7684(\u9AD8\u4EAE\u53EA\u6539\u67D0\u5F20\u9762\u90A3\u4E00\u6BB5)\u3002
layout(std140) uniform Ubuf {
    mat4 mvp;
    mat4 mvpLine;   // \u540C\u4E00\u4E2A\u53D8\u6362,\u6DF1\u5EA6\u5F80\u76F8\u673A\u65B9\u5411\u504F\u4E00\u70B9:\u7ED9\u8FB9\u7EBF\u7528,\u514D\u5F97\u548C\u9762\u6253\u67B6
    vec4 eye;       // \u900F\u89C6:xyz = \u773C\u775B\u4F4D\u7F6E,w = 1;\u6B63\u4EA4:xyz = \u6307\u5411\u773C\u775B\u7684\u65B9\u5411,w = 0
    vec4 lightDir;  // xyz = \u6307\u5411\u5149\u6E90\u7684\u5355\u4F4D\u5411\u91CF(\u8DDF\u7740\u76F8\u673A\u8D70\u7684\u5934\u706F)
    vec4 lineColor; // \u8FB9\u7EBF\u989C\u8272
} ub;
in vec3 aPos;
in vec3 aNormal;
in vec4 aColor;
out vec3 vNormal;
out vec3 vPos;
out vec4 vColor;
void main()
{
    vNormal = aNormal;
    vPos = aPos;
    vColor = aColor;
    gl_Position = ub.mvp * vec4(aPos, 1.0);
}`;
var MESH_FRAG = `#version 300 es
precision highp float;
layout(std140) uniform Ubuf {
    mat4 mvp;
    mat4 mvpLine;
    vec4 eye;
    vec4 lightDir;
    vec4 lineColor;
} ub;
in vec3 vNormal;
in vec3 vPos;
in vec4 vColor;
out vec4 fragColor;
void main()
{
    // \u534A\u900F\u660E\u5B9E\u4F53(NX \u91CC\u8BBE\u4E86\u900F\u660E\u5EA6):\u6309\u5C4F\u5E55\u50CF\u7D20 4\xD74 \u6709\u5E8F\u6296\u52A8\u9542\u7A7A\u3002
    // \u5355\u8D9F\u753B\u3001\u4E0D\u7528\u6392\u5E8F\u4E5F\u4E0D\u6539\u7BA1\u7EBF;\u9009\u4E2D/\u9884\u4EAE\u7684\u989C\u8272 A = 255,\u4E0D\u53D7\u5F71\u54CD\u3002
    if (vColor.a < 0.998) {
        const float bayer[16] = float[16](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0,
                                          3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
        ivec2 p = ivec2(gl_FragCoord.xy) & ivec2(3);
        if (vColor.a <= (bayer[p.y * 4 + p.x] + 0.5) / 16.0)
            discard;
    }
    vec3 n = normalize(vNormal);
    vec3 v = ub.eye.w > 0.5 ? normalize(ub.eye.xyz - vPos) : ub.eye.xyz;
    if (dot(n, v) < 0.0)
        n = -n; // \u53CC\u9762:\u7247\u4F53\u548C\u6CD5\u7EBF\u671D\u91CC\u7684\u9762\u4E5F\u7167\u6837\u4EAE
    vec3 l = ub.lightDir.xyz;
    float hemi = 0.5 + 0.5 * n.z;                       // \u5929/\u5730\u73AF\u5883\u5149:\u671D\u4E0A\u7684\u9762\u4EAE\u4E00\u70B9
    vec3 ambient = mix(vec3(0.30, 0.31, 0.34), vec3(0.56, 0.58, 0.60), hemi);
    float diffuse = max(dot(n, l), 0.0) * 0.50;
    float specular = pow(max(dot(n, normalize(l + v)), 0.0), 40.0) * 0.12;
    fragColor = vec4(vColor.rgb * (ambient + diffuse) + specular, 1.0);
}`;
var LINE_VERT = `#version 300 es
// \u9762\u8FB9\u754C\u7EBF:\u53EA\u6709\u4F4D\u7F6E,\u989C\u8272\u7EDF\u4E00\u3002
layout(std140) uniform Ubuf {
    mat4 mvp;
    mat4 mvpLine;
    vec4 eye;
    vec4 lightDir;
    vec4 lineColor;
} ub;
in vec3 aPos;
void main()
{
    gl_Position = ub.mvpLine * vec4(aPos, 1.0);
}`;
var LINE_FRAG = `#version 300 es
precision highp float;
layout(std140) uniform Ubuf {
    mat4 mvp;
    mat4 mvpLine;
    vec4 eye;
    vec4 lightDir;
    vec4 lineColor;
} ub;
out vec4 fragColor;
void main()
{
    fragColor = vec4(ub.lineColor.rgb, 1.0);
}`;
var ID_VERT = `#version 300 es
// ID \u753B\u5E03:\u628A 32 \u4F4D\u5E8F\u53F7\u6309 4 \u4E2A\u5B57\u8282\u653E\u8FDB RGBA8\u3002\u5C5E\u6027\u662F\u5F52\u4E00\u5316\u5B57\u8282,\u539F\u6837\u5199\u51FA,\u4E0D\u505A\u4EFB\u4F55\u8FD0\u7B97,
// \u6240\u4EE5\u8BFB\u56DE\u7684 4 \u4E2A\u5B57\u8282\u5C31\u662F\u5199\u8FDB\u53BB\u7684 4 \u4E2A\u5B57\u8282\u3002\u9762\u548C\u5200\u8DEF\u7EBF\u6BB5\u5171\u7528\u8FD9\u4E00\u5BF9\u7740\u8272\u5668\u3002
layout(std140) uniform Ubuf { mat4 mvp; } ub;
in vec3 aPos;
in vec4 aId;
flat out vec4 vId;
void main()
{
    vId = aId;
    gl_Position = ub.mvp * vec4(aPos, 1.0);
}`;
var ID_FRAG = `#version 300 es
precision highp float;
flat in vec4 vId;
out vec4 fragColor;
void main()
{
    fragColor = vId;
}`;
var PATH_VERT = `#version 300 es
// \u5200\u8DEF\u7EBF\u6BB5\u56FE\u5C42\u3002\u7EBF\u6BB5\u6309\u52A0\u5DE5\u987A\u5E8F\u6392\u597D,\u4E24\u4E2A\u9876\u70B9\u4E00\u6BB5,\u6240\u4EE5\u300C\u9876\u70B9\u53F7 / 2\u300D\u5C31\u662F\u7EBF\u6BB5\u53F7;
// \u64AD\u653E\u53EA\u9700\u8981\u6539 uniform \u91CC\u7684\u64AD\u653E\u5934,\u4E0D\u7528\u91CD\u4F20\u6570\u636E\u3002
layout(std140) uniform PathUbuf {
    mat4 mvp;       // \u6295\u5F71 \xD7 \u89C6\u56FE \xD7 \u5DE5\u4F4D\u53D8\u6362\u7684\u9006(\u628A NC \u5750\u6807\u6446\u56DE\u96F6\u4EF6\u4E0A)
    vec4 params;    // x = \u64AD\u653E\u5934\u6240\u5728\u7EBF\u6BB5\u53F7;y = \u672A\u8D70\u7EBF\u6BB5\u4FDD\u7559\u591A\u5C11\u672C\u8272(0 = \u5B8C\u5168\u878D\u8FDB\u80CC\u666F)
    vec4 background;
} ub;
in vec3 aPos;
in vec4 aColor;
out vec4 vColor;
void main()
{
    float seg = float(gl_VertexID / 2);
    vec3 c = aColor.rgb;
    if (seg >= ub.params.z && seg < ub.params.w) {
        if (seg > ub.params.x)
            c = mix(ub.background.rgb, c, ub.params.y);
        else if (seg > ub.params.x - 1.0)
            c = mix(c, vec3(1.0), 0.65);
    }
    vColor = vec4(c, 1.0);
    gl_Position = ub.mvp * vec4(aPos, 1.0);
}`;
var PATH_FRAG = `#version 300 es
precision highp float;
in vec4 vColor;
out vec4 fragColor;
void main()
{
    fragColor = vColor;
}`;

// ui-model-viewer/src/viewer/scene_renderer.ts
var EDGE_DEPTH_BIAS = 3e-4;
var PATH_DEPTH_BIAS = 6e-4;
var MAX_DIRTY_COLOR_RANGES = 512;
function depthBiasMatrix(bias) {
  const m = new Mat4();
  m.set(2, 3, -bias);
  return m;
}
function viewParamsFromCamera(camera, aspect) {
  const b = camera.backward();
  let eye;
  if (camera.projection() === 1) {
    const e = camera.eye();
    eye = [e.x, e.y, e.z, 1];
  } else {
    eye = [b.x, b.y, b.z, 0];
  }
  const l = normalized(add(b, add(scale(camera.right(), -0.45), scale(camera.up(), 0.6))));
  return { viewProj: camera.viewProjection(aspect), eye, lightDir: [l.x, l.y, l.z] };
}
function toolpathSegmentCount(path) {
  return path ? path.lines.length : 0;
}
var SceneRenderer = class {
  gl;
  checkErrors;
  meshProg;
  lineProg;
  idProg;
  pathProg;
  // CPU 侧数据
  mesh = null;
  edges = null;
  path = null;
  colors = new Uint8Array(0);
  // 逐顶点 RGBA,高亮改的就是它
  baseColors = new Uint8Array(0);
  // 每张面的本色,4 字节一张面
  pathIds = new Uint8Array(0);
  dirtyColorRanges = [];
  colorsFullyDirty = false;
  meshDirty = false;
  edgesDirty = false;
  pathDirty = false;
  pathModel = new Mat4();
  // 工位变换的逆
  playhead = 1e30;
  playbackStart = 0;
  playbackEnd = 1e30;
  futureKeep = 0.25;
  // 显卡资源
  posBuf = null;
  normalBuf = null;
  colorBuf = null;
  idBuf = null;
  indexBuf = null;
  edgePosBuf = null;
  edgeIndexBuf = null;
  edgeIndexCount = 0;
  pathPosBuf = null;
  pathColorBuf = null;
  pathIdBuf = null;
  gpuBytes = 0;
  bufferBytes = /* @__PURE__ */ new WeakMap();
  // 顶点属性绑定打包成 VAO(每组管线一个):WebGL 的属性绑定是持久全局状态,
  // 换档删掉旧缓冲后,残留的「已启用属性指向已删缓冲」会让后续 draw 报
  // INVALID_OPERATION、画面为空(真 GPU 复现:render → setMesh → pick 全 None,
  // glErr=1282 —— spike「draw 被拒不抛 JS 异常」教训的又一实例)。
  // VAO 跟着缓冲重建,draw 只 bindVertexArray,兼得干净与正确。
  meshVao = null;
  lineVao = null;
  idMeshVao = null;
  pathVao = null;
  idPathVao = null;
  // UBO(布局 = C++ 的 MainUniforms / PathUniforms,恰好满足 std140;
  // pick 用的两个只装一个 mat4)。持久缓冲,对应 C++ 的 m_*Ubuf。
  mainUbo = null;
  pathUbo = null;
  pickUbo = null;
  pickPathUbo = null;
  mainUboData = new Float32Array(176 / 4);
  pathUboData = new Float32Array(96 / 4);
  pickUboData = new Float32Array(16);
  pickPathUboData = new Float32Array(16);
  // 9×9 拾取 FBO(★永远 1× 采样、关混合:带 MSAA 会在面的边界上把两个序号混成一个不存在的序号)
  pickFbo = null;
  pickTex = null;
  pickDepth = null;
  pickRead = new Uint8Array(kPickRegion * kPickRegion * 4);
  stats = { triangles: 0, vertices: 0, edgeSegments: 0, pathSegments: 0, gpuBytes: 0, drawCallsLastFrame: 0 };
  /** checkErrors:debug 构建里逐 draw 校验 getError(spike 教训,默认关,别在热路径开着)。 */
  constructor(gl, opts = {}) {
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
  hasMesh() {
    return this.mesh !== null;
  }
  currentMesh() {
    return this.mesh;
  }
  // ───────────────────────────────────────────── 零件
  /** 换一档网格(粗档先上,细档到了整体替换)。面序号不变,所以调用方的选择集可以原样重新上色。 */
  setMesh(mesh, faces) {
    this.mesh = mesh;
    this.dirtyColorRanges = [];
    if (mesh) {
      this.colors = buildFaceColorAttribute(mesh, faces);
      this.baseColors = new Uint8Array(mesh.faceCount() * 4);
      for (let f = 0; f < mesh.faceCount(); ++f) {
        const c = f < faces.length ? [faces[f].rgb[0], faces[f].rgb[1], faces[f].rgb[2], faces[f].opacity] : [180, 180, 180, 255];
        this.baseColors.set(c, f * 4);
      }
    } else {
      this.colors = new Uint8Array(0);
      this.baseColors = new Uint8Array(0);
    }
    this.meshDirty = true;
    this.colorsFullyDirty = false;
  }
  setEdges(edges) {
    this.edges = edges;
    this.edgesDirty = true;
  }
  clearPart() {
    this.setMesh(null, []);
    this.setEdges(null);
  }
  /** 改一张面的显示颜色:只写 CPU 上那一段并记下脏区间,下一帧局部上传。 */
  setFaceColor(face, color) {
    if (!this.mesh || face >= this.mesh.faceCount())
      return;
    const range = paintFace(this.colors, this.mesh, face, color);
    if (range.size === 0 || this.meshDirty || this.colorsFullyDirty)
      return;
    if (this.dirtyColorRanges.length >= MAX_DIRTY_COLOR_RANGES) {
      this.dirtyColorRanges = [];
      this.colorsFullyDirty = true;
      return;
    }
    this.dirtyColorRanges.push(range);
  }
  /** 这张面在 faces.json 里的本色。 */
  baseFaceColor(face) {
    const c = [180, 180, 180, 255];
    if (face * 4 + 4 <= this.baseColors.length) {
      c[0] = this.baseColors[face * 4];
      c[1] = this.baseColors[face * 4 + 1];
      c[2] = this.baseColors[face * 4 + 2];
      c[3] = this.baseColors[face * 4 + 3];
    }
    return c;
  }
  // ───────────────────────────────────────────── 刀路
  setToolpath(path) {
    this.path = path;
    this.pathIds = new Uint8Array(0);
    const segments = toolpathSegmentCount(path);
    if (path && segments > 0) {
      const vertices = segments * 2;
      this.pathIds = new Uint8Array(vertices * 4);
      const dv = new DataView(this.pathIds.buffer);
      for (let v = 0; v < vertices; ++v)
        dv.setUint32(v * 4, segmentToPickId(v / 2 | 0), true);
    }
    this.pathDirty = true;
  }
  clearToolpath() {
    this.setToolpath(null);
  }
  hasToolpath() {
    return toolpathSegmentCount(this.path) > 0;
  }
  /** 工位变换(p_nc = R·p_pkg + t)。渲染时取逆,把 NC 坐标下的刀路摆回零件上。 */
  setToolpathTransform(partToNc) {
    this.pathModel = partToNc.inverse().toMat4();
  }
  /** 播放头:正在走第几段(从 0 起)。大于等于段数 = 全部走完。 */
  setPlayhead(segment) {
    this.playhead = segment;
  }
  playheadPos() {
    return this.playhead;
  }
  setPlaybackRange(start, end) {
    this.playbackStart = start;
    this.playbackEnd = end;
  }
  /** 还没走到的线段保留多少本色:0 = 完全不显示,1 = 与走过的一样。 */
  setFutureVisibility(keep) {
    this.futureKeep = keep;
  }
  // ───────────────────────────────────────────── 画
  /** 画一帧到当前绑定的帧缓冲(窗口画布或离屏 FBO 都行),画的东西完全一样。 */
  render(view, width, height, options) {
    const gl = this.gl;
    this.flushUploads();
    const mu = this.mainUboData;
    view.viewProj.toFloat32().forEach((v, i) => mu[i] = v);
    depthBiasMatrix(EDGE_DEPTH_BIAS).mul(view.viewProj).toFloat32().forEach((v, i) => mu[16 + i] = v);
    mu[32] = view.eye[0];
    mu[33] = view.eye[1];
    mu[34] = view.eye[2];
    mu[35] = view.eye[3];
    mu[36] = view.lightDir[0];
    mu[37] = view.lightDir[1];
    mu[38] = view.lightDir[2];
    mu[39] = 0;
    mu[40] = options.edgeColor[0];
    mu[41] = options.edgeColor[1];
    mu[42] = options.edgeColor[2];
    mu[43] = 1;
    gl.bindBuffer(gl.UNIFORM_BUFFER, this.mainUbo);
    gl.bufferData(gl.UNIFORM_BUFFER, mu, gl.DYNAMIC_DRAW);
    const pu = this.pathUboData;
    depthBiasMatrix(PATH_DEPTH_BIAS).mul(view.viewProj).mul(this.pathModel).toFloat32().forEach((v, i) => pu[i] = v);
    pu[16] = Math.min(this.playhead, 1e9);
    pu[17] = this.futureKeep;
    pu[18] = this.playbackStart;
    pu[19] = Math.min(this.playbackEnd, 1e9);
    pu[20] = options.background[0];
    pu[21] = options.background[1];
    pu[22] = options.background[2];
    pu[23] = 1;
    gl.bindBuffer(gl.UNIFORM_BUFFER, this.pathUbo);
    gl.bufferData(gl.UNIFORM_BUFFER, pu, gl.DYNAMIC_DRAW);
    gl.viewport(0, 0, width, height);
    gl.clearColor(options.background[0], options.background[1], options.background[2], 1);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.disable(gl.BLEND);
    gl.depthMask(true);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    let draws = 0;
    if (options.showMesh && this.posBuf && this.indexBuf) {
      this.applyPipeline({
        program: this.meshProg.program,
        uboBlockIndex: this.meshProg.uboBlockIndex,
        topology: gl.TRIANGLES,
        depthTest: true,
        depthWrite: true,
        uniforms: "main"
      }, this.mainUbo);
      gl.bindVertexArray(this.meshVao);
      this.drawIndexed(gl.TRIANGLES, this.mesh.indexCount());
      ++draws;
    }
    if (options.showEdges && this.edgePosBuf && this.edgeIndexCount > 0) {
      this.applyPipeline({
        program: this.lineProg.program,
        uboBlockIndex: this.lineProg.uboBlockIndex,
        topology: gl.LINES,
        depthTest: true,
        depthWrite: true,
        uniforms: "main"
      }, this.mainUbo);
      gl.bindVertexArray(this.lineVao);
      this.drawIndexed(gl.LINES, this.edgeIndexCount);
      ++draws;
    }
    if (options.showToolpath && this.pathPosBuf) {
      const segments = this.visibleSegmentCount();
      if (segments > 0) {
        this.applyPipeline({
          program: this.pathProg.program,
          uboBlockIndex: this.pathProg.uboBlockIndex,
          topology: gl.LINES,
          depthTest: !options.toolpathOnTop,
          depthWrite: !options.toolpathOnTop,
          uniforms: "path"
        }, this.pathUbo);
        gl.bindVertexArray(this.pathVao);
        gl.drawArrays(gl.LINES, 0, segments * 2);
        this.checkDrawError("\u5200\u8DEF");
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
  pick(view, viewportWidth, viewportHeight, px, py, options) {
    if (viewportWidth <= 0 || viewportHeight <= 0 || px < 0 || py < 0 || px >= viewportWidth || py >= viewportHeight)
      return { kind: 0, index: 0 };
    const gl = this.gl;
    this.flushUploads();
    const zoomed = pickMatrix(viewportWidth, viewportHeight, px, py, kPickRegion).mul(view.viewProj);
    zoomed.toFloat32().forEach((v, i) => this.pickUboData[i] = v);
    depthBiasMatrix(PATH_DEPTH_BIAS).mul(zoomed).mul(this.pathModel).toFloat32().forEach((v, i) => this.pickPathUboData[i] = v);
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
      if (options.showMesh && this.posBuf && this.idBuf && this.indexBuf) {
        this.applyPipeline({
          program: this.idProg.program,
          uboBlockIndex: this.idProg.uboBlockIndex,
          topology: gl.TRIANGLES,
          depthTest: true,
          depthWrite: true,
          uniforms: "pick"
        }, this.pickUbo);
        gl.bindVertexArray(this.idMeshVao);
        this.drawIndexed(gl.TRIANGLES, this.mesh.indexCount());
      }
      if (options.pickMode !== "face" && options.showToolpath && this.pathPosBuf && this.pathIdBuf) {
        const segments = this.visibleSegmentCount();
        if (segments > 0) {
          this.applyPipeline({
            program: this.idProg.program,
            uboBlockIndex: this.idProg.uboBlockIndex,
            topology: gl.LINES,
            depthTest: !options.toolpathOnTop,
            depthWrite: !options.toolpathOnTop,
            uniforms: "pickPath"
          }, this.pickPathUbo);
          gl.bindVertexArray(this.idPathVao);
          gl.drawArrays(gl.LINES, 0, segments * 2);
          this.checkDrawError("ID \u753B\u5E03\u5200\u8DEF");
        }
      }
      gl.readPixels(0, 0, kPickRegion, kPickRegion, gl.RGBA, gl.UNSIGNED_BYTE, this.pickRead);
    } finally {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
    return resolvePickRegion(this.pickRead, kPickRegion);
  }
  dispose() {
    const gl = this.gl;
    for (const b of [
      this.posBuf,
      this.normalBuf,
      this.colorBuf,
      this.idBuf,
      this.indexBuf,
      this.edgePosBuf,
      this.edgeIndexBuf,
      this.pathPosBuf,
      this.pathColorBuf,
      this.pathIdBuf,
      this.mainUbo,
      this.pathUbo,
      this.pickUbo,
      this.pickPathUbo
    ])
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
  visibleSegmentCount() {
    const segments = toolpathSegmentCount(this.path);
    if (segments === 0)
      return 0;
    if (this.futureKeep <= 0 && this.playhead < segments)
      return Math.max(0, Math.floor(this.playhead) + 1);
    return segments;
  }
  buildProgram(vsSrc, fsSrc) {
    const gl = this.gl;
    const compile = (type, src) => {
      const sh = gl.createShader(type);
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS))
        throw new Error("\u7740\u8272\u5668\u7F16\u8BD1\u5931\u8D25:" + gl.getShaderInfoLog(sh) + "\n\u6E90\u7801\u5934:\n" + src.split("\n").slice(0, 4).join("\n"));
      return sh;
    };
    const program = gl.createProgram();
    gl.attachShader(program, compile(gl.VERTEX_SHADER, vsSrc));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fsSrc));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS))
      throw new Error("\u7740\u8272\u5668\u94FE\u63A5\u5931\u8D25:" + gl.getProgramInfoLog(program));
    const blockIndex = gl.getUniformBlockIndex(program, "Ubuf") >= 0 ? gl.getUniformBlockIndex(program, "Ubuf") : gl.getUniformBlockIndex(program, "PathUbuf");
    return { program, uboBlockIndex: blockIndex };
  }
  applyPipeline(p, ubo) {
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
  bindAttribs(program, attribs) {
    const gl = this.gl;
    for (const a of attribs) {
      const [name2, buf, size, type] = a;
      const normalized2 = a.length > 4 ? a[4] : false;
      const loc = gl.getAttribLocation(program, name2);
      if (loc < 0)
        throw new Error("\u5C5E\u6027 " + name2 + " \u4E0D\u5728\u7740\u8272\u5668\u91CC(\u53EF\u80FD\u88AB\u4F18\u5316\u6389)");
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.enableVertexAttribArray(loc);
      if (type === gl.FLOAT)
        gl.vertexAttribPointer(loc, size, type, false, 0, 0);
      else
        gl.vertexAttribPointer(loc, size, type, normalized2, 0, 0);
    }
  }
  /** 建一个 VAO(属性绑定 + 可选的元素索引缓冲都封进去)。 */
  makeVao(program, attribs, index = null) {
    const gl = this.gl;
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    this.bindAttribs(program, attribs);
    if (index)
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, index);
    gl.bindVertexArray(null);
    return vao;
  }
  deleteVao(vao) {
    if (vao)
      this.gl.deleteVertexArray(vao);
  }
  drawIndexed(mode, count) {
    const gl = this.gl;
    gl.drawElements(mode, count, gl.UNSIGNED_INT, 0);
    this.checkDrawError(mode === gl.TRIANGLES ? "\u7F51\u683C" : "\u8FB9\u7EBF");
  }
  checkDrawError(what) {
    if (!this.checkErrors)
      return;
    for (let i = 0; i < 8; ++i) {
      const err = this.gl.getError();
      if (err === this.gl.NO_ERROR)
        return;
      if (i === 0)
        throw new Error(what + "\u7ED8\u5236\u62A5 GL \u9519\u8BEF " + err);
    }
  }
  upload(data, usage, target) {
    if (data.length === 0)
      return null;
    const gl = this.gl;
    const t = target ?? gl.ARRAY_BUFFER;
    if (t === gl.ELEMENT_ARRAY_BUFFER) {
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
  deleteBuffer(buf) {
    if (!buf)
      return;
    const size = this.bufferBytes.get(buf);
    if (size !== void 0) {
      this.gpuBytes -= size;
      this.bufferBytes.delete(buf);
    }
    this.gl.deleteBuffer(buf);
  }
  // C++ applyPendingUploads 的对应:脏标记统一在下一帧(或拾取)开头处理。
  // ELEMENT 绑定的 VAO 防御在 upload() 内(ELEMENT 分支),见那里的 V-1 注释。
  flushUploads() {
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
      if (this.mesh && this.mesh.vertexCount() > 0 && this.mesh.indexCount() > 0) {
        const mesh = this.mesh;
        const posBytes = new Uint8Array(mesh.positions().buffer, mesh.positions().byteOffset, mesh.positions().byteLength);
        const nrmBytes = new Uint8Array(mesh.normals().buffer, mesh.normals().byteOffset, mesh.normals().byteLength);
        const idxBytes = new Uint8Array(mesh.indices().buffer, mesh.indices().byteOffset, mesh.indices().byteLength);
        const ids = buildFaceIdAttribute(mesh);
        this.posBuf = this.upload(posBytes, gl.STATIC_DRAW);
        this.normalBuf = this.upload(nrmBytes, gl.STATIC_DRAW);
        this.idBuf = this.upload(ids, gl.STATIC_DRAW);
        this.indexBuf = this.upload(idxBytes, gl.STATIC_DRAW, gl.ELEMENT_ARRAY_BUFFER);
        this.colorBuf = this.upload(this.colors, gl.STATIC_DRAW);
        this.meshVao = this.makeVao(this.meshProg.program, [
          ["aPos", this.posBuf, 3, gl.FLOAT],
          ["aNormal", this.normalBuf, 3, gl.FLOAT],
          ["aColor", this.colorBuf, 4, gl.UNSIGNED_BYTE, true]
        ], this.indexBuf);
        this.idMeshVao = this.makeVao(this.idProg.program, [
          ["aPos", this.posBuf, 3, gl.FLOAT],
          ["aId", this.idBuf, 4, gl.UNSIGNED_BYTE, true]
        ], this.indexBuf);
        this.stats.triangles = mesh.triangleCount();
        this.stats.vertices = mesh.vertexCount();
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
      this.stats.edgeSegments = 0;
      if (this.edges && this.edges.pointCount() > 0) {
        const indices = buildEdgeLineIndices(this.edges);
        const pts = this.edges.points();
        const ptBytes = new Uint8Array(pts.buffer, pts.byteOffset, pts.byteLength);
        const idxBytes = new Uint8Array(indices.buffer, indices.byteOffset, indices.byteLength);
        this.edgePosBuf = this.upload(ptBytes, gl.STATIC_DRAW);
        this.edgeIndexBuf = this.upload(idxBytes, gl.STATIC_DRAW, gl.ELEMENT_ARRAY_BUFFER);
        this.lineVao = this.makeVao(
          this.lineProg.program,
          [["aPos", this.edgePosBuf, 3, gl.FLOAT]],
          this.edgeIndexBuf
        );
        this.edgeIndexCount = indices.length;
        this.stats.edgeSegments = indices.length / 2;
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
          ["aColor", this.pathColorBuf, 4, gl.UNSIGNED_BYTE, true]
        ]);
        this.idPathVao = this.makeVao(this.idProg.program, [
          ["aPos", this.pathPosBuf, 3, gl.FLOAT],
          ["aId", this.pathIdBuf, 4, gl.UNSIGNED_BYTE, true]
        ]);
        this.stats.pathSegments = segments;
      }
    }
    this.stats.gpuBytes = Math.max(0, this.gpuBytes);
  }
  ensurePickTarget() {
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
      throw new Error("\u62FE\u53D6 FBO \u4E0D\u5B8C\u6574");
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
};

// ui-model-viewer/src/viewer/selection_port.ts
function createSelection() {
  const model = new SelectionModel();
  return {
    reset: (surfaceTypes) => model.reset(surfaceTypes),
    setTypeFilter: (allowed) => model.setTypeFilter(new Set(allowed)),
    typeFilter: () => new Set(model.typeFilter()),
    isSelectable: (face) => model.isSelectable(face),
    availableTypes: () => model.availableTypes(),
    click: (face, mode) => model.click(face, mode),
    setSelection: (faces) => model.setSelection(faces),
    clear: () => model.clear(),
    isSelected: (face) => model.isSelected(face),
    selection: () => model.selection()
  };
}
var SELECTED_COLOR = [255, 150, 40, 255];
var SELECTED_HOVER_COLOR = [255, 190, 110, 255];
function mixRgba(a, b, t) {
  const out = [0, 0, 0, 0];
  for (let i = 0; i < 3; ++i)
    out[i] = Math.round(a[i] * (1 - t) + b[i] * t);
  out[3] = a[3];
  return out;
}
function displayFaceColor(base2, selected, hovered, selectable) {
  if (selected)
    return hovered ? SELECTED_HOVER_COLOR : SELECTED_COLOR;
  if (!selectable)
    return mixRgba(base2, [40, 44, 52, 255], 0.55);
  if (hovered)
    return mixRgba(base2, [120, 200, 255, 255], 0.45);
  return base2;
}

// ui-model-viewer/src/viewer/geom_view.ts
var EMPTY_SUBJECT = { partRef: "", fid: "", faceIndex: 0, surfaceType: "", areaMm2: 0 };
var DRAG_THRESHOLD_PIXELS = 4;
var HOVER_INTERVAL_MS = 25;
var GeomView = class _GeomView {
  canvas;
  gl;
  renderer = null;
  frameCount = 0;
  lastPickMs = 0;
  lastFrameMs = 0;
  framePending = false;
  dpr;
  requestFrame;
  now;
  // 零件数据(CPU 侧留一份:上下文丢失恢复时要重新喂给渲染器)
  partRef = "";
  faces = [];
  bodies = [];
  mesh = null;
  edges = null;
  originOffset = [0, 0, 0];
  // 刀路
  pathBuffers = null;
  stationTransform = new RigidTransform();
  playhead = 0;
  playbackStart = 0;
  playbackEnd = 1e30;
  futureVisible = true;
  selection;
  hoverFace = null;
  camera = new OrbitCamera();
  options;
  /** 逐 draw 校验 GL 错误(接 GeomViewOptions.checkErrors;此前声明了但从未传给渲染器的死接线)。 */
  debugCheckErrors;
  fitPending = false;
  disposed = false;
  // 鼠标交互
  pressPos = { x: 0, y: 0 };
  lastPos = { x: 0, y: 0 };
  pressButton = -1;
  // -1 = 无(对应 Qt::NoButton);0 左 / 1 中 / 2 右
  dragging = false;
  hoverTimer = null;
  hoverPos = { x: 0, y: 0 };
  underMouse = false;
  callbacks = {};
  constructor(canvas, gl, opts = {}) {
    this.canvas = canvas;
    this.gl = gl;
    this.dpr = opts.dpr ?? (() => globalThis.devicePixelRatio ?? 1);
    this.requestFrame = opts.requestFrame ?? ((fn) => requestAnimationFrame(() => fn()));
    this.now = opts.now ?? (() => performance.now());
    this.selection = opts.selection ?? createSelection();
    this.debugCheckErrors = opts.checkErrors ?? false;
    this.options = {
      showMesh: true,
      showEdges: true,
      showToolpath: true,
      toolpathOnTop: false,
      background: [0.106, 0.118, 0.141],
      edgeColor: [0.06, 0.09, 0.13]
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
    canvas.addEventListener("webglcontextlost", this.onContextLost);
    canvas.addEventListener("webglcontextrestored", this.onContextRestored);
  }
  /** 生产入口:从 canvas 建 WebGL2 上下文。建不出返回 null(调用方走 renderingFailed 提示)。 */
  static create(canvas, opts = {}) {
    const gl = canvas.getContext("webgl2", { antialias: true, depth: true });
    if (!gl)
      return null;
    const view = new _GeomView(canvas, gl, opts);
    if (!view.renderer) {
      view.dispose();
      throw new Error("WebGL2 \u7740\u8272\u5668\u6216\u56FE\u5F62\u8D44\u6E90\u521D\u59CB\u5316\u5931\u8D25");
    }
    return view;
  }
  attachGl(gl) {
    this.gl = gl;
    try {
      this.renderer = new SceneRenderer(gl, { checkErrors: this.debugCheckErrors });
      this.feedRenderer();
      this.scheduleRender();
    } catch (e) {
      this.renderer = null;
      this.callbacks.renderingFailed?.("\u56FE\u5F62\u8BBE\u5907\u521D\u59CB\u5316\u5931\u8D25:" + (e instanceof Error ? e.message : String(e)));
    }
  }
  dispose() {
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
  hasRendered() {
    return this.frameCount > 0;
  }
  lastPickMilliseconds() {
    return this.lastPickMs;
  }
  lastFrameMilliseconds() {
    return this.lastFrameMs;
  }
  renderStats() {
    return this.renderer ? this.renderer.stats : { triangles: 0, vertices: 0, edgeSegments: 0, pathSegments: 0, gpuBytes: 0, drawCallsLastFrame: 0 };
  }
  // ───────────────────────────────────────────── 装载
  // Browser loading is asynchronous; the plugin verifies the package before setPart/setMesh.
  /** 换零件,清空选择集。bodies = 清单的体表(CAM-Agent T-398 ②;老包没有 ⇒ 空) */
  setPart(partRef, faces, bodies = []) {
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
  setMesh(mesh) {
    if (mesh && mesh.faceCount() !== this.faces.length)
      return;
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
      this.refreshAllFaceColors();
    }
    this.callbacks.partChanged?.();
    this.scheduleRender();
  }
  setEdges(edges) {
    this.edges = edges;
    this.renderer?.setEdges(edges);
    this.callbacks.partChanged?.();
    this.scheduleRender();
  }
  clearPart() {
    this.setPart("", []);
  }
  hasPart() {
    return this.mesh !== null;
  }
  partRefOf() {
    return this.partRef;
  }
  facesOf() {
    return this.faces;
  }
  bodiesOf() {
    return this.bodies;
  }
  meshOf() {
    return this.mesh;
  }
  edgesOf() {
    return this.edges;
  }
  /** 当前显示的是哪一档;没有零件时为 null。 */
  displayedLod() {
    if (!this.mesh)
      return null;
    return this.mesh.lod() === 0 ? 0 : 1;
  }
  /** 当前零件的 origin_offset(openPackage 时从清单里取;没有零件时为零)。 */
  getOriginOffset() {
    return [...this.originOffset];
  }
  setOriginOffset(offset) {
    this.originOffset = [...offset];
  }
  // ───────────────────────────────────────────── 刀路
  /**
   * 显示一条刀路(线段缓冲已建好):刚打开时整条显示。
   * lines:每段对应的 NC 行号(从 1 起)。
   */
  setToolpath(geometry) {
    this.pathBuffers = geometry;
    this.playhead = this.segmentCount();
    if (this.renderer) {
      this.renderer.setToolpath(geometry);
      this.renderer.setPlayhead(this.playhead);
    }
    const hadPart = this.mesh !== null;
    this.updateSceneBounds();
    if (!hadPart && this.hasToolpath()) {
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
  setNc(parsed) {
    this.setToolpath(parsed ? buildToolpathBuffers(parsed) : null);
  }
  clearToolpath() {
    this.setToolpath(null);
  }
  hasToolpath() {
    return toolpathSegmentCount(this.pathBuffers) > 0;
  }
  segmentCount() {
    return toolpathSegmentCount(this.pathBuffers);
  }
  /** 每段对应的 NC 行号;没有刀路或段号越界返回 0。 */
  ncLineOfSegment(segment) {
    if (!this.pathBuffers || segment < 0 || segment >= this.pathBuffers.lines.length)
      return 0;
    return this.pathBuffers.lines[segment];
  }
  /** 工位变换,已统一成「包坐标 → NC 坐标」(p_nc = R·p_pkg + t)。刀路按它的逆摆回零件上。 */
  setStationTransform(packageToNc) {
    this.stationTransform = packageToNc;
    this.renderer?.setToolpathTransform(packageToNc);
    this.updateSceneBounds();
    this.scheduleRender();
  }
  getStationTransform() {
    return this.stationTransform;
  }
  /** 播放头:正在走第几段(从 0 起);等于段数 = 全部走完。 */
  setPlayheadSegment(segment) {
    segment = Math.min(Math.max(segment, 0), this.segmentCount());
    if (segment === this.playhead)
      return;
    this.playhead = segment;
    this.renderer?.setPlayhead(segment);
    this.callbacks.playheadChanged?.(segment);
    this.scheduleRender();
  }
  playheadSegment() {
    return this.playhead;
  }
  setPlaybackRange(start, end) {
    this.playbackStart = start;
    this.playbackEnd = end;
    this.renderer?.setPlaybackRange(start, end);
    this.scheduleRender();
  }
  setModelVisible(visible) {
    this.options.showMesh = visible;
    this.scheduleRender();
  }
  setPickMode(mode) {
    this.options.pickMode = mode;
    this.setHoverFace(null);
  }
  /** 还没走到的线段是否淡淡地显示出来(关掉就是「只画前 N 段」)。 */
  setFutureSegmentsVisible(visible) {
    this.futureVisible = visible;
    this.renderer?.setFutureVisibility(visible ? 0.25 : 0);
    this.scheduleRender();
  }
  setToolpathVisible(visible) {
    this.options.showToolpath = visible;
    this.scheduleRender();
  }
  /** 刀路透视显示:不被零件遮挡。 */
  setToolpathOnTop(onTop) {
    this.options.toolpathOnTop = onTop;
    this.scheduleRender();
  }
  /** 场景范围 = 零件 ∪ 摆回零件上的刀路。近远平面按它算,刀路的抬刀段(常在零件上方几十毫米)才不会被裁掉。 */
  updateSceneBounds() {
    let have = false;
    let min = { x: 0, y: 0, z: 0 }, max = { x: 0, y: 0, z: 0 };
    const extend = (px, py, pz) => {
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
          z: i & 4 ? path.max.z : path.min.z
        });
        extend(p.x, p.y, p.z);
      }
    }
    if (have)
      this.camera.setSceneBounds({ min, max });
  }
  // ───────────────────────────────────────────── 拾取与选择
  pixelSize() {
    const dpr = this.dpr();
    const w = Math.max(1, Math.round(this.canvas.clientWidth * dpr));
    const h3 = Math.max(1, Math.round(this.canvas.clientHeight * dpr));
    return { width: w, height: h3 };
  }
  aspect() {
    const s = this.pixelSize();
    return s.width / s.height;
  }
  currentView() {
    return viewParamsFromCamera(this.camera, this.aspect());
  }
  /** pos 是控件坐标(逻辑像素)。点在背景上返回 kind = None。 */
  pickAt(pos) {
    if (!this.renderer || !this.mesh && !this.hasToolpath())
      return { kind: 0, index: 0 };
    const dpr = this.dpr();
    const pixel = { x: Math.floor((pos.x + 0.5) * dpr), y: Math.floor((pos.y + 0.5) * dpr) };
    const t0 = this.now();
    const hit = this.renderer.pick(
      this.currentView(),
      this.pixelSize().width,
      this.pixelSize().height,
      pixel.x,
      pixel.y,
      this.options
    );
    this.lastPickMs = this.now() - t0;
    return this.options.pickMode === "path" && hit.kind === 1 ? { kind: 0, index: 0 } : hit;
  }
  faceSubject(faceIndex) {
    if (faceIndex >= this.faces.length)
      return { ...EMPTY_SUBJECT };
    const f = this.faces[faceIndex];
    return {
      partRef: this.partRef,
      fid: f.fid,
      faceIndex,
      surfaceType: f.surfaceType,
      areaMm2: f.areaMm2
    };
  }
  selectedFids() {
    const fids = [];
    for (const face of this.selection.selection())
      fids.push(this.faces[face].fid);
    return fids;
  }
  selectedFaces() {
    return [...this.selection.selection()];
  }
  setSelectedFids(fids) {
    const faces = [];
    for (const fid of fids) {
      const index = fidToIndex(fid);
      if (index >= 0 && index < this.faces.length && this.faces[index].fid === fid)
        faces.push(index);
    }
    this.applyChange(this.selection.setSelection(faces));
  }
  clearSelection() {
    this.applyChange(this.selection.clear());
  }
  /** 只许选这些曲面类型;空 = 不过滤。 */
  setSurfaceTypeFilter(types) {
    const change = this.selection.setTypeFilter(new Set(types));
    this.refreshAllFaceColors();
    if (!changeIsEmpty(change))
      this.callbacks.selectionChanged?.();
    this.scheduleRender();
  }
  surfaceTypeFilter() {
    return [...this.selection.typeFilter()];
  }
  availableSurfaceTypes() {
    return [...this.selection.availableTypes()];
  }
  applyChange(change) {
    if (changeIsEmpty(change))
      return;
    for (const face of change.added)
      this.refreshFaceColor(face);
    for (const face of change.removed)
      this.refreshFaceColor(face);
    this.callbacks.selectionChanged?.();
    this.scheduleRender();
  }
  displayColorOf(face) {
    const selected = this.selection.isSelected(face);
    const hovered = this.hoverFace === face;
    const base2 = this.renderer ? this.renderer.baseFaceColor(face) : [180, 180, 180, 255];
    return displayFaceColor(base2, selected, hovered, this.selection.isSelectable(face));
  }
  refreshFaceColor(face) {
    this.renderer?.setFaceColor(face, this.displayColorOf(face));
  }
  refreshAllFaceColors() {
    if (!this.renderer || !this.mesh)
      return;
    if (this.selection.typeFilter().size > 0) {
      for (let f = 0; f < this.mesh.faceCount(); ++f)
        this.refreshFaceColor(f);
      return;
    }
    for (let f = 0; f < this.mesh.faceCount(); ++f) {
      if (!this.selection.isSelected(f) && this.hoverFace !== f)
        this.renderer.setFaceColor(f, this.renderer.baseFaceColor(f));
    }
    for (const f of this.selection.selection())
      this.refreshFaceColor(f);
    if (this.hoverFace !== null)
      this.refreshFaceColor(this.hoverFace);
  }
  setHoverFace(face) {
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
  hoverPick() {
    this.hoverTimer = null;
    if (this.pressButton !== -1 || !this.underMouse)
      return;
    const hit = this.pickAt(this.hoverPos);
    if (hit.kind === 1 && this.selection.isSelectable(hit.index))
      this.setHoverFace(hit.index);
    else
      this.setHoverFace(null);
  }
  // ───────────────────────────────────────────── 相机与显示
  getCamera() {
    return this.camera;
  }
  fitView(bounds) {
    const original = this.camera.sceneBounds();
    if (bounds) this.camera.setSceneBounds(bounds);
    this.camera.fit(this.aspect());
    if (bounds) this.camera.setSceneBounds(original);
    this.scheduleRender();
  }
  setStandardView(view) {
    this.camera.setStandardView(view);
    this.camera.fit(this.aspect());
    this.scheduleRender();
  }
  setProjection(projection) {
    this.camera.setProjection(projection);
    this.scheduleRender();
  }
  setEdgesVisible(visible) {
    this.options.showEdges = visible;
    this.scheduleRender();
  }
  edgesVisible() {
    return this.options.showEdges;
  }
  // ───────────────────────────────────────────── 渲染
  feedRenderer() {
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
  requestRender() {
    this.scheduleRender();
  }
  scheduleRender() {
    if (this.framePending || this.disposed)
      return;
    this.framePending = true;
    this.requestFrame(() => {
      this.framePending = false;
      this.renderNow();
    });
  }
  renderNow() {
    if (this.disposed || !this.gl || !this.renderer)
      return;
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
  onPointerDown = (ev) => {
    this.pressPos = { x: ev.offsetX, y: ev.offsetY };
    this.lastPos = { x: ev.offsetX, y: ev.offsetY };
    this.pressButton = ev.button;
    this.dragging = false;
    this.canvas.setPointerCapture?.(ev.pointerId);
  };
  onPointerMove = (ev) => {
    const pos = { x: ev.offsetX, y: ev.offsetY };
    if (this.pressButton === -1) {
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
    const pan = this.pressButton === 2 || this.pressButton === 1 || ev.shiftKey;
    if (pan)
      this.camera.pan(delta.x, delta.y, this.canvas.clientHeight);
    else
      this.camera.orbit(delta.x, delta.y);
    this.scheduleRender();
  };
  onPointerUp = (ev) => {
    const click = !this.dragging && this.pressButton === 0 && ev.button === 0;
    this.pressButton = -1;
    this.dragging = false;
    this.canvas.releasePointerCapture?.(ev.pointerId);
    if (!click || !this.mesh && !this.hasToolpath())
      return;
    const hit = this.pickAt({ x: ev.offsetX, y: ev.offsetY });
    if (hit.kind === 2) {
      this.callbacks.segmentClicked?.(hit.index, this.ncLineOfSegment(hit.index));
      return;
    }
    if (this.options.pickMode === "path") return;
    const toggle = ev.ctrlKey || ev.metaKey;
    const mode = toggle ? "toggle" : "replace";
    if (hit.kind === 1) {
      this.applyChange(this.selection.click(hit.index, mode));
      this.callbacks.faceClicked?.(this.faceSubject(hit.index));
    } else if (hit.kind === 0) {
      this.applyChange(this.selection.click(null, mode));
    }
  };
  onDoubleClick = (ev) => {
    if (ev.button === 0)
      this.fitView();
  };
  onWheel = (ev) => {
    let steps = 0;
    if (ev.deltaMode === 0)
      steps = -ev.deltaY / 60;
    else
      steps = -ev.deltaY / 120;
    if (steps === 0)
      return;
    const ndcX = 2 * ev.offsetX / Math.max(1, this.canvas.clientWidth) - 1;
    const ndcY = 1 - 2 * ev.offsetY / Math.max(1, this.canvas.clientHeight);
    this.camera.zoom(Math.pow(0.88, steps), ndcX, ndcY, this.aspect());
    this.scheduleRender();
    ev.preventDefault();
  };
  onPointerEnter = () => {
    this.underMouse = true;
  };
  onPointerCancel = () => {
    this.pressButton = -1;
    this.dragging = false;
  };
  onContextLost = (ev) => {
    ev.preventDefault();
    this.renderer?.dispose();
    this.renderer = null;
  };
  onContextRestored = () => {
    if (this.gl && !this.disposed) this.attachGl(this.gl);
  };
  onPointerLeave = () => {
    this.underMouse = false;
    this.setHoverFace(null);
  };
};
function manhattanLength(a, b) {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}
function toolpathGeometryBounds(path) {
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

// ui-model-viewer/src/controls.ts
var import_react = __toESM(require("react"), 1);
var import_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
var h = import_react.default.createElement;
function ModelControls({ view, onReference }) {
  const [selected, setSelected] = (0, import_react.useState)([]);
  const [input, setInput] = (0, import_react.useState)(""), [message, setMessage] = (0, import_react.useState)("");
  const [filter, setFilter] = (0, import_react.useState)([]);
  const [adding, setAdding] = (0, import_react.useState)(false);
  const types = view.availableSurfaceTypes();
  (0, import_react.useEffect)(() => {
    const sync = () => setSelected(view.selectedFids());
    view.callbacks.selectionChanged = sync;
    sync();
    return () => {
      if (view.callbacks.selectionChanged === sync) delete view.callbacks.selectionChanged;
    };
  }, [view]);
  const select = (event) => {
    event.preventDefault();
    const fids = [...new Set(input.trim().toUpperCase().split(/[\s,，;；]+/).filter(Boolean))];
    const faces = view.facesOf();
    const unknown = fids.filter((fid) => !faces.some((face) => face.fid === fid));
    const excluded = faces.filter((face) => fids.includes(face.fid) && filter.length > 0 && !filter.includes(face.surfaceType));
    if (unknown.length || excluded.length) {
      setMessage([unknown.length ? `\u9762\u7F16\u53F7\u4E0D\u5B58\u5728\uFF1A${unknown.join("\u3001")}` : "", excluded.length ? `\u9762\u88AB\u7C7B\u578B\u7B5B\u9009\u6392\u9664\uFF1A${excluded.map((face) => face.fid).join("\u3001")}` : ""].filter(Boolean).join("\uFF1B"));
      return;
    }
    view.setSelectedFids(fids);
    setMessage("");
  };
  const changeFilter = (allowed) => {
    const next = allowed.length === types.length ? [] : allowed.length ? allowed : ["<none>"];
    view.setSurfaceTypeFilter(next);
    setFilter(next);
    setMessage("");
  };
  return h(
    "section",
    { className: "cmv-selection", "aria-label": "\u9009\u62E9\u9762\u4E0E\u7C7B\u578B\u7B5B\u9009" },
    h("strong", null, `\u9009\u9762\u4E0E\u7B5B\u9009 \xB7 \u5DF2\u9009 ${selected.length} \u9762`),
    h(
      "div",
      { className: "cmv-selection-body" },
      h(
        "form",
        { className: "cmv-face-form", onSubmit: select },
        h(import_dsh_client_ui_primitives.Input, { "aria-label": "\u9762\u7F16\u53F7", placeholder: "F000001\uFF0C\u591A\u4E2A\u7F16\u53F7\u7528\u7A7A\u683C\u6216\u9017\u53F7\u5206\u9694", value: input, onChange: (e) => setInput(e.target.value) }),
        h(import_dsh_client_ui_primitives.Button, { type: "submit" }, "\u9009\u62E9"),
        h(import_dsh_client_ui_primitives.Button, { type: "button", onClick: () => {
          view.clearSelection();
          setInput("");
          setMessage("");
        } }, "\u6E05\u7A7A")
      ),
      onReference ? h(import_dsh_client_ui_primitives.Button, { disabled: !selected.length || adding, onClick: async () => {
        setAdding(true);
        setMessage("");
        try {
          await onReference([...selected]);
          setMessage("\u5DF2\u6DFB\u52A0\u5230\u63D0\u95EE\u8349\u7A3F\uFF0C\u5C1A\u672A\u53D1\u9001\u3002");
        } catch (error) {
          setMessage(error.message);
        } finally {
          setAdding(false);
        }
      } }, adding ? "\u6838\u5BF9\u5F15\u7528\u2026" : "\u6DFB\u52A0\u5230\u63D0\u95EE") : null,
      message ? h("div", { role: message === "\u5DF2\u6DFB\u52A0\u5230\u63D0\u95EE\u8349\u7A3F\uFF0C\u5C1A\u672A\u53D1\u9001\u3002" ? "status" : "alert" }, message) : null,
      h(
        "fieldset",
        null,
        h("legend", null, "\u53EF\u9009\u66F2\u9762\u7C7B\u578B\uFF08\u5176\u4F59\u9762\u538B\u6697\uFF09"),
        ...types.map((type) => h("label", { key: type }, h("input", { type: "checkbox", checked: filter.length === 0 || filter.includes(type), onChange: (e) => {
          const allowed = filter.length === 0 ? types : filter.filter((t) => t !== "<none>");
          changeFilter(e.target.checked ? [...allowed, type] : allowed.filter((t) => t !== type));
        } }), ` ${type}`)),
        h(import_dsh_client_ui_primitives.Button, { type: "button", onClick: () => changeFilter(types) }, "\u5168\u90E8"),
        h(import_dsh_client_ui_primitives.Button, { type: "button", onClick: () => changeFilter([]) }, "\u5168\u4E0D\u9009")
      ),
      h("div", { className: "cmv-selected", "aria-live": "polite" }, selected.length ? selected.map((fid) => {
        const face = view.facesOf().find((face2) => face2.fid === fid);
        return h("div", { key: fid }, `${fid} \xB7 ${face.surfaceType} \xB7 ${face.areaMm2.toFixed(2)} mm\xB2`);
      }) : "\u672A\u9009\u9762\u3002\u5355\u51FB\u9009\u62E9\uFF0CCtrl/Cmd + \u5355\u51FB\u589E\u51CF\u591A\u9009\uFF1BEsc \u9000\u51FA\u9009\u62E9\u5DE5\u5177\u3002")
    )
  );
}

// ui-model-viewer/src/scene.ts
function makeProgram(op, station) {
  const parsed = parseNc(op.content, { segmentCap: 1e6 });
  if (station) {
    if (parsed.meta.units !== "mm" || parsed.meta.truncated || parsed.meta.skipped.length) throw new Error(`${op.file}\uFF1A\u5355\u4F4D\u975E\u6BEB\u7C73\u6216\u7A0B\u5E8F\u89E3\u6790\u4E0D\u5B8C\u6574\uFF0C\u4E0D\u80FD\u8054\u5408\u663E\u793A`);
    for (const raw of op.content.split("\n")) {
      const line = raw.replace(/\([^)]*\)/g, "").split(";")[0];
      for (const match of line.matchAll(/G\s*([+-]?(?:\d+\.?\d*|\.\d+))/gi)) {
        const g = Number(match[1]);
        if (![0, 1, 2, 3, 4, 17, 21, 28, 30, 40, 41, 42, 43, 44, 49, 54, 55, 56, 57, 58, 59, 61, 64, 73, 74, 76, 80, 81, 82, 83, 84, 85, 86, 87, 88, 89, 90, 91, 91.1, 94, 98, 99].includes(g) || g >= 54 && g <= 59 && `G${g}` !== station.name) throw new Error(`${op.file}\uFF1A\u542B\u672A\u652F\u6301\u6216\u672A\u7ED1\u5B9A\u7684\u6307\u4EE4 G${g}\uFF0C\u4E0D\u80FD\u8054\u5408\u663E\u793A`);
      }
      if (/[ABC]\s*[+-]?(?:\d|\.)/i.test(line)) throw new Error(`${op.file}\uFF1A\u542B\u65CB\u8F6C\u8F74\u8FD0\u52A8\uFF0C\u5F53\u524D\u4EC5\u652F\u6301\u4E09\u8F74\u8F68\u8FF9`);
    }
  }
  const transform = new RigidTransform();
  if (station) {
    transform.r = station.part_to_nc.r.map((row) => [...row]);
    transform.t = [...station.part_to_nc.t];
  }
  const times = new Float64Array(parsed.segments.length + 1);
  parsed.segments.forEach((s, i) => {
    const distance = Math.hypot(...s.to.map((v, k) => v - s.from[k]));
    const rate = s.kind === "rapid" ? 8e3 : s.feed && s.feed > 0 ? s.feed : 500;
    times[i + 1] = times[i] + distance / rate * 60;
  });
  return { ...op, station: station?.name ?? "NC\u539F\u59CB\u5750\u6807", parsed, toPackage: transform.inverse(), times, duration: times[times.length - 1] };
}
function atTime(program, time) {
  const { times, parsed } = program;
  if (!parsed.segments.length) return { index: 0, fraction: 0, point: null };
  let lo = 0, hi = parsed.segments.length;
  while (lo < hi) {
    const mid = lo + hi >>> 1;
    if (times[mid + 1] <= time) lo = mid + 1;
    else hi = mid;
  }
  const index = Math.min(lo, parsed.segments.length - 1), s = parsed.segments[index];
  const fraction = Math.max(0, Math.min(1, (time - times[index]) / Math.max(times[index + 1] - times[index], 1e-9)));
  return { index, fraction, point: s.from.map((v, k) => v + (s.to[k] - v) * fraction) };
}
var COLORS = { rapid: [242, 92, 92], feed: [77, 159, 255], arc: [88, 211, 235], cycle: [240, 180, 60] };
function buildScene(programs, visible, activeId, rapid, cutting) {
  const ordered = [...programs.filter((p) => p.id !== activeId), ...programs.filter((p) => p.id === activeId)].filter((p) => visible.includes(p.id));
  const chosen = ordered.map((p) => ({ p, indices: p.parsed.segments.flatMap((s, i) => (s.kind === "rapid" ? rapid : cutting) ? [i] : []) }));
  const count = chosen.reduce((n, row) => n + row.indices.length, 0);
  if (count > 1e6) throw new Error("\u53EF\u89C1\u5200\u8DEF\u5408\u8BA1\u8D85\u8FC7100\u4E07\u6BB5");
  const positions = new Float32Array(count * 6), colors = new Uint8Array(count * 8), lines = [], locals = new Uint32Array(count);
  const ranges = [];
  let index = 0, activeStart = count, activeEnd = count;
  for (const { p, indices } of chosen) {
    const start = index;
    for (const local of indices) {
      const s = p.parsed.segments[local], color = COLORS[s.kind];
      for (const [vertex, point] of [s.from, s.to].entries()) {
        const v = p.toPackage.apply(v3(...point));
        positions.set([v.x, v.y, v.z], index * 6 + vertex * 3);
        colors.set([...color.map((value, k) => p.id === activeId ? value : Math.round([27, 30, 36][k] + (value - [27, 30, 36][k]) * 0.3)), 255], index * 8 + vertex * 4);
      }
      lines.push(s.line);
      locals[index] = local;
      index++;
    }
    ranges.push({ id: p.id, start, end: index });
    if (p.id === activeId) {
      activeStart = start;
      activeEnd = index;
    }
  }
  return { geometry: { positions, colors, lines }, locals, ranges, activeStart, activeEnd };
}
function programBounds(program) {
  const b = program.parsed.bounds;
  if (!b) return;
  const points = Array.from({ length: 8 }, (_, i) => program.toPackage.apply(v3(...b.min.map((v, k) => i & 1 << k ? b.max[k] : v))));
  return { min: v3(...[0, 1, 2].map((k) => Math.min(...points.map((v) => [v.x, v.y, v.z][k])))), max: v3(...[0, 1, 2].map((k) => Math.max(...points.map((v) => [v.x, v.y, v.z][k])))) };
}

// ui-model-viewer/src/styles.ts
var viewerCss = `
[data-phase]:has(.cmv):not(:has(.campv-embedded)) [data-composer-seat]{display:none}
.cmv{container-type:inline-size;flex:1;min-height:0;min-width:0;display:flex;flex-direction:column;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base);font-size:13px}
.cmv *{box-sizing:border-box}.cmv-expanded{position:fixed;inset:0;width:100%;height:100%;z-index:1000}
.cmv-tools,.cmv-footer,.cmv-playbar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:8px 12px;flex:none;border-bottom:1px solid var(--dsw-alias-border-l2)}
.cmv-inspect{position:relative;margin-left:auto}.cmv-inspect summary{cursor:pointer;padding:6px 8px;border-radius:8px}.cmv-inspect[open] summary{background:var(--dsw-alias-bg-layer-2)}.cmv-inspect-menu{position:absolute;right:0;top:calc(100% + 6px);z-index:5;width:280px;max-width:calc(100cqw - 24px);max-height:320px;overflow:auto;padding:12px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-base);box-shadow:0 4px 16px #0002}.cmv-inspect-menu p{font-size:12px;line-height:1.6;color:var(--dsw-alias-label-secondary);margin:8px 0 0}.cmv-inspect-menu button{margin-right:6px}.cmv-preview-note{font-size:12px;color:var(--dsw-alias-label-secondary);white-space:nowrap}.cmv-playbar button{flex:none}.cmv-playbar>span{min-width:3ch;text-align:right;font-variant-numeric:tabular-nums}
.cmv-tools label{display:flex;align-items:center;gap:4px}.cmv-tools select,.cmv-playbar select{max-width:240px;font:inherit;color:inherit;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:5px}
.cmv summary:focus-visible,.cmv select:focus-visible,.cmv input:focus-visible,.cmv button:focus-visible,.cmv summary:focus-visible,.cmv canvas:focus-visible{outline:2px solid var(--dsw-alias-label-primary);outline-offset:2px}
.cmv-body{display:flex;flex:1;min-height:0;min-width:0}.cmv-stage{position:relative;flex:1;min-width:0;min-height:240px;background:#1b1e24;overflow:hidden}.cmv-stage canvas{position:absolute;inset:0;width:100%;height:100%;touch-action:none}
.cmv-message{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px;color:#eee;text-align:center;font-size:13px;background:#1b1e24}
.cmv-hud{position:absolute;left:12px;bottom:12px;max-width:calc(100% - 24px);color:#eee;background:#1b1e24d9;border-radius:8px;padding:6px 10px;pointer-events:none;font:12px/1.6 ui-monospace,monospace;white-space:pre-wrap}
.cmv-marker{position:absolute;width:12px;height:12px;border:2px solid white;border-radius:50%;background:#f0b43c;transform:translate(-50%,-50%);pointer-events:none;display:none}
.cmv-ops{width:180px;flex:none;border-right:1px solid var(--dsw-alias-border-l2);overflow:auto;padding:8px}.cmv-ops strong{display:block;font-size:12px;color:var(--dsw-alias-label-secondary);padding:8px 4px}.cmv-op{display:flex;align-items:center;gap:4px}.cmv-op button{flex:1;min-width:0;border:0;border-radius:8px;background:transparent;color:inherit;text-align:left;padding:8px;overflow-wrap:anywhere;cursor:pointer}.cmv-op button[aria-current=true]{background:var(--dsw-alias-bg-layer-3);font-weight:600}.cmv-op button:hover{background:var(--dsw-alias-bg-layer-2)}
.cmv-footer{font-size:12px;color:var(--dsw-alias-label-secondary);border-top:1px solid var(--dsw-alias-border-l2);border-bottom:0;overflow-wrap:anywhere}.cmv-footer>span:first-child{flex:1;min-width:0}.cmv-playbar{border-bottom:1px solid var(--dsw-alias-border-l2)}.cmv-playbar input[type=range]{flex:1;min-width:120px}.cmv-note{padding:8px 12px;color:var(--dsw-alias-state-warn-label);font-size:12px;overflow-wrap:anywhere}.cmv-alerts{display:flex;gap:6px;flex-wrap:wrap;padding:4px 12px}.cmv-alerts button{border:0;background:transparent;color:var(--dsw-alias-state-warn-label);cursor:pointer;text-align:left;font:inherit}
.cmv-selection,.cmv-source,.cmv-details{width:310px;flex:none;border-left:1px solid var(--dsw-alias-border-l2);min-height:0;overflow:auto;padding:10px}.cmv-details pre{white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.6 ui-monospace,monospace}.cmv-axes{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;overflow:hidden}.cmv-selection-body{display:flex;flex-direction:column;gap:8px;padding-top:8px;overflow-wrap:anywhere}.cmv-face-form{display:flex;gap:6px;flex-wrap:wrap}.cmv-face-form input{width:100%}.cmv-selection fieldset{display:flex;gap:8px;flex-wrap:wrap;border:1px solid var(--dsw-alias-border-l2);border-radius:8px}.cmv-selected{max-height:180px;overflow:auto}
.cmv-source{display:flex;flex-direction:column;overflow:hidden;padding:0}.cmv-source-head{display:flex;gap:6px;align-items:center;flex-wrap:wrap;padding:8px;border-bottom:1px solid var(--dsw-alias-border-l2)}.cmv-source-head strong{flex:1;min-width:0;overflow-wrap:anywhere}.cmv-source-head input{width:90px}.cmv-source-lines{flex:1;min-height:100px;overflow:auto;font:12px/20px ui-monospace,monospace;background:var(--dsw-alias-markdown-code-block)}.cmv-source-line{display:block;border:0;background:transparent;color:inherit;text-align:left;white-space:pre;height:20px;line-height:20px;padding:0 8px;min-width:100%;cursor:pointer;font:inherit}.cmv-source-line[aria-current=true]{position:relative;background:color-mix(in srgb,var(--dsw-alias-state-business-primary,#2468d8) 24%,var(--dsw-alias-markdown-code-block,#f6f8fa));box-shadow:inset 3px 0 var(--dsw-alias-state-business-primary,#2468d8);font-weight:700}.cmv-source-line[aria-current=true]::before{content:"\u203A";position:absolute;left:5px;color:var(--dsw-alias-state-business-primary,#2468d8);font-weight:700}
.cmv-layers{position:absolute;right:12px;top:12px;z-index:2;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);padding:12px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px}.cmv-layers label{display:block;padding:4px 0}
.cmv-inspection-dialog{width:min(900px,calc(100vw - 48px));height:min(720px,80vh);max-height:calc(100vh - 48px);padding:0;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);box-shadow:0 16px 64px #0005;overflow:hidden;font:14px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.cmv-inspection-dialog[open]{display:flex;flex-direction:column}.cmv-inspection-dialog::backdrop{background:#0005}.cmv-inspection-dialog>header{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:16px 20px;flex:none;border-bottom:1px solid var(--dsw-alias-border-l2)}.cmv-inspection-dialog h2{margin:0;font-size:18px}.cmv-dialog-note{margin:0;padding:12px 20px;color:var(--dsw-alias-label-secondary);flex:none}.cmv-inspection-dialog .cmv-source{width:100%;height:auto;flex:1;min-height:0;border:0}.cmv-inspection-dialog .cmv-source-head{padding:10px 20px}.cmv-inspection-dialog .cmv-source-line{padding:0 20px}.cmv-information{padding:8px 20px 20px;overflow:auto}.cmv-information p{color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}.cmv-information dl{margin:16px 0}.cmv-information dl>div{display:grid;grid-template-columns:minmax(100px,160px) 1fr;gap:12px;padding:10px 0;border-bottom:1px solid var(--dsw-alias-border-l2)}.cmv-information dt{color:var(--dsw-alias-label-secondary)}.cmv-information dd{margin:0;overflow-wrap:anywhere}
/* The embedded composer reduces available height; never crop the canvas to a standalone minimum. */
.campv-embedded .cmv-stage{min-height:min(120px,100%)}
@container(max-width:480px){.cmv-playbar input[type=range]{order:1;flex-basis:100%}.cmv-preview-note{white-space:normal}}
@container(max-width:736px){.cmv-body{flex-wrap:wrap;overflow:auto}.cmv-ops{width:132px}.cmv-source,.cmv-selection,.cmv-details{width:100%;height:220px;border-left:0;border-top:1px solid var(--dsw-alias-border-l2)}.cmv-stage{flex-basis:calc(100% - 132px);min-height:200px}.cmv-tools{gap:6px;padding:6px}.cmv-tools select{max-width:160px}.cmv-hud{font-size:11px}}
`;

// ui-model-viewer/src/client.ts
var h2 = import_react2.default.createElement;
var MAX = 128 * 1024 * 1024;
function base(sessionId) {
  return `/camind/api/models/sessions/${encodeURIComponent(sessionId)}`;
}
function endpoint(sessionId, path) {
  return `${base(sessionId)}/model?path=${encodeURIComponent(path)}`;
}
async function json(url, init) {
  const response = await fetch(url, init), body = await response.json();
  if (!response.ok) throw new Error(body.message || `HTTP ${response.status}`);
  return body;
}
async function bounded(stream) {
  const reader = stream.getReader(), chunks = [];
  let size = 0;
  try {
    for (; ; ) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX) throw new Error("\u6A21\u578B\u6570\u636E\u8D85\u8FC7 128 MiB");
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}
async function loadEntry(url, entry, signal) {
  const split = url.indexOf("?");
  const response = await fetch(`${url.slice(0, split)}/${encodeURIComponent(entry.name)}${url.slice(split)}`, { signal });
  if (!response.ok || !response.body) throw new Error(`\u7F51\u683C\u4E0B\u8F7D\u5931\u8D25\uFF1AHTTP ${response.status}`);
  const raw = await bounded(response.body);
  if (raw.length !== entry.bytes) throw new Error("\u7F51\u683C\u957F\u5EA6\u4E0E\u6E05\u5355\u4E0D\u7B26");
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", raw)), (x) => x.toString(16).padStart(2, "0")).join("");
  if (digest !== entry.sha256) throw new Error("\u7F51\u683C SHA256 \u6821\u9A8C\u5931\u8D25");
  return entry.encoding === "gzip" ? bounded(new Blob([raw]).stream().pipeThrough(new DecompressionStream("gzip"))) : raw;
}
function InspectionDialog({ title, close, children }) {
  const dialog = (0, import_react2.useRef)(null);
  (0, import_react2.useEffect)(() => {
    const el = dialog.current, previous = document.activeElement;
    el.showModal();
    return () => {
      el.close();
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  return h2(
    "dialog",
    {
      ref: dialog,
      className: "cmv-inspection-dialog",
      "aria-label": title,
      onCancel: (e) => {
        e.preventDefault();
        e.stopPropagation();
        close();
      },
      onKeyDown: (e) => e.stopPropagation()
    },
    h2("header", null, h2("h2", null, title), h2(import_dsh_client_ui_primitives2.Button, { onClick: close, autoFocus: true }, "\u5173\u95ED")),
    children
  );
}
function PreviewInformation({ state, active, aligned }) {
  const rows = [
    ["\u9884\u89C8\u5185\u5BB9", active ? "NC \u7A0B\u5E8F\u8F68\u8FF9" : "\u96F6\u4EF6\u6A21\u578B"],
    ...active ? [
      ["\u7A0B\u5E8F\u6587\u4EF6", active.file],
      ["\u5DE5\u5E8F", active.name],
      ["\u5750\u6807\u4E0E\u5BF9\u9F50", aligned ? "\u5DF2\u6821\u9A8C\u6A21\u578B\u4E0E\u5DE5\u5E8F\u5750\u6807\u53D8\u6362" : "NC \u539F\u59CB\u5750\u6807\uFF0C\u672A\u4E0E\u96F6\u4EF6\u6A21\u578B\u5BF9\u9F50"],
      ["\u5355\u4F4D", active.parsed.meta.units],
      ["\u7A0B\u5E8F\u6362\u5200\u53F7", active.parsed.meta.tools.length ? active.parsed.meta.tools.map((t) => `T${t}`).join("\u3001") : "\u672A\u8BFB\u5230\u6362\u5200\u6307\u4EE4"],
      ["\u7A0B\u5E8F\u6700\u540E\u8BBE\u5B9A\u8F6C\u901F", active.parsed.meta.spindle == null ? "\u672A\u8BFB\u5230\u8F6C\u901F\u6307\u4EE4" : `${active.parsed.meta.spindle} rpm`],
      ["\u7A0B\u5E8F\u6700\u540E\u8BBE\u5B9A\u8FDB\u7ED9", active.parsed.meta.feed == null ? "\u672A\u8BFB\u5230\u8FDB\u7ED9\u6307\u4EE4" : `${active.parsed.meta.feed}\uFF08\u5355\u4F4D\u4E0E\u8FDB\u7ED9\u6A21\u5F0F\u9700\u6838\u5BF9\u7A0B\u5E8F\uFF09`],
      ["\u8F68\u8FF9\u6BB5\u6570", active.parsed.segments.length.toLocaleString()],
      ["\u4F30\u7B97\u56DE\u653E\u65F6\u957F", `${Math.round(active.duration / 60)} \u5206\u949F`]
    ] : [],
    ...state.faces ? [["\u6A21\u578B\u9762\u6570", state.faces.length.toLocaleString()], ["\u663E\u793A\u7F51\u683C\u4E09\u89D2\u7247", state.triangles.toLocaleString()]] : []
  ];
  return h2(
    "section",
    { className: "cmv-information" },
    h2("p", null, "\u7528\u4E8E\u4E86\u89E3\u5F53\u524D\u663E\u793A\u7684\u6A21\u578B\u6216\u7A0B\u5E8F\u3002\u7A0B\u5E8F\u5B57\u6BB5\u4E0D\u4EE3\u8868\u673A\u5E8A\u5B9E\u6D4B\uFF0C\u4E5F\u4E0D\u8868\u793A\u751F\u4EA7\u68C0\u67E5\u901A\u8FC7\u3002"),
    h2("dl", null, ...rows.map(([label, value]) => h2("div", { key: label }, h2("dt", null, label), h2("dd", null, value)))),
    active ? h2("p", null, "\u56DE\u653E\u65F6\u957F\u6309\u7A0B\u5E8F\u8FDB\u7ED9\u4F30\u7B97\uFF0C\u4E0D\u5305\u542B\u6362\u5200\u3001\u52A0\u51CF\u901F\u548C\u505C\u7559\uFF1B\u4E0D\u7528\u4E8E\u627F\u8BFA\u5B9E\u9645\u52A0\u5DE5\u65F6\u95F4\u3002") : null,
    state.sha ? h2("details", null, h2("summary", null, "\u6587\u4EF6\u7248\u672C\u6807\u8BC6"), h2("p", null, state.sha)) : null
  );
}
function SourceDrawer({ program, line, follow, onFollow, onSeek }) {
  const rows = (0, import_react2.useMemo)(() => program.content.split("\n"), [program]);
  const scroll = (0, import_react2.useRef)(null);
  const [top, setTop] = (0, import_react2.useState)(0), [requested, setRequested] = (0, import_react2.useState)("");
  const locate = (target) => {
    const el = scroll.current;
    if (!el) return;
    el.scrollTop = Math.max(0, (target - 5) * 20);
    setTop(el.scrollTop);
  };
  (0, import_react2.useEffect)(() => {
    setTop(0);
    if (scroll.current) scroll.current.scrollTop = 0;
  }, [program]);
  (0, import_react2.useEffect)(() => {
    if (!follow) return;
    const frame = requestAnimationFrame(() => locate(line));
    return () => cancelAnimationFrame(frame);
  }, [line, follow, program]);
  const start = Math.max(0, Math.floor(top / 20) - 10), end = Math.min(rows.length, start + 100);
  return h2(
    "aside",
    { className: "cmv-source", "aria-label": "NC\u6E90\u7801" },
    h2(
      "div",
      { className: "cmv-source-head" },
      h2("strong", null, program.file),
      h2(import_dsh_client_ui_primitives2.Button, { onClick: () => {
        onFollow(true);
        locate(line);
      }, "aria-pressed": follow }, "\u8DDF\u968F\u5200\u4F4D"),
      h2("form", { onSubmit: (e) => {
        e.preventDefault();
        const n = Number(requested);
        if (Number.isInteger(n) && n >= 1 && n <= rows.length) {
          onSeek(n);
          locate(n);
        }
      } }, h2(import_dsh_client_ui_primitives2.Input, { type: "number", min: 1, max: rows.length, "aria-label": "\u6E90\u7801\u884C\u53F7", placeholder: "\u884C\u53F7", value: requested, onChange: (e) => setRequested(e.target.value) }), h2(import_dsh_client_ui_primitives2.Button, { type: "submit" }, "\u5B9A\u4F4D"))
    ),
    h2(
      "div",
      { ref: scroll, className: "cmv-source-lines", tabIndex: 0, onScroll: (e) => setTop(e.currentTarget.scrollTop), onWheel: () => onFollow(false), onPointerDown: () => onFollow(false), onKeyDown: (e) => {
        if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End"].includes(e.key)) onFollow(false);
      } },
      h2("div", { style: { height: rows.length * 20, position: "relative", minWidth: "max-content" } }, h2("div", { style: { position: "absolute", top: start * 20, minWidth: "100%" } }, rows.slice(start, end).map((text, i) => h2("button", { key: start + i, type: "button", className: "cmv-source-line", "aria-current": start + i + 1 === line, onClick: () => onSeek(start + i + 1) }, `${String(start + i + 1).padStart(5)}  ${text}`))))
    )
  );
}
function SceneView({ sessionId, path, programs, expectedSha, notice, contextTools, onReference }) {
  const canvas = (0, import_react2.useRef)(null), marker = (0, import_react2.useRef)(null), axes = (0, import_react2.useRef)(null);
  const [view, setView] = (0, import_react2.useState)(null), [state, setState] = (0, import_react2.useState)({ state: "loading" }), [error, setError] = (0, import_react2.useState)(""), [revision, setRevision] = (0, import_react2.useState)(0);
  const [activeId, setActive] = (0, import_react2.useState)(""), [visible, setVisible] = (0, import_react2.useState)([]), [time, setTime] = (0, import_react2.useState)(0), [playing, setPlaying] = (0, import_react2.useState)(false), [speed, setSpeed] = (0, import_react2.useState)(1);
  const [selecting, setSelecting] = (0, import_react2.useState)(false), [source, setSource] = (0, import_react2.useState)(false), [details, setDetails] = (0, import_react2.useState)(false), [follow, setFollow] = (0, import_react2.useState)(true), [layers, setLayers] = (0, import_react2.useState)(false), [expanded, setExpanded] = (0, import_react2.useState)(false);
  const [projection, setProjection] = (0, import_react2.useState)(Projection.Orthographic);
  const [display, setDisplay] = (0, import_react2.useState)({ model: true, edges: true, rapid: true, cutting: true, future: true, through: false, axes: false });
  const active = programs.find((p) => p.id === activeId);
  const position = active ? atTime(active, time) : null;
  const scene = (0, import_react2.useMemo)(() => buildScene(programs, visible, activeId, display.rapid, display.cutting), [programs, visible, activeId, display.rapid, display.cutting]);
  const markerPoint = (0, import_react2.useRef)(null);
  markerPoint.current = active && visible.includes(active.id) && position?.point ? (() => {
    const p = active.toPackage.apply(v3(...position.point));
    return [p.x, p.y, p.z];
  })() : null;
  (0, import_react2.useEffect)(() => {
    setActive(programs[0]?.id ?? "");
    setVisible(programs.map((p) => p.id));
    setTime(programs[0]?.duration ?? 0);
    setPlaying(false);
    setSource(false);
  }, [programs]);
  (0, import_react2.useEffect)(() => {
    const controller = new AbortController();
    let renderer = null, observer, timer;
    setView(null);
    setError("");
    setState({ state: "loading" });
    async function load() {
      try {
        let next = { state: "ready" }, mesh, edges, manifest;
        if (path && sessionId) {
          const url = endpoint(sessionId, path);
          next = await json(url, { signal: controller.signal });
          if (controller.signal.aborted) return;
          if (next.state !== "ready") {
            setState(next);
            if (next.state === "running") timer = setTimeout(load, 1500);
            return;
          }
          manifest = parseManifest(JSON.stringify(next.manifest));
          const m = manifest.files.find((f) => f.role === "mesh" && f.lod === "fine"), e = manifest.files.find((f) => f.role === "edges");
          mesh = Mesh.parse(await loadEntry(url, m, controller.signal), m.name);
          edges = Edges.parse(await loadEntry(url, e, controller.signal), manifest.faceCount, e.name);
          if (mesh.faceCount() !== manifest.faceCount || mesh.lod() !== 1 || edges.edgeCount() !== manifest.edgeCount) throw new Error("\u6A21\u578B\u8BA1\u6570\u4E0E\u6E05\u5355\u4E0D\u7B26");
        }
        if (controller.signal.aborted || !canvas.current) return;
        renderer = GeomView.create(canvas.current);
        if (!renderer) throw new Error("\u5F53\u524D\u8BBE\u5907\u4E0D\u652F\u6301 WebGL2\uFF1B\u53EF\u4ECE\u6587\u4EF6\u5165\u53E3\u67E5\u770B\u539F\u59CB NC \u6587\u672C");
        renderer.callbacks.renderingFailed = setError;
        if (manifest && mesh && edges) {
          renderer.setPart(manifest.partRef, next.faces, manifest.bodies ?? []);
          renderer.setOriginOffset(manifest.originOffset);
          renderer.setMesh(mesh);
          renderer.setEdges(edges);
        }
        observer = new ResizeObserver(() => renderer?.requestRender());
        observer.observe(canvas.current);
        setState(next);
        setView(renderer);
        setProjection(Projection.Orthographic);
      } catch (e) {
        if (!controller.signal.aborted) setError(e.message);
      }
    }
    void load();
    return () => {
      controller.abort();
      clearTimeout(timer);
      observer?.disconnect();
      renderer?.dispose();
    };
  }, [sessionId, path, revision]);
  (0, import_react2.useEffect)(() => {
    if (!view) return;
    if (expectedSha && state.sha !== expectedSha) {
      view.clearToolpath();
      setError("\u52A0\u5DE5\u6279\u6B21\u4E0E\u753B\u5E03\u4E2D\u7684\u6E90\u6A21\u578B\u7248\u672C\u4E0D\u5339\u914D");
      return;
    }
    const camera = view.getCamera(), target = { ...camera.target() }, distance = camera.distance(), yaw = camera.yaw(), pitch = camera.pitch();
    view.setStationTransform(new RigidTransform());
    view.setToolpath(scene.geometry);
    view.setPlaybackRange(scene.activeStart, scene.activeEnd);
    if (view.hasRendered()) {
      camera.setTarget(target);
      camera.setDistance(distance);
      camera.setAngles(yaw, pitch);
    }
    view.callbacks.segmentClicked = (index) => {
      const range = scene.ranges.find((r) => index >= r.start && index < r.end), p = programs.find((p2) => p2.id === range?.id);
      if (!p) return;
      setActive(p.id);
      setTime(p.times[scene.locals[index]]);
      setPlaying(false);
      setDetails(false);
      setFollow(true);
    };
    return () => {
      delete view.callbacks.segmentClicked;
    };
  }, [view, scene, programs, expectedSha, state.sha]);
  (0, import_react2.useEffect)(() => {
    if (!view) return;
    view.setPickMode(selecting ? "face" : "path");
    view.setModelVisible(display.model);
    view.setEdgesVisible(display.model && display.edges);
    view.setToolpathOnTop(display.through);
    view.setFutureSegmentsVisible(display.future);
  }, [view, selecting, display]);
  (0, import_react2.useEffect)(() => {
    if (!view) return;
    let lo = scene.activeStart, hi = scene.activeEnd;
    while (lo < hi) {
      const mid = lo + hi >>> 1;
      if (scene.locals[mid] < (position?.index ?? 0)) lo = mid + 1;
      else hi = mid;
    }
    view.setPlayheadSegment(active && time >= active.duration ? scene.activeEnd : lo);
    view.requestRender();
  }, [view, scene, time, active]);
  (0, import_react2.useEffect)(() => {
    if (!view) return;
    const drawMarker = () => {
      const element = marker.current, point = markerPoint.current;
      if (!element || !point) {
        if (element) element.style.display = "none";
        return;
      }
      const w = view.canvas.clientWidth, height = view.canvas.clientHeight, matrix = view.getCamera().viewProjection(w / Math.max(1, height));
      const values = [point[0], point[1], point[2], 1], clip = [0, 1, 2, 3].map((row) => values.reduce((sum, v, k) => sum + matrix.at(row, k) * v, 0));
      const x = clip[0] / clip[3], y = clip[1] / clip[3], z = clip[2] / clip[3];
      element.style.display = clip[3] > 0 && Math.abs(x) <= 1 && Math.abs(y) <= 1 && Math.abs(z) <= 1 ? "block" : "none";
      element.style.left = `${(x + 1) * w / 2}px`;
      element.style.top = `${(1 - y) * height / 2}px`;
      if (axes.current && active) {
        axes.current.style.display = display.axes ? "block" : "none";
        const length2 = view.getCamera().halfHeightAtTarget() * 0.18;
        const project = (point2) => {
          const p = active.toPackage.apply(v3(...point2)), values2 = [p.x, p.y, p.z, 1];
          const clip2 = [0, 1, 2, 3].map((row) => values2.reduce((sum, v, k) => sum + matrix.at(row, k) * v, 0));
          return [(clip2[0] / clip2[3] + 1) * w / 2, (1 - clip2[1] / clip2[3]) * height / 2];
        };
        const origin = project([0, 0, 0]);
        axes.current.querySelectorAll("g").forEach((group, i) => {
          const end = project([0, 1, 2].map((k) => k === i ? length2 : 0)), line2 = group.querySelector("line"), label = group.querySelector("text");
          for (const [name2, value] of Object.entries({ x1: origin[0], y1: origin[1], x2: end[0], y2: end[1] })) line2.setAttribute(name2, String(value));
          label.setAttribute("x", String(end[0] + 4));
          label.setAttribute("y", String(end[1]));
        });
      }
    };
    view.callbacks.frameRendered = drawMarker;
    view.requestRender();
    return () => {
      delete view.callbacks.frameRendered;
    };
  }, [view, active, display.axes]);
  (0, import_react2.useEffect)(() => {
    if (!playing || !active) return;
    let frame, previous = performance.now();
    const tick = (now) => {
      const delta = Math.min((now - previous) / 1e3, 0.25) * speed;
      previous = now;
      setTime((t) => Math.min(active.duration, t + delta));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, active, speed]);
  (0, import_react2.useEffect)(() => {
    if (active && time >= active.duration) setPlaying(false);
  }, [time, active]);
  const changeActive = (p) => {
    setActive(p.id);
    setVisible((ids) => ids.includes(p.id) ? ids : [...ids, p.id]);
    setPlaying(false);
    setTime(p.duration);
  };
  const togglePlay = () => {
    if (!active || !visible.includes(active.id) || !active.parsed.segments.length) return;
    if (time >= active.duration) setTime(0);
    setPlaying((value) => !value);
  };
  const step = (direction) => {
    if (!active) return;
    setPlaying(false);
    const next = Math.max(0, Math.min(active.parsed.segments.length, (position?.index ?? 0) + direction));
    setTime(active.times[next]);
  };
  const seekLine = (line2) => {
    if (!active) return;
    const index = active.parsed.segments.findIndex((s) => s.line >= line2);
    setPlaying(false);
    if (index >= 0) setTime(active.times[index]);
  };
  const prepare = async () => {
    if (!sessionId || !path) return;
    setError("");
    setState({ state: "running", stage: "\u68C0\u67E5 NX \u72B6\u6001" });
    try {
      await json(`${endpoint(sessionId, path)}&confirm=1`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      setRevision((x) => x + 1);
    } catch (e) {
      setError(e.message);
    }
  };
  const autoPrepare = (0, import_react2.useRef)("");
  (0, import_react2.useEffect)(() => {
    if (!sessionId || !path || error || state?.state !== "missing") return;
    const key = `${sessionId}/${state.sha}`;
    if (autoPrepare.current === key) return;
    autoPrepare.current = key;
    void prepare();
  }, [state, sessionId, path, error]);
  const ready = !!view && state.state === "ready" && !error, line = active?.parsed.segments[position?.index ?? 0]?.line ?? 0;
  const playingEnabled = ready && !!active?.parsed.segments.length && visible.includes(activeId);
  const alerts = active ? [...active.parsed.meta.warnings.map((text) => ({ text, line: Number(text.match(/第\s*(\d+)\s*行/)?.[1] ?? 1) })), ...active.parsed.meta.skipped.slice(0, 20).map((s) => ({ text: `\u7B2C${s.line}\u884C\u8DF3\u8FC7\uFF1A${s.reason}`, line: s.line }))] : [];
  const keydown = (e) => {
    if (e.key === "Escape") {
      setSelecting(false);
      setLayers(false);
      setSource(false);
      setDetails(false);
      setExpanded(false);
      return;
    }
    if (e.target.tagName !== "CANVAS") return;
    if (e.code === "Space") {
      e.preventDefault();
      togglePlay();
    }
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      step(e.key === "ArrowLeft" ? -1 : 1);
    }
  };
  return h2(
    "div",
    { className: `cmv${expanded ? " cmv-expanded" : ""}`, onKeyDown: keydown },
    h2(
      "div",
      { className: "cmv-tools" },
      contextTools,
      h2("select", { "aria-label": "\u6807\u51C6\u89C6\u56FE", disabled: !ready, defaultValue: "", onChange: (e) => {
        if (e.target.value !== "") view?.setStandardView(Number(e.target.value));
        e.target.value = "";
      } }, h2("option", { value: "" }, "\u6807\u51C6\u89C6\u56FE"), ...Object.entries(StandardView).map(([name2, value], i) => h2("option", { key: name2, value }, ["\u7B49\u8F74", "\u4FEF\u89C6", "\u4EF0\u89C6", "\u524D\u89C6", "\u540E\u89C6", "\u53F3\u89C6", "\u5DE6\u89C6"][i]))),
      h2("select", { "aria-label": "\u6295\u5F71\u65B9\u5F0F", disabled: !ready, value: projection, onChange: (e) => {
        view?.setProjection(Number(e.target.value));
        setProjection(Number(e.target.value));
      } }, h2("option", { value: Projection.Orthographic }, "\u6B63\u4EA4"), h2("option", { value: Projection.Perspective }, "\u900F\u89C6")),
      h2("select", { "aria-label": "\u9002\u914D\u8303\u56F4", disabled: !ready, defaultValue: "", onChange: (e) => {
        let bounds = e.target.value === "model" && view?.meshOf() ? meshBounds(view.meshOf()) : e.target.value === "active" && active ? programBounds(active) : void 0;
        if (e.target.value === "all" && display.axes && active && view) {
          const original = view.getCamera().sceneBounds(), origin = active.toPackage.apply(v3(0, 0, 0));
          bounds = { min: v3(Math.min(original.min.x, origin.x), Math.min(original.min.y, origin.y), Math.min(original.min.z, origin.z)), max: v3(Math.max(original.max.x, origin.x), Math.max(original.max.y, origin.y), Math.max(original.max.z, origin.z)) };
        }
        view?.fitView(bounds);
        e.target.value = "";
      } }, h2("option", { value: "" }, "\u9002\u914D"), h2("option", { value: "all" }, "\u5168\u90E8"), path ? h2("option", { value: "model" }, "\u6A21\u578B") : null, active ? h2("option", { value: "active" }, "\u5F53\u524D\u5DE5\u5E8F") : null),
      h2(import_dsh_client_ui_primitives2.Button, { onClick: () => setLayers((v) => !v), disabled: !ready, "aria-expanded": layers }, "\u663E\u793A"),
      path ? h2(import_dsh_client_ui_primitives2.Button, { onClick: () => {
        setSelecting((v) => !v);
        setSource(false);
        setDetails(false);
        setPlaying(false);
      }, disabled: !ready, "aria-pressed": selecting }, "\u9009\u62E9\u9762") : null,
      h2(import_dsh_client_ui_primitives2.Button, { onClick: () => setExpanded((value) => !value), disabled: !ready, "aria-pressed": expanded }, expanded ? "\u9000\u51FA\u6269\u5927" : "\u6269\u5927\u89C6\u533A"),
      h2(
        "details",
        { className: "cmv-inspect" },
        h2("summary", null, "\u68C0\u67E5"),
        h2(
          "div",
          { className: "cmv-inspect-menu" },
          h2(import_dsh_client_ui_primitives2.Button, { onClick: (e) => {
            setDetails((v) => !v);
            setPlaying(false);
            setSource(false);
            setSelecting(false);
            e.currentTarget.closest("details").open = false;
          }, disabled: !ready, "aria-expanded": details }, "\u9884\u89C8\u4FE1\u606F"),
          active ? h2(import_dsh_client_ui_primitives2.Button, { onClick: (e) => {
            setSource((v) => !v);
            setPlaying(false);
            setSelecting(false);
            setDetails(false);
            setFollow(true);
            e.currentTarget.closest("details").open = false;
          }, disabled: !ready, "aria-expanded": source }, "\u7A0B\u5E8F\u6838\u5BF9") : null,
          active ? h2("p", null, "\u8F68\u8FF9\u4E3A\u8FD1\u4F3C\u56DE\u653E\uFF0C\u4E0D\u662F\u6750\u6599\u53BB\u9664\u3001\u78B0\u649E\u68C0\u67E5\u6216\u673A\u5E8A\u4EFF\u771F\u3002\u5200\u4F4D\u6807\u8BB0\u53EF\u7A7F\u8FC7\u906E\u6321\u3002") : null,
          alerts.length ? h2("div", { className: "cmv-alerts" }, ...alerts.slice(0, 30).map((a, i) => h2("button", { key: i, type: "button", onClick: (e) => {
            setSource(true);
            setSelecting(false);
            setDetails(false);
            setFollow(true);
            seekLine(a.line);
            e.currentTarget.closest("details").open = false;
          } }, a.text))) : null,
          state.manifest?.warnings?.length ? h2("p", null, `\u6A21\u578B\u5BFC\u51FA\u544A\u8B66\uFF1A${JSON.stringify(state.manifest.warnings)}`) : null
        )
      ),
      active ? h2("span", { className: "cmv-preview-note", title: "\u7A0B\u5E8F\u8F68\u8FF9\u8FD1\u4F3C\u56DE\u653E\uFF0C\u4E0D\u662F\u6750\u6599\u53BB\u9664\u3001\u78B0\u649E\u68C0\u67E5\u6216\u673A\u5E8A\u4EFF\u771F\u3002\u5200\u4F4D\u6807\u8BB0\u53EF\u7A7F\u8FC7\u906E\u6321\u3002" }, "\u8FD1\u4F3C\u8F68\u8FF9 \xB7 \u975E\u78B0\u649E\u4EFF\u771F") : null
    ),
    active ? h2(
      "div",
      { className: "cmv-playbar" },
      h2(import_dsh_client_ui_primitives2.Button, { onClick: () => step(-1), disabled: !playingEnabled }, "\u4E0A\u4E00\u6B65"),
      h2(import_dsh_client_ui_primitives2.Button, { variant: "primary", onClick: togglePlay, disabled: !playingEnabled }, playing ? "\u6682\u505C" : "\u64AD\u653E"),
      h2(import_dsh_client_ui_primitives2.Button, { onClick: () => step(1), disabled: !playingEnabled }, "\u4E0B\u4E00\u6B65"),
      h2("input", { type: "range", "aria-label": "\u5F53\u524D\u5DE5\u5E8F\u64AD\u653E\u8FDB\u5EA6", min: 0, max: active.duration || 1, step: "any", value: time, disabled: !playingEnabled, onChange: (e) => {
        setPlaying(false);
        setTime(Number(e.target.value));
      } }),
      h2("select", { "aria-label": "\u64AD\u653E\u901F\u5EA6", value: speed, onChange: (e) => setSpeed(Number(e.target.value)) }, ...[0.25, 0.5, 1, 2, 4, 8].map((v) => h2("option", { key: v, value: v }, `${v}\xD7`))),
      h2("span", { title: "\u6309\u7A0B\u5E8FF\u4F30\u7B97\uFF1B\u5FEB\u79FB\u5047\u5B9A8000\u3001\u7F3AF\u5047\u5B9A500\u5355\u4F4D/\u5206\u949F\uFF0C\u4E0D\u542B\u6362\u5200/\u52A0\u51CF\u901F/\u505C\u7559" }, `${Math.round(active.duration ? time / active.duration * 100 : 0)}%`)
    ) : null,
    notice ? h2("div", { className: "cmv-note", role: "status" }, notice) : null,
    h2(
      "div",
      { className: "cmv-body" },
      programs.length > 1 || path && programs.length ? h2(
        "nav",
        { className: "cmv-ops", "aria-label": "\u5DE5\u5E8F\u5BFC\u822A" },
        h2(import_dsh_client_ui_primitives2.Button, { disabled: !active, onClick: () => {
          setVisible(active ? [active.id] : []);
          setPlaying(false);
        } }, "\u4EC5\u5F53\u524D"),
        h2(import_dsh_client_ui_primitives2.Button, { disabled: !active, onClick: () => setVisible(programs.filter((p) => p.station === active?.station).map((p) => p.id)) }, "\u672C\u5DE5\u4F4D\u5168\u90E8"),
        ...[...new Set(programs.map((p) => p.station))].map((station) => h2("section", { key: station }, h2("strong", null, `\u5DE5\u4F4D ${station}`), ...programs.filter((p) => p.station === station).map((p) => h2("div", { key: p.id, className: "cmv-op" }, h2("input", { type: "checkbox", "aria-label": `\u663E\u793A ${p.name}`, checked: visible.includes(p.id), onChange: (e) => {
          if (!e.target.checked && p.id === activeId) setPlaying(false);
          setVisible((ids) => e.target.checked ? [...ids, p.id] : ids.filter((id) => id !== p.id));
        } }), h2("button", { type: "button", "aria-current": p.id === activeId, onClick: () => changeActive(p), title: p.file }, p.name)))))
      ) : null,
      h2(
        "div",
        { className: "cmv-stage" },
        h2("canvas", { ref: canvas, tabIndex: 0, onContextMenu: (e) => e.preventDefault(), "aria-label": "\u52A0\u5DE5\u4E09\u7EF4\u89C6\u533A\uFF1A\u5DE6\u952E\u65CB\u8F6C\uFF0C\u53F3\u952E\u6216Shift\u5E73\u79FB\uFF0C\u6EDA\u8F6E\u7F29\u653E\uFF0C\u53CC\u51FB\u9002\u914D\uFF1B\u7A7A\u683C\u64AD\u653E\uFF0C\u5DE6\u53F3\u952E\u5355\u6B65" }),
        h2("div", { ref: marker, className: "cmv-marker", title: "\u7A0B\u5E8F\u5200\u4F4D\u6807\u8BB0\uFF08\u4E0D\u662F\u5200\u5177\u5B9E\u4F53\uFF09" }),
        active ? h2("svg", { ref: axes, className: "cmv-axes", "aria-label": `${active.station} \u5DE5\u4F4D\u5750\u6807\u8F74`, style: { display: "none" } }, ...["#f25c5c", "#70cf8e", "#4d9fff"].map((color, i) => h2("g", { key: i }, h2("line", { stroke: color, strokeWidth: 2 }), h2("text", { fill: color, fontSize: 12 }, `${active.station} ${["X", "Y", "Z"][i]}`)))) : null,
        ready && active ? h2("div", { className: "cmv-hud" }, `${active.file} \xB7 \u7B2C${line}\u884C
${active.station} \xB7 ${active.parsed.meta.units}
${position?.point ? position.point.map((v, i) => `${["X", "Y", "Z"][i]} ${v.toFixed(3)}`).join("  ") : "\u65E0\u8FD0\u52A8\u6BB5"}
F ${active.parsed.segments[position?.index ?? 0]?.feed ?? "\u2014"}`) : null,
        layers ? h2("div", { className: "cmv-layers", "aria-label": "\u663E\u793A\u56FE\u5C42" }, ...Object.entries(display).filter(([key]) => path || !["model", "edges"].includes(key)).map(([key, checked]) => h2("label", { key }, h2("input", { type: "checkbox", checked, onChange: (e) => setDisplay((d) => ({ ...d, [key]: e.target.checked })) }), ` ${{ model: "\u5DE5\u4EF6", edges: "\u8FB9\u7EBF", rapid: "\u5FEB\u79FB\uFF08\u7EA2\uFF09", cutting: "\u5207\u524A\uFF08\u84DD/\u9752/\u7425\u73C0\uFF09", future: "\u6DE1\u663E\u672A\u8D70\u8F68\u8FF9", through: "\u5200\u8DEF\u7A7F\u900F\u663E\u793A", axes: "\u5DE5\u4F4D\u5750\u6807\u8F74" }[key]}`)), h2(import_dsh_client_ui_primitives2.Button, { onClick: () => setLayers(false) }, "\u5173\u95ED\u663E\u793A\u8BBE\u7F6E")) : null,
        error ? h2("div", { className: "cmv-message", role: "alert" }, error) : null,
        !error && !ready ? h2("div", { className: "cmv-message" }, state.state === "missing" ? autoPrepare.current === `${sessionId}/${state.sha}` ? h2("p", null, "\u6B63\u5728\u81EA\u52A8\u51C6\u5907\u4E09\u7EF4\u9884\u89C8\uFF1ANX \u5C06\u6253\u5F00\u72EC\u7ACB\u6807\u8BB0\u526F\u672C\uFF0C\u4E0D\u8986\u76D6\u539F PRT\u2026") : h2(import_react2.default.Fragment, null, h2("p", null, "\u5C1A\u672A\u751F\u6210\u4E09\u7EF4\u9884\u89C8\u3002NX \u5C06\u6253\u5F00\u72EC\u7ACB\u6807\u8BB0\u526F\u672C\uFF0C\u4E0D\u8986\u76D6\u539F PRT\uFF1B\u6210\u529F\u540E\u53EA\u5173\u95ED\u672C\u6B21\u9884\u89C8\u526F\u672C\u3002"), h2(import_dsh_client_ui_primitives2.Button, { variant: "primary", onClick: prepare }, "\u786E\u8BA4\u5E76\u751F\u6210\u4E09\u7EF4\u9884\u89C8")) : state.state === "error" ? h2(import_react2.default.Fragment, null, h2("p", null, state.message), state.retryable ? h2(import_dsh_client_ui_primitives2.Button, { variant: "primary", onClick: prepare }, "\u91CD\u8BD5\u751F\u6210\u4E09\u7EF4\u9884\u89C8") : h2("p", null, "\u8BF7\u6838\u5B9E NX \u6267\u884C\u72B6\u6001\u3001\u6392\u9664\u95EE\u9898\u540E\u91CD\u542F\u670D\u52A1\u518D\u8BD5\u3002")) : state.message || state.stage || "\u6B63\u5728\u52A0\u8F7D\u2026") : null
      ),
      ready && selecting && view ? h2(ModelControls, { view, onReference: onReference && sessionId && path ? async (fids) => {
        const query = new URLSearchParams({ path, sha: state.sha, geometry: state.geometry_sha256, fids: fids.join(",") });
        const reference = await json(`${base(sessionId)}/selection?${query}`);
        await onReference(reference);
      } : void 0 }) : null
    ),
    source && active ? h2(
      InspectionDialog,
      { title: "NC \u7A0B\u5E8F\u6838\u5BF9", close: () => setSource(false) },
      h2("p", { className: "cmv-dialog-note" }, "\u4F9B\u7F16\u7A0B\u5DE5\u7A0B\u5E08\u6838\u5BF9\u6362\u5200\u3001\u8F6C\u901F\u3001\u8FDB\u7ED9\u4E0E\u5750\u6807\u6307\u4EE4\u3002\u4EC5\u663E\u793A\u539F\u59CB\u7A0B\u5E8F\uFF0C\u4E0D\u5728\u6B64\u7F16\u8F91\uFF1B\u52A8\u753B\u67E5\u770B\u65E0\u9700\u6253\u5F00\u3002"),
      h2(SourceDrawer, { program: active, line, follow, onFollow: setFollow, onSeek: seekLine })
    ) : null,
    ready && details ? h2(
      InspectionDialog,
      { title: "\u9884\u89C8\u4FE1\u606F", close: () => setDetails(false) },
      h2(PreviewInformation, { state, active, aligned: Boolean(path) })
    ) : null,
    !active && state.faces ? h2("div", { className: "cmv-footer" }, `${state.faces.length} \u9762 \xB7 ${state.triangles.toLocaleString()} \u4E09\u89D2\u7247 \xB7 mm`) : null
  );
}
function ModelViewer({ sessionId, path, runId, onReference }) {
  const [selectedRun, setRun] = (0, import_react2.useState)(runId ?? ""), [runs, setRuns] = (0, import_react2.useState)([]), [joint, setJoint] = (0, import_react2.useState)(null), [notice, setNotice] = (0, import_react2.useState)("");
  (0, import_react2.useEffect)(() => {
    setRun(runId ?? "");
    setJoint(null);
    setNotice("");
  }, [sessionId, path, runId]);
  (0, import_react2.useEffect)(() => {
    const controller = new AbortController();
    const requested = path ?? joint?.model_path;
    if (requested) void json(`${base(sessionId)}/runs?path=${encodeURIComponent(requested)}`, { signal: controller.signal }).then((data) => setRuns(data.runs), (e) => {
      if (!controller.signal.aborted) setNotice(e.message);
    });
    return () => controller.abort();
  }, [sessionId, path, joint?.model_path]);
  (0, import_react2.useEffect)(() => {
    const controller = new AbortController();
    setJoint(null);
    setNotice("");
    if (selectedRun) void json(`${base(sessionId)}/runs/${encodeURIComponent(selectedRun)}`, { signal: controller.signal }).then((data) => {
      if (data.state !== "ready") {
        setNotice(data.message);
        return;
      }
      ;
      setJoint(data);
    }, (e) => {
      if (!controller.signal.aborted) setNotice(e.message);
    });
    return () => controller.abort();
  }, [sessionId, selectedRun]);
  const prepared = (0, import_react2.useMemo)(() => {
    try {
      const programs = joint ? joint.operations.map((op) => makeProgram(op, joint.stations.find((s) => s.name === op.station))) : [];
      if (programs.reduce((n, p) => n + p.parsed.segments.length, 0) > 1e6) throw new Error("\u6279\u6B21\u5200\u8DEF\u5408\u8BA1\u8D85\u8FC7100\u4E07\u6BB5");
      return { programs, error: "" };
    } catch (e) {
      return { programs: [], error: e.message };
    }
  }, [joint]);
  const modelPath = path ?? joint?.model_path;
  const choices = runs.some((r) => r.run_id === selectedRun) || !selectedRun ? runs : [{ run_id: selectedRun, available: true }, ...runs];
  if (!modelPath) return h2("div", { className: "cmv" }, h2("div", { className: "cmv-note", role: "status" }, notice || "\u6B63\u5728\u8BFB\u53D6\u52A0\u5DE5\u6279\u6B21\u2026"));
  return h2(SceneView, {
    key: `${sessionId}/${modelPath}`,
    sessionId,
    path: modelPath,
    programs: prepared.programs,
    expectedSha: joint?.source_sha256,
    notice: prepared.error || notice,
    onReference,
    contextTools: h2("select", { "aria-label": "\u52A0\u5DE5\u6279\u6B21", value: selectedRun, onChange: (e) => setRun(e.target.value) }, h2("option", { value: "" }, "\u4EC5\u6A21\u578B"), ...choices.map((r) => h2("option", { key: r.run_id, value: r.run_id }, `${r.run_id}${r.available ? "" : "\uFF08\u7F3A\u5BF9\u9F50\u4FE1\u606F\uFF09"}`)))
  });
}
function ToolpathViewer({ content, fileName }) {
  const programs = (0, import_react2.useMemo)(() => [makeProgram({ id: "0", name: fileName, file: fileName, content })], [content, fileName]);
  return h2(SceneView, { key: fileName, programs });
}
var name = "camind-ui-model-viewer";
var inject = ["slots"];
function apply(ctx) {
  ctx.effect(() => {
    const style = document.createElement("style");
    style.textContent = viewerCss;
    document.head.append(style);
    return () => style.remove();
  });
  ctx.slots.inject("cam.model.preview", () => ctx.slots.register({ name: "cam.model.preview", key: "model-viewer" }, ModelViewer));
  ctx.slots.inject("cam.nc.preview", () => ctx.slots.register({ name: "cam.nc.preview", key: "toolpath-viewer" }, ToolpathViewer));
}
return module.exports; } });
