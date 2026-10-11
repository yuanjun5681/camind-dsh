// PackError 与拒绝码。直译 core/include/camind/error.h 的 PackErrorCode(拒绝码与
// CAM-Agent check_bodies 同名,是跨仓契约,不许改名)。
export type PackErrorCode =
    | "Io"
    | "MissingFile"
    | "BadMagic"
    | "UnsupportedFormat"
    | "BadJson"
    | "InvalidValue"
    | "BadLength"
    | "OutOfRange"
    | "CountMismatch"
    | "SizeMismatch"
    | "HashMismatch"
    | "BadGzip";

export class PackError extends Error {
    code: PackErrorCode;
    file: string;
    constructor(code: PackErrorCode, message: string, file: string) {
        super(message);
        this.code = code;
        this.file = file;
    }
}

// 拒绝码名(与 C++ core/src/error.cpp 的 packErrorCodeName 同表;是跨仓对账契约,不许改名)。
export function packErrorCodeName(code: PackErrorCode): string {
    return code; // TS 版的 code 字段本身就是名字符串
}
