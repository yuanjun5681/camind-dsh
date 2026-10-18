// GeomView 的选择集端口:core 的 SelectionModel 已合入(A 线),这里做薄适配
// (core 的 Change 是纯对象,isEmpty 是独立函数;typeFilter 双向都是数组/集合的薄换)。
// 接口语义见 core/src/select/selection.ts 的注释(直译 core/select/selection.cpp)。
import { SelectionModel, changeIsEmpty } from "@camind/core";
import type { SelectionChange, ClickMode } from "@camind/core";

export type { SelectionChange, ClickMode };
export { changeIsEmpty };

export interface SelectionPort {
    /** 换零件:给出每张面的曲面类型(下标 = 面序号)。清空选择集与过滤条件。
     *  bodyAffiliation:每面的体归属(与 surfaceTypes 等长;省略 = 无体信息)。 */
    reset(surfaceTypes: string[], bodyAffiliation?: number[]): void;
    /** 类型过滤:只有这些类型的面可以被选中;空集 = 不过滤。
     *  已选中但不再符合过滤条件的面会被移出选择集。 */
    setTypeFilter(allowed: Iterable<string>): SelectionChange;
    typeFilter(): ReadonlySet<string>;
    isSelectable(face: number): boolean;
    /** 只判类型过滤(压暗上色用;声明体不压暗)。 */
    passesTypeFilter(face: number): boolean;
    isDeclaredFace(face: number): boolean;
    setDeclaredBodies(bodies: Iterable<number>): void;
    /** 这个零件里出现过的全部曲面类型(去重、按字典序)。 */
    availableTypes(): string[];
    click(face: number | null, mode: ClickMode): SelectionChange;
    /** 直接指定选择集(不可选的面与越界的面序号被忽略)。 */
    setSelection(faces: number[]): SelectionChange;
    clear(): SelectionChange;
    isSelected(face: number): boolean;
    /** 按选中的先后顺序。 */
    selection(): number[];
}

/** core SelectionModel 的默认端口(GeomView 构造缺省用它)。 */
export function createSelection(): SelectionPort {
    const model = new SelectionModel();
    return {
        reset: (surfaceTypes, bodyAffiliation) => model.reset(surfaceTypes, bodyAffiliation),
        setTypeFilter: (allowed) => model.setTypeFilter(new Set(allowed)),
        typeFilter: () => new Set(model.typeFilter()),
        isSelectable: (face) => model.isSelectable(face),
        passesTypeFilter: (face) => model.passesTypeFilter(face),
        isDeclaredFace: (face) => model.isDeclaredFace(face),
        setDeclaredBodies: (bodies) => model.setDeclaredBodies(bodies),
        availableTypes: () => model.availableTypes(),
        click: (face, mode) => model.click(face, mode),
        setSelection: (faces) => model.setSelection(faces),
        clear: () => model.clear(),
        isSelected: (face) => model.isSelected(face),
        selection: () => model.selection(),
    };
}

// ───────────────────────────────────────────── 显示颜色(与 C++ GeomViewWidget.cpp 匿名命名空间同源)

import type { Rgba } from "@camind/core";

export const SELECTED_COLOR: Rgba = [255, 150, 40, 255];
export const SELECTED_HOVER_COLOR: Rgba = [255, 190, 110, 255];

function mixRgba(a: Rgba, b: Rgba, t: number): Rgba {
    const out: Rgba = [0, 0, 0, 0];
    for (let i = 0; i < 3; ++i)
        out[i] = Math.round(a[i] * (1.0 - t) + b[i] * t);
    out[3] = a[3]; // 保留底色的不透明度:半透明实体压暗 / 预亮后仍是半透明(T-398 ②)
    return out;
}

/** 一张面的显示颜色:选中橙、选中+滑过亮橙、被类型过滤挡掉压暗、滑过偏蓝,其余本色。 */
export function displayFaceColor(base: Rgba, selected: boolean, hovered: boolean, selectable: boolean): Rgba {
    if (selected)
        return hovered ? SELECTED_HOVER_COLOR : SELECTED_COLOR;
    if (!selectable)
        return mixRgba(base, [40, 44, 52, 255], 0.55); // 被类型过滤挡掉的面压暗
    if (hovered)
        return mixRgba(base, [120, 200, 255, 255], 0.45);
    return base;
}
