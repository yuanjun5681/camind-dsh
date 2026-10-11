// 面的选择集逻辑(不碰图形接口):单选、Ctrl 多选、按曲面类型过滤。
// 直译 core/src/select/selection.cpp + selection.h。
// 选择集按面序号存,粗档换细档时原样保留(两档的面序号相同);对外输出再换 FID。

export type ClickMode = "replace" | "toggle";

export interface SelectionChange {
    added: number[];
    removed: number[];
}

function emptyChange(): SelectionChange {
    return { added: [], removed: [] };
}

export function changeIsEmpty(c: SelectionChange): boolean {
    return c.added.length === 0 && c.removed.length === 0;
}

export class SelectionModel {
    private types: string[] = [];
    private filter = new Set<string>();
    private selected: boolean[] = [];
    private order: number[] = [];

    // 换零件:给出每张面的曲面类型(下标 = 面序号)。清空选择集与过滤条件。
    reset(surfaceTypes: string[]): void {
        this.types = surfaceTypes;
        this.filter = new Set();
        this.selected = new Array<boolean>(surfaceTypes.length).fill(false);
        this.order = [];
    }

    faceCount(): number {
        return this.types.length;
    }

    // 类型过滤:只有这些类型的面可以被选中;空集 = 不过滤。
    // 已选中但不再符合过滤条件的面会被移出选择集。
    setTypeFilter(allowed: Set<string>): SelectionChange {
        this.filter = allowed;
        const change = emptyChange();
        const current = [...this.order];
        for (const face of current) {
            if (!this.isSelectable(face))
                this.remove(face, change);
        }
        return change;
    }

    typeFilter(): string[] {
        // std::set 按字典序迭代;JS Set 保持插入序,这里显式排序对齐语义。
        return [...this.filter].sort();
    }

    isSelectable(face: number): boolean {
        if (face >= this.types.length)
            return false;
        return this.filter.size === 0 || this.filter.has(this.types[face]);
    }

    // 这个零件里出现过的全部曲面类型(去重、按字典序)。
    availableTypes(): string[] {
        return [...new Set(this.types)].sort();
    }

    click(face: number | null, mode: ClickMode): SelectionChange {
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
        // Replace:除了点中的这一张,其余全部取消;点在空白处或点到被过滤掉的面 = 全部取消。
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
    setSelection(faces: number[]): SelectionChange {
        const change = emptyChange();
        const wanted = new Array<boolean>(this.types.length).fill(false);
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

    clear(): SelectionChange {
        const change = emptyChange();
        change.removed = [...this.order];
        this.order = [];
        this.selected.fill(false);
        return change;
    }

    isSelected(face: number): boolean {
        return face < this.selected.length && this.selected[face];
    }

    // 按选中的先后顺序。
    selection(): number[] {
        return this.order;
    }

    private add(face: number, change: SelectionChange): void {
        if (this.selected[face])
            return;
        this.selected[face] = true;
        this.order.push(face);
        change.added.push(face);
    }

    private remove(face: number, change: SelectionChange): void {
        if (!this.selected[face])
            return;
        this.selected[face] = false;
        const i = this.order.indexOf(face);
        if (i >= 0)
            this.order.splice(i, 1);
        change.removed.push(face);
    }
}
