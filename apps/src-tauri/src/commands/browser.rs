//! browser — 浏览器模拟爬取支持(CDP 附加真实 Edge)。
//!
//! 微博/小红书反爬强,纯 HTTP/纯算法难以为继,需真实浏览器环境提供
//! 登录态 + JS 签名 + 设备指纹。本模块 spawn 系统 Edge(带
//! `--remote-debugging-port`),crawler 侧通过 appHost.ws 连 CDP 端点
//! (`ws://127.0.0.1:<port>/devtools/browser`)发 `Runtime.evaluate` 命令。
//!
//! 窗口处理:以 **SW_HIDE** 启动(Windows API `CreateProcessW`),Edge 完全隐藏
//! 含任务栏——但浏览器内部仍是正常模式(非 headless),UA/指纹与可见窗口一致,
//! 反爬检测不出。为什么不用 `--headless`:headless 的 UA 带 `HeadlessChrome`,
//! xhs 的 b1 指纹校验直接拦;覆盖 UA 又破坏指纹 hash 一致性。
//!
//! 为什么不打包浏览器:真实 Edge 零打包体积、真实指纹(反检测最强,
//! 2026 风控识别不了)、`--user-data-dir` 持久化登录态(扫码一次后续复用)。

use std::net::TcpStream;
use std::os::windows::ffi::OsStrExt;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Manager};
use windows_sys::Win32::Foundation::{BOOL, CloseHandle, HANDLE, HWND, LPARAM};
use windows_sys::Win32::System::Threading::{
    CreateProcessW, OpenProcess, PROCESS_INFORMATION, PROCESS_TERMINATE, STARTF_USESHOWWINDOW,
    STARTUPINFOW, TerminateProcess, WaitForSingleObject,
};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GetWindowThreadProcessId, ShowWindow, SW_HIDE,
};

/// 进程句柄包装(HANDLE 是裸指针默认 !Send;进程句柄无线程亲和,可跨线程用)。
struct SafeHandle(HANDLE);
unsafe impl Send for SafeHandle {}

/// 浏览器进程管理:持有 spawn 的 Edge 进程句柄,供 browser_close 终止。
pub struct BrowserManager {
    process: Mutex<Option<SafeHandle>>,
}

impl Default for BrowserManager {
    fn default() -> Self {
        Self { process: Mutex::new(None) }
    }
}

/// CDP 固定端口(高位,避开常见服务端口)。
const CDP_PORT: u16 = 9223;

/// 探测端口上是否已有 CDP 服务(Edge 已启动则复用,避免重复 spawn)。
fn cdp_alive(port: u16) -> bool {
    let addr = std::net::SocketAddr::from(([127, 0, 0, 1], port));
    TcpStream::connect_timeout(&addr, std::time::Duration::from_millis(300)).is_ok()
}

/// 探测系统 Edge 可执行路径(Windows 常见安装位置)。
fn edge_path() -> Option<PathBuf> {
    const CANDIDATES: [&str; 2] = [
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    ];
    for p in CANDIDATES {
        let pb = PathBuf::from(p);
        if pb.exists() {
            return Some(pb);
        }
    }
    None
}

/// 收集 spawn 进程的所有后代 PID。Edge 持窗进程 ≠ CreateProcess 返回的
/// pid(它是启动器/协调进程,持窗的 browser/renderer 是其子进程),须整棵进程树隐藏。
fn collect_process_descendants(root: u32) -> std::collections::HashSet<u32> {
    use windows_sys::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
        TH32CS_SNAPPROCESS,
    };
    let mut children: std::collections::HashMap<u32, Vec<u32>> = std::collections::HashMap::new();
    let snapshot = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) };
    if snapshot as isize == -1 {
        let mut s = std::collections::HashSet::new();
        s.insert(root);
        return s;
    }
    let mut entry: PROCESSENTRY32W = unsafe { std::mem::zeroed() };
    entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
    if unsafe { Process32FirstW(snapshot, &mut entry) } != 0 {
        loop {
            children
                .entry(entry.th32ParentProcessID)
                .or_default()
                .push(entry.th32ProcessID);
            if unsafe { Process32NextW(snapshot, &mut entry) } == 0 {
                break;
            }
        }
    }
    unsafe {
        let _ = CloseHandle(snapshot);
    }
    // BFS:root 及其所有后代
    let mut set = std::collections::HashSet::new();
    let mut queue = vec![root];
    while let Some(pid) = queue.pop() {
        if !set.insert(pid) {
            continue;
        }
        if let Some(kids) = children.get(&pid) {
            queue.extend(kids.iter().copied());
        }
    }
    set
}

