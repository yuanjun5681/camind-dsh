#!/usr/bin/env node
// Python(CAM-Agent) / JS(service-draft-converter) / TS(camind-dsh 本地交付版) 三方 packcheck 差分。
// 输入为 Desktop tools/gen_draft_fixtures.py --selfcheck 生成的同一批好/坏包；期望错误码集合
// 直接从该生成器的 BAD_CASES 导入（唯一事实源，不再读单独 manifest.json）。writer/reader
// 双档逐包比对标准化错误码集合，reader 另比对 skipped。任何不一致都整体失败，不输出审图结论。
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { stripTypeScriptTypes } from "node:module";
import { checkDraftPack as checkJs } from "./lib/packcheck.js";
import { gitSafeEnv } from "../ui-drawing-viewer/with-scissor.mjs";

// 负例覆盖：钉住排序后的完整坏包文件名集合，增删改名均红，合法变更需显式同步本断言。
const EXPECTED_BAD_CASES = [
    "bad_color_mutex.json", "bad_coverage.json", "bad_format_version.json", "bad_i1_facets.json",
    "bad_i1_selfcheck.json", "bad_i1b_count.json", "bad_i2_bbox.json", "bad_i4_rows.json",
    "bad_i5_orphan_layer.json", "bad_i6_replacement.json", "bad_i7_view.json", "bad_i8_unknown_type.json",
    "bad_i9_dim_ref.json", "bad_i9_reverse.json", "bad_id_index.json", "bad_missing_required.json",
    "bad_no_format.json", "bad_shape.json", "bad_units.json",
];

const DSH_ROOT = fileURLToPath(new URL("../", import.meta.url));
const DESKTOP = resolve(process.env.DESKTOP_REPO ?? join(DSH_ROOT, "..", "Camind-desktop"));
const CAM_AGENT = resolve(process.env.CAM_AGENT_REPO ?? join(DSH_ROOT, "..", "CAM-Agent"));
const FIXTURES = join(DESKTOP, "tests", "fixtures", "draft");
// 期望码集合与好包文件名的唯一事实源是 Desktop 生成器：BAD_CASES 经只读 import 取得
// （生成器只用标准库且以 `if __name__ == "__main__"` 守卫 main()，模块级无写盘副作用；
// 探针在导入生成器前禁字节码缓存，不向相邻仓库写 __pycache__），好包文件名从生成器源码中
// `good_path = os.path.join(OUT, "<name>.json")` 唯一赋值点解析（多处出现即判歧义失败）。
// 包文件本身由 `python3 tools/gen_draft_fixtures.py --selfcheck` 生成并入库，不再要求单独 manifest.json。
// GIT_DIR/GIT_WORK_TREE/GIT_INDEX_FILE 会把 git 引到别的仓库/工作树/索引，
// GIT_COMMON_DIR/GIT_OBJECT_DIRECTORY/GIT_ALTERNATE_OBJECT_DIRECTORIES/GIT_NAMESPACE 会把
// refs/对象库引到别处（影响 rev-parse/ls-files/HEAD:path）；GIT_CONFIG_PARAMETERS 与
// GIT_CONFIG_COUNT+GIT_CONFIG_KEY_<n>+GIT_CONFIG_VALUE_<n> 可注入任意 git 配置
// （core.excludesFile/fsmonitor 等会改变 status 输出）；GIT_EXEC_PATH 改变子命令解析、
// GIT_TRACE* 追踪族（GIT_TRACE2_EVENT 等）会把 trace 写进指定文件（写盘副作用落在被看守
// 仓库内即误报漂移）：所有 git 调用统一经 gitSafe 删除这十个变量，并按命名规约连带删除
// GIT_CONFIG_KEY_*/GIT_CONFIG_VALUE_* 配对族与 GIT_TRACE* 追踪族
// （statusOf 另含 rev-parse --show-toplevel 自校验兜底 toplevel 改变的重定向面）。
// 变量集合是精选而非完备性证明；行为负控覆盖前五个路径变量、GIT_CONFIG_* 配置注入与
// GIT_TRACE2_EVENT 写盘（DIR/WORK_TREE/INDEX_FILE/COMMON_DIR/OBJECT_DIRECTORY、
// CONFIG_PARAMETERS/CONFIG_COUNT 族、TRACE2_EVENT），
// 后两项（ALTERNATE_OBJECT_DIRECTORIES/NAMESPACE）与 GIT_EXEC_PATH 只有删除与一致性断言，
// 无 raw counterfactual（这些变量下不产生可区分的 status 输出差）。
const GIT_REDIRECT_VARS = ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_COMMON_DIR", "GIT_OBJECT_DIRECTORY", "GIT_ALTERNATE_OBJECT_DIRECTORIES", "GIT_NAMESPACE", "GIT_CONFIG_PARAMETERS", "GIT_CONFIG_COUNT", "GIT_EXEC_PATH"];
// GIT_CONFIG_KEY_<n>/GIT_CONFIG_VALUE_<n> 家族由 GIT_CONFIG_COUNT 门控（git 只读前 COUNT 对），
// 但家族成员编号可任意散落，按命名规约整体删除更稳；GIT_TRACE 家族（TRACE/TRACE2_EVENT/
// TRACE_PACKET 等）同理按前缀删除。
const GIT_CONFIG_PAIR_RE = /^GIT_CONFIG_(KEY|VALUE)_\d+$/;
const GIT_TRACE_RE = /^GIT_TRACE/;
const gitSafe = (env) => {
    const clean = { ...(env ?? process.env) };
    for (const v of GIT_REDIRECT_VARS) delete clean[v];
    for (const k of Object.keys(clean)) if (GIT_CONFIG_PAIR_RE.test(k) || GIT_TRACE_RE.test(k)) delete clean[k];
    return clean;
};

const generatorDir = join(DESKTOP, "tools");
const generatorFile = join(generatorDir, "gen_draft_fixtures.py");
assert.ok(existsSync(generatorFile), `缺少 ${generatorFile}`);
// 最早一批 git 调用前的中文前置：两个相邻仓库必须都是 git 工作树根，否则 ls-files/status
// 抛英文 stderr（statusOf 内的同款判定要到守卫段才生效，覆盖不到这里）。
for (const repo of [DESKTOP, CAM_AGENT]) {
    let top;
    try {
        top = execFileSync("git", ["-C", repo, "rev-parse", "--show-toplevel"], { encoding: "utf8", timeout: 15000, env: gitSafe() }).trim();
    } catch (err) {
        throw new Error(`前置检查失败：${repo} 不是 git 工作树（DESKTOP_REPO/CAM_AGENT_REPO 必须指向 git 检出）: ${err.message}`, { cause: err });
    }
    if (realpathSync(top) !== realpathSync(repo))
        throw new Error(`前置检查失败：${repo} 不是 git 工作树根（rev-parse 解析到 ${top}）；DESKTOP_REPO/CAM_AGENT_REPO 必须指向工作树根`);
}
// 生成器（期望码的 oracle）与夹具同纪律：必须被 git 跟踪且工作树干净；
// 「差分来源」行同时打印工作树 sha256 与 HEAD blob sha，来源可回溯。
execFileSync("git", ["-C", DESKTOP, "ls-files", "--error-unmatch", "--", "tools/gen_draft_fixtures.py"], { encoding: "utf8", timeout: 15000, env: gitSafe() });
assert.equal(execFileSync("git", ["--no-optional-locks", "-C", DESKTOP, "-c", "core.fsmonitor=false", "-c", "core.untrackedCache=false", "status", "--porcelain", "--", "tools/gen_draft_fixtures.py"], { encoding: "utf8", timeout: 15000, env: gitSafe() }).trim(), "",
    "生成器 tools/gen_draft_fixtures.py 须为已提交干净基线（期望码 oracle；有改动请先提交或 checkout）");
