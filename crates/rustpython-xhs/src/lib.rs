//! rustpython-xhs —— RustPython 嵌入封装:跑 xhshow(Python 小红书签名库) 生成签名 headers。
//!
//! 动机:TS fork 签名过时(461),Python xhshow 0.2.0 有效;RustPython 免手写移植,
//! 进程内跑 .py(无 sidecar 进程)。xhshow 源码在 `packages/xhshow` submodule
//! (含 rustpython 兼容补丁)。
//!
//! 版本:rustpython crates.io **0.5.0**(2026-03-31) + `freeze-stdlib`。
//! - 库嵌入踩坑史(全记录):0.5.0 动态 stdlib 导入纯 Python re/enum 递归爆栈;
//!   freeze 后 essential_init 比较/哈希递归需 **release 构建**(debug 默认限制
//!   256 + 大栈帧 → RecursionError;release 限制 1000 + 小帧过)。git main
//!   `d609108`(2026-08-14) 有 import hash 环 bug(RecursionError: while hashing);
//!   0.4.0 快照 mt19937 编译 bug。详见 Cargo.toml + docs。
//! - malachite 冲突:stdlib 锁 ^0.9.1、pymath 开其 malachite-bigint feature 拉 ^0
//!   → 解析到 0.10 双版本;Cargo.lock `cargo update -p malachite-bigint@0.6.1
//!   --precise 0.9.2` 统一(补丁不能写 crate 内——cargo 要求 workspace 根)。
//!
//! ## 加载方式
//!
//! 每调用建一次 interpreter(正确优先;缓存/复用 interpreter 待优化):
//! 1. `packages/xhshow/src` + `res/` 挂到 `Settings.path_list`(embed 时
//!    module_search_paths 只含 path_list,insert_sys_path 对 __import__ 无效);
//! 2. `vm.import("_xhs_sign")` 拿 wrapper 模块;
//! 3. `call(_sign, (uri, cookie, params_json))` → JSON 字符串;
//! 4. serde 反序列化为 [`XhsSignHeaders`]。
//!
//! 读返回值:`PyObjectRef::downcast::<PyStr>()` + `to_string_lossy`(官方
//! `call_between_rust_and_python.rs` 的 import+call 模式;scope.load/eval
//! 在 2026 main 重构不可用)。

use std::path::PathBuf;

use rustpython::vm::builtins::PyStr;
use rustpython::vm::{AsObject, PyObject, VirtualMachine};
use rustpython::{Interpreter, InterpreterBuilderExt};

/// 签名入口模块(wrapper)文件名与函数名。
const ENTRY_MODULE: &str = "_xhs_sign";
const ENTRY_FN: &str = "_sign";

/// 签名 headers(xhshow 返回,生成后由 crawler 拼到请求)。
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct XhsSignHeaders {
    #[serde(rename = "x-s")]
    pub x_s: String,
    #[serde(rename = "x-s-common")]
    pub x_s_common: String,
    #[serde(rename = "x-t")]
    pub x_t: String,
    #[serde(rename = "x-b3-traceid")]
    pub x_b3_traceid: String,
    #[serde(rename = "x-xray-traceid")]
    pub x_xray_traceid: String,
    #[serde(rename = "x-mns")]
    pub x_mns: String,
    #[serde(rename = "xy-direction")]
    pub xy_direction: String,
}

/// xhshow 源码目录(packages/xhshow submodule 的 src)。
fn xhshow_src_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .join("packages/xhshow/src")
}

/// 签名入口 wrapper 所在目录(本 crate 的 res/)。
fn entry_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("res")
}

/// Python 异常对象 → 可读消息(取 str,失败退化 Debug)。
fn exc_str(vm: &VirtualMachine, exc: &PyObject) -> String {
    let s = exc.str(vm).map(|s| s.to_string()).unwrap_or_default();
    if s.is_empty() {
        format!("{exc:?}")
    } else {
        s
    }
}

