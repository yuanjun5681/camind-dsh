#!/usr/bin/env node
// CLI:DWG/DXF → 契约 v1 图纸包 JSON(dwg_to_draft_v1.py 的替代入口)。
// 用法: node service-draft-converter/cli.mjs <输入.dwg|.dxf> <输出.json> [--dwg2dxf <路径>]
// 退出码:0 成功;1 转换失败/出包自检不过;2 参数错。

import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { convertDxfText } from "./lib/convert.js";
import { dwgToDxfText, libredwgVersion, resolveDwg2dxf } from "./lib/dwg.js";
import { checkDraftPack } from "./lib/packcheck.js";

function main() {
    const args = [];
    let dwg2dxfPath;
    const argv = process.argv.slice(2);
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === "--dwg2dxf" && i + 1 < argv.length) { dwg2dxfPath = argv[i + 1]; i++; continue; }
        if (argv[i].startsWith("--dwg2dxf=")) { dwg2dxfPath = argv[i].split("=", 2)[1]; continue; }
        args.push(argv[i]);
    }
    if (args.length !== 2) {
        console.error("用法: node cli.mjs <输入.dwg|.dxf> <输出.json> [--dwg2dxf <路径>]");
        process.exit(2);
    }
    const [input, output] = args;
    const srcBytes = readFileSync(input);
    const isDxf = /\.dxf$/i.test(input);
    let dxfText;
    if (isDxf) {
        dxfText = srcBytes.toString("utf8"); // DXF 直读入口(单测/调试)
    } else {
        dxfText = dwgToDxfText(input, { dwg2dxfPath });
    }
    const pack = convertDxfText(dxfText, {
        sourceName: basename(input),
        sourceBytes: srcBytes,
        libredwgVersion: isDxf ? "n/a(dxf 直读)" : libredwgVersion({ dwg2dxfPath }),
        converterVersion: process.env.npm_package_version ?? "dev",
    });
    const body = JSON.stringify(pack);
    // 出包前 writer 档已在 convert 内自检;此处 reader 档复核防御(零成本)
    const errs = checkDraftPack(pack, "reader").filter(e => !e.startsWith("skipped:"));
    if (errs.length) {
        console.error(`REJECT(reader 复核) ${basename(input)}: ${errs.join(";")}`);
        process.exit(1);
    }
    writeFileSync(output, body);
    const sc = pack.self_check;
    const dropped = Object.values(sc.dropped.by_type).reduce((a, b) => a + b, 0);
    console.log(`OK ${basename(input)}: 实体 ${sc.input_entities}=${sc.drawn_entities}出图+${dropped}丢弃`
        + `(对账过),dims ${pack.dims.length},tech ${pack.tech_requirements.length}`
        + `,真彩 ${sc.truecolor_count},ByBlock 回退 ${sc.byblock_fallback}`);
}

try {
    main();
} catch (e) {
    console.error(e.message);
    process.exit(1);
}
