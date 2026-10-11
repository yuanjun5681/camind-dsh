// 几何包整体读取:先验哈希、后解压;清单→面表→体表对账→透明度落地。直译 core/src/geompack/package.cpp。
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { openSync, readSync, closeSync, fstatSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { PackError } from "../error.ts";
import { parseManifest, parseFaces, findEntry, meshEntry, lodName, checkBodies, applyBodyOpacity } from "./manifest.ts";
import type { Manifest, FaceInfo, FileEntry } from "./manifest.ts";
import { Mesh, Edges } from "./mesh.ts";

function readFileBytes(path: string, displayName: string): Uint8Array {
    if (!existsSync(path) || !statSync(path).isFile())
        throw new PackError("MissingFile", displayName + ":文件不存在", displayName);
    const fd = openSync(path, "r");
    try {
        const size = fstatSync(fd).size;
        const bytes = new Uint8Array(size);
        let done = 0;
        while (done < size) {
            const got = readSync(fd, bytes, done, size - done, done);
            if (got <= 0)
                throw new PackError("Io", displayName + ":读取失败", displayName);
            done += got;
        }
        return bytes;
    } finally {
        closeSync(fd);
    }
}

function sha256Hex(bytes: Uint8Array): string {
    return createHash("sha256").update(bytes).digest("hex");
}

// C++ gunzip 的缺省上限(8GiB,压缩炸弹防线);readVerified 与测试共用同一路径。
export const kGzipMaxOutputBytes = 8 * 1024 * 1024 * 1024;

// 带上限的包内 gzip 解压:超上限/坏流一律 BadGzip(与 C++ gzip.cpp 的 failGzip 同码)。
export function gunzipWithLimit(bytes: Uint8Array, name: string,
                                maxOutputBytes: number = kGzipMaxOutputBytes): Uint8Array {
    try {
        return gunzipSync(bytes, { maxOutputLength: maxOutputBytes });
    } catch (e) {
        throw new PackError("BadGzip", name + ":" + (e instanceof Error ? e.message : String(e)), name);
    }
}

function readVerified(dir: string, entry: FileEntry, maxGzipOutputBytes: number): Uint8Array {
    const bytes = readFileBytes(join(dir, entry.name), entry.name);
    if (bytes.length !== entry.bytes) {
        throw new PackError("SizeMismatch",
            entry.name + ":文件 " + bytes.length + " 字节,清单写的是 " + entry.bytes, entry.name);
    }
    // 先验哈希、后解压:哈希针对的是落盘的压缩后字节。
    if (sha256Hex(bytes) !== entry.sha256)
        throw new PackError("HashMismatch", entry.name + ":sha256 与清单不符", entry.name);
    if (entry.encoding === "gzip")
        return gunzipWithLimit(bytes, entry.name, maxGzipOutputBytes);
    return bytes;
}

export class Package {
    private dirValue: string;
    manifest: Manifest;
    faces: FaceInfo[];

    private maxGzipOutputBytes: number;

    private constructor(dir: string, manifest: Manifest, faces: FaceInfo[], maxGzipOutputBytes: number) {
        this.dirValue = dir;
        this.manifest = manifest;
        this.faces = faces;
        this.maxGzipOutputBytes = maxGzipOutputBytes;
    }

    // maxGzipOutputBytes 只为测试注入小上限用(验收审查:接线也要有守护 ——
    // 若有人把解压改回裸 gunzipSync,小上限开包必红);产品路径用缺省 8GiB。
    static open(dir: string, opts: { maxGzipOutputBytes?: number } = {}): Package {
        const maxGzip = opts.maxGzipOutputBytes ?? kGzipMaxOutputBytes;
        const manifestBytes = readFileBytes(join(dir, "manifest.json"), "manifest.json");
        const manifest = parseManifest(new TextDecoder().decode(manifestBytes));

        const facesEntry = findEntry(manifest, "faces");
        if (!facesEntry)
            throw new PackError("BadJson", "manifest.json:files[] 里没有 faces", "manifest.json");
        const facesBytes = readVerified(dir, facesEntry, maxGzip);
        const faces = parseFaces(new TextDecoder().decode(facesBytes), manifest.faceCount);
        checkBodies(manifest, faces);      // ★CAM-Agent T-398 ②:带体表就与面表对账
        applyBodyOpacity(manifest, faces); // 体的透明度落到每张面上,渲染按它镂空
        return new Package(dir, manifest, faces, maxGzip);
    }

    partRef(): string { return this.manifest.partRef; }

    hasMesh(lod: 0 | 1): boolean {
        const e = meshEntry(this.manifest, lod);
        return !!e && existsSync(join(this.dirValue, e.name));
    }

    hasEdges(): boolean {
        const e = findEntry(this.manifest, "edges");
        return !!e && existsSync(join(this.dirValue, e.name));
    }

    loadMesh(lod: 0 | 1): Mesh {
        const e = meshEntry(this.manifest, lod);
        if (!e)
            throw new PackError("MissingFile", "manifest.json:files[] 里没有 " + lodName(lod) + " 档网格", "manifest.json");
        const mesh = Mesh.parse(readVerified(this.dirValue, e, this.maxGzipOutputBytes), e.name);
        if (mesh.faceCount() !== this.manifest.faceCount) {
            throw new PackError("CountMismatch",
                e.name + ":网格有 " + mesh.faceCount() + " 张面,清单写的是 " + this.manifest.faceCount, e.name);
        }
        if (mesh.lod() !== lod) {
            throw new PackError("InvalidValue", e.name + ":文件头里的 lod 与清单的 " + lodName(lod) + " 不符", e.name);
        }
        return mesh;
    }

    loadEdges(): Edges {
        const e = findEntry(this.manifest, "edges");
        if (!e)
            throw new PackError("MissingFile", "manifest.json:files[] 里没有 edges", "manifest.json");
        const edges = Edges.parse(readVerified(this.dirValue, e, this.maxGzipOutputBytes), this.manifest.faceCount, e.name);
        if (edges.edgeCount() !== this.manifest.edgeCount) {
            throw new PackError("CountMismatch",
                e.name + ":边线有 " + edges.edgeCount() + " 条边,清单写的是 " + this.manifest.edgeCount, e.name);
        }
        return edges;
    }
}
