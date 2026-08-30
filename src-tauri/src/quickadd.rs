use std::sync::Mutex;

use tauri::{
    AppHandle, Emitter, LogicalSize, Manager, PhysicalPosition, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder,
};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

pub const LABEL: &str = "quickadd";

/// 기본 전역 단축키. 설정에서 바꿀 수 있다.
///
/// 한국어 Windows 에서 `Ctrl+Shift+Space` 는 IME 가 선점하는 경우가 많아
/// 기본값으로 쓰지 않는다.
pub const DEFAULT_SHORTCUT: &str = "CommandOrControl+Alt+Space";

/// 원하는 조합이 이미 잡혀 있을 때 차례로 시도할 대안.
const FALLBACKS: [&str; 4] = [
    "CommandOrControl+Alt+Space",
    "CommandOrControl+Alt+N",
    "CommandOrControl+Shift+N",
    "Alt+Shift+D",
];

/// 실제로 등록에 성공한 조합. 설정 화면이 사실대로 보여주려면 필요하다.
static ACTIVE: Mutex<String> = Mutex::new(String::new());

pub fn active() -> String {
    ACTIVE.lock().map(|g| g.clone()).unwrap_or_default()
}

const WIDTH: f64 = 520.0;
const INITIAL_HEIGHT: f64 = 96.0;

fn build(app: &AppHandle) -> Result<WebviewWindow, String> {
    if let Some(win) = app.get_webview_window(LABEL) {
        return Ok(win);
    }

    let win = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("quickadd.html".into()))
        .title("빠른 입력")
        .inner_size(WIDTH, INITIAL_HEIGHT)
        .decorations(false)
        .transparent(true)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        // 여기는 반대로 포커스를 받아야 한다. 바로 타이핑하는 것이 목적이다.
        .focused(true)
        .visible(false)
        .build()
        .map_err(|e| format!("빠른 입력 창 생성 실패: {e}"))?;

    Ok(win)
}

/// 화면 상단 1/4 지점 가운데. Spotlight 류가 쓰는 위치다.
fn position_center_top(win: &WebviewWindow) -> Result<(), String> {
    let monitor = match win.current_monitor() {
        Ok(Some(m)) => Some(m),
        _ => win.primary_monitor().ok().flatten(),
    };
    let Some(monitor) = monitor else {
        return Ok(());
    };

    let m_size = monitor.size();
    let m_pos = monitor.position();
    let win_size = win
        .outer_size()
        .map_err(|e| format!("창 크기 조회 실패: {e}"))?;

    let x = m_pos.x + (m_size.width as i32 - win_size.width as i32) / 2;
    let y = m_pos.y + m_size.height as i32 / 5;

    win.set_position(PhysicalPosition::new(x, y))
        .map_err(|e| format!("빠른 입력 위치 설정 실패: {e}"))
}

pub fn show(app: &AppHandle) -> Result<(), String> {
    let win = build(app)?;
    position_center_top(&win)?;
    win.show()
        .map_err(|e| format!("빠른 입력 표시 실패: {e}"))?;
    let _ = win.set_always_on_top(true);
    let _ = win.set_focus();
    // 이미 열려 있던 경우를 위해 입력칸을 비우라고 알린다.
    let _ = win.emit("quickadd://reset", ());
    Ok(())
}

pub fn hide(app: &AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window(LABEL) {
        win.hide()
            .map_err(|e| format!("빠른 입력 숨기기 실패: {e}"))?;
    }
    Ok(())
}

pub fn toggle(app: &AppHandle) -> Result<(), String> {
    let open = app
        .get_webview_window(LABEL)
        .and_then(|w| w.is_visible().ok())
        .unwrap_or(false);
    if open {
        hide(app)
    } else {
        show(app)
    }
}

fn try_register(app: &AppHandle, accelerator: &str) -> Result<(), String> {
    let shortcut: Shortcut = accelerator
        .parse()
        .map_err(|_| format!("단축키 형식을 알 수 없습니다: {accelerator}"))?;

    app.global_shortcut()
        .on_shortcut(shortcut, move |app, _sc, event| {
            // 누를 때 한 번만 반응한다. 뗄 때까지 처리하면 두 번 열린다.
            if event.state() == ShortcutState::Pressed {
                let _ = toggle(app);
            }
        })
        .map_err(|e| format!("{e}"))
}

/// 전역 단축키를 등록한다. 이미 등록된 것은 먼저 해제한다.
///
/// 다른 프로그램이 선점한 조합은 등록에 실패한다(한국어 IME 가 대표적이다).
/// 그럴 때 조용히 포기하면 사용자는 단축키가 왜 안 먹는지 알 수 없으므로,
/// 대안을 차례로 시도하고 **실제로 걸린 조합**을 돌려준다.
pub fn register(app: &AppHandle, accelerator: &str) -> Result<String, String> {
    let gs = app.global_shortcut();
    let _ = gs.unregister_all();

    if let Ok(mut a) = ACTIVE.lock() {
        a.clear();
    }

    if accelerator.trim().is_empty() {
        return Ok(String::new());
    }

    let mut tried: Vec<String> = Vec::new();
    let candidates = std::iter::once(accelerator).chain(FALLBACKS.iter().copied());

    for cand in candidates {
        if tried.iter().any(|t| t == cand) {
            continue;
        }
        tried.push(cand.to_string());

        match try_register(app, cand) {
            Ok(()) => {
                if let Ok(mut a) = ACTIVE.lock() {
                    *a = cand.to_string();
                }
                if cand != accelerator {
                    eprintln!("[quickadd] {accelerator} 사용 불가 → {cand} 로 대체");
                }
                return Ok(cand.to_string());
            }
            Err(e) => eprintln!("[quickadd] {cand} 등록 실패: {e}"),
        }
    }

    Err("사용할 수 있는 단축키 조합을 찾지 못했습니다. 설정에서 직접 골라주세요.".into())
}

// ---------------------------------------------------------------------------
// 커맨드
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn hide_quickadd(app: AppHandle) -> Result<(), String> {
    hide(&app)
}

#[tauri::command]
pub fn resize_quickadd(app: AppHandle, height: f64) -> Result<(), String> {
    let Some(win) = app.get_webview_window(LABEL) else {
        return Ok(());
    };
    win.set_size(LogicalSize::new(WIDTH, height.clamp(60.0, 500.0)))
        .map_err(|e| format!("빠른 입력 크기 조절 실패: {e}"))?;
    position_center_top(&win)
}

/// 설정 화면에서 단축키를 바꿀 때 호출한다. 실제로 걸린 조합을 돌려준다.
#[tauri::command]
pub fn set_shortcut(app: AppHandle, accelerator: String) -> Result<String, String> {
    register(&app, &accelerator)
}

/// 지금 실제로 동작 중인 단축키.
#[tauri::command]
pub fn active_shortcut() -> String {
    active()
}
