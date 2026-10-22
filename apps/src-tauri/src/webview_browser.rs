//! webview_browser —— 用 Tauri 自己的 WebView2 当抓取浏览器。
//!
//! 一个隐藏的 `WebviewWindow`（独立 `data_directory`）+ CDP 端口 9334。TS 侧的
//! `TauriBrowserBackend` 仍是同一套 CDP 客户端，只是端口来源是 `webview_browser_open`。
//!
//! 为什么能省内存：Edge 实例自带 Copilot / discover-chat / nurturing 等界面
//! （实测 private ~0.29GB），WebView2 没有这一层；代价是页面里能直接读到
//! `window.chrome.webview` 与 UA-CH 的 `Microsoft Edge WebView2`（见 crawler-topology）。
//!
//! 生命周期（open / close / reset 全部串行化，见 `OP`）：
//!   - **懒创建**：启动不建，第一次抓取才建（空闲回收掉的实例不会被开机又拉起来）；
//!   - `open` 以「CDP 端口真的可连」为就绪判据，而不只是「窗口对象存在」；
//!   - `close` 用 `destroy()`（不走 CloseRequested 钩子）并**等到窗口销毁、端口释放**
//!     才返回 —— 否则紧接着的重建会撞上旧 WebView2 环境占着的 user-data-dir / 端口；
//!   - 主窗口销毁后必须显式 `exit`：抓取 webview 是第二个窗口，只关主窗口时
//!     Tauri 的 windows 集合非空，进程会变成不可见的常驻僵尸。
//!
//! ⚠️ WebView2 的窗口创建必须在主线程：命令跑在线程池，统一经 `run_on_main_thread`
//! 回主线程并等结果（`build_on_main`）。退出钩子本身在主线程，走 `close_for_exit`
//! （只投递销毁消息，不等待）。
//! ⚠️ `additional_browser_args` 会**覆盖** wry 默认带的
//! `--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection`，这里自己补回。

#[cfg(windows)]
use std::collections::HashMap;
#[cfg(windows)]
use std::net::{SocketAddr, TcpStream};
#[cfg(windows)]
use std::os::windows::process::CommandExt;
#[cfg(windows)]
use std::path::PathBuf;
#[cfg(windows)]
use std::sync::atomic::{AtomicBool, Ordering};
#[cfg(windows)]
use std::sync::{Mutex, MutexGuard};
#[cfg(windows)]
use std::time::{Duration, Instant};
#[cfg(windows)]
use tauri::{AppHandle, Manager, PhysicalPosition, WebviewUrl, WebviewWindowBuilder};
#[cfg(windows)]
use windows_sys::Win32::Foundation::{CloseHandle, BOOL, HWND, LPARAM};
#[cfg(windows)]
use windows_sys::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
};
#[cfg(windows)]
use windows_sys::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GetClassNameW, GetWindowLongPtrW, GetWindowThreadProcessId, SetWindowLongPtrW,
    SetWindowPos, ShowWindow, GWL_EXSTYLE, SWP_FRAMECHANGED, SWP_NOACTIVATE, SWP_NOSIZE,
    SWP_NOZORDER, SW_HIDE, SW_SHOWNA, WS_EX_APPWINDOW, WS_EX_TOOLWINDOW,
};
#[cfg(not(windows))]
use tauri::AppHandle;

/// 与正式 Edge 的 9223 不同：本方案不再 spawn Edge，这个端口只服务 WebView2。
pub const PORT: u16 = 9334;

#[cfg(windows)]
const LABEL: &str = "scrape-webview";
/// CDP 就绪等待上限（冷启动 WebView2 实测 <1.5s）。
#[cfg(windows)]
const CDP_READY_TIMEOUT: Duration = Duration::from_secs(8);
/// 销毁后等待事件循环回收窗口 / WebView2 进程释放端口的预算。
#[cfg(windows)]
const TEARDOWN_TIMEOUT: Duration = Duration::from_secs(3);

