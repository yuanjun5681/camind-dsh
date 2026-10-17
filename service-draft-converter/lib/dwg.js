// dwg2dxf 子进程编排(Python convert_dwg 移植):.dwg → 临时 .dxf 字节。
// 纪律:LibreDWG 只以命令行子进程跑、永不进安装包(GPL 铁律);dwg2dxf 路径可配,
// 缺二进制/超时/非零退出全部响亮报错;临时 DXF 即用即删。

import { execFile, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const DWG2DXF_TIMEOUT_MS = 300_000;

/** dwg2dxf 可执行解析:显式配置 > 环境变量 CAMIND_DWG2DXF > PATH 上的 "dwg2dxf"。 */
export function resolveDwg2dxf(configPath) {
    return configPath || process.env.CAMIND_DWG2DXF || "dwg2dxf";
}

/** dwg 绝对路径 → dxf 文本。失败抛错(退码/超时/缺二进制,消息带中文原因)。 */
export function dwgToDxfText(dwgPath, opts = {}) {
    const bin = resolveDwg2dxf(opts.dwg2dxfPath);
    const dir = mkdtempSync(join(tmpdir(), "camind-draft-"));
    const out = join(dir, "out.dxf");
    try {
        const r = spawnSync2(bin, ["--as", "r2018", "-y", "-o", out, dwgPath], opts.timeoutMs);
        if (r.error) {
            if (r.error.code === "ENOENT") {
                throw new Error(`dwg2dxf 未找到(${bin}):请安装 LibreDWG 或配置 dwg2dxf 路径`);
            }
            throw r.error;
        }
        if (r.status !== 0) {
            throw new Error(`dwg2dxf 退 ${r.status}:${(r.stderr || "").slice(0, 200)}`);
        }
        return readFileSync(out, "utf8");
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

function spawnSync2(bin, args, timeoutMs) {
    // spawnSync 包装(超时 kill)
    return spawnSync(bin, args, {
        timeout: timeoutMs ?? DWG2DXF_TIMEOUT_MS,
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
    });
}

/** dwg2dxf --version 首行( conversion.libredwg 留痕用);拿不到返回 "unknown"。 */
export function libredwgVersion(opts = {}) {
    try {
        const r = spawnSync2(resolveDwg2dxf(opts.dwg2dxfPath), ["--version"], 10_000);
        const line = `${r.stdout ?? ""}${r.stderr ?? ""}`.trim().split("\n")[0];
        return line ? line.slice(0, 80) : "unknown";
    } catch {
        return "unknown";
    }
}

/** Host 侧异步版本探测:超时/取消终止子进程,不阻塞事件循环。 */
export async function libredwgVersionAsync(opts = {}) {
    try {
        const { stdout, stderr } = await execFileAsync(resolveDwg2dxf(opts.dwg2dxfPath), ["--version"], {
            timeout: 10_000,
            encoding: "utf8",
            maxBuffer: 64 * 1024,
            signal: opts.signal,
        });
        const line = `${stdout ?? ""}${stderr ?? ""}`.trim().split("\n")[0];
        return line ? line.slice(0, 80) : "unknown";
    } catch {
        if (opts.signal?.aborted) throw new Error("图纸转换已取消");
        return "unknown";
    }
}
