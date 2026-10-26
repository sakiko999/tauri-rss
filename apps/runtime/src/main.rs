//! `amoeba-runtime` —— 解析/下载 Bun，然后 spawn 入口脚本。
//!
//! ```text
//! amoeba-runtime --print                 # 打印解析出的 Bun 路径/版本/来源
//! amoeba-runtime <entry.ts> [args...]    # 解析 Bun 后运行入口，透传退出码
//! amoeba-runtime --no-download <entry>   # 离线：只允许已有 Bun
//! ```
//!
//! stdout 只给两层：`--print` 的输出，或子进程原样继承。启动器自己的日志全在 stderr。

use std::env;
use std::path::Path;
use std::process::{exit, Command};

use amoeba_runtime::{ensure_bun, ResolveOptions, RuntimeError};

const USAGE: &str = "\
amoeba-runtime — Amoeba 的 Bun 运行时启动器

用法:
  amoeba-runtime --print                 打印解析出的 Bun 路径/版本/来源
  amoeba-runtime <entry> [args...]       解析 Bun 后运行入口，透传 stdout/stderr/退出码
  amoeba-runtime --no-download <entry>   离线模式：不联网下载

解析顺序: AMOEBA_BUN → PATH → 随包 → 缓存 → 下载固定版本
环境变量:
  AMOEBA_BUN          显式 Bun 路径（配错直接报错）
  AMOEBA_BUN_ZIP      本地 bun-windows-x64.zip（离线/CI，仍校验 SHA256）
  AMOEBA_RUNTIME_DIR  缓存根目录（默认 %LOCALAPPDATA%\\app.amoeba.runtime）
";

fn main() {
    match run() {
        Ok(code) => exit(code),
        Err(e) => {
            eprintln!("[runtime] {e}");
            exit(2);
        }
    }
}

fn run() -> Result<i32, RuntimeError> {
    let args: Vec<String> = env::args().skip(1).collect();
    let mut allow_download = true;
    let mut print_only = false;
    let mut entry: Option<String> = None;
    let mut child_args: Vec<String> = Vec::new();

    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "--help" | "-h" => {
                println!("{USAGE}");
                return Ok(0);
            }
            "--version" | "-V" => {
                println!("amoeba-runtime {}", env!("CARGO_PKG_VERSION"));
                return Ok(0);
            }
            "--print" | "--ensure" => {
                print_only = true;
                i += 1;
            }
            "--no-download" => {
                allow_download = false;
                i += 1;
            }
            "--" => {
                i += 1;
                if i < args.len() {
                    entry = Some(args[i].clone());
                    child_args = args[i + 1..].to_vec();
                }
                break;
            }
            other if other.starts_with('-') => {
                return Err(RuntimeError::new(format!(
                    "未知参数 {other}（--help 查看用法）"
                )));
            }
            other => {
                entry = Some(other.to_string());
                child_args = args[i + 1..].to_vec();
                break;
            }
        }
    }

    let opts = ResolveOptions {
        allow_download,
        log: true,
    };
    let bun = ensure_bun(&opts)?;

    if print_only {
        println!("{}", bun.path.display());
        println!("{} ({})", bun.version, bun.source);
        return Ok(0);
    }

    let Some(entry) = entry else {
        eprintln!("{USAGE}");
        return Ok(2);
    };
    let entry_path = Path::new(&entry);
    if !entry_path.is_file() {
        return Err(RuntimeError::new(format!("入口文件不存在：{entry}")));
    }

    let status = Command::new(&bun.path)
        .arg(entry_path)
        .args(&child_args)
        .status()
        .map_err(|e| RuntimeError::new(format!("无法启动 Bun（{}）：{e}", bun.path.display())))?;
    Ok(status.code().unwrap_or(1))
}