/// 查询 TCP 端口上 LISTENING 的进程 PID(用 GetExtendedTcpTable)。
/// 用于定位我们的 Edge——9223 只可能是我们 spawn 的 Edge(用户日常 Edge 不开调试端口)。
fn tcp_listen_pids(port: u16) -> Vec<u32> {
    use windows_sys::Win32::NetworkManagement::IpHelper::{
        GetExtendedTcpTable, MIB_TCPROW_OWNER_PID, MIB_TCPTABLE_OWNER_PID, TCP_TABLE_OWNER_PID_ALL,
    };
    use windows_sys::Win32::Networking::WinSock::AF_INET;
    let mut size: u32 = 0;
    unsafe {
        GetExtendedTcpTable(std::ptr::null_mut(), &mut size, 0, AF_INET as u32, TCP_TABLE_OWNER_PID_ALL, 0);
    }
    let mut buf = vec![0u8; size as usize];
    let ret = unsafe {
        GetExtendedTcpTable(buf.as_mut_ptr() as *mut _, &mut size, 0, AF_INET as u32, TCP_TABLE_OWNER_PID_ALL, 0)
    };
    if ret != 0 {
        return vec![];
    }
    let mut pids = vec![];
    unsafe {
        let table = buf.as_ptr() as *const MIB_TCPTABLE_OWNER_PID;
        let count = (*table).dwNumEntries;
        let rows = std::ptr::addr_of!((*table).table) as *const MIB_TCPROW_OWNER_PID;
        for i in 0..count as usize {
            let row = rows.add(i);
            // dwLocalPort 是网络字节序存储的低 16 位 → 交换字节得到主机序端口。
            let lp = (*row).dwLocalPort;
            let host_port = ((lp & 0xFF) << 8) | ((lp & 0xFF00) >> 8);
            if host_port == port as u32 {
                pids.push((*row).dwOwningPid);
            }
        }
    }
    pids
}

/// 杀掉占用给定端口的进程及其整棵进程树。
/// TerminateProcess(单进程)不保证连带杀 Edge 子进程(Job Object 未设 KILL_ON_CLOSE),
/// 须显式枚举整树逐个杀。
fn kill_edge_tree_on_port(port: u16) {
    for pid in tcp_listen_pids(port) {
        let tree = collect_process_descendants(pid);
        eprintln!("[browser] kill Edge tree root={pid}: {} procs", tree.len());
        for p in &tree {
            let h = unsafe { OpenProcess(PROCESS_TERMINATE, 0, *p) };
            if h != std::ptr::null_mut() {
                unsafe {
                    TerminateProcess(h, 0);
                    let _ = CloseHandle(h);
                }
            }
        }
    }
}

/// 枚举期间累计:目标 PID 集合 + 已隐藏窗口数。
struct HideCtx {
    pids: *const std::collections::HashSet<u32>,
    hidden: usize,
}

/// 隐藏目标 PID 集合的全部顶层窗口(Edge 主窗口 + 辅助窗口),返回隐藏数。
/// SW_HIDE 的窗口无任务栏图标——「含任务栏完全隐藏」。Chromium 首次显示主窗口
/// **不遵守 STARTUPINFO 的 wShowWindow**(内部显式 ShowWindow(SW_SHOW)),故须主动隐藏。
fn hide_windows_for_pids(pids: &std::collections::HashSet<u32>) -> usize {
    unsafe extern "system" fn enum_cb(hwnd: HWND, lparam: LPARAM) -> BOOL {
        let ctx = &mut *(lparam as *mut HideCtx);
        let mut wnd_pid: u32 = 0;
        unsafe {
            GetWindowThreadProcessId(hwnd, &mut wnd_pid);
            if (*ctx.pids).contains(&wnd_pid) {
                ShowWindow(hwnd, SW_HIDE);
                ctx.hidden += 1;
            }
        }
        1 // TRUE,继续枚举
    }
    let mut ctx = HideCtx { pids, hidden: 0 };
    unsafe {
        EnumWindows(Some(enum_cb), &mut ctx as *mut HideCtx as isize);
    }
    ctx.hidden
}

