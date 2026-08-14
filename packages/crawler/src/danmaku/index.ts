/**
 * danmaku —— 弹幕共享基础层门面。
 *
 * 跨平台弹幕运行时:类型契约(types)+ 弹幕颜色归一(color)+ 弹幕流原语(stream)。
 * 平台专属的协议编解码在 `platform/<平台>/` 下(danmaku-proto / danmaku-tars 等),
 * 不进门面——只归本平台弹幕文件消费。消费方统一 `from "../danmaku"`,不感知内部拆分。
 */
export * from "./types.ts"
export * from "./color.ts"
export * from "./stream.ts"