/// open / set_mode / close / reset 串行化：并发首次使用时两次 open 会重复建窗口
/// （第二个必然因 label 冲突失败）；close 与 open 交错还会拿到正在销毁的窗口。
#[cfg(windows)]
static OP: Mutex<()> = Mutex::new(());

#[cfg(windows)]
fn op_lock() -> MutexGuard<'static, ()> {
    // 失败的 op 不应毒化后续操作：状态本身是「窗口是否存在」的实时查询。
    OP.lock().unwrap_or_else(|e| e.into_inner())
}

/// 当前窗口模式（CDP 创建的 lane 窗口不归 Tauri 管，只能按这份状态整理）。
#[cfg(windows)]
static INTERACTIVE: AtomicBool = AtomicBool::new(false);

#[cfg(windows)]
fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_local_data_dir()
        .map_err(|e| e.to_string())?
        .join("webview-profile"))
}

#[cfg(windows)]
fn browser_args() -> String {
    [
        format!("--remote-debugging-port={PORT}"),
        "--remote-allow-origins=*".to_string(),
        "--no-first-run".to_string(),
        "--no-default-browser-check".to_string(),
        "--hide-crash-restore-bubble".to_string(),
        "--disable-sync".to_string(),
        "--disable-extensions".to_string(),
        "--disable-default-apps".to_string(),
        "--disable-background-timer-throttling".to_string(),
        "--disable-renderer-backgrounding".to_string(),
        "--disable-backgrounding-occluded-windows".to_string(),
        // Tauri/wry 的默认项被覆盖后必须补回，另加产品用的 feature 关闭项。
        "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection,CalculateNativeWinOcclusion,Translate,BackForwardCache,OptimizationHints,MediaRouter".to_string(),
        "--disable-background-networking".to_string(),
        "--disable-component-update".to_string(),
        "--no-pings".to_string(),
        "--disable-breakpad".to_string(),
        "--metrics-recording-only".to_string(),
        "--disable-gpu-compositing".to_string(),
        "--js-flags=--max-old-space-size=512".to_string(),
        "--disk-cache-size=67108864".to_string(),
        "--blink-settings=imagesEnabled=false".to_string(),
        // 屏外起点：interactive 模式 show 出来也不会闪到用户屏幕正中。
        "--window-position=-32000,-32000".to_string(),
    ]
    .join(" ")
}

/// CDP 端口是否可连（= 浏览器进程的调试服务真的起来了）。
#[cfg(windows)]
fn cdp_alive() -> bool {
    TcpStream::connect_timeout(
        &SocketAddr::from(([127, 0, 0, 1], PORT)),
        Duration::from_millis(250),
    )
    .is_ok()
}