/// Edge 启动参数。hide 时加屏幕外(配合循环 ShowWindow 防闪现)+ 禁节流(隐藏后
/// 页面不被后台节流,登录轮询/签名照常);debug 不隐藏则窗口正常显示。
fn edge_args(port: u16, data_dir: &std::path::Path, hide: bool) -> Vec<String> {
    let mut args = vec![
        format!("--remote-debugging-port={port}"),
        format!("--user-data-dir={}", data_dir.display()),
        // 新 Chromium 拒跨源 CDP,必须放开 origin。
        "--remote-allow-origins=*".to_string(),
        "--no-first-run".to_string(),
        "--no-default-browser-check".to_string(),
    ];
    if hide {
        args.push("--window-position=-32000,-32000".to_string());
        args.push("--disable-background-timer-throttling".to_string());
        args.push("--disable-renderer-backgrounding".to_string());
        args.push("--disable-backgrounding-occluded-windows".to_string());
        args.push("--disable-features=CalculateNativeWinOcclusion".to_string());
    }
    args.push("about:blank".to_string());
    args
}

/// 用 Windows API 启动 Edge,返回 (进程句柄, 主进程 PID)。
///
/// hide=true 时以 SW_HIDE 启动(窗口完全隐藏含任务栏)——浏览器内部仍是正常模式
/// (非 headless),UA/指纹与可见窗口一致,反爬检测不出;仅窗口被 Windows 层隐藏。
/// hide=false(debug 构建)正常显示窗口,便于开发观察 Edge 行为。
/// 进程句柄由 BrowserManager 持有,browser_close 用 TerminateProcess 终止。
/// Command + from_raw_handle 转 Child 在稳定 rustc 不可用(被 gate),故直接管 HANDLE。
fn spawn_edge(exe: &Path, args: &[String], hide: bool) -> std::io::Result<(HANDLE, u32)> {
    // lpApplicationName 给 exe 路径 + lpCommandLine 拼完整命令行(引号防空格路径)。
    let exe_w: Vec<u16> = exe.as_os_str().encode_wide().chain(Some(0)).collect();
    let mut cmdline = format!("\"{}\"", exe.display());
    for a in args {
        cmdline.push(' ');
        if a.contains(' ') {
            // 含空格参数(如 --user-data-dir=C:\Users\John Doe\edge-profile)整体加引号,
            // 否则 CreateProcessW 按空白分词截断路径(用户名含空格时 Edge 启动失败/profile 错乱)。
            cmdline.push('"');
            cmdline.push_str(a);
            cmdline.push('"');
        } else {
            cmdline.push_str(a);
        }
    }
    let mut cmdline_w: Vec<u16> = cmdline.encode_utf16().chain(Some(0)).collect();

    // hide:STARTUPINFO 带 SW_HIDE(Chromium 会忽略它,需配合 hide_windows_for_pids);
    // debug 不隐藏:默认窗口显示。
    let mut si = STARTUPINFOW {
        cb: std::mem::size_of::<STARTUPINFOW>() as u32,
        ..unsafe { std::mem::zeroed() }
    };
    if hide {
        si.dwFlags = STARTF_USESHOWWINDOW;
        si.wShowWindow = SW_HIDE as u16;
    }
    let mut pi: PROCESS_INFORMATION = unsafe { std::mem::zeroed() };

    let ok = unsafe {
        CreateProcessW(
            exe_w.as_ptr(),
            cmdline_w.as_mut_ptr(),
            std::ptr::null(),
            std::ptr::null(),
            0,
            0,
            std::ptr::null(),
            std::ptr::null(),
            &si,
            &mut pi,
        )
    };
    if ok == 0 {
        return Err(std::io::Error::last_os_error());
    }
    // 线程句柄释放;进程句柄交还调用方(browser_close 负责 TerminateProcess)。
    unsafe {
        let _ = CloseHandle(pi.hThread);
    }
    Ok((pi.hProcess, pi.dwProcessId))
}