/// 生成小红书 API 签名 headers。
///
/// `uri`: 请求路径+查询(如 `/api/sns/web/v1/user_posted?num=30&user_id=xxx`)——
/// 查询串在 wrapper 里剥掉,参数由 `params` 单独给(xhshow 契约,避免重复编码)。
/// `params`: 查询参数。
/// `cookie`: 会话 cookie 串(`a1` 作签名种子,缺 a1 会签名失败)。
pub fn sign_xhs(
    uri: &str,
    params: &serde_json::Map<String, serde_json::Value>,
    cookie: &str,
) -> Result<XhsSignHeaders, String> {
    let src_dir = xhshow_src_dir();
    if !src_dir.is_dir() {
        return Err(format!(
            "xhshow 源码目录不存在:{}(需先 init packages/xhshow submodule)",
            src_dir.display()
        ));
    }
    let params_json = serde_json::to_string(params).map_err(|e| format!("params 序列化失败:{e}"))?;
    // module_search_paths 必须在 build 前注入:embed 时 getpath 算出的 sys.path 只含
    // settings.path_list(insert_sys_path 改 Python 层 sys.path 对 __import__ 无效)。
    let settings = rustpython::vm::Settings::default()
        .with_path(src_dir.to_string_lossy().to_string())
        .with_path(entry_dir().to_string_lossy().to_string());
    let interp = Interpreter::builder(settings).init_stdlib().build();
    interp.enter(|vm| {
        // ⚠️ 需 release 构建:debug 下默认递归限制 256,essential_init 深导入
        // (比较/哈希递归 ~几百层)直接 RecursionError(见 Cargo.toml 注释);release
        // 限制 1000 且栈帧小。此处再放宽到 5000 留余量。
        vm.recursion_limit.set(5_000);
        // 1. import wrapper 模块 → 拿 _sign 函数
        let module = vm
            .import(ENTRY_MODULE, 0)
            .map_err(|e| format!("import {} 失败:{}", ENTRY_MODULE, exc_str(vm, e.as_object())))?;
        let sign_fn = module
            .get_attr(ENTRY_FN, vm)
            .map_err(|e| format!("get_attr {} 失败:{}", ENTRY_FN, exc_str(vm, e.as_object())))?;
        // 3. 调用 _sign(uri, cookie, params_json) → JSON 字符串
        let result = sign_fn
            .call((uri.to_string(), cookie.to_string(), params_json), vm)
            .map_err(|e| format!("Python 签名失败:{}", exc_str(vm, e.as_object())))?;
        let s = result
            .downcast::<PyStr>()
            .map_err(|_| "签名结果非 str(xhshow 抛错?)".to_string())?
            .to_string_lossy()
            .to_string();
        // 4. 反序列化 headers
        serde_json::from_str::<XhsSignHeaders>(&s)
            .map_err(|e| format!("签名 headers JSON 解析失败:{e} -> {s}"))
    })
}

/// 生成签名用的 params Map(供调用方从查询参数构造)。
pub fn params_map(params: &[(&str, &str)]) -> serde_json::Map<String, serde_json::Value> {
    let mut m = serde_json::Map::new();
    for (k, v) in params {
        m.insert((*k).to_string(), serde_json::Value::String((*v).to_string()));
    }
    m
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 桥接冒烟测试:不联网,验证 Rust→RustPython→xhshow 链路返回 headers。
    /// 用假 cookie(只需含 a1 键);生成的 x-s 对服务器可能无效,但函数应正常返回。
    #[test]
    fn sign_xhs_returns_headers() {
        let params = params_map(&[("num", "30"), ("user_id", "012345678901234567890123")]);
        let cookie = "a1=abcdef123456; web_session=test";
        let headers = sign_xhs("/api/sns/web/v1/user_posted", &params, cookie)
            .expect("sign_xhs 应返回 headers");
        assert!(!headers.x_s.is_empty(), "x-s 不应为空");
        assert!(!headers.x_s_common.is_empty(), "x-s-common 不应为空");
        assert!(!headers.x_t.is_empty(), "x-t 不应为空");
        println!("x-s={}", headers.x_s);
        println!("x-s-common={}", headers.x_s_common);
    }
}
