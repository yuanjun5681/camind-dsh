// GLSL ES 3.00 着色器,手转自 viewer/shaders/*.vert|frag(Vulkan 风 GLSL 440)。
// 在 ts-spike 里三个环境(WebKit 内嵌 / 前台 Safari / Electron Chromium)验证过,原样收编为正式实现。
// 转换点(正本是 qsb 的 300es 编译目标做的事):
//   1. #version 440 → #version 300 es
//   2. 删 attribute/varying 的 layout(location=N)(ES 3.00 无),绑定在 JS 侧按名字做
//   3. UBO 的 layout(std140, binding=0) → layout(std140),绑定点 JS 侧 uniformBlockBinding
//   4. fragment 加 precision highp float(ES 必需)
//   5. gl_VertexIndex → gl_VertexID(Vulkan 命名 → GL 命名)
// flat 插值、bayer 数组、std140 块:ES 3.00 原生支持,不动。
// flat_color(探针用)未收编:探针属性能基准复测(§8.1 范围外),届时再迁。

export const MESH_VERT = `#version 300 es
// 零件网格。位置、法线直接来自几何包;颜色是逐顶点的(高亮只改某张面那一段)。
layout(std140) uniform Ubuf {
    mat4 mvp;
    mat4 mvpLine;   // 同一个变换,深度往相机方向偏一点:给边线用,免得和面打架
    vec4 eye;       // 透视:xyz = 眼睛位置,w = 1;正交:xyz = 指向眼睛的方向,w = 0
    vec4 lightDir;  // xyz = 指向光源的单位向量(跟着相机走的头灯)
    vec4 lineColor; // 边线颜色
} ub;
in vec3 aPos;
in vec3 aNormal;
in vec4 aColor;
in float aPhase;    // 抖动掩码相位(0/1),与不透明度分立
out vec3 vNormal;
out vec3 vPos;
out vec4 vColor;
out float vPhase;
void main()
{
    vNormal = aNormal;
    vPos = aPos;
    vColor = aColor;
    vPhase = aPhase;
    gl_Position = ub.mvp * vec4(aPos, 1.0);
}`;

export const MESH_FRAG = `#version 300 es
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
in float vPhase;
out vec4 fragColor;
void main()
{
    // 半透明实体(NX 里设了透明度):按屏幕像素 4×4 有序抖动镂空。
    // 单趟画、不用排序也不改管线;选中/预亮的颜色 A = 255,不受影响。
    // A 只表达有效不透明度;vPhase 选择掩码平移。同为 A=128 的相位 0/1
    // 保留集互补;同相位叠层仍会遮挡,抖动镂空也不是平滑混合。
    if (vColor.a < 0.998) {
        const float bayer[16] = float[16](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0,
                                          3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
        ivec2 p = ivec2(gl_FragCoord.xy);
        if (vPhase > 0.5)
            p += ivec2(1, 2);
        p &= ivec2(3);
        if (vColor.a <= (bayer[p.y * 4 + p.x] + 0.5) / 16.0)
            discard;
    }
    vec3 n = normalize(vNormal);
    vec3 v = ub.eye.w > 0.5 ? normalize(ub.eye.xyz - vPos) : ub.eye.xyz;
    if (dot(n, v) < 0.0)
        n = -n; // 双面:片体和法线朝里的面也照样亮
    vec3 l = ub.lightDir.xyz;
    float hemi = 0.5 + 0.5 * n.z;                       // 天/地环境光:朝上的面亮一点
    vec3 ambient = mix(vec3(0.30, 0.31, 0.34), vec3(0.56, 0.58, 0.60), hemi);
    float diffuse = max(dot(n, l), 0.0) * 0.50;
    float specular = pow(max(dot(n, normalize(l + v)), 0.0), 40.0) * 0.12;
    fragColor = vec4(vColor.rgb * (ambient + diffuse) + specular, 1.0);
}`;

export const LINE_VERT = `#version 300 es
// 面边界线:只有位置,颜色统一。
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

export const LINE_FRAG = `#version 300 es
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

export const ID_VERT = `#version 300 es
// ID 画布:把 32 位序号按 4 个字节放进 RGBA8。属性是归一化字节,原样写出,不做任何运算,
// 所以读回的 4 个字节就是写进去的 4 个字节。面和刀路线段共用这一对着色器。
layout(std140) uniform Ubuf { mat4 mvp; } ub;
in vec3 aPos;
in vec4 aId;
flat out vec4 vId;
void main()
{
    vId = aId;
    gl_Position = ub.mvp * vec4(aPos, 1.0);
}`;

export const ID_FRAG = `#version 300 es
precision highp float;
flat in vec4 vId;
out vec4 fragColor;
void main()
{
    fragColor = vId;
}`;

export const PATH_VERT = `#version 300 es
// 刀路线段图层。线段按加工顺序排好,两个顶点一段,所以「顶点号 / 2」就是线段号;
// 播放只需要改 uniform 里的播放头,不用重传数据。
layout(std140) uniform PathUbuf {
    mat4 mvp;       // 投影 × 视图 × 工位变换的逆(把 NC 坐标摆回零件上)
    vec4 params;    // x = 播放头所在线段号;y = 未走线段保留多少本色(0 = 完全融进背景)
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

export const PATH_FRAG = `#version 300 es
precision highp float;
in vec4 vColor;
out vec4 fragColor;
void main()
{
    fragColor = vColor;
}`;
