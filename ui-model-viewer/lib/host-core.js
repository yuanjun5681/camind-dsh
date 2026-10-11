// ui-model-viewer/src/core/geompack/package.ts
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { openSync, readSync, closeSync, fstatSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";

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

// ui-model-viewer/src/core/version.ts
var kPackFormatName = "camind-geom";
var kPackFormatVersion = 1;

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
function findEntry(manifest, role, lod = "") {
  for (const e of manifest.files) {
    if (e.role === role && (lod === "" || e.lod === lod))
      return e;
  }
  return null;
}
function lodName(lod) {
  return lod === 0 ? "coarse" : "fine";
}
function meshEntry(manifest, lod) {
  return findEntry(manifest, "mesh", lodName(lod));
}
function checkBodies(manifest, faces) {
  if (!manifest.bodies)
    return;
  const file = "manifest.json";
  const bodies = manifest.bodies;
  const counts = new Array(bodies.length).fill(0);
  for (const f of faces) {
    if (f.body < 0 || f.body >= bodies.length) {
      fail("CountMismatch", file + ":\u9762 " + f.fid + " \u5C5E\u4E8E\u4F53 " + f.body + ",\u4F53\u8868\u91CC\u6CA1\u6709\u8FD9\u4E2A\u4F53", file);
    }
    ++counts[f.body];
  }
  for (const b of bodies) {
    if (b.nFaces !== counts[b.body]) {
      fail(
        "CountMismatch",
        file + ":\u4F53 " + b.body + " \u7684 n_faces \u662F " + b.nFaces + ",\u9762\u8868\u91CC\u8FD9\u4E2A\u4F53\u6709 " + counts[b.body] + " \u5F20",
        file
      );
    }
  }
}
function opacityFromTranslucency(translucency) {
  if (translucency === null || translucency === void 0)
    return 255;
  const t = Math.min(Math.max(translucency, 0), 100);
  return Math.round(255 * (100 - t) / 100);
}
function applyBodyOpacity(manifest, faces) {
  for (const f of faces) {
    f.opacity = 255;
    if (manifest.bodies && f.body >= 0 && f.body < manifest.bodies.length)
      f.opacity = opacityFromTranslucency(manifest.bodies[f.body].translucency);
  }
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
function indexToFid(index) {
  return "F" + String(index + 1).padStart(6, "0");
}
function parseFaces(text, expectedCount) {
  const file = "faces.json";
  const doc = parseOrThrow(text, file);
  if (!Array.isArray(doc))
    fail("BadJson", file + ":\u9876\u5C42\u5E94\u4E3A\u6570\u7EC4", file);
  if (doc.length !== expectedCount) {
    fail("CountMismatch", file + " \u6709 " + doc.length + " \u5F20\u9762,\u6E05\u5355\u5199\u7684\u662F " + expectedCount, file);
  }
  const faces = [];
  for (let index = 0; index < doc.length; ++index) {
    const item = doc[index];
    if (typeof item !== "object" || item === null)
      fail("BadJson", file + ":\u6570\u7EC4\u5143\u7D20\u5E94\u4E3A\u5BF9\u8C61", file);
    const fid = str(item, "fid", file);
    if (fidToIndex(fid) !== index) {
      fail(
        "InvalidValue",
        "\u7B2C " + index + " \u5F20\u9762\u7684 FID \u662F " + fid + ",\u5E94\u4E3A " + indexToFid(index) + "(\u6570\u7EC4\u4E0B\u6807 = FID \u5E8F\u53F7 \u2212 1)",
        file
      );
    }
    const area = item.area_mm2;
    if (typeof area !== "number" || !(area > 0) || !Number.isFinite(area))
      fail("InvalidValue", "\u9762 " + fid + " \u7684 area_mm2 \u7F3A\u5931\u6216\u4E3A\u7A7A", file);
    const rgb = [180, 180, 180];
    if (Array.isArray(item.rgb) && item.rgb.length === 3) {
      for (let i = 0; i < 3; ++i) {
        if (typeof item.rgb[i] === "number")
          rgb[i] = Math.min(255, Math.max(0, Math.trunc(item.rgb[i])));
      }
    }
    faces.push({
      fid,
      body: typeof item.body === "number" ? item.body : 0,
      surfaceType: strOr(item, "surface_type", "other"),
      rgb,
      layer: typeof item.layer === "number" ? item.layer : 0,
      areaMm2: area,
      bboxRelative: bbox(item, "bbox_relative", file, false),
      opacity: 255
    });
  }
  return faces;
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

// ui-model-viewer/src/core/geompack/package.ts
function readFileBytes(path, displayName) {
  if (!existsSync(path) || !statSync(path).isFile())
    throw new PackError("MissingFile", displayName + ":\u6587\u4EF6\u4E0D\u5B58\u5728", displayName);
  const fd = openSync(path, "r");
  try {
    const size = fstatSync(fd).size;
    const bytes = new Uint8Array(size);
    let done = 0;
    while (done < size) {
      const got = readSync(fd, bytes, done, size - done, done);
      if (got <= 0)
        throw new PackError("Io", displayName + ":\u8BFB\u53D6\u5931\u8D25", displayName);
      done += got;
    }
    return bytes;
  } finally {
    closeSync(fd);
  }
}
function sha256Hex(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}
var kGzipMaxOutputBytes = 8 * 1024 * 1024 * 1024;
function gunzipWithLimit(bytes, name, maxOutputBytes = kGzipMaxOutputBytes) {
  try {
    return gunzipSync(bytes, { maxOutputLength: maxOutputBytes });
  } catch (e) {
    throw new PackError("BadGzip", name + ":" + (e instanceof Error ? e.message : String(e)), name);
  }
}
function readVerified(dir, entry, maxGzipOutputBytes) {
  const bytes = readFileBytes(join(dir, entry.name), entry.name);
  if (bytes.length !== entry.bytes) {
    throw new PackError(
      "SizeMismatch",
      entry.name + ":\u6587\u4EF6 " + bytes.length + " \u5B57\u8282,\u6E05\u5355\u5199\u7684\u662F " + entry.bytes,
      entry.name
    );
  }
  if (sha256Hex(bytes) !== entry.sha256)
    throw new PackError("HashMismatch", entry.name + ":sha256 \u4E0E\u6E05\u5355\u4E0D\u7B26", entry.name);
  if (entry.encoding === "gzip")
    return gunzipWithLimit(bytes, entry.name, maxGzipOutputBytes);
  return bytes;
}
var Package = class _Package {
  dirValue;
  manifest;
  faces;
  maxGzipOutputBytes;
  constructor(dir, manifest, faces, maxGzipOutputBytes) {
    this.dirValue = dir;
    this.manifest = manifest;
    this.faces = faces;
    this.maxGzipOutputBytes = maxGzipOutputBytes;
  }
  // maxGzipOutputBytes 只为测试注入小上限用(验收审查:接线也要有守护 ——
  // 若有人把解压改回裸 gunzipSync,小上限开包必红);产品路径用缺省 8GiB。
  static open(dir, opts = {}) {
    const maxGzip = opts.maxGzipOutputBytes ?? kGzipMaxOutputBytes;
    const manifestBytes = readFileBytes(join(dir, "manifest.json"), "manifest.json");
    const manifest = parseManifest(new TextDecoder().decode(manifestBytes));
    const facesEntry = findEntry(manifest, "faces");
    if (!facesEntry)
      throw new PackError("BadJson", "manifest.json:files[] \u91CC\u6CA1\u6709 faces", "manifest.json");
    const facesBytes = readVerified(dir, facesEntry, maxGzip);
    const faces = parseFaces(new TextDecoder().decode(facesBytes), manifest.faceCount);
    checkBodies(manifest, faces);
    applyBodyOpacity(manifest, faces);
    return new _Package(dir, manifest, faces, maxGzip);
  }
  partRef() {
    return this.manifest.partRef;
  }
  hasMesh(lod) {
    const e = meshEntry(this.manifest, lod);
    return !!e && existsSync(join(this.dirValue, e.name));
  }
  hasEdges() {
    const e = findEntry(this.manifest, "edges");
    return !!e && existsSync(join(this.dirValue, e.name));
  }
  loadMesh(lod) {
    const e = meshEntry(this.manifest, lod);
    if (!e)
      throw new PackError("MissingFile", "manifest.json:files[] \u91CC\u6CA1\u6709 " + lodName(lod) + " \u6863\u7F51\u683C", "manifest.json");
    const mesh = Mesh.parse(readVerified(this.dirValue, e, this.maxGzipOutputBytes), e.name);
    if (mesh.faceCount() !== this.manifest.faceCount) {
      throw new PackError(
        "CountMismatch",
        e.name + ":\u7F51\u683C\u6709 " + mesh.faceCount() + " \u5F20\u9762,\u6E05\u5355\u5199\u7684\u662F " + this.manifest.faceCount,
        e.name
      );
    }
    if (mesh.lod() !== lod) {
      throw new PackError("InvalidValue", e.name + ":\u6587\u4EF6\u5934\u91CC\u7684 lod \u4E0E\u6E05\u5355\u7684 " + lodName(lod) + " \u4E0D\u7B26", e.name);
    }
    return mesh;
  }
  loadEdges() {
    const e = findEntry(this.manifest, "edges");
    if (!e)
      throw new PackError("MissingFile", "manifest.json:files[] \u91CC\u6CA1\u6709 edges", "manifest.json");
    const edges = Edges.parse(readVerified(this.dirValue, e, this.maxGzipOutputBytes), this.manifest.faceCount, e.name);
    if (edges.edgeCount() !== this.manifest.edgeCount) {
      throw new PackError(
        "CountMismatch",
        e.name + ":\u8FB9\u7EBF\u6709 " + edges.edgeCount() + " \u6761\u8FB9,\u6E05\u5355\u5199\u7684\u662F " + this.manifest.edgeCount,
        e.name
      );
    }
    return edges;
  }
};

// tool-cam/lib/delivery-route.js
import { inflateRawSync } from "node:zlib";
var MAX_NC_ENTRY_BYTES = 32 * 1024 * 1024;
function basenameOf(p) {
  const slash = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return slash >= 0 ? p.slice(slash + 1) : p;
}
function readZipEntry(bytes, wantName) {
  const EOCD_SIG = 101010256;
  const CDIR_SIG = 33639248;
  const LOCAL_SIG = 67324752;
  const min = Math.max(0, bytes.length - 22 - 65536);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= min; i -= 1) {
    if (bytes.readUInt32LE(i) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("\u627E\u4E0D\u5230 ZIP \u4E2D\u592E\u76EE\u5F55\u7ED3\u5C3E\u8BB0\u5F55\uFF08\u4E0D\u662F\u6709\u6548 zip\uFF09");
  const count = bytes.readUInt16LE(eocd + 10);
  let offset = bytes.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n += 1) {
    if (offset + 46 > bytes.length || bytes.readUInt32LE(offset) !== CDIR_SIG) {
      throw new Error("ZIP \u4E2D\u592E\u76EE\u5F55\u635F\u574F");
    }
    const method = bytes.readUInt16LE(offset + 10);
    const compressedSize = bytes.readUInt32LE(offset + 20);
    const nameLen = bytes.readUInt16LE(offset + 28);
    const extraLen = bytes.readUInt16LE(offset + 30);
    const commentLen = bytes.readUInt16LE(offset + 32);
    const localOffset = bytes.readUInt32LE(offset + 42);
    const name = bytes.subarray(offset + 46, offset + 46 + nameLen).toString("utf8");
    offset += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith("/") || basenameOf(name) !== wantName) continue;
    if (method !== 0 && method !== 8) throw new Error(`\u4E0D\u652F\u6301\u7684 ZIP \u538B\u7F29\u65B9\u5F0F\uFF08method ${method}\uFF09`);
    if (localOffset + 30 > bytes.length || bytes.readUInt32LE(localOffset) !== LOCAL_SIG) {
      throw new Error("ZIP \u672C\u5730\u6587\u4EF6\u5934\u635F\u574F");
    }
    const localNameLen = bytes.readUInt16LE(localOffset + 26);
    const localExtraLen = bytes.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    if (dataStart + compressedSize > bytes.length) throw new Error("ZIP \u6761\u76EE\u6570\u636E\u8D8A\u754C");
    const raw = bytes.subarray(dataStart, dataStart + compressedSize);
    const content = method === 0 ? Buffer.from(raw) : inflateRawSync(raw, { maxOutputLength: MAX_NC_ENTRY_BYTES });
    if (content.length > MAX_NC_ENTRY_BYTES) throw new Error("NC \u6761\u76EE\u8D85\u8FC7 32 MiB \u4E0A\u9650");
    return content;
  }
  return null;
}
export {
  Package,
  parseManifest,
  readZipEntry
};