/// 确保浏览器就绪,返回 CDP 端口。
///
/// 幂等:端口上已有 CDP 服务(之前 spawn 的 Edge 存活)则直接复用。
/// 否则 spawn 系统 Edge(--remote-debugging-port + --user-data-dir 持久化登录态)。
#[tauri::command]
pub fn browser_ensure(app: AppHandle) -> Result<u16, String> {
    let port = CDP_PORT;
    if cdp_alive(port) {
        return Ok(port);
    }

    // spawn 前清理:杀残留的「我们的 Edge」(占 9223 的进程树),避免新 spawn 转发给
    // 残留实例而成为转发器(转发器无窗口、句柄指向转发器,退出杀不干净)。
    kill_edge_tree_on_port(port);

    let path = edge_path().ok_or("未找到系统 Edge,浏览器模拟不可用".to_string())?;

    // user-data-dir 持久化登录态(首次扫码登录后后续复用;独立 profile 不接管用户 Edge)。
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("edge-profile");
    std::fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;

    // debug 构建(dev)不隐藏窗口,便于开发观察 Edge 行为;release 构建隐藏(生产无感)。
    let hide = !cfg!(debug_assertions);
    let (handle, pid) = spawn_edge(&path, &edge_args(port, &data_dir, hide), hide)
        .map_err(|e| format!("spawn Edge 失败: {e}"))?;
    eprintln!("[browser] spawn Edge pid={pid} (hide={hide})");

    // 保存进程句柄供 browser_close 终止。
    let manager = app.state::<BrowserManager>();
    *manager.process.lock().unwrap() = Some(SafeHandle(handle));

    if hide {
        // ⚠️ 持窗进程 ≠ spawn pid(Edge 动态 fork 子进程承载窗口),须每次重新收集整棵
        // 进程树再隐藏——启动早期快照会漏掉稍后创建的持窗进程。CDP 端口 bind 早于
        // 主窗口创建,须等「至少藏到一个窗口」再返回,否则 CDP 就绪即 return 会漏藏。
        for _ in 0..30 {
            let pids = collect_process_descendants(pid);
            let hidden = hide_windows_for_pids(&pids);
            if cdp_alive(port) && hidden > 0 {
                eprintln!("[browser] CDP ready port={port}, hidden {hidden} windows");
                return Ok(port);
            }
            std::thread::sleep(std::time::Duration::from_millis(100));
        }
        // 兜底(3s 内 CDP 就绪但未确认藏到窗口):再补藏两次,覆盖极端时序。
        eprintln!("[browser] window hide not confirmed in 3s, retry…");
        let pids = collect_process_descendants(pid);
        hide_windows_for_pids(&pids);
        std::thread::sleep(std::time::Duration::from_millis(300));
        let pids = collect_process_descendants(pid);
        let hidden = hide_windows_for_pids(&pids);
        eprintln!("[browser] final hide: {hidden} windows");
        if cdp_alive(port) {
            return Ok(port);
        }
    } else {
        // debug:等 CDP 就绪即可,窗口保持可见。
        for _ in 0..30 {
            if cdp_alive(port) {
                eprintln!("[browser] CDP ready port={port} (debug, window visible)");
                return Ok(port);
            }
            std::thread::sleep(std::time::Duration::from_millis(100));
        }
    }
    Err("Edge 已启动但 CDP 未就绪".to_string())
}

/// 关闭浏览器进程(应用退出时调用,避免残留 Edge)。
#[tauri::command]
pub fn browser_close(app: AppHandle) -> Result<(), String> {
    let manager = app.state::<BrowserManager>();
    let handle = manager.process.lock().unwrap().take();
    if let Some(SafeHandle(h)) = handle {
        eprintln!("[browser] close: terminating Edge (handle)");
        unsafe {
            TerminateProcess(h, 0);
            WaitForSingleObject(h, 5000);
            CloseHandle(h);
        }
    } else {
        eprintln!("[browser] close: no handle (Edge not running)");
    }
    // TerminateProcess(单进程)不连带杀 Edge 子进程 → 按 9223 定位并杀整树兜底。
    kill_edge_tree_on_port(CDP_PORT);
    Ok(())
}
