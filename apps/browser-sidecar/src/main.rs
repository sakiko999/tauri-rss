//! amoeba-browser — 无 Tauri 依赖的屏外 WebView2 宿主，供 CLI 通过 CDP 驱动。
//!
//! 协议（与 `packages/host/src/node/browser-sidecar.ts` 对齐）：
//!   stdout: 只输出一行 `READY <port>\n`（日志一律 stderr）
//!   stdin : 行命令 `tidy` / `mode hidden|interactive` / `touch` / `close`
//!           EOF = 关闭；`--parent-pid` 监视父进程；Ctrl+C/BREAK/CLOSE 也关闭。
//!
//! 线程模型：
//!   - 主线程 = STA（CoInitializeEx + 窗口 + WebView2 + GetMessage 循环）；
//!   - stdin / parent / Ctrl+C 都是外部线程，只做原子标记 + PostMessageW，不碰 COM。
//!
//! 窗口语义（与桌面 `webview_browser.rs` 对齐）：
//!   - 宿主窗口 WS_POPUP + WS_EX_TOOLWINDOW，屏外 (-32000,-32000)，SW_SHOWNA 不激活；
//!   - 页面必须 visible 才会跑 rAF/IntersectionObserver/scroll，所以默认 interactive；
//!   - `Target.createTarget` 在 WebView2 下是独立顶层窗口，由 500ms 周期 tidy 去任务栏
//!     并按当前模式隐藏/屏外显示。
//!
//! 退出顺序（重要，见 App::drop）：
//!   controller.Close → drop ICoreWebView2/Environment → DestroyWindow
//!   → 等浏览器进程退出（flush cookie）→ 关 Job（兜底杀残留）→ CoUninitialize。

#[cfg(not(windows))]
fn main() {
    eprintln!("amoeba-browser 仅支持 Windows（WebView2）");
    std::process::exit(2);
}

#[cfg(windows)]
fn main() -> std::process::ExitCode {
    windows_impl::main()
}

#[cfg(windows)]
mod windows_impl {
    use std::ffi::{c_void, OsStr, OsString};
    use std::io::{BufRead, Write};
    use std::net::{SocketAddr, TcpListener, TcpStream};
    use std::os::windows::ffi::OsStrExt;
    use std::path::{Path, PathBuf};
    use std::sync::atomic::{AtomicBool, AtomicIsize, Ordering};
    use std::sync::Mutex;
    use std::time::{Duration, Instant};

