#!/usr/bin/env node
// Python(CAM-Agent) / JS(service-draft-converter) / TS(Camind-desktop) 三方 packcheck 差分。
// 输入为 Desktop tools/gen_draft_fixtures.py 生成的同一批好/坏包与 manifest；writer/reader
// 双档逐包比对标准化错误码集合，reader 另比对 skipped。任何不一致都整体失败，不输出审图结论。
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { stripTypeScriptTypes } from "node:module";
import { checkDraftPack as checkJs } from "./lib/packcheck.js";

const DSH_ROOT = fileURLToPath(new URL("../", import.meta.url));
const DESKTOP = resolve(process.env.DESKTOP_REPO ?? join(DSH_ROOT, "..", "Camind-desktop"));
const CAM_AGENT = resolve(process.env.CAM_AGENT_REPO ?? join(DSH_ROOT, "..", "CAM-Agent"));
const FIXTURES = join(DESKTOP, "tests", "fixtures", "draft");
const manifestPath = join(FIXTURES, "manifest.json");
assert.ok(existsSync(manifestPath), `缺少 ${manifestPath}；先在 Desktop 运行 python3 tools/gen_draft_fixtures.py --selfcheck`);

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const entries = [
    { file: manifest.good, expected: [] },
    ...manifest.cases.map(c => ({ file: c.file, expected: [...c.expected] })),
];
assert.ok(entries.length > 1 && entries.every(e => e.file && Array.isArray(e.expected)), "manifest 为空或形态不对");
const packs = entries.map(e => JSON.parse(readFileSync(join(FIXTURES, e.file), "utf8")));

if (typeof stripTypeScriptTypes !== "function") throw new Error("TS 差分需要 Node.js 的 stripTypeScriptTypes（^22.19 或 >=24）");
const tsPath = join(DESKTOP, "packages", "viewer", "src", "draft", "packcheck.ts");
const tsSource = stripTypeScriptTypes(readFileSync(tsPath, "utf8"));
const tsModule = await import(`data:text/javascript;base64,${Buffer.from(tsSource).toString("base64")}`);
const checkTs = tsModule.checkDraftPack;
assert.equal(typeof checkTs, "function", "TS checkDraftPack 导出缺失");

function pythonExecutable() {
    if (process.env.CAM_AGENT_PYTHON) return process.env.CAM_AGENT_PYTHON;
    const candidates = [
        join(CAM_AGENT, "Drawing_parser", ".venv", "bin", "python"),
        join(CAM_AGENT, ".venv", "bin", "python"),
    ];
    return candidates.find(existsSync) ?? "python3";
}

function runPython(profile) {
    const parserDir = join(CAM_AGENT, "Drawing_parser");
    const code = `
import json, sys
sys.path.insert(0, ${JSON.stringify(parserDir)})
import draft_packcheck as checker
payload = json.loads(sys.stdin.buffer.read().decode("utf-8"))
profile = sys.argv[1]
results = []
for pack in payload:
    raw = checker.check(pack, profile)
    results.append({
        "errors": [e for e in raw if not e.startswith("skipped:")],
        "skipped": [e[len("skipped:"):] for e in raw if e.startswith("skipped:")],
    })
print(json.dumps(results, ensure_ascii=False))
`;
    const run = spawnSync(pythonExecutable(), ["-c", code, profile], {
        input: JSON.stringify(packs), encoding: "utf8", maxBuffer: 64 * 1024 * 1024,
    });
    if (run.status !== 0) throw new Error(`Python ${profile} 差分执行失败:\n${run.stderr || run.stdout}`);
    return JSON.parse(run.stdout);
}

const codes = errors => [...new Set(errors.map(e => e.split(":")[0]))].sort();
const skippedOf = errors => errors.filter(e => e.startsWith("skipped:")).map(e => e.slice("skipped:".length)).sort();
const normalizeJs = raw => ({ errors: raw.filter(e => !e.startsWith("skipped:")), skipped: skippedOf(raw) });
const normalizeTs = raw => ({ errors: [...raw.errors], skipped: [...raw.skipped].sort() });

let assertions = 0;
for (const profile of ["writer", "reader"]) {
    const python = runPython(profile);
    assert.equal(python.length, entries.length, "Python 返回数量与夹具不符");
    entries.forEach((entry, i) => {
        const pack = packs[i];
        const actual = {
            python: python[i],
            js: normalizeJs(checkJs(pack, profile)),
            ts: normalizeTs(checkTs(pack, profile)),
        };
        const expectedCodes = entry.expected.filter(c => profile === "writer" || c !== "DRAFT_E_UNKNOWN_TYPE");
        for (const [implementation, result] of Object.entries(actual)) {
            assert.deepEqual(codes(result.errors), [...expectedCodes].sort(),
                `${profile} ${entry.file} ${implementation} 错误码不一致；原始结果 ${JSON.stringify(result.errors)}`);
            assertions++;
        }
        assert.deepEqual(actual.js.skipped, actual.ts.skipped,
            `${profile} ${entry.file} JS/TS skipped 不一致`);
        assert.deepEqual(actual.python.skipped, actual.ts.skipped,
            `${profile} ${entry.file} Python/TS skipped 不一致`);
        assertions += 2;
    });
    console.log(`ok - ${profile}: ${entries.length} 个包 × Python/JS/TS 错误码与 skipped 一致`);
}

console.log(`三方差分完成：${entries.length * 2} 个包/档位组合，${assertions} 项断言通过；不代表图纸已审或尺寸正确。`);
