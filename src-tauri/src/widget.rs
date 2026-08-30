use tauri::{
    AppHandle, LogicalSize, Manager, PhysicalPosition, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder,
};

pub const LABEL: &str = "widget";

/// 위젯 기본 크기(논리 px). 높이는 내용에 맞춰 프론트가 다시 알려준다.
const WIDTH: f64 = 300.0;
const INITIAL_HEIGHT: f64 = 220.0;
/// 화면 우측·상단 여백
const MARGIN_X: f64 = 16.0;
const MARGIN_Y: f64 = 16.0;

fn build(app: &AppHandle) -> Result<WebviewWindow, String> {
    if let Some(win) = app.get_webview_window(LABEL) {
        return Ok(win);
    }

    let win = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("widget.html".into()))
        .title("Dayflow 요약")
        .inner_size(WIDTH, INITIAL_HEIGHT)
        .decorations(false)
        .transparent(true)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        // 작업 중인 창을 가리지 않도록 포커스를 뺏지 않는다.
        .focused(false)
        .visible(false)
        .build()
        .map_err(|e| format!("위젯 창 생성 실패: {e}"))?;

    Ok(win)
}

/// 화면 우측 상단에 붙인다.
///
/// 알림 창과 달리 위쪽 모서리를 기준으로 하므로, 알림이 아래에서 올라와도
/// 서로 겹치지 않는다.
pub fn position_top_right(win: &WebviewWindow) -> Result<(), String> {
    let monitor = match win.current_monitor() {
        Ok(Some(m)) => Some(m),
        _ => win.primary_monitor().ok().flatten(),
    };

    let Some(monitor) = monitor else {
        return Ok(());
    };

    let scale = monitor.scale_factor();
    let m_size = monitor.size();
    let m_pos = monitor.position();

    let win_size = win
        .outer_size()
        .map_err(|e| format!("창 크기 조회 실패: {e}"))?;

    let x =
        m_pos.x + m_size.width as i32 - win_size.width as i32 - (MARGIN_X * scale).round() as i32;
    let y = m_pos.y + (MARGIN_Y * scale).round() as i32;

    win.set_position(PhysicalPosition::new(x, y))
        .map_err(|e| format!("위젯 위치 설정 실패: {e}"))
}

pub fn show(app: &AppHandle) -> Result<(), String> {
    let win = build(app)?;
    position_top_right(&win)?;
    win.show().map_err(|e| format!("위젯 표시 실패: {e}"))?;
    let _ = win.set_always_on_top(true);
    Ok(())
}

pub fn hide(app: &AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window(LABEL) {
        win.hide().map_err(|e| format!("위젯 숨기기 실패: {e}"))?;
    }
    Ok(())
}

pub fn is_open(app: &AppHandle) -> bool {
    app.get_webview_window(LABEL)
        .and_then(|w| w.is_visible().ok())
        .unwrap_or(false)
}

/// 트레이 메뉴에서 켜고 끈다.
pub fn toggle(app: &AppHandle) -> Result<(), String> {
    if is_open(app) {
        hide(app)
    } else {
        show(app)
    }
}

/// 내용 높이에 맞춰 창을 줄이고 다시 우측 상단에 붙인다.
#[tauri::command]
pub fn resize_widget(app: AppHandle, height: f64) -> Result<(), String> {
    let Some(win) = app.get_webview_window(LABEL) else {
        return Ok(());
    };
    win.set_size(LogicalSize::new(WIDTH, height.clamp(80.0, 900.0)))
        .map_err(|e| format!("위젯 크기 조절 실패: {e}"))?;
    position_top_right(&win)
}

#[tauri::command]
pub fn set_widget_visible(app: AppHandle, visible: bool) -> Result<(), String> {
    if visible {
        show(&app)
    } else {
        hide(&app)
    }
}

#[tauri::command]
pub fn widget_visible(app: AppHandle) -> bool {
    is_open(&app)
}

/// 위젯에서 메인 창을 여는 버튼.
#[tauri::command]
pub fn open_main(app: AppHandle) {
    crate::tray::focus_main(&app);
}