#[cfg(windows)]
fn wait_cdp(timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    loop {
        if cdp_alive() {
            return true;
        }
        if Instant::now() >= deadline {
            return false;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
}

#[cfg(windows)]
fn wait_cdp_gone(timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    loop {
        if !cdp_alive() {
            return true;
        }
        if Instant::now() >= deadline {
            return false;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
}

/// 启动外部控制台程序时隐藏窗口。
///
/// ⚠️ release 是 Windows GUI 子系统（`main.rs` 的 `windows_subsystem = "windows"`）：
/// `std::process::Command` 默认不带 `CREATE_NO_WINDOW`，netstat/taskkill 每次都会闪一个
/// 黑色控制台并短暂抢焦点。debug 因父进程自带控制台不显形（典型 release-only 分支）。
#[cfg(windows)]
fn quiet_command(program: &str) -> std::process::Command {
    let mut cmd = std::process::Command::new(program);
    cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    cmd
}

/// 监听 CDP 端口的进程 PID（= 抓取 WebView2 的浏览器进程）。
#[cfg(windows)]
fn cdp_listener_pids() -> Vec<u32> {
    let Ok(out) = quiet_command("netstat").args(["-ano", "-p", "TCP"]).output() else {
        return Vec::new();
    };
    let text = String::from_utf8_lossy(&out.stdout);
    let needle = format!(":{PORT} ");
    let mut pids = Vec::new();
    for line in text.lines() {
        if !line.contains("LISTENING") || !line.contains(&needle) {
            continue;
        }
        let Some(pid) = line.split_whitespace().last().and_then(|p| p.parse::<u32>().ok()) else {
            continue;
        };
        if pid != 0 && !pids.contains(&pid) {
            pids.push(pid);
        }
    }
    pids
}

/// 进程 → 父进程表（一次快照；用于判断监听者是否属于本进程树）。
#[cfg(windows)]
fn process_parent_map() -> HashMap<u32, u32> {
    let mut map = HashMap::new();
    unsafe {
        let snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if snap as isize == -1 {
            return map;
        }
        let mut entry: PROCESSENTRY32W = std::mem::zeroed();
        entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
        if Process32FirstW(snap, &mut entry) != 0 {
            loop {
                map.insert(entry.th32ProcessID, entry.th32ParentProcessID);
                if Process32NextW(snap, &mut entry) == 0 {
                    break;
                }
            }
        }
        let _ = CloseHandle(snap);
    }
    map
}

#[cfg(windows)]
fn is_descendant(pid: u32, ancestor: u32, parents: &HashMap<u32, u32>) -> bool {
    let mut cur = pid;
    for _ in 0..64 {
        if cur == ancestor {
            return true;
        }
        match parents.get(&cur).copied() {
            Some(p) if p != 0 && p != cur => cur = p,
            _ => return false,
        }
    }
    false
}

/// 占着 CDP 端口、且属于**本进程树**的监听者。
///
/// ⚠️ 不能只看「端口有人监听」：应用没有 single-instance 保护，第二个实例会把第一个
/// 实例的浏览器误当孤儿杀掉，随后两个实例还会互相连到对方的 CDP。归属判据 = 父进程链
/// 能走到本进程（WebView2 浏览器进程由宿主进程拉起）。
#[cfg(windows)]
fn our_cdp_pids() -> Vec<u32> {
    let me = std::process::id();
    let parents = process_parent_map();
    cdp_listener_pids()
        .into_iter()
        .filter(|&pid| is_descendant(pid, me, &parents))
        .collect()
}

/// 杀掉本进程遗留的 CDP 进程树（上一个宿主窗口已销毁 / lane 窗口仍在 / 崩溃残留）。
///
/// 只杀父进程链属于本进程的监听者；其它实例的浏览器不碰（open/close 会据端口是否释放
/// 给出可操作错误）。
#[cfg(windows)]
fn kill_stale_cdp() {
    let me = std::process::id();
    let parents = process_parent_map();
    for pid in cdp_listener_pids() {
        if !is_descendant(pid, me, &parents) {
            eprintln!("[browser] skip foreign CDP listener pid={pid}");
            continue;
        }
        eprintln!("[browser] kill CDP process tree pid={pid}");
        let pid = pid.to_string();
        let _ = quiet_command("taskkill")
            .args(["/F", "/T", "/PID", pid.as_str()])
            .output();
    }
}

/// lane 窗口整理上下文。
#[cfg(windows)]
struct TidyCtx {
    pids: Vec<u32>,
    interactive: bool,
    seen: usize,
}

/// `Chrome_WidgetWin_1` = Chromium 主框架窗口（`Chrome_WidgetWin_0` 是辅助窗口）。
///
/// CDP `Target.createTarget` 在 WebView2 下会为每个 target 建**独立顶层窗口**
/// （不是 tab）：无 owner、带任务栏/Alt-Tab 项。必须：
///   - 去掉 `WS_EX_APPWINDOW` 换 `WS_EX_TOOLWINDOW`（不进任务栏/Alt-Tab）；
///   - hidden 模式 `SW_HIDE`（不渲染）；interactive 模式屏外 `SW_SHOWNA`（渲染照常）。
#[cfg(windows)]
unsafe extern "system" fn tidy_cb(hwnd: HWND, lparam: LPARAM) -> BOOL {
    let ctx = &mut *(lparam as *mut TidyCtx);
    let mut pid: u32 = 0;
    unsafe {
        GetWindowThreadProcessId(hwnd, &mut pid);
    }
    if !ctx.pids.contains(&pid) {
        return 1;
    }
    let mut class = [0u16; 64];
    let n = unsafe { GetClassNameW(hwnd, class.as_mut_ptr(), class.len() as i32) };
    if n <= 0 || String::from_utf16_lossy(&class[..n as usize]) != "Chrome_WidgetWin_1" {
        return 1;
    }
    ctx.seen += 1;
    unsafe {
        let ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE) as u32;
        let next = (ex & !WS_EX_APPWINDOW) | WS_EX_TOOLWINDOW;
        if next != ex {
            SetWindowLongPtrW(hwnd, GWL_EXSTYLE, next as isize);
        }
        if ctx.interactive {
            SetWindowPos(
                hwnd,
                std::ptr::null_mut(),
                -32000,
                -32000,
                0,
                0,
                SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED,
            );
            ShowWindow(hwnd, SW_SHOWNA);
        } else {
            ShowWindow(hwnd, SW_HIDE);
        }
    }
    1
}

/// 把当前所有抓取 lane 窗口整理到目标模式，返回命中的窗口数。
#[cfg(windows)]
fn tidy_browser_windows() -> usize {
    let pids = our_cdp_pids();
    if pids.is_empty() {
        return 0;
    }
    let mut ctx = TidyCtx {
        pids,
        interactive: INTERACTIVE.load(Ordering::Relaxed),
        seen: 0,
    };
    unsafe {
        EnumWindows(Some(tidy_cb), &mut ctx as *mut TidyCtx as isize);
    }
    ctx.seen
}

/// 真正建 webview（只能在主线程调用）。
#[cfg(windows)]
fn build(app: &AppHandle) -> Result<(), String> {
    if app.get_webview_window(LABEL).is_some() {
        return Ok(());
    }
    let dir = data_dir(app)?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let url = tauri::Url::parse("about:blank").map_err(|e| e.to_string())?;

    WebviewWindowBuilder::new(app, LABEL, WebviewUrl::External(url))
        .title(LABEL)
        .visible(false)
        .skip_taskbar(true)
        .decorations(false)
        .inner_size(1280.0, 800.0)
        .data_directory(dir)
        .additional_browser_args(&browser_args())
        .build()
        .map_err(|e| format!("创建抓取 webview 失败: {e}"))?;
    Ok(())
}

/// 命令跑在线程池 → 回主线程建 webview，等结果。
#[cfg(windows)]
fn build_on_main(app: &AppHandle) -> Result<(), String> {
    if app.get_webview_window(LABEL).is_some() {
        return Ok(());
    }
    let (tx, rx) = std::sync::mpsc::channel();
    let handle = app.clone();
    app.run_on_main_thread(move || {
        let _ = tx.send(build(&handle));
    })
    .map_err(|e| e.to_string())?;
    rx.recv_timeout(Duration::from_secs(15))
        .map_err(|e| format!("创建抓取 webview 超时: {e}"))?
}

/// 投递销毁消息（`destroy` 跳过 CloseRequested 钩子，语义更接近「内部资源回收」）。
#[cfg(windows)]
fn destroy_window(app: &AppHandle) -> Result<bool, String> {
    match app.get_webview_window(LABEL) {
        Some(win) => {
            win.destroy().map_err(|e| e.to_string())?;
            Ok(true)
        }
        None => Ok(false),
    }
}

#[cfg(windows)]
fn wait_window_gone(app: &AppHandle, timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    loop {
        if app.get_webview_window(LABEL).is_none() {
            return true;
        }
        if Instant::now() >= deadline {
            return false;
        }
        std::thread::sleep(Duration::from_millis(20));
    }
}

/// 确保 webview 存在且 CDP 真的可连（调用方必须持 `OP` 锁）。
#[cfg(windows)]
fn ensure_open_locked(app: &AppHandle) -> Result<(), String> {
    if app.get_webview_window(LABEL).is_some() {
        if cdp_alive() {
            // ⚠️ 「端口有人监听」还不够：可能是另一个实例的浏览器（本实例的窗口成了
            // 死壳）。只有监听者属于本进程树才能交回端口，否则会静默连到别的实例。
            if our_cdp_pids().is_empty() {
                return Err(format!(
                    "CDP 端口 {PORT} 被其它进程占用（可能已有另一个应用实例在运行）"
                ));
            }
            // lane 窗口可能在上一次模式切换后残留，按当前模式再整理一次（幂等）。
            tidy_browser_windows();
            return Ok(());
        }
        // 窗口对象在但 CDP 不通：上一次创建半途失败 / 浏览器进程已退出。
        // 留着它会让每次 open 都返回一个连不上的端口，直接重建。
        eprintln!("[browser] webview alive but CDP down → recreate");
        destroy_window(app)?;
        wait_window_gone(app, TEARDOWN_TIMEOUT);
        wait_cdp_gone(TEARDOWN_TIMEOUT);
    } else if cdp_alive() {
        // 没有窗口却有人监听端口：可能是本进程上一次的残留，也可能是另一个应用实例。
        // 只收掉本进程树的残留；端口仍不释放说明被别的实例占着，绝不能连上去。
        kill_stale_cdp();
        if !wait_cdp_gone(TEARDOWN_TIMEOUT) {
            return Err(format!(
                "CDP 端口 {PORT} 被其它进程占用（可能已有另一个应用实例在运行）"
            ));
        }
    }

    build_on_main(app)?;
    if !wait_cdp(CDP_READY_TIMEOUT) {
        // 建了但 CDP 没起来：销毁掉，别让下次 open 把「窗口存在」误判成可用。
        let _ = destroy_window(app);
        return Err("抓取 webview 已创建但 CDP 端口未就绪".to_string());
    }
    // 复用一个已存在的实例时，lane 窗口可能残留（例如上次 close 没走完）。
    tidy_browser_windows();
    Ok(())
}

/// 关闭并等到真正释放（调用方必须持 `OP` 锁）。
#[cfg(windows)]
fn close_locked(app: &AppHandle) -> Result<(), String> {
    INTERACTIVE.store(false, Ordering::Relaxed);
    let had_window = destroy_window(app)?;
    if had_window && !wait_window_gone(app, TEARDOWN_TIMEOUT) {
        return Err("抓取 webview 关闭超时（窗口未销毁）".to_string());
    }
    // 窗口销毁 ≠ WebView2 浏览器进程退出：CDP `Target.createTarget` 建的 lane 窗口
    // 是独立顶层窗口，宿主窗口销毁后它们仍在，浏览器进程（和 9334）会继续存活 ——
    // 下一次 open 会撞 user-data-dir / 端口。进程树是本应用专用的，直接收掉。
    if cdp_alive() {
        kill_stale_cdp();
    }
    if !wait_cdp_gone(TEARDOWN_TIMEOUT) {
        // 不是本进程树的监听者（例如另一个应用实例）：不杀，也不能假装清理完成。
        return Err(format!(
            "CDP 端口 {PORT} 仍被占用（可能来自另一个应用实例）"
        ));
    }
    Ok(())
}

/// 确保 webview 存在，返回 CDP 端口（幂等；就绪时才返回）。
#[cfg(windows)]
pub fn open(app: &AppHandle) -> Result<u16, String> {
    let _guard = op_lock();
    ensure_open_locked(app)?;
    Ok(PORT)
}

/// 窗口模式：hidden = 藏窗口；interactive = 屏外显示（渲染/滚动照常）。
#[cfg(windows)]
pub fn set_mode(app: &AppHandle, mode: &str) -> Result<(), String> {
    let visible = match mode {
        "hidden" => false,
        "interactive" => true,
        other => return Err(format!("未知窗口模式: {other}（可用: hidden / interactive）")),
    };
    let _guard = op_lock();
    ensure_open_locked(app)?;
    let win = app
        .get_webview_window(LABEL)
        .ok_or_else(|| "抓取 webview 不存在".to_string())?;
    INTERACTIVE.store(visible, Ordering::Relaxed);
    if visible {
        // 先定位再显示，避免在默认位置闪一下。
        let _ = win.set_position(PhysicalPosition::new(-32000, -32000));
        // ⚠️ 不能用 `win.show()`：tao 内部走 ShowWindow(SW_SHOWNORMAL)，会激活窗口，
        // 把用户正在主窗口输入的焦点抢走（旧 Edge 实现专门还原过前台）。SW_SHOWNA
        // 只显示不激活 —— 屏外窗口渲染照常（lane 窗口同款）。
        let hwnd = win.hwnd().map_err(|e| e.to_string())?;
        unsafe {
            ShowWindow(hwnd.0 as *mut core::ffi::c_void, SW_SHOWNA);
        }
    } else {
        // ⚠️ 同理不能用 `win.hide()`：Tauri 的内部可见态没被 SW_SHOWNA 更新过，
        // 它会认为窗口本来就不可见而跳过 SW_HIDE。直接对 HWND 操作。
        let hwnd = win.hwnd().map_err(|e| e.to_string())?;
        unsafe {
            ShowWindow(hwnd.0 as *mut core::ffi::c_void, SW_HIDE);
        }
    }
    // Tauri 只管宿主窗口；lane 窗口得按同一模式单独整理。
    tidy_browser_windows();
    Ok(())
}

/// 整理 CDP lane 窗口（去任务栏 / 屏外 / 隐藏）。
///
/// TS 侧每次 `Target.createTarget` 后调用：WebView2 会为 target 建一个独立顶层窗口，
/// 不整理就会留在任务栏 / Alt-Tab 里。调用方（backend）在 target 创建后立即调用，
/// 这里做两轮（覆盖窗口晚几毫秒才可见的情况）。
#[cfg(windows)]
pub fn tidy_windows(app: &AppHandle) -> Result<(), String> {
    let _guard = op_lock();
    if app.get_webview_window(LABEL).is_none() {
        return Ok(());
    }
    tidy_browser_windows();
    std::thread::sleep(Duration::from_millis(60));
    tidy_browser_windows();
    Ok(())
}

/// 关闭 webview（空闲回收）。返回时窗口已销毁、端口已释放；下次 `open` 重建。
#[cfg(windows)]
pub fn close(app: &AppHandle) -> Result<(), String> {
    let _guard = op_lock();
    close_locked(app)
}

/// 清空抓取 profile（登录态/缓存）：先关 webview，再删目录（Windows 可能短暂占用 → 重试）。
#[cfg(windows)]
pub fn reset(app: &AppHandle) -> Result<String, String> {
    // 整个删除过程持锁：否则并发 open 会把 webview 重建到正在删的目录里。
    let _guard = op_lock();
    let dir = data_dir(app)?;
    close_locked(app)?;
    let mut last = String::new();
    for _ in 0..30 {
        if !dir.exists() {
            return Ok(format!("已清空抓取浏览器数据（{}）", dir.display()));
        }
        match std::fs::remove_dir_all(&dir) {
            Ok(()) => return Ok("已清空抓取浏览器数据，下次使用会重建".to_string()),
            Err(e) => {
                last = e.to_string();
                std::thread::sleep(Duration::from_millis(200));
            }
        }
    }
    Err(format!(
        "删除抓取 profile 失败（{}）：{last}",
        dir.display()
    ))
}

// ── 非 Windows：抓取浏览器只支持 Windows（与「移动端无 CDP」的既有结论一致） ──────

#[cfg(not(windows))]
pub fn open(_app: &AppHandle) -> Result<u16, String> {
    Err("抓取浏览器仅 Windows 可用".to_string())
}

#[cfg(not(windows))]
pub fn set_mode(_app: &AppHandle, _mode: &str) -> Result<(), String> {
    Err("抓取浏览器仅 Windows 可用".to_string())
}

#[cfg(not(windows))]
pub fn close(_app: &AppHandle) -> Result<(), String> {
    Ok(())
}

#[cfg(not(windows))]
pub fn tidy_windows(_app: &AppHandle) -> Result<(), String> {
    Ok(())
}

#[cfg(not(windows))]
pub fn reset(_app: &AppHandle) -> Result<String, String> {
    Err("抓取浏览器仅 Windows 可用".to_string())
}