// CAM-Agent 侧 Python oracle 同纪律：draft_packcheck.py 必须被跟踪且工作树干净，
// 否则差分跑的是脏实现而日志仍显示 CAM-Agent@HEAD。
const packcheckPy = join(CAM_AGENT, "Drawing_parser", "draft_packcheck.py");
assert.ok(existsSync(packcheckPy), `缺少 ${packcheckPy}`);
execFileSync("git", ["-C", CAM_AGENT, "ls-files", "--error-unmatch", "--", "Drawing_parser/draft_packcheck.py"], { encoding: "utf8", timeout: 15000, env: gitSafe() });
assert.equal(execFileSync("git", ["--no-optional-locks", "-C", CAM_AGENT, "-c", "core.fsmonitor=false", "-c", "core.untrackedCache=false", "status", "--porcelain", "--", "Drawing_parser/draft_packcheck.py"], { encoding: "utf8", timeout: 15000, env: gitSafe() }).trim(), "",
    "Drawing_parser/draft_packcheck.py 须为已提交干净基线（Python oracle；有改动请先提交或 checkout）");
// 受控内容零漂移（比 git 可见状态更强）：生成器与 draft_packcheck.py 的 sha256 在探针前后、
// 全部夹具在差分结束后必须逐字节不变——覆盖「既有 dirty/untracked 文件被内容改写」的 status 盲区。
const sha256Of = file => createHash("sha256").update(readFileSync(file)).digest("hex");
const oracleStatic = [["generator", generatorFile], ["draft_packcheck.py", packcheckPy]];
// 好包文件名在 JS 侧从生成器源码解析（剔除 # 注释行，与探针内 Python 侧同一规约；两侧各自
// 解析并以一致性断言兜底，不是同源证明）。夹具清单在探针前即可完整确定：oracleFiles 与哈希
// 在探针前采集，探针失败路径同样覆盖全部受控文件。
const goodNameMatches = [...readFileSync(generatorFile, "utf8").split("\n").filter(line => !line.trimStart().startsWith("#")).join("\n").matchAll(/good_path\s*=\s*os\.path\.join\(OUT, "([^"]+\.json)"\)/g)].map(m => m[1]);
assert.equal(goodNameMatches.length, 1, `生成器 good_path 赋值点不唯一或缺失: ${JSON.stringify(goodNameMatches)}`);
const goodName = goodNameMatches[0];
const oracleFiles = [
    ...oracleStatic,
    ...[goodName, ...EXPECTED_BAD_CASES].map(name => [name, join(FIXTURES, name)]),
];
for (const [, file] of oracleFiles)
    assert.ok(existsSync(file), `缺少夹具包 ${file}；先在 Desktop 运行 python3 tools/gen_draft_fixtures.py --selfcheck`);
// assume-unchanged / skip-worktree 是 status 盲区：受控文件不得带 h/S 标记，否则内容改写对守卫不可见。
// ls-files -v tag 语义（本机 git 2.54.0 实测）：常规大写 H/S/M/R/C/K/?，assume-unchanged
// 叠加后变小写；skip-worktree+assume-unchanged 同置位输出小写 s（只钉 h/S 会漏检该组合形态）。
// assume-unchanged（任何小写 tag）与 skip-worktree（S/s）都让内容改写对 status 不可见。
const isStatusInvisibleTag = line => /^[a-zS] /.test(line);
for (const repo of [DESKTOP, CAM_AGENT]) {
    const marked = execFileSync("git", ["-C", repo, "ls-files", "-v"], { encoding: "utf8", timeout: 15000, maxBuffer: 16 * 1024 * 1024, env: gitSafe() })
        .split("\n").filter(isStatusInvisibleTag);
    assert.deepEqual(marked, [], `${repo} 含 assume-unchanged/skip-worktree 标记文件（任何小写 tag 或大写 S；零漂移盲区）: ${JSON.stringify(marked.slice(0, 5))}`);
}
const oracleHashesBefore = oracleFiles.map(([name, file]) => [name, sha256Of(file)]);
const assertOracleUnchanged = where => {
    oracleFiles.forEach(([name, file], i) =>
        assert.equal(sha256Of(file), oracleHashesBefore[i][1], `${where}：受控文件 ${name} 内容被改写`));
};
// importlib 按绝对路径加载，不做 sys.path 前插；-I 隔离模式之外再显式剔除空/cwd 项
// （-I 隐含 -P 仅 Python ≥3.11），避免相邻仓库或调用方目录劫持模块解析。
// 好包文件名正则耦合生成器的 `good_path = os.path.join(OUT, "<双引号>.json")` 写法，
// 生成器改写 Path/单引号会 fail-closed（误伤可接受，结构化导出走 Desktop 跨仓后续）。
// 零写入守卫：探针运行前后比较 Desktop 与 CAM-Agent 全仓的 git 状态（含 ignored），
// 任何路径下漂移都 fail-closed；探针失败也会先核对再抛错。
// 前置要求：DESKTOP_REPO 与 CAM_AGENT_REPO 都是 git 工作树（非工作树时给中文前置提示）。
// 零漂移边界：git 可见零漂移 = 全仓 git 状态（含 ignored 项）不变；porcelain 对 ignored
// ——既有 ignored 文件的内容改写不可见（git status 不比对内容；新建 ignored 文件在 -uall
// 下逐条可见；空目录本就不进入 git 状态，是 git 不变量而非本守卫的盲区；
// .pyc 改写由代码内 sys.dont_write_bytecode = True 抑制，-I 隐含 -E，环境变量不生效，
// 没有第二条抑制机制）；.DS_Store 类无关抖动先过滤。覆盖范围 = 两仓库内（仓库外写盘不在
// 承诺内）。porcelain 解析按行切片（slice(3)），含转义/引号路径的极端形态不在覆盖内（-z 待办）。
// 未跟踪与 ignored 文件都用 -uall 逐文件列出（消除未跟踪/ignored 目录折叠盲区；ignored 文件
// 内容改写仍是盲区，由 dont_write_bytecode 抑制 .pyc）。
// 只过滤未跟踪/ignored 的 .DS_Store 抖动；rename 行与 tracked 修改不过滤（已知边界）。
const filterDsStore = text => text.split("\n").filter(line => {
    const status = line.slice(0, 2);
    if (status !== "??" && status !== "!!") return true;
    const p = line.slice(3).replace(/^"|"$/g, "");
    return p.split("/").pop() !== ".DS_Store";
}).join("\n");
const statusOf = (repo, scope, env) => {
    let out;
    try {
        out = execFileSync("git", ["--no-optional-locks", "-C", repo, "-c", "status.showUntrackedFiles=all", "-c", "status.renames=true", "-c", "core.fsmonitor=false", "-c", "core.untrackedCache=false", "status", "--porcelain", "--ignored=traditional", "--", scope], { encoding: "utf8", timeout: 15000, maxBuffer: 16 * 1024 * 1024, env: gitSafe(env) });
        // 自校验：工作树根必须等于目标路径（linked worktree 的 .git 是指针文件，
        // rev-parse --git-dir 指向主仓管理目录，故不能按 git-dir 判定）。本检查只兜底
        // 「toplevel 改变」的重定向；指向「有效但错误」对象库且 toplevel 不变的形态不由本
        // 自校验覆盖，由 gitSafe 的变量删除承担。
        const top = execFileSync("git", ["-C", repo, "rev-parse", "--show-toplevel"], { encoding: "utf8", timeout: 15000, env: gitSafe(env) }).trim();
        if (realpathSync(top) !== realpathSync(repo))
            throw new Error(`worktree 错位: ${top}`);
    } catch (err) {
        if (/not a git repository/i.test(String(err.stderr || err.message)))
            throw new Error(`零漂移守卫前置失败：${repo} 不是 git 工作树（DESKTOP_REPO/CAM_AGENT_REPO 必须指向 git 检出）`, { cause: err });
        if (/worktree 错位/.test(String(err.message)))
            throw new Error(`零漂移守卫自校验失败：${repo} 的 git 工作树根与目标路径不一致（存在 GIT_* 重定向，或目标路径不是工作树根）`, { cause: err });
        if (/ENOBUFS|maxBuffer/i.test(String(err.message)))
            throw new Error(`零漂移守卫的 git status 输出超限（${repo} ${scope}）：ignored/未跟踪体量过大，请清理或减小范围`, { cause: err });
        if (/ETIMEDOUT/i.test(String(err.message)))
            throw new Error(`零漂移守卫的 git status 超时（${repo} ${scope}）：体量过大或磁盘繁忙`, { cause: err });
        throw new Error(`零漂移守卫的 git status 执行失败（${repo} ${scope}）: ${err.message}`, { cause: err });
    }
    return filterDsStore(out);
};
// 漂移判定附实际漂移行（对称差分，调用方负责截断展示）。
const statusDiff = (before, after) => {
    const b = new Set(before.split("\n").filter(Boolean));
    const a = new Set(after.split("\n").filter(Boolean));
    return [...a].filter(line => !b.has(line)).concat([...b].filter(line => !a.has(line)).map(line => `(removed) ${line}`));
};
const desktopStatusT0 = Date.now();
const desktopStatusBefore = statusOf(DESKTOP, ".");
const camAgentStatusBefore = statusOf(CAM_AGENT, ".");
const statusMs = Date.now() - desktopStatusT0;
// oracle 传递导入面：runPython 经 sys.path.insert(0, parserDir) 前插导入，Drawing_parser/ 下
// 被传递导入的兄弟模块若 dirty/未跟踪，差分跑的就是脏实现，而 drift 守卫判不出（dirty 前后不变）。
// 断言该目录状态行全为 !!（本地 .venv/__pycache__ 等 ignored 噪音允许），即零 ??、零受控改动。
const parserDirStatus = statusOf(CAM_AGENT, "Drawing_parser/").split("\n").filter(Boolean);
assert.ok(parserDirStatus.every(l => l.startsWith("!!")),
    `Drawing_parser/ 须无未跟踪文件与受控改动（oracle 传递导入面；!! ignored 项允许）: ${JSON.stringify(parserDirStatus.filter(l => !l.startsWith("!!")).slice(0, 10))}`);
// sys.path.insert(0, parserDir) 使该目录顶层任何 .py 都能遮蔽 stdlib/传递导入——ignored 形态
// 的顶层 .py 不经 git 评审，同样拒绝（.venv/__pycache__ 内的不参与该路径解析，允许）。
assert.ok(!parserDirStatus.some(l => /^!! Drawing_parser\/[^/]+\.py$/.test(l)),
    `Drawing_parser/ 顶层不允许存在 ignored .py（sys.path 前插遮蔽面）: ${JSON.stringify(parserDirStatus.filter(l => /\.py$/.test(l)).slice(0, 10))}`);
// 守卫负控：在临时 git 仓库内制造未跟踪新增(??)、已跟踪改写( M)、rename(R)、ignored 新增(!!)
// 与 tracked .DS_Store 改写五类变化，statusOf 必须全部检出；另钉住两条已知边界——既有 ignored
// 文件内容改写不改变状态输出（git status 不比对内容；ignored 目录内新增在 -uall 下逐条可见，
// 未跟踪目录内新增必须检出）。负控仓库经 GIT_CONFIG_GLOBAL=/dev/null 与 core.hooksPath=/dev/null
// 隔离全局配置与钩子。
{
    // gitSafe 双副本一致性钉（双向）：①行为断言——gitSafe 对探针对象必须清空（固定变量 +
    // GIT_CONFIG_KEY/VALUE 配对族，null 与无参同语义）；②副本比对——with-scissor.mjs 的
    // gitSafeEnv 文本钉变量集合指纹 + import 后行为钉逐键相等/null 同语义。
    // 单边增删变量时此处先红，两副本须显式同步。
    assert.deepEqual(gitSafe(Object.fromEntries(GIT_REDIRECT_VARS.map(v => [v, "x"]))), {}, "gitSafe 未能清空全部重定向变量");
    assert.deepEqual(gitSafe({ GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "a", GIT_CONFIG_VALUE_0: "b", GIT_TRACE2_EVENT: "/tmp/x", keep: "1" }), { keep: "1" }, "gitSafe 未能清空 GIT_CONFIG_KEY/VALUE 配对族或 GIT_TRACE* 追踪族");
    assert.deepEqual(gitSafe(null), gitSafe(), "gitSafe(null) 与 gitSafe() 语义须一致（null 走 process.env）");
    const wsSource = readFileSync(new URL("../ui-drawing-viewer/with-scissor.mjs", import.meta.url), "utf8");
    // 文本钉只保留变量集合指纹且限定 gitSafeEnv 函数体（整文件正则会把注释/错误串里的
    // "GIT_..." 字面量误计入）；函数体格式变化导致 [\s\S]*?\n} 提取截断、或变量列表被提为
    // 模块常量等等价重写，都会让集合断言误报「漂移」（已知过敏面，接受：误红时人工核对并
    // 同步提取规约）。
    const wsFuncBody = wsSource.match(/export function gitSafeEnv[\s\S]*?\n}/);
    assert.ok(wsFuncBody, "with-scissor.mjs 未匹配到 gitSafeEnv 函数体（副本一致性钉无从比对）");
    const wsVars = [...wsFuncBody[0].matchAll(/"(GIT_[A-Z_]+)"/g)].map(m => m[1]);
    assert.deepEqual([...new Set(wsVars)].sort(), [...GIT_REDIRECT_VARS].sort(), "with-scissor.mjs 的 gitSafeEnv 变量集合与 three-way 的 GIT_REDIRECT_VARS 不一致（两副本漂移，或函数体格式变化致提取截断——核对后同步）");
    // 行为钉（with-scissor.mjs 纯导出、无模块级副作用，可安全 import）：同一探针 env 下两副本
    // 逐键相等；null 入参同语义。覆盖配对族与默认参数行为，不再依赖实现文本断言。
    const crossProbe = Object.fromEntries([...GIT_REDIRECT_VARS, "GIT_CONFIG_KEY_0", "GIT_CONFIG_VALUE_0", "GIT_TRACE2_EVENT", "keep"].map(v => [v, "x"]));
    assert.deepEqual(gitSafeEnv(crossProbe), gitSafe(crossProbe), "gitSafeEnv 与 gitSafe 清理行为不一致（两副本漂移）");
    assert.deepEqual(gitSafeEnv(null), gitSafe(null), "gitSafeEnv/gitSafe 的 null 入参语义不一致（两副本漂移）");
    const probeRepo = mkdtempSync(join(tmpdir(), "camind-guard-"));
    // guardEnv 必须先过 gitSafe：调用方环境（如 Git hook）可能带 GIT_DIR/GIT_WORK_TREE 等
    // 重定向变量，raw 侧负控刻意不做 gitSafe，基线不洁会把调用方仓库当探测对象（误报/空转）。
    const guardEnv = gitSafe({ ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" });
    assert.ok(GIT_REDIRECT_VARS.every(v => !(v in guardEnv)), "guardEnv 必须不含重定向/注入变量（raw 侧负控只携带刻意污染）");
    const guardGit = (args, opts) => execFileSync("git", args, { encoding: "utf8", timeout: 15000, env: gitSafe(guardEnv), ...opts });
    try {
        guardGit(["-c", "core.hooksPath=/dev/null", "init", "-q", probeRepo]);
        guardGit(["-C", probeRepo, "config", "core.excludesFile", "/dev/null"]); // 隔离全局 excludes，保证 ?? 分支真实可测
        const guard = () => statusOf(probeRepo, "tools/", guardEnv);
        mkdirSync(join(probeRepo, "tools"));
        writeFileSync(join(probeRepo, "tools", "x.txt"), "1");
        assert.ok(guard().includes("?? tools/x.txt"), "零漂移守卫未按 -uall 逐文件检出未跟踪新增");
        writeFileSync(join(probeRepo, "tools", "z.txt"), "0");
        assert.ok(guard().includes("?? tools/z.txt"), "未跟踪目录内新增文件必须检出（-uall 无折叠盲区）");
        guardGit(["-C", probeRepo, "add", "tools/x.txt"]);
        guardGit(["-C", probeRepo, "-c", "user.email=guard@test", "-c", "user.name=guard", "-c", "commit.gpgsign=false", "commit", "-qm", "init"]);
        writeFileSync(join(probeRepo, "tools", "x.txt"), "2");
        assert.ok(guard().includes(" M "), "零漂移守卫未检出已跟踪文件改写");
        // git mv 作用于已改写文件（内容 1→2）：index 保留旧 blob、worktree 含新内容，
        // status.renames 按 inexact rename 检出为 "RM" 行（本机 git 2.54.0 实测；断言形态
        // /^R.{0,2}/ 同时接受 "R " 与 "RM"，git 行为变化时此处先红提示重校准）。
        guardGit(["-C", probeRepo, "mv", "tools/x.txt", "tools/y.txt"]);
        assert.match(guard(), /^R.{0,2}tools\/x\.txt -> tools\/y\.txt/m, "零漂移守卫未检出 rename（rename 行不得被 .DS_Store 过滤误伤）");
        // h/S 过滤负控（本机 git 2.54.0 实测形态）：skip-worktree 与 assume-unchanged 分两次
        // 置位后输出小写 s（单次调用同传两旗标的叠加顺序不保证同形态，故分步），必须被过滤器
        // 捕获（只钉 h/S 的写法会漏掉组合形态）；用后复位不影响后续用例。
        guardGit(["-C", probeRepo, "update-index", "--skip-worktree", "tools/y.txt"]);
        guardGit(["-C", probeRepo, "update-index", "--assume-unchanged", "tools/y.txt"]);
        const yLine = guardGit(["-C", probeRepo, "ls-files", "-v"]).split("\n").find(l => l.endsWith("tools/y.txt"));
        assert.ok(yLine && isStatusInvisibleTag(yLine), `组合标记必须被过滤器捕获: ${JSON.stringify(yLine)}`);
        assert.equal(yLine[0], "s", "组合标记的 ls-files -v tag 应为小写 s（git 行为变化时此钉先红）");
        guardGit(["-C", probeRepo, "update-index", "--no-skip-worktree", "--no-assume-unchanged", "tools/y.txt"]);
        // GIT_* 泄漏会把 git 引到别的仓库：statusOf 必须隔离。负控全程 hermetic——引入第三个
        // 临时仓库 otherRepo 作为「错误仓库」，变异侧的未隔离调用只落在 probeRepo/otherRepo 上，
        // 真实 Desktop/CAM-Agent 全程零未隔离 git 调用（避免 index 刷新等副作用）。
        const otherRepo = mkdtempSync(join(tmpdir(), "camind-guard-other-"));
        const cleanView = guard();
        try {
            guardGit(["-c", "core.hooksPath=/dev/null", "init", "-q", otherRepo]);
            writeFileSync(join(otherRepo, "other.txt"), "other");
            guardGit(["-C", otherRepo, "add", "other.txt"]);
            guardGit(["-C", otherRepo, "-c", "user.email=guard@test", "-c", "user.name=guard", "-c", "commit.gpgsign=false", "commit", "-qm", "other"]);
            // 变异侧逐变量钉死失败形态（本机 git 2.54.0 实测）：GIT_DIR/GIT_WORK_TREE 重定向后
            // 命令仍成功但读到错误仓库（输出必须不同）；GIT_INDEX_FILE 指向目录、
            // GIT_COMMON_DIR/GIT_OBJECT_DIRECTORY 重定向对象库时 status 必然抛错（rc=128）。
            // raw 调用 stderr 管道化不转发父进程，日志不留 fatal 噪音（err.stderr 仍可供断言排查）。
            for (const leakVar of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_COMMON_DIR", "GIT_OBJECT_DIRECTORY"]) {
                const leakedEnv = { ...guardEnv, [leakVar]: join(otherRepo, ".git") };
                const mustThrow = leakVar !== "GIT_DIR" && leakVar !== "GIT_WORK_TREE";
                // 隔离侧：必须把泄漏 env 传给 statusOf，gitSafe 生效时结果与无污染基线一致。
                assert.equal(statusOf(probeRepo, "tools/", leakedEnv), cleanView, `${leakVar} 泄漏未被隔离：statusOf 读到了错误的仓库`);
                // GIT_NAMESPACE 与 GIT_ALTERNATE_OBJECT_DIRECTORIES 无可区分反例（实测：GIT_NAMESPACE
                // 下 refs/heads/<branch> 与 HEAD 仍正常解析，ALTERNATE 只做增量补充），维持「仅删除与
                // 一致性断言」的接受理由（见文件头注释）。
                let rawErr = null, rawDiffers = false;
                try {
                    const rawView = execFileSync("git", ["-C", probeRepo, "-c", "status.showUntrackedFiles=all", "-c", "status.renames=true", "-c", "core.fsmonitor=false", "-c", "core.untrackedCache=false", "status", "--porcelain", "--ignored=traditional", "--", "tools/"], { encoding: "utf8", timeout: 15000, maxBuffer: 16 * 1024 * 1024, env: leakedEnv, stdio: ["ignore", "pipe", "pipe"] });
                    rawDiffers = statusDiff(cleanView, filterDsStore(rawView)).length > 0;
                } catch (err) { rawErr = err; }
                if (mustThrow) assert.ok(rawErr !== null, `${leakVar} 未隔离时必须实际抛错（git 行为变化时此断言先红，提示负控需重校准）`);
                else assert.ok(rawErr === null && rawDiffers, `${leakVar} 未隔离时必须成功且读到错误仓库（输出与基线不同，否则泄漏负控空转）`);
            }
            // GIT_CONFIG_PARAMETERS 与 GIT_CONFIG_COUNT 族可注入任意 git 配置：以 core.excludesFile
            // 指向「排除 tools/z.txt」的文件为反例——未隔离时 ?? tools/z.txt 行必须消失（否则负控
            // 空转），隔离后结果必须回到无污染基线。
            const leakedExcludes = join(probeRepo, "leaked-excludes");
            writeFileSync(leakedExcludes, "tools/z.txt\n");
            for (const leakedEnv of [
                { ...guardEnv, GIT_CONFIG_PARAMETERS: `'core.excludesFile=${leakedExcludes}'` },
                { ...guardEnv, GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "core.excludesFile", GIT_CONFIG_VALUE_0: leakedExcludes },
            ]) {
                assert.equal(statusOf(probeRepo, "tools/", leakedEnv), cleanView, "GIT_CONFIG_* 配置注入未被隔离");
                const rawView = execFileSync("git", ["-C", probeRepo, "-c", "status.showUntrackedFiles=all", "-c", "status.renames=true", "-c", "core.fsmonitor=false", "-c", "core.untrackedCache=false", "status", "--porcelain", "--ignored=traditional", "--", "tools/"], { encoding: "utf8", timeout: 15000, maxBuffer: 16 * 1024 * 1024, env: leakedEnv });
                assert.ok(statusDiff(cleanView, filterDsStore(rawView)).length > 0, "GIT_CONFIG_* 配置注入在未隔离时必须实际影响结果（否则负控空转）");
                assert.ok(!rawView.includes("?? tools/z.txt"), "GIT_CONFIG_* 注入反例未命中目标：未隔离时 ?? tools/z.txt 行必须消失（其他差异不能顶替）");
            }
            // GIT_TRACE2_EVENT 把 trace 写进指定文件（真实写盘副作用）：未隔离时 raw 调用在
            // probeRepo 留下 ?? tools/trace.log（漂移误报源），隔离后文件不得产生；用后清理。
            const traceFile = join(probeRepo, "tools", "trace.log");
            const tracedEnv = { ...guardEnv, GIT_TRACE2_EVENT: traceFile };
            assert.equal(statusOf(probeRepo, "tools/", tracedEnv), cleanView, "GIT_TRACE* 写盘副作用未被隔离");
            assert.ok(!existsSync(traceFile), "隔离后 trace 文件不得产生");
            execFileSync("git", ["-C", probeRepo, "-c", "status.showUntrackedFiles=all", "-c", "status.renames=true", "-c", "core.fsmonitor=false", "-c", "core.untrackedCache=false", "status", "--porcelain", "--ignored=traditional", "--", "tools/"], { encoding: "utf8", timeout: 15000, maxBuffer: 16 * 1024 * 1024, env: tracedEnv, stdio: ["ignore", "pipe", "pipe"] });
            assert.ok(existsSync(traceFile), "未隔离时 trace 文件必须实际产生（否则追踪负控空转）");
            rmSync(traceFile, { force: true });
            writeFileSync(join(probeRepo, "root.txt"), "0");
            assert.ok(statusOf(probeRepo, ".", guardEnv).includes("?? root.txt"), "零漂移守卫未检出根级未跟踪新增");
            // 行为性证明：statusOf 的默认 env 路径（process.env）同样被 gitSafe 清理——临时把
            // GIT_DIR 放进 process.env（保存并恢复；注入目标为 otherRepo，与泄漏负控同一隔离口径），
            // 不传第三参也必须得到无污染结果（未清理时会读到 otherRepo 的状态而失败）。
            // 比较基线 cleanView 出自 guardEnv（GIT_CONFIG_GLOBAL=/dev/null 等），本用例把这两个
            // 隔离变量也临时放进 process.env（保存/恢复），与开发者全局 gitconfig 解耦。
            const savedGitEnv = {};
            for (const k of ["GIT_DIR", "GIT_CONFIG_GLOBAL", "GIT_CONFIG_NOSYSTEM"]) savedGitEnv[k] = process.env[k];
            process.env.GIT_DIR = join(otherRepo, ".git");
            process.env.GIT_CONFIG_GLOBAL = "/dev/null";
            process.env.GIT_CONFIG_NOSYSTEM = "1";
            let defaultEnvView;
            try {
                defaultEnvView = statusOf(probeRepo, "tools/");
            } finally {
                for (const k of Object.keys(savedGitEnv)) {
                    if (savedGitEnv[k] === undefined) delete process.env[k];
                    else process.env[k] = savedGitEnv[k];
                }
            }
            assert.equal(defaultEnvView, cleanView, "statusOf 默认 env 路径未消费/清理 process.env 中的 GIT_DIR");
        } finally {
            rmSync(otherRepo, { force: true, recursive: true });
        }
        // ??/!! 的 .DS_Store 抖动被显式过滤：先证原始输出确有该行，再证过滤后消失（两段防空转）。
        const rawStatus = () => execFileSync("git", ["-C", probeRepo, "-c", "status.showUntrackedFiles=normal", "-c", "status.renames=true", "-c", "core.fsmonitor=false", "-c", "core.untrackedCache=false", "status", "--porcelain", "--ignored"], { encoding: "utf8", timeout: 15000, env: gitSafe(guardEnv) });
        writeFileSync(join(probeRepo, ".DS_Store"), "0");
        assert.ok(rawStatus().split("\n").some(l => l.startsWith("??") && l.endsWith(".DS_Store")), "负控前置：原始输出必须含 ?? .DS_Store 行（否则 ?? 分支空转）");
        assert.ok(!statusOf(probeRepo, ".", guardEnv).split("\n").some(l => l.startsWith("??") && l.split("/").pop() === ".DS_Store"),
            "untracked .DS_Store 必须被过滤（?? 抖动）");
        writeFileSync(join(probeRepo, ".gitignore"), ".DS_Store\n");
        assert.ok(rawStatus().split("\n").some(l => l.startsWith("!!") && l.endsWith(".DS_Store")), "负控前置：原始输出必须含 !! .DS_Store 行（否则 !! 分支空转）");
        assert.ok(!statusOf(probeRepo, ".", guardEnv).split("\n").some(l => l.startsWith("!!") && l.split("/").pop() === ".DS_Store"),
            "ignored .DS_Store 必须被过滤（!! 抖动）");
        // 子目录 !! 形态：gitignore 的无斜杠 ".DS_Store" 模式匹配任意层级，raw 必见
        // "!! tools/.DS_Store"，statusOf 按 basename 过滤必须滤掉（两段防空转）。
        writeFileSync(join(probeRepo, "tools", ".DS_Store"), "0");
        assert.ok(rawStatus().split("\n").some(l => l.startsWith("!!") && l.endsWith("tools/.DS_Store")), "负控前置：原始输出必须含 !! tools/.DS_Store 行（否则子目录 !! 分支空转）");
        assert.ok(!statusOf(probeRepo, ".", guardEnv).split("\n").some(l => l.split("/").pop() === ".DS_Store"), "子目录 ignored .DS_Store 必须被过滤（!! 抖动）");
        rmSync(join(probeRepo, "tools", ".DS_Store"), { force: true });
        rmSync(join(probeRepo, ".DS_Store"), { force: true });
        rmSync(join(probeRepo, ".gitignore"), { force: true });
        // 子目录 ?? 抖动同纪律两段式：根级用例只证了根路径行，过滤按 basename 判定，
        // 子目录行（?? tools/.DS_Store）另钉一次防空转（raw 全仓视角必须先见到该行）。
        writeFileSync(join(probeRepo, "tools", ".DS_Store"), "0");
        assert.ok(rawStatus().split("\n").some(l => l.startsWith("??") && l.endsWith("tools/.DS_Store")), "负控前置：原始输出必须含 ?? tools/.DS_Store 行（否则子目录 ?? 分支空转）");
        assert.ok(!guard().split("\n").some(l => l.split("/").pop() === ".DS_Store"), "子目录 untracked .DS_Store 必须被过滤（?? 抖动）");
        rmSync(join(probeRepo, "tools", ".DS_Store"), { force: true });
        writeFileSync(join(probeRepo, "tools", ".DS_Store"), "1");
        guardGit(["-C", probeRepo, "add", "-f", "tools/.DS_Store"]); // 全局 excludes 常忽略 .DS_Store，须强制纳入
        guardGit(["-C", probeRepo, "-c", "user.email=guard@test", "-c", "user.name=guard", "-c", "commit.gpgsign=false", "commit", "-qm", "ds"]);
        const committedDs = guard();
        assert.equal(committedDs.includes(".DS_Store"), false, "提交后干净快照不应出现 .DS_Store（否则断言是同义反复）");
        writeFileSync(join(probeRepo, "tools", ".DS_Store"), "2");
        assert.ok(guard().includes(" M tools/.DS_Store"), "tracked .DS_Store 修改必须仍被检出（过滤只针对 ??/!! 抖动）");
        writeFileSync(join(probeRepo, ".gitignore"), "tools/blob.bin\ntools/__pycache__/\n");
        guardGit(["-C", probeRepo, "add", ".gitignore"]);
        writeFileSync(join(probeRepo, "tools", "blob.bin"), "2");
        const beforeIgnored = guard();
        assert.ok(beforeIgnored.includes("!! tools/blob.bin"), "零漂移守卫未按 --ignored 列出 ignored 项");
        writeFileSync(join(probeRepo, "tools", "blob.bin"), "3");
        assert.equal(guard(), beforeIgnored, "既有 ignored 文件内容改写不应改变状态（已知边界）");
        mkdirSync(join(probeRepo, "tools", "__pycache__"));
        writeFileSync(join(probeRepo, "tools", "__pycache__", "a.pyc"), "4"); // 空目录本就不进入 git 状态（git 不变量）；含文件后 ignored 文件逐条显示
        const withIgnoredDir = guard();
        assert.ok(withIgnoredDir.includes("!! tools/__pycache__/a.pyc"), "新建 ignored 目录（含文件）必须可见（-uall 文件粒度）");
        writeFileSync(join(probeRepo, "tools", "__pycache__", "b.pyc"), "5");
        assert.ok(guard().includes("!! tools/__pycache__/b.pyc"), "-uall 下 ignored 目录内新增文件也必须检出（ignored 目录不再折叠）");
        // 全局 excludes 命中的新建文件在 -uall + traditional 下必须以 !! 逐条可见（真实路径沿用用户
        // 全局 excludes，此用例钉住该分支行为；负控仓库用 repo-local core.excludesFile 模拟）。
        writeFileSync(join(probeRepo, "global-excludes"), "tools/skip.me\n");
        guardGit(["-C", probeRepo, "config", "core.excludesFile", join(probeRepo, "global-excludes")]);
        writeFileSync(join(probeRepo, "tools", "skip.me"), "6");
        assert.ok(guard().includes("!! tools/skip.me"), "全局 excludes 命中的新建文件必须以 !! 可见");
        // linked worktree 正控（Codex P2 回归钉）：.git 为指针文件的 linked worktree 必须被
        // --show-toplevel 自校验接受（回退到 --git-dir 判定时此处必红）。
        // stderr 管道化：linked worktree 的 "Preparing worktree" 进度行不转发进父进程日志。
        guardGit(["-C", probeRepo, "worktree", "add", "--detach", join(probeRepo, "linked"), "HEAD"], { stdio: ["ignore", "pipe", "pipe"] });
        assert.ok(typeof statusOf(join(probeRepo, "linked"), ".", guardEnv) === "string", "linked worktree 必须被自校验接受");
    } finally {
        rmSync(probeRepo, { force: true, recursive: true });
    }
}
let manifestProbe, probeError;
try {
    manifestProbe = spawnSync(pythonExecutable(), [
        "-I",
        "-c",
        `import sys\nsys.dont_write_bytecode = True\nsys.path = [p for p in sys.path if p not in ("", ".")]\nimport importlib.util, json, re\nfrom pathlib import Path\nspec = importlib.util.spec_from_file_location("gen_draft_fixtures", ${JSON.stringify(generatorFile)})\ngen = importlib.util.module_from_spec(spec)\nspec.loader.exec_module(gen)\nsrc = "\\n".join(line for line in Path(${JSON.stringify(generatorFile)}).read_text(encoding="utf-8").split("\\n") if not line.lstrip().startswith("#"))\nmatches = re.findall(r'good_path\\s*=\\s*os\\.path\\.join\\(OUT, "([^"]+\\.json)"\\)', src)\nprint(json.dumps({"good": matches if matches else None, "cases": [{"file": name, "expected": sorted(wants)} for name, _fn, wants in gen.BAD_CASES]}))`,
    ], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024, timeout: 120000 }); // -I 隐含 -E，PYTHONDONTWRITEBYTECODE 不生效；.pyc 抑制靠代码内 dont_write_bytecode
} catch (err) {
    probeError = err; // 仅兜参数级同步异常；非零退出/超时走 manifestProbe.status/.error
}
// 无论探针成败都先判定漂移；drift 计算自身的异常也并入守卫备注，不掩盖探针根因。
// 漂移判定附实际漂移行（对称差分，截断 20 行），便于区分本脚本副作用与外部活动
// （运行期间相邻仓库须保持静默，见 README 前置约定）。
let desktopDriftLines = [], camAgentDriftLines = [], driftCalcErr = null;
try {
    desktopDriftLines = statusDiff(desktopStatusBefore, statusOf(DESKTOP, "."));
    camAgentDriftLines = statusDiff(camAgentStatusBefore, statusOf(CAM_AGENT, "."));
} catch (err) { driftCalcErr = err; }
const desktopDrift = desktopDriftLines.length > 0;
const camAgentDrift = camAgentDriftLines.length > 0;
const driftNote = `Desktop drift=${desktopDrift} CAM-Agent drift=${camAgentDrift}`
    + (desktopDrift ? ` Desktop行=${JSON.stringify(desktopDriftLines.slice(0, 20))}` : "")
    + (camAgentDrift ? ` CAM-Agent行=${JSON.stringify(camAgentDriftLines.slice(0, 20))}` : "")
    + (driftCalcErr ? ` drift计算异常=${driftCalcErr.message}` : "");
// 失败路径同样先做全部断言（git 漂移 + 全量受控文件内容），但与原始错误合并呈现，
// 不让守卫断言掩盖探针根因。
let guardErr = driftCalcErr;
try {
    assert.equal(desktopDrift, false, "生成器探针改变了 Desktop 的 git 状态（全仓，含 ignored）");
    assert.equal(camAgentDrift, false, "生成器探针改变了 CAM-Agent 的 git 状态（含 ignored）");
    assertOracleUnchanged("生成器探针后");
} catch (err) { guardErr = err; }
const guardNote = guardErr ? `；守卫断言同时失败: ${guardErr.message}` : "";
if (probeError) throw new Error(`生成器探针异常（${driftNote}）: ${probeError.message}${guardNote}`, { cause: probeError });
if (manifestProbe.status !== 0) throw new Error(`读取生成器 BAD_CASES 失败（${driftNote}）: ${manifestProbe.error?.message ?? ""}\n${manifestProbe.stderr || manifestProbe.stdout || ""}${guardNote}`);
if (guardErr) throw guardErr;
assert.ok(manifestProbe.stdout.trim().length > 0, "生成器探针无输出");
assert.equal(manifestProbe.stdout.trim().split("\n").length, 1, `生成器探针 stdout 应为单行 JSON，疑似顶层 print 污染:\n${manifestProbe.stdout}`);
const manifest = JSON.parse(manifestProbe.stdout);
assert.ok(Array.isArray(manifest.good) && manifest.good.length === 1, `生成器 good_path 赋值点不唯一或缺失: ${JSON.stringify(manifest.good)}`);
assert.equal(manifest.good[0], goodName, "探针与 JS 解析的 good_path 不一致（生成器源码存在多个写出点）");
// 负例覆盖：生成器案例集合的任何增删改名都在此处先红（期望码仍归生成器 BAD_CASES 单一事实源）。
assert.deepEqual(manifest.cases.map(c => c.file).sort(), EXPECTED_BAD_CASES, "生成器坏包案例集合被改动；合法变更需同步更新 EXPECTED_BAD_CASES");
const entries = [
    { file: manifest.good[0], expected: [] },
    ...manifest.cases.map(c => ({ file: c.file, expected: [...c.expected] })),
];
assert.ok(entries.length > 1 && entries.every(e => e.file && Array.isArray(e.expected)), "生成器提供的包清单为空或形态不对");
for (const entry of entries)
    assert.ok(existsSync(join(FIXTURES, entry.file)), `缺少夹具包 ${entry.file}；先在 Desktop 运行 python3 tools/gen_draft_fixtures.py --selfcheck`);
// 夹具必须是已提交且被 git 跟踪的干净基线：先验证每个 entry 文件被跟踪，再验证目录干净
// （「夹具内容漂移由 git diff 负责发现」的前提是这些文件确实受 git 跟踪）。
for (const entry of entries)
    execFileSync("git", ["-C", DESKTOP, "ls-files", "--error-unmatch", "--", join("tests/fixtures/draft", entry.file)], { encoding: "utf8", timeout: 15000, env: gitSafe() });
assert.equal(statusOf(DESKTOP, "tests/fixtures/draft/").trim(), "",
    "Desktop tests/fixtures/draft/ 须干净（夹具是已提交基线；有改动请先 checkout 或重跑生成器并提交）");
const packBytes = entries.map(e => readFileSync(join(FIXTURES, e.file)));
const packs = packBytes.map(bytes => JSON.parse(bytes.toString("utf8")));
// 内容漂移只记录不比对（见 README 边界）：生成器改包内容而未改期望码时，指纹变化在日志可见。
console.log(`夹具指纹（仅记录，不作断言）：${entries.map((e, i) => `${e.file}=${createHash("sha256").update(packBytes[i]).digest("hex")}`).join(" ")}`);
console.log(`差分来源（仅记录）：Desktop@${execFileSync("git", ["-C", DESKTOP, "rev-parse", "HEAD"], { encoding: "utf8", timeout: 15000, env: gitSafe() }).trim()} CAM-Agent@${execFileSync("git", ["-C", CAM_AGENT, "rev-parse", "HEAD"], { encoding: "utf8", timeout: 15000, env: gitSafe() }).trim()} generator工作树=${createHash("sha256").update(readFileSync(generatorFile)).digest("hex").slice(0, 16)} generatorHEADblob=${execFileSync("git", ["-C", DESKTOP, "rev-parse", "HEAD:tools/gen_draft_fixtures.py"], { encoding: "utf8", timeout: 15000, env: gitSafe() }).trim().slice(0, 16)} packcheck工作树=${createHash("sha256").update(readFileSync(packcheckPy)).digest("hex").slice(0, 16)} packcheckHEADblob=${execFileSync("git", ["-C", CAM_AGENT, "rev-parse", "HEAD:Drawing_parser/draft_packcheck.py"], { encoding: "utf8", timeout: 15000, env: gitSafe() }).trim().slice(0, 16)} git=${execFileSync("git", ["--version"], { encoding: "utf8", timeout: 15000, env: gitSafe() }).trim()} status行数 Desktop=${desktopStatusBefore.split("\n").filter(Boolean).length} CAM-Agent=${camAgentStatusBefore.split("\n").filter(Boolean).length} 两仓status合计耗时ms=${statusMs} Drawing_parser/状态行=${parserDirStatus.length}（全为!!，零??与受控改动已前置断言）`);

if (typeof stripTypeScriptTypes !== "function") throw new Error("TS 差分需要 Node.js 的 stripTypeScriptTypes（^22.19 或 >=24）");
const tsPath = join(DSH_ROOT, "ui-drawing-viewer", "src", "draft", "packcheck.ts");
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

function runPython(profile, inputPacks = packs) {
    const parserDir = join(CAM_AGENT, "Drawing_parser");
    // stdin 传 ~139KB 载荷在本机（macOS 26 + Node 25.7）间歇性卡死在子进程 read()；
    // 改经 mkdtemp 临时目录传参，消除 spawnSync stdin 管道面与可预测路径风险。
    // 已知边界：parserDir 经 sys.path.insert(0, ...) 前插导入 oracle——Drawing_parser/
    // 下模块若与标准库同名会遮蔽传递导入（导入 oracle 的固有代价，不接受改名引入的 fail-open）。
    const code = `
import sys
sys.dont_write_bytecode = True
sys.path = [p for p in sys.path if p not in ("", ".")]
import json
sys.path.insert(0, ${JSON.stringify(parserDir)})
import draft_packcheck as checker
payload = json.loads(open(sys.argv[2], encoding="utf-8").read())
profile = sys.argv[1]
results = []
for pack in payload:
    raw = checker.check(pack, profile)
    results.append({
        "errors": [e for e in raw if not e.startswith("skipped:")],
        "skipped": sorted([e[len("skipped:"):] for e in raw if e.startswith("skipped:")]),
    })
print(json.dumps(results, ensure_ascii=False))
`;
    let payloadDir, run, runError;
    try {
        payloadDir = mkdtempSync(join(tmpdir(), "camind-three-way-"));
        writeFileSync(join(payloadDir, `${profile}.json`), JSON.stringify(inputPacks), { mode: 0o600 });
        run = spawnSync(pythonExecutable(), ["-I", "-c", code, profile, join(payloadDir, `${profile}.json`)], {
            encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 120000,
        });
    } catch (err) {
        runError = err;
    } finally {
        if (payloadDir) {
            try {
                rmSync(payloadDir, { force: true, recursive: true });
            } catch (cleanupErr) {
                // 主错误已存在时不丢弃清理失败：降级为告警保留事实（残留位于 tmpdir，不进漂移守卫视野）。
                if (runError) console.warn(`临时载荷目录清理失败（次要，主错误已存在）: ${cleanupErr.message}`);
                else runError = new Error(`临时载荷目录清理失败: ${cleanupErr.message}`, { cause: cleanupErr });
            }
        }
    }
    // 失败路径（异常或非零退出）同样给出漂移终检结论（含实际漂移行），不丢弃零漂移证据；
    // drift 计算自身的异常也并入守卫备注，不掩盖子进程根因。
    let desktopFinalDriftLines = [], camAgentFinalDriftLines = [], driftCalcErr = null;
    try {
        desktopFinalDriftLines = statusDiff(desktopStatusBefore, statusOf(DESKTOP, "."));
        camAgentFinalDriftLines = statusDiff(camAgentStatusBefore, statusOf(CAM_AGENT, "."));
    } catch (err) { driftCalcErr = err; }
    const desktopFinalDrift = desktopFinalDriftLines.length > 0;
    const camAgentFinalDrift = camAgentFinalDriftLines.length > 0;
    const finalNote = `终检 drift: Desktop=${desktopFinalDrift} CAM-Agent=${camAgentFinalDrift}`
        + (desktopFinalDrift ? ` Desktop行=${JSON.stringify(desktopFinalDriftLines.slice(0, 20))}` : "")
        + (camAgentFinalDrift ? ` CAM-Agent行=${JSON.stringify(camAgentFinalDriftLines.slice(0, 20))}` : "")
        + (driftCalcErr ? ` drift计算异常=${driftCalcErr.message}` : "");
    // 失败路径同样先做全部机器断言（git 漂移 + 全量受控文件内容），但与子进程错误合并呈现。
    let guardErr = driftCalcErr;
    try {
        assert.equal(desktopFinalDrift, false, `Python ${profile} 改变了 Desktop 的 git 状态（全仓，含 ignored）: ${JSON.stringify(desktopFinalDriftLines.slice(0, 20))}`);
        assert.equal(camAgentFinalDrift, false, `Python ${profile} 改变了 CAM-Agent 的 git 状态（含 ignored）: ${JSON.stringify(camAgentFinalDriftLines.slice(0, 20))}`);
        assertOracleUnchanged(`Python ${profile} 后`);
    } catch (err) { guardErr = err; }
    const guardNote = guardErr ? `；守卫断言同时失败: ${guardErr.message}` : "";
    if (runError) throw new Error(`Python ${profile} 执行异常（${finalNote}）: ${runError.message}${run && run.status !== 0 && run.status !== null ? `；子进程同时非零退出: ${run.stderr || run.stdout}` : ""}${guardNote}`, { cause: runError });
    if (run.status !== 0) throw new Error(`Python ${profile} 差分执行失败（${finalNote}）: ${run.error?.message ?? ""}\n${run.stderr || run.stdout || ""}${guardNote}`);
    if (guardErr) throw guardErr;
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

// 多个未知类型按非字母序出现时，三方 skipped 语义仍一致；排序只为消除实体顺序差，不去重。
const forward = structuredClone(packs[0]);
for (const [id, type] of [[0, "ZFuture"], [14, "AFuture"]]) {
    const previous = forward.entities[id].type;
    const histogram = forward.coverage.entities_by_type;
    histogram[previous]--;
    if (histogram[previous] === 0) delete histogram[previous];
    forward.entities[id].type = type;
    histogram[type] = 1;
}
const forwardActual = {
    python: runPython("reader", [forward])[0],
    js: normalizeJs(checkJs(forward, "reader")),
    ts: normalizeTs(checkTs(forward, "reader")),
};
for (const [implementation, result] of Object.entries(forwardActual)) {
    assert.deepEqual(codes(result.errors), [], `reader 多未知类型 ${implementation} 应零拒绝`);
    assert.deepEqual(result.skipped, ["AFuture", "ZFuture"], `reader 多未知类型 ${implementation} skipped 排序/内容不一致`);
    assertions += 2;
}
console.log("ok - reader: ZFuture + AFuture 非字母序 skipped 归一化一致");

// 新增语义形态只由本地 JS/TS 双端差分；CAM-Agent Python 当前未实现这些新增校验，
// 不把旧三方 fixture 的全绿冒充成 Python 已覆盖新形态。
const semanticCases = [
    ["views", [{ id: 0, bbox: [0, 0, 0, 0] }], "DRAFT_E_SHAPE"],
    ["views", [{ id: "1", bbox: [0, 0, 0, 0] }], "DRAFT_E_SHAPE"],
    ["views", [{ id: 1, bbox: ["x", 0, 0, 0] }], "DRAFT_E_SHAPE"],
    ["title_block", { attributes: [null], found: false, inferred: false, rule_version: "x" }, "DRAFT_E_SHAPE"],
    ["tech_requirements", [{ text: "x", source_handle: "h", rule_version: "r" }], "DRAFT_E_SHAPE"],
    ["dims", {}, "DRAFT_E_SHAPE"],
];
for (const profile of ["writer", "reader"]) {
    for (const [key, value, expected] of semanticCases) {
        const pack = structuredClone(packs[0]);
        pack[key] = value;
        const js = normalizeJs(checkJs(pack, profile));
        const ts = normalizeTs(checkTs(pack, profile));
        assert.deepEqual(codes(js.errors), codes(ts.errors), `${profile} ${key} JS/TS 新增语义错误码集合不一致`);
        assert.ok(codes(js.errors).includes(expected), `${profile} ${key} 缺少 ${expected}: ${js.errors.join(";")}`);
        assert.deepEqual(js.skipped, ts.skipped, `${profile} ${key} JS/TS skipped 不一致`);
        assertions += 3;
    }
}
// 终检：所有 Python 子进程（生成器探针 + writer/reader 差分）结束后，两仓库相关目录状态仍须不变。
const endDesktopDrift = statusDiff(desktopStatusBefore, statusOf(DESKTOP, "."));
assert.equal(endDesktopDrift.length, 0, `差分执行改变了 Desktop 的 git 状态（含 ignored）: ${JSON.stringify(endDesktopDrift.slice(0, 20))}`);
const endCamAgentDrift = statusDiff(camAgentStatusBefore, statusOf(CAM_AGENT, "."));
assert.equal(endCamAgentDrift.length, 0, `差分执行改变了 CAM-Agent 的 git 状态（含 ignored）: ${JSON.stringify(endCamAgentDrift.slice(0, 20))}`);
assertOracleUnchanged("差分执行终检");
console.log("ok - JS/TS 新增语义负例一致（Python 旧版不覆盖这些新增形态）");

console.log(`三方差分完成：${entries.length * 2} 个包/档位组合 + 多未知类型守卫与本地 JS/TS 新增语义差分，${assertions} 项断言通过；不代表图纸已审或尺寸正确。`);
