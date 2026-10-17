// 文本出口三件套(ezdxf plain_mtext 与 dwg_to_draft_v1.py 的等价物,行为按 ezdxf 1.4.4 实测校准):
//   preStack      MTEXT 原串 \S上^下; 堆叠预线性化(在剥码之前,审查两轮实证口径)
//   plainMtext    内联码剥除子集:{\f..;}/\H/\C/\W/\T/\A/\Q 等剥码留内容、\P→\n、
//                 \~→空格、^I→4 空格、%%c/%%d/%%p 解码(ezdxf MTextParser 同样解码 %%)
//   linearize     \U+XXXX 解码 + ∅(U+2205)→Ø(U+00D8) 码点统一(契约 I6)
// TEXT/ATTRIB 实体走 decodeText(%% 码 + linearize);MTEXT 走 plainMtextFull。

export const MTEXT_CODES = {
    "%%c": "Ø", "%%C": "Ø", "%%d": "°", "%%D": "°",
    "%%p": "±", "%%P": "±", "%%%": "%",
};

const STACK_RE = /\\S([^;]*);/;

/** 堆叠预线性化:\S上^下; / \S上/下; / \S上#下; → 上(下)。Python 版口径:双值保留
 *  各自符号与空白不臆造(不 trim——「 0」前导空格是公差排版的有效载荷,黄金实证)。 */
export function preStack(raw) {
    let s = String(raw);
    let m;
    while ((m = STACK_RE.exec(s))) {
        const body = m[1];
        let rep = body;
        for (const sep of ["^", "/", "#"]) {
            const k = body.indexOf(sep);
            if (k >= 0) {
                rep = `${body.slice(0, k)}(${body.slice(k + 1)})`;
                break;
            }
        }
        s = s.slice(0, m.index) + rep + s.slice(m.index + m[0].length);
    }
    return s;
}

/** 通用清理:\\U+XXXX → 字符;∅ → Ø。 */
export function linearize(text) {
    return String(text)
        .replace(/\\U\+([0-9A-Fa-f]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
        .replace(/∅/g, "Ø");
}

/** TEXT/ATTRIB 文本出口:%% 码(7 个,Python text_payload 口径)+ linearize。 */
export function decodeText(raw) {
    let out = String(raw ?? "");
    for (const [k, v] of Object.entries(MTEXT_CODES)) out = out.split(k).join(v);
    return linearize(out);
}

// 带参数内联码:剥「\字母 参数;」整段,内容留在原分组里(花括号只是分组,直接丢)。
const ARG_CODES = new Set(["f", "F", "H", "h", "C", "c", "W", "w", "T", "t", "Q", "q", "A", "a", "p", "S", "s"]);
// 无参开关键:\L \l \O \o \K \k —— 剥掉字母本身即可。

/** ezdxf plain_mtext 的等价剥码(实测口径见文件头)。 */
export function plainMtext(raw) {
    const s = String(raw ?? "");
    const lines = [];
    let cur = "";
    let i = 0;
    const flush = () => { lines.push(cur); cur = ""; };
    while (i < s.length) {
        const ch = s[i];
        if (ch === "{") { i++; continue; }            // 分组括号丢弃,内容顺流
        if (ch === "}") { i++; continue; }
        if (ch === "\\") {
            const nx = s[i + 1];
            if (nx === undefined) { i++; break; }
            if (nx === "\\" || nx === "{" || nx === "}") { cur += nx; i += 2; continue; }
            if (nx === "P") { flush(); i += 2; continue; }          // 换段
            if (nx === "N") { flush(); i += 2; continue; }          // 换列按换段(ezdxf new_column)
            if (nx === "X") { flush(); i += 2; continue; }
            if (nx === "~") { cur += " "; i += 2; continue; }       // 不换行空格→空格
            if (ARG_CODES.has(nx)) {
                // 剥到 ';' 或段尾(无分号的裸码容错:只剥字母)
                let j = i + 2;
                let ate = false;
                while (j < s.length && s[j] !== ";" && s[j] !== "}" && s[j] !== "\\") { j++; ate = true; }
                if (s[j] === ";") j++;
                else if (!ate) j = i + 2;
                i = j;
                continue;
            }
            // 其余无参码(\L \O \K 等):剥字母
            i += 2;
            continue;
        }
        if (ch === "^") {
            const nx = s[i + 1];
            if (nx === "I") { cur += "    "; i += 2; continue; }    // 制表→4 空格
            if (nx !== undefined && nx >= "@" && nx <= "_") { i += 2; continue; } // 控制字符丢弃
            cur += ch; i++; continue;
        }
        if (ch === "%" && s[i + 1] === "%") {
            // ezdxf MTextParser 只解码 %%c/%%d/%%p 六个;%%%/%%o/%%u/%%nn 原样保留(实测)
            const c2 = s.slice(i, i + 3);
            if (c2 !== "%%%" && c2 in MTEXT_CODES) { cur += MTEXT_CODES[c2]; i += 3; continue; }
        }
        cur += ch;
        i++;
    }
    flush();
    return lines.join("\n");
}

/** MTEXT 文本出口:原串堆叠线性化 → 剥码 → 统一清理(与 Python 版 _plain_mtext 同序)。 */
export function plainMtextFull(raw) {
    return linearize(plainMtext(preStack(raw ?? "")));
}

/** 显示文本通用清理(display_text 口径):\\U+ 解码 + 码点统一。 */
export const linearizeStacks = linearize;
