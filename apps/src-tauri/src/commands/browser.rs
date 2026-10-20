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
use windows_sys::Win32::Foundation::{BOOL, CloseHandle, HANDLE, HWND, LPARAM, RECT};
use windows_sys::Win32::System::Threading::{
    CreateProcessW, OpenProcess, PROCESS_INFORMATION, PROCESS_TERMINATE, STARTF_USESHOWWINDOW,
    STARTUPINFOW, TerminateProcess, WaitForSingleObject,
};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GetClassNameW, GetForegroundWindow, GetWindowLongPtrW, GetWindowRect,
    GetWindowTextLengthW, GetWindowThreadProcessId, IsIconic, IsWindowVisible, SetForegroundWindow,
    SetWindowLongPtrW, ShowWindow, GWL_EXSTYLE, GWL_STYLE, SW_HIDE, SW_RESTORE, SW_SHOWNA,
    WS_EX_APPWINDOW, WS_EX_TOOLWINDOW, WS_THICKFRAME,
};

/// 进程句柄包装(HANDLE 是裸指针默认 !Send;进程句柄无线程亲和,可跨线程用)。
struct SafeHandle(HANDLE);
unsafe impl Send for SafeHandle {}

/// 窗口模式。
///
/// - `Hidden`：`SW_HIDE`。不渲染、无任务栏、CPU 近 0；SSR/DOM 读取够用。
/// - `Interactive`：屏外 shown（遮挡 flag 关闭）。渲染/IO/懒加载/scroll 事件与
///   可见窗口一致，供滚动驱动页面（xhs:user 翻页）使用。
///
/// ⚠️ 两者共用同一 Edge 实例，通过 `ShowWindow` 切换；遮挡/定时器 flag 是**启动参数**，
/// 所以启动时就全带上（见 `edge_args`），否则切到 Interactive 也唤不醒渲染。
#[derive(Clone, Copy, PartialEq, Eq, Debug, Default)]
enum BrowserMode {
    #[default]
    Hidden,
    Interactive,
}

/// 解析可选模式。`None` = 调用方只要求「确保就绪」，**不改变**当前模式
/// （`ensureConn` 会在每次首次 evaluate 时调 `browser_ensure`，带默认值会把
/// 刚切好的 interactive 又打回 hidden）。未知字符串报错，不静默降级。
fn parse_mode(mode: Option<&str>) -> Result<Option<BrowserMode>, String> {
    match mode {
        None => Ok(None),
        Some("interactive") => Ok(Some(BrowserMode::Interactive)),
        Some("hidden") => Ok(Some(BrowserMode::Hidden)),
        Some(other) => Err(format!("未知窗口模式: {other}（可用: hidden / interactive）")),
    }
}

/// 浏览器进程管理:持有 spawn 的 Edge 进程句柄,供 browser_close 终止。
pub struct BrowserManager {
    process: Mutex<Option<SafeHandle>>,
    /// spawn 的主进程 PID（窗口切换时要重新收集整棵进程树）。
    pid: Mutex<Option<u32>>,
    /// `None` = 模式未知（失败/未应用），下次切换强制重新应用；
    /// 不能只存 Hidden/Interactive，否则切换失败后会被「模式已一致」快路径永久跳过。
    mode: Mutex<Option<BrowserMode>>,
    /// 串行化窗口切换：读-改-写 mode 与阻塞的 ShowWindow 必须在同一临界区。
    switch_lock: Mutex<()>,
}

impl Default for BrowserManager {
    fn default() -> Self {
        Self {
            process: Mutex::new(None),
            pid: Mutex::new(None),
            mode: Mutex::new(None),
            switch_lock: Mutex::new(()),
        }
    }
}

