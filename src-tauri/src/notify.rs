use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use tauri::{
    AppHandle, Emitter, LogicalSize, Manager, PhysicalPosition, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder,
};

use crate::models::NotificationPayload;

pub const NOTIFY_LABEL: &str = "notification";

/// 알림 창의 논리 크기(px). 높이는 카드 개수에 따라 프론트가 다시 알려준다.
const WIDTH: f64 = 380.0;
const INITIAL_HEIGHT: f64 = 140.0;
/// 화면 우측 여백
const MARGIN_X: f64 = 16.0;
/// 화면 하단 여백. 작업 표시줄을 피하기 위해 넉넉히 잡는다.
const MARGIN_Y: f64 = 56.0;

/// 알림 창 webview가 이벤트를 받을 준비가 됐는지.
///
/// 창을 갓 만든 직후에는 아직 리스너가 붙기 전이라 emit이 유실된다.
/// 준비 전에 발생한 알림은 큐에 쌓아두고 프론트가 `drain_notifications`로 가져간다.
static READY: AtomicBool = AtomicBool::new(false);

/// 아직 전달되지 않은 알림 큐.
#[derive(Default)]
pub struct NotifyQueue(pub Mutex<Vec<NotificationPayload>>);

/// 알림 창을 만들거나 이미 있으면 그대로 돌려준다.
fn ensure_window(app: &AppHandle) -> Result<WebviewWindow, String> {
    if let Some(win) = app.get_webview_window(NOTIFY_LABEL) {
        return Ok(win);
    }

    let win = WebviewWindowBuilder::new(
        app,
        NOTIFY_LABEL,
        WebviewUrl::App("notification.html".into()),
    )
    .title("알림")
    .inner_size(WIDTH, INITIAL_HEIGHT)
    .decorations(false)
    .transparent(true)
    .always_on_top(true)
    .skip_taskbar(true)
    .resizable(false)
    // 포커스를 뺏으면 작업 중인 창이 가려지므로 알림은 포커스를 받지 않는다.
    .focused(false)
    .visible(false)
    .build()
    .map_err(|e| format!("알림 창 생성 실패: {e}"))?;

    // 창이 사라지면 리스너도 함께 사라진다. 준비 상태를 되돌려 두지 않으면
    // 이후 알림이 아무도 듣지 않는 곳으로 emit 된다.
    win.on_window_event(|event| {
        if matches!(event, tauri::WindowEvent::Destroyed) {
            mark_ready(false);
        }
    });

    Ok(win)
}

/// 알림 창을 화면 우측 하단으로 옮긴다.
///
/// 창 크기가 바뀔 때마다 다시 호출해야 아래쪽 모서리에 붙어 있는다.
pub fn position_bottom_right(win: &WebviewWindow) -> Result<(), String> {
    let monitor = match win.current_monitor() {
        Ok(Some(m)) => Some(m),
        // 창이 아직 화면에 없으면 current_monitor가 비는 경우가 있다.
        _ => win.primary_monitor().ok().flatten(),
    };

    let Some(monitor) = monitor else {
        return Ok(()); // 모니터 정보를 못 얻으면 OS 기본 위치에 맡긴다.
    };

    let scale = monitor.scale_factor();
    let m_size = monitor.size();
    let m_pos = monitor.position();

    let win_size = win
        .outer_size()
        .map_err(|e| format!("창 크기 조회 실패: {e}"))?;

    let margin_x = (MARGIN_X * scale).round() as i32;
    let margin_y = (MARGIN_Y * scale).round() as i32;

    let x = m_pos.x + m_size.width as i32 - win_size.width as i32 - margin_x;
    let y = m_pos.y + m_size.height as i32 - win_size.height as i32 - margin_y;

    win.set_position(PhysicalPosition::new(x, y))
        .map_err(|e| format!("창 위치 설정 실패: {e}"))
}

/// 알림 한 건을 우측 하단에 띄운다.
pub fn push(app: &AppHandle, payload: NotificationPayload) -> Result<(), String> {
    let win = ensure_window(app)?;

    if READY.load(Ordering::SeqCst) {
        app.emit_to(NOTIFY_LABEL, "notification://push", &payload)
            .map_err(|e| format!("알림 전달 실패: {e}"))?;
    } else {
        // 아직 리스너가 없다. 큐에 넣어두면 프론트가 마운트 직후 가져간다.
        let queue = app.state::<NotifyQueue>();
        let mut q = queue
            .0
            .lock()
            .map_err(|_| "알림 큐 잠금 실패".to_string())?;
        q.push(payload);
        // 창이 오래 닫혀 있었다면 무한정 쌓이지 않도록 상한을 둔다.
        if q.len() > 50 {
            let overflow = q.len() - 50;
            q.drain(0..overflow);
        }
    }

    // 자리를 먼저 잡고 보여준다. 순서가 반대면 창이 화면 가운데 잠깐 떴다가
    // 우측 하단으로 튀는 것이 보인다.
    position_bottom_right(&win)?;
    win.show().map_err(|e| format!("알림 창 표시 실패: {e}"))?;
    // 다른 always-on-top 창에 가리지 않도록 매번 최상위로 올린다.
    let _ = win.set_always_on_top(true);

    Ok(())
}

/// 프론트가 마운트를 마쳤음을 알린다. 이후로는 emit이 유실되지 않는다.
pub fn mark_ready(ready: bool) {
    READY.store(ready, Ordering::SeqCst);
}

/// 큐에 쌓인 알림을 모두 꺼내고 비운다.
pub fn drain(app: &AppHandle) -> Result<Vec<NotificationPayload>, String> {
    let queue = app.state::<NotifyQueue>();
    let mut q = queue
        .0
        .lock()
        .map_err(|_| "알림 큐 잠금 실패".to_string())?;
    Ok(std::mem::take(&mut *q))
}

/// 표시할 카드가 없어졌을 때 창을 숨긴다.
///
/// 파괴하지 않고 숨기기만 하는 이유는 다음 알림에서 webview를 다시 띄우는
/// 비용(수백 ms)을 아끼기 위해서다.
pub fn hide(app: &AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window(NOTIFY_LABEL) {
        win.hide()
            .map_err(|e| format!("알림 창 숨기기 실패: {e}"))?;
    }
    Ok(())
}

/// 카드 개수에 맞춰 창 높이를 조절한다.
///
/// 투명 창이라도 영역 자체는 클릭을 가로채므로, 내용 높이에 정확히 맞춰야
/// 빈 공간이 뒤쪽 창의 클릭을 먹지 않는다.
pub fn resize(app: &AppHandle, height: f64) -> Result<(), String> {
    let Some(win) = app.get_webview_window(NOTIFY_LABEL) else {
        return Ok(());
    };

    let h = height.clamp(80.0, 900.0);
    win.set_size(LogicalSize::new(WIDTH, h))
        .map_err(|e| format!("알림 창 크기 조절 실패: {e}"))?;
    position_bottom_right(&win)?;

    // 프론트가 카드를 그렸다는 뜻이므로 창이 보이는 상태임을 보장한다.
    // 창 생성 직후의 show() 와 프론트의 첫 hide() 가 엇갈리는 경우를 막는다.
    if !win.is_visible().unwrap_or(true) {
        let _ = win.show();
        let _ = win.set_always_on_top(true);
    }

    Ok(())
}
