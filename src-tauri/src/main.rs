// 始终隐藏控制台窗口。
//
// 之前的写法是 `not(debug_assertions)`，导致 debug 构建的 exe 启动时会弹出黑色 cmd 窗口。
// 由于日常运行的是 debug 构建（`tauri build --debug`），这里改为无条件隐藏。
//
// 需要查看日志时：用 `npx tauri dev` 启动（日志走 DevTools 控制台），
// 或设置环境变量 PERYX_CONSOLE=1 后运行 exe（会重新申请一个控制台）。
#![windows_subsystem = "windows"]

fn main() {
    #[cfg(windows)]
    attach_console_if_requested();

    peryx_lib::run()
}

/// 若设置了 `PERYX_CONSOLE=1`，则附加/申请一个控制台用于输出日志。
#[cfg(windows)]
fn attach_console_if_requested() {
    if std::env::var("PERYX_CONSOLE").is_err() {
        return;
    }
    extern "system" {
        fn AttachConsole(dw_process_id: u32) -> i32;
        fn AllocConsole() -> i32;
    }
    const ATTACH_PARENT_PROCESS: u32 = 0xFFFF_FFFF;
    unsafe {
        // 优先附加到启动它的终端；没有则新建一个
        if AttachConsole(ATTACH_PARENT_PROCESS) == 0 {
            AllocConsole();
        }
    }
}