    use webview2_com::Microsoft::Web::WebView2::Win32::*;
    use webview2_com::{
        CoreWebView2EnvironmentOptions, CreateCoreWebView2ControllerCompletedHandler,
        CreateCoreWebView2EnvironmentCompletedHandler,
    };
    use windows::core::{w, BOOL, PCWSTR};
    use windows::Win32::Foundation::{
        CloseHandle, E_POINTER, HANDLE, HINSTANCE, HWND, LPARAM, LRESULT, RECT, WAIT_ABANDONED,
        WAIT_OBJECT_0, WPARAM,
    };
    use windows::Win32::System::Com::{CoInitializeEx, CoUninitialize, COINIT_APARTMENTTHREADED};
    use windows::Win32::System::Console::{
        SetConsoleCtrlHandler, CTRL_BREAK_EVENT, CTRL_CLOSE_EVENT, CTRL_C_EVENT, CTRL_LOGOFF_EVENT,
        CTRL_SHUTDOWN_EVENT,
    };
    use windows::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
        SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };
    use windows::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows::Win32::System::Threading::{
        CreateMutexW, OpenProcess, WaitForSingleObject, INFINITE, PROCESS_SET_QUOTA,
        PROCESS_SYNCHRONIZE, PROCESS_TERMINATE,
    };
    use windows::Win32::UI::HiDpi::{
        SetProcessDpiAwarenessContext, DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        CreateWindowExW, DefWindowProcW, DestroyWindow, DispatchMessageW, EnumWindows,
        GetClassNameW, GetClientRect, GetForegroundWindow, GetMessageW, GetWindowLongPtrW,
        GetWindowThreadProcessId, IsWindowVisible, KillTimer, PostMessageW, PostQuitMessage,
        RegisterClassW, SetForegroundWindow, SetTimer, SetWindowLongPtrW, SetWindowPos, ShowWindow,
        TranslateMessage, GWLP_USERDATA, GWL_EXSTYLE, MSG, SWP_FRAMECHANGED, SWP_NOACTIVATE,
        SWP_NOSIZE, SWP_NOZORDER, SW_HIDE, SW_SHOWNA, WM_APP, WM_CLOSE, WM_DESTROY, WM_SIZE,
        WM_TIMER, WNDCLASSW, WS_EX_APPWINDOW, WS_EX_TOOLWINDOW, WS_POPUP,
    };

    const TIMER_ID: usize = 1;
    const WM_APP_COMMAND: u32 = WM_APP; // 有新 stdin 命令
    const WM_APP_SHUTDOWN: u32 = WM_APP + 1; // 请求优雅关闭

    static MAIN_HWND: AtomicIsize = AtomicIsize::new(0);
    static SHUTDOWN: AtomicBool = AtomicBool::new(false);
    static LOOP_RUNNING: AtomicBool = AtomicBool::new(false);
    static CTRL_SEEN: AtomicBool = AtomicBool::new(false);
    static COMMANDS: Mutex<Vec<Command>> = Mutex::new(Vec::new());

    #[derive(Clone, Copy)]
    enum Command {
        Tidy,
        Touch,
        Mode(bool), // true = interactive(屏外 shown)，false = hidden
    }

    struct ComGuard;
    impl Drop for ComGuard {
        fn drop(&mut self) {
            unsafe { CoUninitialize() };
        }
    }

    #[derive(Default)]
    struct Args {
        user_data_dir: PathBuf,
        port: Option<u16>,
        port_file: Option<PathBuf>,
        idle_ms: Option<u64>,
        parent_pid: Option<u32>,
        images: bool,
    }

    struct App {
        hwnd: HWND,
        port: u16,
        controller: Option<ICoreWebView2Controller>,
        webview: Option<ICoreWebView2>,
        environment: Option<ICoreWebView2Environment>,
        browser_pid: u32,
        interactive: bool, // 默认 true：hidden 下 rAF/IO/scroll 停摆
        idle_ms: Option<u64>,
        last_activity: Instant,
        window_alive: bool,
        shutting_down: bool,
    }

    struct TidyCtx {
        pid: u32,
        interactive: bool,
    }

    fn err(msg: impl Into<String>) -> Box<dyn std::error::Error> {
        std::io::Error::new(std::io::ErrorKind::Other, msg.into()).into()
    }

    fn wide(s: &OsStr) -> Vec<u16> {
        s.encode_wide().chain(std::iter::once(0)).collect()
    }

    fn wide_str(s: &str) -> Vec<u16> {
        wide(OsStr::new(s))
    }

    fn default_profile_dir() -> Result<PathBuf, String> {
        let base = std::env::var_os("LOCALAPPDATA")
            .ok_or_else(|| "LOCALAPPDATA 未设置，无法定位默认 profile".to_string())?;
        // 与 desktop 的 `app.amoeba.desktop/webview-profile` 严格分开：
        // 两个 WebView2 environment 共用同一 profile 会共享浏览器进程，CDP 端口互相覆盖。
        Ok(PathBuf::from(base)
            .join("app.amoeba.cli")
            .join("browser-profile"))
    }

    fn usage() -> &'static str {
        "amoeba-browser — hidden WebView2 host for CDP\n\
         \n\
         usage: amoeba-browser [options]\n\
           --user-data-dir <path>   default %LOCALAPPDATA%\\app.amoeba.cli\\browser-profile\n\
           --port <n>               fixed CDP port (default: pick free 127.0.0.1 port)\n\
           --port-file <path>       also write `READY <port>` atomically\n\
           --idle-ms <ms>           exit after N ms without stdin commands (0 = off)\n\
           --parent-pid <pid>       exit when this process exits\n\
           --no-images              add --blink-settings=imagesEnabled=false\n\
         \n\
         stdout: one line `READY <port>` (nothing else)\n\
         stdin : tidy | mode hidden|interactive | touch | close   (EOF = exit)\n"
    }

    fn next_arg(it: &mut impl Iterator<Item = OsString>, flag: &str) -> Result<OsString, String> {
        it.next().ok_or_else(|| format!("{flag} 缺少参数"))
    }

    fn parse_num<T: std::str::FromStr>(flag: &str, v: OsString) -> Result<T, String> {
        let text = v.to_string_lossy().into_owned();
        text.parse::<T>()
            .map_err(|_| format!("{flag} 参数无效: {text}"))
    }

    /// Ok(None) = --help；错误只在参数层，不碰 COM。
    fn parse_args() -> Result<Option<Args>, String> {
        let mut out = Args {
            user_data_dir: default_profile_dir()?,
            images: true,
            ..Default::default()
        };
        let mut it = std::env::args_os().skip(1);
        while let Some(arg) = it.next() {
            match arg.to_string_lossy().as_ref() {
                "--user-data-dir" => {
                    out.user_data_dir = PathBuf::from(next_arg(&mut it, "--user-data-dir")?)
                }
                "--port" => out.port = Some(parse_num("--port", next_arg(&mut it, "--port")?)?),
                "--port-file" => {
                    out.port_file = Some(PathBuf::from(next_arg(&mut it, "--port-file")?))
                }
                "--idle-ms" => {
                    let v: u64 = parse_num("--idle-ms", next_arg(&mut it, "--idle-ms")?)?;
                    out.idle_ms = if v == 0 { None } else { Some(v) };
                }
                "--parent-pid" => {
                    out.parent_pid = Some(parse_num(
                        "--parent-pid",
                        next_arg(&mut it, "--parent-pid")?,
                    )?)
                }
                "--no-images" => out.images = false,
                "--help" | "-h" => {
                    eprintln!("{}", usage());
                    return Ok(None);
                }
                other => return Err(format!("未知参数: {other}\n{}", usage())),
            }
        }
        Ok(Some(out))
    }

    /// FNV-1a：命名 mutex 必须跨版本稳定（`DefaultHasher` 的算法不保证）。
    fn fnv1a(s: &str) -> u64 {
        let mut h: u64 = 0xcbf29ce484222325;
        for b in s.as_bytes() {
            h ^= *b as u64;
            h = h.wrapping_mul(0x100000001b3);
        }
        h
    }

    fn acquire_profile_lock(dir: &Path) -> Result<HANDLE, Box<dyn std::error::Error>> {
        let canon = std::fs::canonicalize(dir).unwrap_or_else(|_| dir.to_path_buf());
        let name = format!(
            "Local\\amoeba-cli-browser-{:016x}",
            fnv1a(&canon.to_string_lossy().to_lowercase())
        );
        let name_w = wide_str(&name);

        let handle = unsafe { CreateMutexW(None, false, PCWSTR(name_w.as_ptr()))? };
        let wait = unsafe { WaitForSingleObject(handle, 0) };
        if wait == WAIT_OBJECT_0 || wait == WAIT_ABANDONED {
            Ok(handle)
        } else {
            unsafe {
                let _ = CloseHandle(handle);
            };
            Err(err(format!(
                "profile 已被另一个 sidecar 占用: {}（先结束旧进程，或用 --user-data-dir 换目录）",
                canon.display()
            )))
        }
    }

    fn create_kill_on_close_job() -> Option<HANDLE> {
        unsafe {
            let job = CreateJobObjectW(None, PCWSTR::null()).ok()?;
            let mut info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
            info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            SetInformationJobObject(
                job,
                JobObjectExtendedLimitInformation,
                &info as *const _ as *const c_void,
                std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            )
            .ok()?;
            Some(job)
        }
    }

    /// 只把 msedgewebview2.exe 放进 Job；不要把 sidecar 自己放进去，
    /// 否则关 Job 时会把 sidecar 一起 Terminate，拿不到正常退出码/来不及 flush cookie。
    fn put_browser_in_job(job: HANDLE, pid: u32) {
        unsafe {
            let Ok(h) = OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, false, pid) else {
                eprintln!("[sidecar] OpenProcess({pid}) 失败，子进程兜底不可用");
                return;
            };
            if let Err(e) = AssignProcessToJobObject(job, h) {
                eprintln!("[sidecar] AssignProcessToJobObject({pid}) 失败: {e}");
            }
            let _ = CloseHandle(h);
        }
    }

    fn pick_free_port() -> std::io::Result<u16> {
        let l = TcpListener::bind(("127.0.0.1", 0))?;
        let p = l.local_addr()?.port();
        drop(l); // 有极小的 TOCTOU 窗口；READY 之后 CLI 还会 GET /json/version 校验
        Ok(p)
    }

    fn browser_args(port: u16, images: bool) -> String {
        let mut args = vec![
            format!("--remote-debugging-port={port}"),
            "--no-first-run".to_string(),
            "--no-default-browser-check".to_string(),
            "--hide-crash-restore-bubble".to_string(),
            "--disable-sync".to_string(),
            "--disable-extensions".to_string(),
            "--disable-default-apps".to_string(),
            "--disable-background-timer-throttling".to_string(),
            "--disable-renderer-backgrounding".to_string(),
            "--disable-backgrounding-occluded-windows".to_string(),
            // 屏外 shown 会被原生遮挡计算判 hidden；这两个开关任一即可恢复 visible。
            "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection,CalculateNativeWinOcclusion,Translate,BackForwardCache,OptimizationHints,MediaRouter".to_string(),
            "--disable-background-networking".to_string(),
            "--disable-component-update".to_string(),
            "--no-pings".to_string(),
            "--disable-breakpad".to_string(),
            "--metrics-recording-only".to_string(),
            "--disable-gpu-compositing".to_string(),
            "--js-flags=--max-old-space-size=512".to_string(),
            "--disk-cache-size=67108864".to_string(),
            "--window-position=-32000,-32000".to_string(),
        ];
        // ⚠️ 默认不关图片：xhs 必须登录，扫码二维码是图片；需要省内存时用 --no-images。
        if !images {
            args.push("--blink-settings=imagesEnabled=false".to_string());
        }
        args.join(" ")
    }

    fn create_environment(
        user_data: &Path,
        port: u16,
        images: bool,
    ) -> Result<ICoreWebView2Environment, Box<dyn std::error::Error>> {
        let data_w = wide(user_data.as_os_str());
        let options = CoreWebView2EnvironmentOptions::default();
        unsafe {
            options.set_additional_browser_arguments(browser_args(port, images));
        }
        let options: ICoreWebView2EnvironmentOptions = options.into();

        let (tx, rx) = std::sync::mpsc::channel();
        CreateCoreWebView2EnvironmentCompletedHandler::wait_for_async_operation(
            Box::new(move |handler| unsafe {
                CreateCoreWebView2EnvironmentWithOptions(
                    PCWSTR::null(),
                    PCWSTR(data_w.as_ptr()),
                    &options,
                    &handler,
                )
                .map_err(webview2_com::Error::WindowsError)
            }),
            Box::new(move |error_code, environment| {
                error_code?;
                let env = environment.ok_or_else(|| windows::core::Error::from(E_POINTER))?;
                let _ = tx.send(env); // 接收方提前退出时不 panic 穿回 COM 回调
                Ok(())
            }),
        )?;
        Ok(rx.recv()?)
    }

    fn create_controller(
        env: &ICoreWebView2Environment,
        hwnd: HWND,
    ) -> Result<ICoreWebView2Controller, Box<dyn std::error::Error>> {
        let env = (*env).clone();
        let (tx, rx) = std::sync::mpsc::channel();
        CreateCoreWebView2ControllerCompletedHandler::wait_for_async_operation(
            Box::new(move |handler| unsafe {
                env.CreateCoreWebView2Controller(hwnd, &handler)
                    .map_err(webview2_com::Error::WindowsError)
            }),
            Box::new(move |error_code, controller| {
                error_code?;
                let c = controller.ok_or_else(|| windows::core::Error::from(E_POINTER))?;
                let _ = tx.send(c);
                Ok(())
            }),
        )?;
        Ok(rx.recv()?)
    }

    fn cdp_connect(port: u16) -> bool {
        TcpStream::connect_timeout(
            &SocketAddr::from(([127, 0, 0, 1], port)),
            Duration::from_millis(250),
        )
        .is_ok()
    }

    fn wait_cdp(port: u16, timeout: Duration) -> bool {
        let deadline = Instant::now() + timeout;
        while Instant::now() < deadline {
            if cdp_connect(port) {
                return true;
            }
            if SHUTDOWN.load(Ordering::SeqCst) {
                return false;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        false
    }

    fn wait_port_closed(port: u16, timeout: Duration) {
        let deadline = Instant::now() + timeout;
        while Instant::now() < deadline {
            if !cdp_connect(port) {
                return;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
    }

    fn open_process_for_wait(pid: u32) -> Option<HANDLE> {
        if pid == 0 {
            return None;
        }
        unsafe { OpenProcess(PROCESS_SYNCHRONIZE, false, pid).ok() }
    }

    fn wake_window(msg: u32) {
        let h = MAIN_HWND.load(Ordering::Relaxed);
        if h != 0 {
            unsafe {
                let _ = PostMessageW(Some(HWND(h as *mut c_void)), msg, WPARAM(0), LPARAM(0));
            }
        }
    }

    fn request_shutdown() {
        SHUTDOWN.store(true, Ordering::SeqCst);
        // 启动阶段不投递关闭消息：wait_with_pump 正等 WebView2 回调，
        // 提前 DestroyWindow 会让回调的 mpsc sender 失去 receiver。
        if LOOP_RUNNING.load(Ordering::SeqCst) {
            wake_window(WM_APP_SHUTDOWN);
        }
    }

    fn post_command(cmd: Command) {
        COMMANDS.lock().unwrap_or_else(|e| e.into_inner()).push(cmd);
        wake_window(WM_APP_COMMAND);
    }

    unsafe extern "system" fn ctrl_handler(ctrl_type: u32) -> BOOL {
        match ctrl_type {
            CTRL_C_EVENT | CTRL_BREAK_EVENT => {
                // 第二次 Ctrl+C 交回系统默认处理，避免清理卡住时无法强杀。
                if CTRL_SEEN.swap(true, Ordering::SeqCst) {
                    return BOOL(0);
                }
                request_shutdown();
                BOOL(1)
            }
            CTRL_CLOSE_EVENT | CTRL_LOGOFF_EVENT | CTRL_SHUTDOWN_EVENT => {
                request_shutdown();
                BOOL(1)
            }
            _ => BOOL(0),
        }
    }

    fn spawn_stdin_reader() {
        std::thread::spawn(move || {
            let stdin = std::io::stdin();
            let mut line = String::new();
            loop {
                line.clear();
                match stdin.lock().read_line(&mut line) {
                    Ok(0) => break, // EOF
                    Ok(_) => match line.trim() {
                        "" => {}
                        "tidy" => post_command(Command::Tidy),
                        "touch" => post_command(Command::Touch),
                        "close" | "quit" | "exit" => {
                            request_shutdown();
                            return;
                        }
                        other => {
                            if let Some(mode) = other.strip_prefix("mode ") {
                                match mode.trim() {
                                    "hidden" => post_command(Command::Mode(false)),
                                    "interactive" => post_command(Command::Mode(true)),
                                    m => eprintln!("[sidecar] 未知 mode: {m}"),
                                }
                            } else {
                                eprintln!("[sidecar] 未知命令: {other}");
                            }
                        }
                    },
                    Err(e) => {
                        eprintln!("[sidecar] stdin 读取失败: {e}");
                        break;
                    }
                }
            }
            request_shutdown();
        });
    }

    fn spawn_parent_watch(pid: u32) {
        std::thread::spawn(move || unsafe {
            match OpenProcess(PROCESS_SYNCHRONIZE, false, pid) {
                Ok(h) => {
                    let _ = WaitForSingleObject(h, INFINITE);
                    let _ = CloseHandle(h);
                    eprintln!("[sidecar] parent {pid} exited → shutdown");
                    request_shutdown();
                }
                Err(e) => eprintln!("[sidecar] 无法监视 parent {pid}: {e}"),
            }
        });
    }

    fn show_off_screen(hwnd: HWND) {
        let prev = unsafe { GetForegroundWindow() };
        let _ = unsafe { ShowWindow(hwnd, SW_SHOWNA) };
        // SW_SHOWNA 不激活，但 Chromium 显示窗口时仍可能前台化；best-effort 还原。
        if !prev.is_invalid() {
            unsafe {
                let _ = SetForegroundWindow(prev);
            }
        }
    }

    fn create_window() -> Result<(HWND, HINSTANCE), Box<dyn std::error::Error>> {
        let hmodule = unsafe { GetModuleHandleW(None)? };
        let hinstance = HINSTANCE(hmodule.0);
        let wc = WNDCLASSW {
            lpfnWndProc: Some(wndproc),
            hInstance: hinstance,
            lpszClassName: w!("AmoebaBrowserSidecar"),
            ..Default::default()
        };
        let atom = unsafe { RegisterClassW(&wc) };
        if atom == 0 {
            return Err(err("RegisterClassW 失败"));
        }
        let hwnd = unsafe {
            CreateWindowExW(
                WS_EX_TOOLWINDOW,
                w!("AmoebaBrowserSidecar"),
                w!("AmoebaBrowserSidecar"),
                WS_POPUP,
                -32000,
                -32000,
                1280,
                800,
                None,
                None,
                Some(hinstance),
                None,
            )?
        };
        Ok((hwnd, hinstance))
    }

    unsafe extern "system" fn wndproc(
        hwnd: HWND,
        msg: u32,
        wparam: WPARAM,
        lparam: LPARAM,
    ) -> LRESULT {
        let ptr = unsafe { GetWindowLongPtrW(hwnd, GWLP_USERDATA) } as *mut App;
        if ptr.is_null() {
            return unsafe { DefWindowProcW(hwnd, msg, wparam, lparam) };
        }
        let app = unsafe { &mut *ptr };
        match msg {
            WM_SIZE => {
                app.resize();
                LRESULT(0)
            }
            WM_TIMER => {
                app.on_timer();
                LRESULT(0)
            }
            WM_APP_COMMAND => {
                app.drain_commands();
                LRESULT(0)
            }
            WM_APP_SHUTDOWN | WM_CLOSE => {
                app.begin_shutdown();
                LRESULT(0)
            }
            WM_DESTROY => {
                unsafe { PostQuitMessage(0) };
                LRESULT(0)
            }
            _ => unsafe { DefWindowProcW(hwnd, msg, wparam, lparam) },
        }
    }

    unsafe extern "system" fn tidy_cb(hwnd: HWND, lparam: LPARAM) -> BOOL {
        let ctx = unsafe { &mut *(lparam.0 as *mut TidyCtx) };
        let mut pid = 0u32;
        unsafe { GetWindowThreadProcessId(hwnd, Some(&mut pid as *mut u32)) };
        if pid != ctx.pid {
            return BOOL(1);
        }
        let mut class = [0u16; 64];
        let n = unsafe { GetClassNameW(hwnd, &mut class) };
        if n <= 0 {
            return BOOL(1);
        }
        if String::from_utf16_lossy(&class[..n as usize]) != "Chrome_WidgetWin_1" {
            return BOOL(1);
        }

        unsafe {
            let ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE) as u32;
            let next = (ex & !WS_EX_APPWINDOW.0) | WS_EX_TOOLWINDOW.0;
            let style_changed = next != ex;
            if style_changed {
                SetWindowLongPtrW(hwnd, GWL_EXSTYLE, next as isize);
            }
            let visible = IsWindowVisible(hwnd).as_bool();

            if ctx.interactive {
                if !visible || style_changed {
                    let _ = SetWindowPos(
                        hwnd,
                        None,
                        -32000,
                        -32000,
                        0,
                        0,
                        SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED,
                    );
                }
                if !visible {
                    let _ = ShowWindow(hwnd, SW_SHOWNA);
                }
            } else if visible {
                let _ = ShowWindow(hwnd, SW_HIDE);
            }
        }
        BOOL(1)
    }

    impl App {
        fn new(hwnd: HWND, port: u16, idle_ms: Option<u64>) -> Self {
            Self {
                hwnd,
                port,
                controller: None,
                webview: None,
                environment: None,
                browser_pid: 0,
                interactive: true, // 默认屏外可见：hidden 下 rAF/IO/scroll 停摆
                idle_ms,
                last_activity: Instant::now(),
                window_alive: true,
                shutting_down: false,
            }
        }

        fn attach(
            &mut self,
            env: ICoreWebView2Environment,
            controller: ICoreWebView2Controller,
            webview: ICoreWebView2,
        ) {
            let mut pid = 0u32;
            unsafe {
                let _ = webview.BrowserProcessId(&mut pid);
            }
            self.browser_pid = pid;
            self.environment = Some(env);
            self.controller = Some(controller);
            self.webview = Some(webview);

            self.resize();
            unsafe {
                if let Some(c) = &self.controller {
                    let _ = c.SetIsVisible(true);
                }
                if let Some(w) = &self.webview {
                    let url = wide_str("about:blank");
                    if let Err(e) = w.Navigate(PCWSTR(url.as_ptr())) {
                        eprintln!("[sidecar] Navigate(about:blank) 失败: {e}");
                    }
                }
            }
        }

        fn resize(&mut self) {
            let Some(c) = &self.controller else { return };
            let mut rc = RECT::default();
            unsafe {
                if GetClientRect(self.hwnd, &mut rc as *mut RECT).is_ok() {
                    let _ = c.SetBounds(rc);
                }
            }
        }

        fn on_timer(&mut self) {
            if let Some(ms) = self.idle_ms {
                if self.last_activity.elapsed() >= Duration::from_millis(ms) {
                    eprintln!("[sidecar] idle timeout ({ms} ms) → shutdown");
                    request_shutdown();
                    return;
                }
            }
            self.tidy();
        }

        fn tidy(&mut self) {
            let Some(wv) = &self.webview else { return };
            let mut pid = 0u32;
            if unsafe { wv.BrowserProcessId(&mut pid) }.is_err() || pid == 0 {
                return;
            }
            let mut ctx = TidyCtx {
                pid,
                interactive: self.interactive,
            };
            unsafe {
                let _ = EnumWindows(Some(tidy_cb), LPARAM(&mut ctx as *mut TidyCtx as isize));
            }
        }

        fn drain_commands(&mut self) {
            let cmds = {
                let mut q = COMMANDS.lock().unwrap_or_else(|e| e.into_inner());
                std::mem::take(&mut *q)
            };
            for cmd in cmds {
                self.last_activity = Instant::now();
                match cmd {
                    Command::Tidy => self.tidy(),
                    Command::Touch => {}
                    Command::Mode(v) => {
                        self.interactive = v;
                        self.tidy();
                    }
                }
            }
        }

        fn close_controller(&mut self) {
            if let Some(c) = self.controller.take() {
                unsafe {
                    let _ = c.SetIsVisible(false);
                    let _ = c.Close();
                }
            }
        }

        fn begin_shutdown(&mut self) {
            if self.shutting_down {
                return;
            }
            // 启动阶段（wait_with_pump 正在等 WebView2 回调）不销毁窗口；
            // 只置位，drive() 在每个 await 后检查 SHUTDOWN。
            if !LOOP_RUNNING.load(Ordering::SeqCst) {
                SHUTDOWN.store(true, Ordering::SeqCst);
                return;
            }
            self.shutting_down = true;
            self.close_controller();
            if self.window_alive {
                self.window_alive = false;
                if unsafe { DestroyWindow(self.hwnd) }.is_err() {
                    unsafe { PostQuitMessage(0) };
                }
            } else {
                unsafe { PostQuitMessage(0) };
            }
        }

        fn run_loop(&mut self) -> Result<(), Box<dyn std::error::Error>> {
            // 先置 LOOP_RUNNING 再查 SHUTDOWN，避免 request_shutdown 的竞态：
            // 否则可能「看到 LOOP_RUNNING=false 不投递，主线程随即阻塞在 GetMessage」。
            LOOP_RUNNING.store(true, Ordering::SeqCst);
            if SHUTDOWN.load(Ordering::SeqCst) {
                LOOP_RUNNING.store(false, Ordering::SeqCst);
                return Ok(());
            }

            let mut msg = MSG::default();
            let result: Result<(), Box<dyn std::error::Error>> = loop {
                let ret = unsafe { GetMessageW(&mut msg, None, 0, 0) };
                if ret.0 == -1 {
                    break Err(err("GetMessageW 失败"));
                }
                if ret.0 == 0 {
                    break Ok(()); // WM_QUIT
                }
                unsafe {
                    let _ = TranslateMessage(&msg);
                    DispatchMessageW(&msg);
                }
            };
            LOOP_RUNNING.store(false, Ordering::SeqCst);
            result
        }
    }

    impl Drop for App {
        fn drop(&mut self) {
            unsafe {
                let _ = KillTimer(Some(self.hwnd), TIMER_ID);
            }

            // 在关 controller 之前拿进程句柄：PID 后续可能被系统复用。
            let proc = open_process_for_wait(self.browser_pid);

            self.close_controller();
            self.webview.take();
            self.environment.take();

            if self.window_alive {
                self.window_alive = false;
                unsafe {
                    let _ = DestroyWindow(self.hwnd);
                }
            }

            // 等 WebView2 浏览器进程自己退出，给 profile/cookie 留 flush 时间。
            if let Some(h) = proc {
                unsafe {
                    let _ = WaitForSingleObject(h, 2000);
                    let _ = CloseHandle(h);
                }
            }
            wait_port_closed(self.port, Duration::from_millis(1500));
        }
    }

    fn announce_ready(
        port: u16,
        port_file: Option<&Path>,
    ) -> Result<(), Box<dyn std::error::Error>> {
        let line = format!("READY {port}\n");
        let mut out = std::io::stdout();
        out.write_all(line.as_bytes())?;
        out.flush()?;

        if let Some(path) = port_file {
            if let Some(parent) = path.parent() {
                if !parent.as_os_str().is_empty() {
                    let _ = std::fs::create_dir_all(parent);
                }
            }
            let tmp = path.with_extension("tmp");
            std::fs::write(&tmp, line.as_bytes())?;
            let _ = std::fs::remove_file(path); // Windows rename 不覆盖已存在文件
            std::fs::rename(&tmp, path)?;
        }
        eprintln!(
            "[sidecar] cdp ready: http://127.0.0.1:{port} (pid {})",
            std::process::id()
        );
        Ok(())
    }

    fn run_inner(args: Args) -> Result<(), Box<dyn std::error::Error>> {
        std::fs::create_dir_all(&args.user_data_dir)?;
        let profile_lock = acquire_profile_lock(&args.user_data_dir)?;
        let job = create_kill_on_close_job();
        let port = match args.port {
            Some(p) if p != 0 => p,
            _ => pick_free_port()?,
        };

        let (hwnd, _hinstance) = create_window()?;
        let mut app = Box::new(App::new(hwnd, port, args.idle_ms));
        unsafe {
            SetWindowLongPtrW(hwnd, GWLP_USERDATA, (&mut *app as *mut App) as isize);
        }
        MAIN_HWND.store(hwnd.0 as isize, Ordering::SeqCst);
        show_off_screen(hwnd);

        let result = drive(app.as_mut(), &args, port, job);

        // 先摘 USERDATA，再 drop App（Drop 会 DestroyWindow，WndProc 走 DefWindowProc）。
        unsafe { SetWindowLongPtrW(hwnd, GWLP_USERDATA, 0) };
        drop(app);
        MAIN_HWND.store(0, Ordering::SeqCst);

        if let Some(path) = args.port_file.as_deref() {
            let _ = std::fs::remove_file(path);
        }
        if let Some(job) = job {
            // App 已优雅收尾并等过浏览器进程；这里关 Job 只兜底残留树。
            let _ = unsafe { CloseHandle(job) };
        }
        let _ = unsafe { CloseHandle(profile_lock) };
        result
    }

    fn drive(
        app: &mut App,
        args: &Args,
        port: u16,
        job: Option<HANDLE>,
    ) -> Result<(), Box<dyn std::error::Error>> {
        if let Err(e) = unsafe { SetConsoleCtrlHandler(Some(ctrl_handler), true) } {
            // 无控制台（Bun CREATE_NO_WINDOW/继承句柄）时属正常；stdin EOF/parent-pid 是主路径。
            eprintln!("[sidecar] SetConsoleCtrlHandler 失败（无控制台时正常）: {e}");
        }
        spawn_stdin_reader();
        if let Some(pid) = args.parent_pid {
            spawn_parent_watch(pid);
        }
        wake_window(WM_APP_COMMAND); // 处理启动前已排队的命令/EOF

        let env = match create_environment(&args.user_data_dir, port, args.images) {
            Ok(env) => env,
            Err(_) if SHUTDOWN.load(Ordering::SeqCst) => return Ok(()),
            Err(e) => return Err(e),
        };
        if SHUTDOWN.load(Ordering::SeqCst) {
            return Ok(());
        }

        let controller = match create_controller(&env, app.hwnd) {
            Ok(c) => c,
            Err(_) if SHUTDOWN.load(Ordering::SeqCst) => return Ok(()),
            Err(e) => return Err(e),
        };
        let webview = unsafe { controller.CoreWebView2()? };
        app.attach(env, controller, webview);

        if let Some(job) = job {
            if app.browser_pid != 0 {
                put_browser_in_job(job, app.browser_pid);
            }
        }
        if SHUTDOWN.load(Ordering::SeqCst) {
            return Ok(());
        }

        let _ = unsafe { SetTimer(Some(app.hwnd), TIMER_ID, 500, None) };

        if !wait_cdp(port, Duration::from_secs(10)) {
            if SHUTDOWN.load(Ordering::SeqCst) {
                return Ok(());
            }
            return Err(err(format!(
                "CDP 端口 {port} 在 10s 内未就绪（可能被别的进程抢占，或 WebView2 启动失败）"
            )));
        }
        announce_ready(port, args.port_file.as_deref())?;
        app.run_loop()
    }

    pub fn main() -> std::process::ExitCode {
        let args = match parse_args() {
            Ok(Some(a)) => a,
            Ok(None) => return std::process::ExitCode::SUCCESS, // --help
            Err(e) => {
                eprintln!("[sidecar] 参数错误: {e}");
                return std::process::ExitCode::from(2);
            }
        };

        unsafe {
            if let Err(e) = CoInitializeEx(None, COINIT_APARTMENTTHREADED).ok() {
                eprintln!("[sidecar] CoInitializeEx(STA) 失败: {e}");
                return std::process::ExitCode::from(2);
            }
        }
        let _com = ComGuard; // 所有 COM 引用 drop 之后才 CoUninitialize

        let _ =
            unsafe { SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2) };

        match run_inner(args) {
            Ok(()) => std::process::ExitCode::SUCCESS,
            Err(e) => {
                eprintln!("[sidecar] fatal: {e}");
                std::process::ExitCode::from(1)
            }
        }
    }
}
