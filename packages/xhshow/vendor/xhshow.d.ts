/**
 * 签名数据结构
 */
interface SignatureData {
    x0: string;
    x1: string;
    x2: string;
    x3: string;
    x4: string;
}
/**
 * X3 Payload 解析后的数据结构
 */
interface X3Payload {
    version: number[];
    seed: number;
    timestampRaw: number;
    sequence: number;
    windowPropsLen: number;
    uriLen: number;
    md5Hex: string;
    a1: string;
    source: string;
}
/**
 * 屏幕配置
 */
interface ScreenConfig {
    width: number;
    height: number;
    availWidth: number;
    availHeight: number;
}
/**
 * 指纹数据结构
 */
interface FingerprintData {
    [key: string]: string | number | boolean | object | string[];
}
/**
 * Cookie 字典
 */
interface CookieDict {
    a1: string;
    web_session?: string;
    [key: string]: string | number | undefined;
}
/**
 * 请求 Payload（可以是查询参数或请求体）
 */
interface RequestPayload {
    [key: string]: string | number | boolean | object | any[];
}
/**
 * 签名选项
 */
interface SignOptions {
    timestamp?: number;
    xsecAppId?: string;
}

/**
 * 主客户端类
 * 移植自 xhshow-go/xhshow/client.go
 */

declare class Client {
    private xsCommonSigner;
    constructor();
    /**
     * 获取 x-t 头部值（毫秒级 Unix 时间戳）
     */
    getXT(timestamp?: number): number;
    /**
     * 获取 x-b3-traceid
     */
    getB3TraceId(): string;
    /**
     * 获取 x-xray-traceid
     */
    getXrayTraceId(timestamp?: number, seq?: number): string;
    /**
     * 生成 x-s-common 签名
     */
    signXSCommon(cookies: CookieDict): string;
    /**
     * 生成请求签名 (x-s)
     */
    signXS(method: string, uri: string, a1Value: string, xsecAppId?: string, payload?: RequestPayload, timestamp?: number): string;
    /**
     * 构建内容字符串
     */
    private buildContentString;
    /**
     * 生成 D 值（MD5 哈希）
     */
    private generateDValue;
    /**
     * 构建签名
     */
    private buildSignature;
    /**
     * 提取 URI 路径
     */
    private extractUri;
    /**
     * Python 风格的 quote (safe=",")
     */
    private pythonQuote;
    /**
     * 解密完整的 XYS 签名
     */
    decodeXS(xsSignature: string): SignatureData;
    /**
     * 解密 x3 签名
     */
    decodeX3(x3Signature: string): Uint8Array;
    /**
     * 解析 X3 Payload
     */
    parseX3Payload(payload: Uint8Array): X3Payload;
}

/**
 * 工具函数模块
 * 移植自 xhshow-go/xhshow/utils.go
 */
/**
 * 自定义 Base64 编码
 */
declare function encodeCustomBase64(data: Uint8Array): string;
/**
 * 自定义 Base64 解码
 */
declare function decodeCustomBase64(data: string): Uint8Array;
/**
 * X3 Base64 编码
 */
declare function encodeX3Base64(data: Uint8Array): string;
/**
 * X3 Base64 解码
 */
declare function decodeX3Base64(data: string): Uint8Array;
/**
 * 生成随机整数（0 到 MAX_32BIT）
 */
declare function generateRandomInt(): number;
/**
 * 在范围内生成随机整数
 */
declare function generateRandomByteInRange(minVal: number, maxVal: number): number;
/**
 * 生成 B3 TraceId
 */
declare function generateB3TraceId(): string;
/**
 * 生成 Xray TraceId
 */
declare function generateXrayTraceId(timestamp?: number, seq?: number): string;

/**
 * Cookie 生成模块
 * 移植自 xhshow-go/xhshow/cookie_gen.go
 */
/**
 * 生成随机字符串
 */
declare function generateRandomString(length: number): string;
/**
 * 生成 WebId (32 字符的十六进制字符串)
 */
declare function registerId(): string;
/**
 * 生成 A1 Cookie 值
 */
declare function generateA1(): string;
/**
 * 获取加载时间戳（毫秒）
 */
declare function getLoadTs(): string;

declare const X3_PREFIX = "mns0301_";
declare const XYS_PREFIX = "XYS_";
declare const PUBLIC_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36 Edg/142.0.0.0";

export { Client, type CookieDict, type FingerprintData, PUBLIC_USER_AGENT, type RequestPayload, type ScreenConfig, type SignOptions, type SignatureData, type X3Payload, X3_PREFIX, XYS_PREFIX, decodeCustomBase64, decodeX3Base64, encodeCustomBase64, encodeX3Base64, generateA1, generateB3TraceId, generateRandomByteInRange, generateRandomInt, generateRandomString, generateXrayTraceId, getLoadTs, registerId };