/// 替换进程句柄槽，旧的立即 `CloseHandle`（重复 ensure 不泄漏内核句柄）。
fn set_process_handle(manager: &BrowserManager, next: Option<SafeHandle>) {
    let old = {
        let mut slot = manager.process.lock().unwrap();
        std::mem::replace(&mut *slot, next)
    };
    if let Some(SafeHandle(h)) = old {
        unsafe {
            let _ = CloseHandle(h);
        }
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
        GetExtendedTcpTable, MIB_TCPROW_OWNER_PID, MIB_TCPTABLE_OWNER_PID, MIB_TCP_STATE_LISTEN,
        TCP_TABLE_OWNER_PID_ALL,
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
            // ⚠️ 必须只认 LISTEN + 非 0 PID：ALL 表里同一端口还有 TIME_WAIT 行，
            // 其 OwningProcess 是 0；拿它当根 PID 会让隐藏/显示全部静默失效。
            if (*row).dwState != MIB_TCP_STATE_LISTEN as u32 || (*row).dwOwningPid == 0 {
                continue;
            }
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

/// 杀掉以 `root` 为根的整棵进程树。
/// TerminateProcess(单进程)不保证连带杀 Edge 子进程(Job Object 未设 KILL_ON_CLOSE),
/// 须显式枚举整树逐个杀。
fn kill_process_tree(root: u32) {
    let tree = collect_process_descendants(root);
    eprintln!("[browser] kill Edge tree root={root}: {} procs", tree.len());
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

/// 杀掉占用给定端口的进程及其整棵进程树。
fn kill_edge_tree_on_port(port: u16) {
    for pid in tcp_listen_pids(port) {
        kill_process_tree(pid);
    }
}

/// 枚举期间累计:目标 PID 集合 + 本次藏掉的「原本可见」窗口数。
struct HideCtx {
    pids: *const std::collections::HashSet<u32>,
    hidden: usize,
}

/// 隐藏目标 PID 集合的全部**可见**顶层窗口(Edge 主框架 + 辅助窗口),返回本次藏掉的数目。
///
/// ⚠️ **只对原本可见(`IsWindowVisible`)的窗口计数** —— 这是本函数唯一的正确性来源。
/// Chromium 顶层窗口里绝大多数是本来就 `vis=False` 的辅助/IPC 窗口,对它们
/// `ShowWindow(SW_HIDE)` 是无操作;若一律计数,`hidden>0` 会在**主框架窗口创建之前**
/// 就成立(那些隐形窗口先出现),调用方据此提前 return → 稍后创建并自行
/// `ShowWindow(SW_SHOW)` 的**主窗口漏藏**,表现为「隐藏的 Edge 仍在任务栏出现图标」
/// (2026-10-16 实测:命中时主框架 hwnd 尚未创建,主进程只被 `--window-position`
/// 挪到屏幕外,但仍占任务栏)。
///
/// SW_HIDE 的窗口无任务栏图标——「含任务栏完全隐藏」。Chromium 首次显示主窗口
/// **不遵守 STARTUPINFO 的 wShowWindow**(内部显式 ShowWindow(SW_SHOW)),故须主动隐藏。
fn hide_windows_for_pids(pids: &std::collections::HashSet<u32>) -> usize {
    unsafe extern "system" fn enum_cb(hwnd: HWND, lparam: LPARAM) -> BOOL {
        let ctx = &mut *(lparam as *mut HideCtx);
        let mut wnd_pid: u32 = 0;
        unsafe {
            GetWindowThreadProcessId(hwnd, &mut wnd_pid);
            // 只藏「属于我们 + 当前可见」的窗口,且只对后者计数。
            if (*ctx.pids).contains(&wnd_pid) && IsWindowVisible(hwnd) != 0 {
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

// ── 窗口模式切换（hidden ↔ interactive） ───────────────────────────────────────

/// 记录当前前台窗口（切换模式前后用于还原焦点）。
fn foreground_hwnd() -> HWND {
    unsafe { GetForegroundWindow() }
}

/// 把前台还给原窗口。
///
/// ⚠️ Chromium 显示窗口时会自己 `SetForegroundWindow`，`SW_SHOWNA` /
/// `WS_EX_NOACTIVATE` 都挡不住（2026-10-19 实测）。只能显示后稍等再还回去；
/// 若调用进程当时不是前台，Windows 可能拒绝这次还原（尽力而为）。
fn restore_foreground(hwnd: HWND) {
    if hwnd.is_null() {
        return;
    }
    std::thread::sleep(std::time::Duration::from_millis(350));
    unsafe {
        let _ = SetForegroundWindow(hwnd);
    }
}

struct MainWinCtx {
    pids: *const std::collections::HashSet<u32>,
    best: HWND,
    best_score: i64,
}

/// 找进程树里的**主框架窗口**。
///
/// ⚠️ 不能只按面积挑：Chromium 会有一个 `Chrome_WidgetWin_0` 的大尺寸辅助窗口
/// （隐藏、无标题），主窗口最小化后面积会掉到几千 px，辅助窗口反而"更大"——按面积
/// 会挑错窗口，`show_until_visible` 看起来成功、实际主窗口仍是 minimized（滚动 0 条），
/// 或者辅助窗口 show 不出来直接报「窗口模式切换失败」。
///
/// 判据 = 类名 `Chrome_WidgetWin_1` + `WS_THICKFRAME`（真正的浏览器框架；`还原页面`
/// 气泡虽然也是 `_1`，但 style 没有 thickframe）。带标题的优先，面积只做同档内排序。
fn main_window_for_pids(pids: &std::collections::HashSet<u32>) -> Option<HWND> {
    unsafe extern "system" fn enum_cb(hwnd: HWND, lparam: LPARAM) -> BOOL {
        let ctx = &mut *(lparam as *mut MainWinCtx);
        let mut wnd_pid: u32 = 0;
        unsafe {
            GetWindowThreadProcessId(hwnd, &mut wnd_pid);
            if !(*ctx.pids).contains(&wnd_pid) {
                return 1;
            }
            let mut rect: RECT = std::mem::zeroed();
            if GetWindowRect(hwnd, &mut rect) == 0 {
                return 1;
            }
            let area = (rect.right - rect.left).max(0) as i64 * (rect.bottom - rect.top).max(0) as i64;

            let mut class = [0u16; 64];
            let class_len = GetClassNameW(hwnd, class.as_mut_ptr(), class.len() as i32);
            let is_main = class_len > 0
                && String::from_utf16_lossy(&class[..class_len as usize]) == "Chrome_WidgetWin_1"
                && (GetWindowLongPtrW(hwnd, GWL_STYLE) as u32 & WS_THICKFRAME) != 0;
            let has_title = GetWindowTextLengthW(hwnd) > 0;
            let tier = if is_main && has_title {
                2
            } else if is_main {
                1
            } else {
                0
            };
            // 非主框架只接受足够大的窗口（启动早期的小辅助窗不应参与）。
            if tier == 0 && area < 100_000 {
                return 1;
            }
            let score = tier * 1_000_000_000 + area;
            if score > ctx.best_score {
                ctx.best_score = score;
                ctx.best = hwnd;
            }
        }
        1
    }
    let mut ctx = MainWinCtx {
        pids,
        best: std::ptr::null_mut(),
        best_score: 0,
    };
    unsafe {
        EnumWindows(Some(enum_cb), &mut ctx as *mut MainWinCtx as isize);
    }
    if ctx.best.is_null() {
        None
    } else {
        Some(ctx.best)
    }
}

/// 以「不激活 + 去任务栏」的方式显示主窗口，返回是否已显示。
///
/// `WS_EX_TOOLWINDOW` 去掉任务栏按钮；`SW_SHOWNA` 避免主动激活
/// （但 Chromium 仍可能前台化，调用方负责 `restore_foreground`）。
fn show_main_window(pids: &std::collections::HashSet<u32>) -> bool {
    let Some(hwnd) = main_window_for_pids(pids) else {
        return false;
    };
    unsafe {
        let ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE) as u32;
        let ex = (ex & !WS_EX_APPWINDOW) | WS_EX_TOOLWINDOW;
        SetWindowLongPtrW(hwnd, GWL_EXSTYLE, ex as isize);
        // ⚠️ SW_SHOWNA 不会还原最小化窗口（IsWindowVisible 仍为 true，但内容不渲染，
        // 滚动/IO 全停）。主窗口可能被系统/用户最小化 → 必须 SW_RESTORE。
        if IsIconic(hwnd) != 0 {
            ShowWindow(hwnd, SW_RESTORE);
        } else {
            ShowWindow(hwnd, SW_SHOWNA);
        }
        IsWindowVisible(hwnd) != 0
    }
}

/// 隐藏到稳定态。
///
/// `require_seen`：
///   - true（启动路径）：主框架窗口比 CDP 就绪晚约 1s，必须「曾见可见窗口 + 连续 3 轮
///     0 命中」才返回；否则会在主窗口创建前误判「藏净」。
///   - false（模式切换）：窗口本来就在，第一轮没东西可藏即可返回。
///
/// `seen0`：预热循环已经藏过窗口时传 true（否则 seen 永远为 false，会白等 2s）。
fn hide_until_stable(root: u32, require_seen: bool, seen0: bool) -> bool {
    let mut seen = seen0;
    let mut quiet = 0u32;
    for _ in 0..20 {
        let pids = collect_process_descendants(root);
        let main_like = main_window_for_pids(&pids).is_some();
        let hidden = hide_windows_for_pids(&pids);
        // 窗口可能在「取 main_like」与「藏窗口」之间创建：藏完再确认一次，
        // 否则 require_seen 路径会永远置不上 seen（白等 2s 且日志报 ok=false）。
        let main_now = main_like || (hidden > 0 && main_window_for_pids(&pids).is_some());
        if hidden > 0 && (main_now || !require_seen) {
            seen = true;
            quiet = 0;
        } else if hidden > 0 {
            // 启动路径只藏到辅助窗口：不算「见过主框架」，继续等。
        } else if seen || !require_seen {
            quiet += 1;
        }
        if seen && quiet >= 3 {
            return true;
        }
        if !require_seen && !seen && quiet >= 1 {
            return true; // 切隐藏时本来就没有可见窗口
        }
        std::thread::sleep(std::time::Duration::from_millis(100));
    }
    seen
}

/// 显示主窗口直到确认可见（窗口创建可能晚于 CDP 就绪）。
fn show_until_visible(root: u32) -> bool {
    for _ in 0..20 {
        let pids = collect_process_descendants(root);
        if show_main_window(&pids) {
            return true;
        }
        std::thread::sleep(std::time::Duration::from_millis(100));
    }
    false
}

/// 取进程树的根 PID：优先用本进程 spawn 的 pid；复用残留实例时按 CDP 端口反查。
fn browser_root_pid(manager: &BrowserManager) -> Option<u32> {
    if let Some(pid) = *manager.pid.lock().unwrap() {
        return Some(pid);
    }
    tcp_listen_pids(CDP_PORT).into_iter().next()
}

/// 等 CDP 端口就绪（spawn 后最多 6s）。
fn wait_cdp(port: u16) -> Result<(), String> {
    for _ in 0..60 {
        if cdp_alive(port) {
            return Ok(());
        }
        std::thread::sleep(std::time::Duration::from_millis(100));
    }
    Err("Edge 已启动但 CDP 未就绪".to_string())
}

/// Edge 启动参数。
///
/// `hide_capable` = release 构建（窗口可隐藏/切模式）。debug 保留可见窗口便于开发观察。
///
/// ⚠️ 遮挡与节流 flag 是**启动参数**，两种模式共用同一实例，所以必须无条件带上：
/// 若只在 hidden 时带，后来切到 interactive 也唤不醒渲染管线（见 docs §3.9）。
fn edge_args(port: u16, data_dir: &std::path::Path, hide_capable: bool) -> Vec<String> {
    let mut args = vec![
        format!("--remote-debugging-port={port}"),
        format!("--user-data-dir={}", data_dir.display()),
        // 新 Chromium 拒跨源 CDP,必须放开 origin。
        "--remote-allow-origins=*".to_string(),
        "--no-first-run".to_string(),
        "--no-default-browser-check".to_string(),
        // 关掉会「带出日常账号形态」的三个入口(对齐 edge-cdp 插件的干净实例做法):
        // Edge 账户层会把同步/扩展/默认应用挂到任何 profile 上,换 user-data-dir 挡不住。
        // ⚠️ .msn/.bing 的账户 cookie 仍会被注入(那是账户层行为,flag 挡不住),
        // 但不影响抓取;需要清零时在 CDP 内删 cookie。
        "--disable-sync".to_string(),
        "--disable-extensions".to_string(),
        "--disable-default-apps".to_string(),
        "--edge-redirect-feed-at-first-run-disabled=1".to_string(),
        // 后台不被节流/降权：hidden 下定时器照常；切 interactive 后无需重启即可渲染。
        "--disable-background-timer-throttling".to_string(),
        "--disable-renderer-backgrounding".to_string(),
        "--disable-backgrounding-occluded-windows".to_string(),
        "--disable-features=CalculateNativeWinOcclusion".to_string(),
    ];
    if hide_capable {
        // 屏外启动：即使 Chromium 先 ShowWindow 也不会闪在用户屏幕上。
        args.push("--window-position=-32000,-32000".to_string());
        // 只用于 SSR/滚动抓取，不给人看：禁图省内存与带宽。
        // 实测不影响 interactive 下的 rAF / IO / scroll 事件（只影响图片本身）。
        // ⚠️ 登录二维码不受影响——微博读 img.src、小红书读 data URL、抖音是 canvas 绘制。
        args.push("--blink-settings=imagesEnabled=false".to_string());
    }
    args.push("about:blank".to_string());
    args
}

/// 用 Windows API 启动 Edge,返回 (进程句柄, 主进程 PID)。
///
/// start_hidden=true 时以 SW_HIDE 启动(窗口完全隐藏含任务栏)——浏览器内部仍是正常模式
/// (非 headless),UA/指纹与可见窗口一致,反爬检测不出;仅窗口被 Windows 层隐藏。
/// start_hidden=false 时正常显示(交互模式 / debug 构建)。
/// 进程句柄由 BrowserManager 持有,browser_close 用 TerminateProcess 终止。
/// Command + from_raw_handle 转 Child 在稳定 rustc 不可用(被 gate),故直接管 HANDLE。
fn spawn_edge(exe: &Path, args: &[String], start_hidden: bool) -> std::io::Result<(HANDLE, u32)> {
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

    // start_hidden:STARTUPINFO 带 SW_HIDE(Chromium 会忽略它,需配合 hide_windows_for_pids);
    // debug 不隐藏:默认窗口显示。
    let mut si = STARTUPINFOW {
        cb: std::mem::size_of::<STARTUPINFOW>() as u32,
        ..unsafe { std::mem::zeroed() }
    };
    if start_hidden {
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

/// Edge profile 目录(release:持久化登录态)。
fn profile_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("edge-profile"))
}

/// 递归删目录(存在才删)。用于清理脏 profile。
fn rm_dir(path: &Path) -> std::io::Result<()> {
    if path.exists() {
        std::fs::remove_dir_all(path)
    } else {
        Ok(())
    }
}

/// 清空浏览器 profile(先杀我们的 Edge,再删目录)。下次 browser_ensure 会自建全新目录。
///
/// desktop「存储与诊断」/ CLI `rss browser-reset` 均调用此命令(CLI 经它转发到同一个
/// Rust 实现,不重复写删除逻辑)。
///
/// ⚠️ 只杀**占用 CDP 端口的那棵进程树**(= 我们的 Edge),不动用户日常 Edge:
/// 日常实例用另一个 profile,不会锁住我们的目录;按镜像名全杀会把用户正在浏览的
/// 窗口一起关掉,对「清理浏览器数据」这个动作来说过界了。
/// 副作用:微博/小红书等靠 Edge profile 登录态的平台会**掉登录态**(需重新登录);
/// 应用自身数据(SQLite / localStorage)不受影响。
// ⚠️ `(async)` 让同步体跑**线程池**而非主线程:本命令含 10×200ms 重试忙等,主线程执行
// 会冻窗口数秒(WebView 不重绘)。
#[tauri::command(async)]
pub fn browser_reset_profile(app: AppHandle) -> Result<String, String> {
    let dir = profile_dir(&app)?;
    let pids = tcp_listen_pids(CDP_PORT).len();
    let manager = app.state::<BrowserManager>();
    // 与模式切换互斥，避免切换中途进程被删。
    let _switch = manager.switch_lock.lock().unwrap();
    kill_edge_tree_on_port(CDP_PORT);
    // 进程已杀：关掉旧句柄并清空状态，下次 ensure 按请求重新应用模式。
    set_process_handle(&manager, None);
    *manager.pid.lock().unwrap() = None;
    *manager.mode.lock().unwrap() = None;
    // 杀进程后 Chromium 子进程释放文件句柄有延迟,重试几次再放弃。
    let mut last_err = None;
    for _ in 0..10 {
        match rm_dir(&dir) {
            Ok(()) => {
                let msg = format!("已清理浏览器 profile(结束 {pids} 个实例):{}", dir.display());
                eprintln!("[browser] reset-profile ok: {msg}");
                return Ok(msg);
            }
            Err(e) => {
                last_err = Some(e);
                std::thread::sleep(std::time::Duration::from_millis(200));
            }
        }
    }
    Err(format!(
        "删除 profile 失败({}):{}。可能有 Edge 仍占用该目录,请手动关闭后重试。",
        dir.display(),
        last_err.map(|e| e.to_string()).unwrap_or_default()
    ))
}

/// 确保浏览器就绪,返回 CDP 端口。
///
/// `mode`: `"hidden"`（默认）/ `"interactive"`，见 `BrowserMode`。
/// 幂等：端口上已有 CDP 服务时只按请求切换窗口模式，不重复 spawn。
/// 否则 spawn 系统 Edge（--remote-debugging-port + --user-data-dir 持久化登录态）。
// ⚠️ `(async)`：本命令 spawn Edge 后含最多 60×100ms 的 CDP 就绪忙等 + 窗口稳定
// 等待（约 3s+），主线程执行会冻窗口。见 browser_reset_profile 上方注释。
#[tauri::command(async)]
pub fn browser_ensure(app: AppHandle, mode: Option<String>) -> Result<u16, String> {
    let port = CDP_PORT;
    let requested = parse_mode(mode.as_deref())?;
    let manager = app.state::<BrowserManager>();

    if cdp_alive(port) {
        if let Some(m) = requested {
            switch_mode(&manager, m)?;
        }
        return Ok(port);
    }

    // 串行化整段「双检 → 清理 → spawn → 应用模式」：否则两个并发 ensure 会互相
    // 把对方刚起的 Edge 杀掉。持锁后必须重新检查端口。
    let _switch = manager.switch_lock.lock().unwrap();
    if cdp_alive(port) {
        drop(_switch); // 不能在持锁时调 switch_mode（它会再次取同一把锁）
        if let Some(m) = requested {
            switch_mode(&manager, m)?;
        }
        return Ok(port);
    }

    // spawn 前清理:杀残留的「我们的 Edge」(占 9223 的进程树),避免新 spawn 转发给
    // 残留实例而成为转发器(转发器无窗口、句柄指向转发器,退出杀不干净)。
    kill_edge_tree_on_port(port);

    let path = edge_path().ok_or("未找到系统 Edge,浏览器模拟不可用".to_string())?;

    // user-data-dir 持久化登录态(首次扫码登录后后续复用;独立 profile 不接管用户 Edge)。
    // ⚠️ profile 会被 Edge 越养越脏(累积扩展 + 微软账户层 cookie,见 edge-cdp「坑 2」),
    // 需要时用 browser_reset_profile(桌面「存储与诊断」/ CLI `rss browser-reset`)重置,
    // **不**在每次启动时自动清——那会连带清掉扫码登录态。
    let data_dir = profile_dir(&app)?;
    std::fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;

    // debug 构建(dev)不隐藏窗口,便于开发观察 Edge 行为;release 构建可隐藏/切模式。
    let hide_capable = !cfg!(debug_assertions);
    let initial = requested.unwrap_or(BrowserMode::Hidden);
    let start_hidden = hide_capable && initial == BrowserMode::Hidden;

    // （switch_lock 已在上面获取，覆盖 spawn 与模式应用。）
    let (handle, pid) = spawn_edge(
        &path,
        &edge_args(port, &data_dir, hide_capable),
        start_hidden,
    )
    .map_err(|e| format!("spawn Edge 失败: {e}"))?;
    eprintln!(
        "[browser] spawn Edge pid={pid} (mode={initial:?}, hide_capable={hide_capable}, profile={})",
        data_dir.display()
    );

    // 保存进程句柄供 browser_close 终止（替换旧句柄并关闭，避免泄漏）。
    set_process_handle(&manager, Some(SafeHandle(handle)));
    *manager.pid.lock().unwrap() = Some(pid);

    // 失败清理：杀半启动的进程树、关句柄、状态置未知（下次 ensure 重新应用模式）。
    let abort = |e: String| -> Result<u16, String> {
        kill_process_tree(pid);
        set_process_handle(&manager, None);
        *manager.pid.lock().unwrap() = None;
        *manager.mode.lock().unwrap() = None;
        eprintln!("[browser] spawn aborted: {e}");
        Err(e)
    };

    if hide_capable {
        let fg = foreground_hwnd();
        let result = (|| -> Result<bool, String> {
            match initial {
                BrowserMode::Hidden => {
                    // 边等 CDP 边藏：Chromium 往往在 CDP 就绪前就 ShowWindow，
                    // 尽早藏掉可缩短「屏外可见 + 可能抢前台」的暴露时间。
                    let mut pre_seen = false;
                    for _ in 0..60 {
                        let pids = collect_process_descendants(pid);
                        // 只把「主框架级」窗口算作 seen，避免辅助小窗让稳定判定过早成立。
                        if main_window_for_pids(&pids).is_some() {
                            pre_seen = true;
                        }
                        hide_windows_for_pids(&pids);
                        if cdp_alive(port) {
                            break;
                        }
                        std::thread::sleep(std::time::Duration::from_millis(100));
                    }
                    wait_cdp(port)?;
                    Ok(hide_until_stable(pid, true, pre_seen))
                }
                BrowserMode::Interactive => {
                    wait_cdp(port)?;
                    Ok(show_until_visible(pid))
                }
            }
        })();
        restore_foreground(fg);
        match result {
            Ok(ok) => {
                *manager.mode.lock().unwrap() = if ok { Some(initial) } else { None };
                eprintln!("[browser] ready port={port} mode={initial:?} ok={ok}");
            }
            Err(e) => return abort(e),
        }
    } else {
        if let Err(e) = wait_cdp(port) {
            return abort(e);
        }
        *manager.mode.lock().unwrap() = Some(initial);
        eprintln!("[browser] ready port={port} (debug, window visible)");
    }
    Ok(port)
}

/// 切换窗口模式（不重启 Edge）。浏览器未启动时按目标模式 spawn。
#[tauri::command(async)]
pub fn browser_set_mode(app: AppHandle, mode: String) -> Result<(), String> {
    let requested = parse_mode(Some(&mode))?.ok_or_else(|| "缺少窗口模式".to_string())?;
    if !cdp_alive(CDP_PORT) {
        browser_ensure(app.clone(), Some(mode))?;
        // spawn 路径的应用失败目前只把 mode 置 None；这里必须把它变成显式错误，
        // 否则冷启动的 interactive 会「假成功」，滚动翻页静默 0 条。
        let manager = app.state::<BrowserManager>();
        if *manager.mode.lock().unwrap() != Some(requested) {
            return Err(format!("浏览器窗口模式未生效: {requested:?}"));
        }
        return Ok(());
    }
    let manager = app.state::<BrowserManager>();
    switch_mode(&manager, requested)
}

/// 已有实例的模式切换：按需 hide/show，并还原前台。
fn switch_mode(manager: &BrowserManager, requested: BrowserMode) -> Result<(), String> {
    // 整个切换临界区：读-改-写 mode 与阻塞的 ShowWindow 必须原子（命令跑在线程池，
    // JS 侧的 withBrowserLock 只覆盖 crawler 路径，挡不住并发的 browser_set_mode）。
    let _guard = manager.switch_lock.lock().unwrap();

    // 只有「本进程 spawn 的实例」才能信内存里的模式；复用残留实例时状态未知，
    // 必须强制应用一次（否则 app 重启后可能把 interactive 窗口当成 hidden 跳过）。
    let owned = manager.pid.lock().unwrap().is_some();
    let current = *manager.mode.lock().unwrap();
    if owned && current == Some(requested) {
        return Ok(());
    }
    // debug 窗口始终可见，模式无意义。
    if cfg!(debug_assertions) {
        *manager.mode.lock().unwrap() = Some(requested);
        return Ok(());
    }
    let root = browser_root_pid(manager).ok_or("未找到浏览器进程")?;
    // 记住残留实例的根 PID：后续切换按 owned 快路径走，不必每次都强制应用。
    if !owned {
        *manager.pid.lock().unwrap() = Some(root);
    }
    let fg = foreground_hwnd();
    let ok = match requested {
        BrowserMode::Hidden => hide_until_stable(root, false, false),
        BrowserMode::Interactive => show_until_visible(root),
    };
    restore_foreground(fg);
    // 失败时置「未知」而不是记成成功态：否则下次同向请求会命中「模式已一致」快路径，
    // 永久跳过重试（窗口可能仍可见）。
    *manager.mode.lock().unwrap() = if ok { Some(requested) } else { None };
    if !ok {
        return Err(format!("浏览器窗口模式切换失败: {requested:?}"));
    }
    eprintln!("[browser] mode -> {requested:?}");
    Ok(())
}

/// 关闭浏览器进程(应用退出时调用,避免残留 Edge)。
#[tauri::command]
pub fn browser_close(app: AppHandle) -> Result<(), String> {
    let manager = app.state::<BrowserManager>();
    // 与应用退出互斥，但**不能阻塞退出**：切换最长约 12s，拿不到锁就直接按端口杀树。
    let _switch = manager.switch_lock.try_lock().ok();
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
    *manager.pid.lock().unwrap() = None;
    *manager.mode.lock().unwrap() = None;
    Ok(())
}
