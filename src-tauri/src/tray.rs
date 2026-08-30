use std::sync::atomic::{AtomicBool, Ordering};

use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, WebviewWindow,
};

use chrono::TimeZone;

use crate::db::Db;
use crate::models::now;

pub const TRAY_ID: &str = "main-tray";

/// 창 닫기(X)를 트레이 숨김으로 볼지, 진짜 종료로 볼지.
///
/// 설정에서 바꿀 수 있어야 하는데 창 이벤트 핸들러 안에서 DB를 뒤지는 것은
/// 과하다. 시작할 때 한 번 읽어 여기에 담아두고, 설정이 바뀌면 갱신한다.
static CLOSE_TO_TRAY: AtomicBool = AtomicBool::new(true);

pub fn set_close_to_tray(v: bool) {
    CLOSE_TO_TRAY.store(v, Ordering::SeqCst);
}

/// 메인 창을 화면 앞으로 가져온다. 최소화·숨김 상태 모두에서 동작해야 한다.
pub fn focus_main(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.show();
        let _ = win.unminimize();
        let _ = win.set_focus();
    }
}

/// 창 닫기를 종료가 아니라 트레이로 숨기기로 바꾼다.
///
/// 알림 스케줄러가 계속 돌아야 하므로, 앱이 살아 있는 편이 사용자의 기대에 맞다.
/// 설정에서 끄면 평소처럼 종료한다.
pub fn hide_on_close(win: &WebviewWindow) {
    let handle = win.clone();
    win.on_window_event(move |event| {
        if let tauri::WindowEvent::CloseRequested { api, .. } = event {
            if CLOSE_TO_TRAY.load(Ordering::SeqCst) {
                api.prevent_close();
                let _ = handle.hide();
            }
        }
    });
}

/// 오늘 남은 일 / 기한 지난 일 개수.
fn summary(app: &AppHandle) -> (i64, i64) {
    let Some(db) = app.try_state::<Db>() else {
        return (0, 0);
    };
    let Ok(conn) = db.0.lock() else {
        return (0, 0);
    };

    let ts = now();
    // 로컬 자정 경계는 chrono로 계산한다. epoch 나눗셈으로 구하면 시간대가 틀어진다.
    let (from, to) = match chrono::Local
        .timestamp_opt(ts, 0)
        .single()
        .map(|d| d.date_naive())
    {
        Some(day) => {
            let s = day.and_hms_opt(0, 0, 0).unwrap();
            let e = day.and_hms_opt(23, 59, 59).unwrap();
            (
                chrono::Local
                    .from_local_datetime(&s)
                    .single()
                    .map(|d| d.timestamp())
                    .unwrap_or(0),
                chrono::Local
                    .from_local_datetime(&e)
                    .single()
                    .map(|d| d.timestamp())
                    .unwrap_or(0),
            )
        }
        None => return (0, 0),
    };

    let today: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM tasks WHERE deleted_at IS NULL AND status <> 'done' \
             AND starts_at IS NOT NULL AND starts_at BETWEEN ?1 AND ?2",
            [from, to],
            |r| r.get(0),
        )
        .unwrap_or(0);

    let overdue: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM tasks WHERE deleted_at IS NULL AND status <> 'done' \
             AND COALESCE(ends_at, starts_at) IS NOT NULL AND COALESCE(ends_at, starts_at) < ?1",
            [ts],
            |r| r.get(0),
        )
        .unwrap_or(0);

    (today, overdue)
}

fn build_menu(app: &AppHandle, today: i64, overdue: i64) -> tauri::Result<Menu<tauri::Wry>> {
    // 첫 두 줄은 정보 표시용이라 누를 수 없게 둔다.
    let head = MenuItem::with_id(
        app,
        "summary-today",
        format!("오늘 남은 일  {today}건"),
        false,
        None::<&str>,
    )?;
    let od = MenuItem::with_id(
        app,
        "summary-overdue",
        format!("기한 지남  {overdue}건"),
        false,
        None::<&str>,
    )?;
    let sep0 = PredefinedMenuItem::separator(app)?;

    let open = MenuItem::with_id(app, "open", "Dayflow 열기", true, None::<&str>)?;
    let new_task = MenuItem::with_id(app, "new", "새 할 일", true, None::<&str>)?;
    let widget = MenuItem::with_id(app, "widget", "요약 위젯 켜기 / 끄기", true, None::<&str>)?;
    let sep1 = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "종료", true, None::<&str>)?;

    Menu::with_items(
        app,
        &[&head, &od, &sep0, &open, &new_task, &widget, &sep1, &quit],
    )
}

/// 트레이 툴팁과 메뉴의 요약을 다시 계산해 반영한다.
///
/// 할 일이 바뀔 때마다 호출된다. 메뉴를 통째로 새로 만드는 편이 개별 항목
/// 핸들을 들고 다니는 것보다 단순하고, 빈도가 낮아 비용도 문제되지 않는다.
pub fn refresh(app: &AppHandle) {
    let (today, overdue) = summary(app);

    let Some(tray) = app.tray_by_id(TRAY_ID) else {
        return;
    };

    let tip = if overdue > 0 {
        format!("Dayflow — 오늘 {today}건 · 지남 {overdue}건")
    } else if today > 0 {
        format!("Dayflow — 오늘 {today}건")
    } else {
        "Dayflow — 오늘 남은 일 없음".to_string()
    };
    let _ = tray.set_tooltip(Some(tip));

    if let Ok(menu) = build_menu(app, today, overdue) {
        let _ = tray.set_menu(Some(menu));
    }
}

pub fn setup(app: &AppHandle) -> tauri::Result<()> {
    let menu = build_menu(app, 0, 0)?;

    TrayIconBuilder::with_id(TRAY_ID)
        .icon(app.default_window_icon().unwrap().clone())
        .tooltip("Dayflow")
        .menu(&menu)
        // 좌클릭은 메뉴가 아니라 창 열기로 쓴다. 메뉴는 우클릭에서만 뜬다.
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => focus_main(app),
            "new" => {
                // 창을 열지 않고도 바로 적을 수 있도록 빠른 입력을 띄운다.
                let _ = crate::quickadd::toggle(app);
            }
            "widget" => {
                let _ = crate::widget::toggle(app);
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                focus_main(tray.app_handle());
            }
        })
        .build(app)?;

    Ok(())
}

/// 트레이·위젯이 함께 갱신되도록 한 곳에 모은다.
pub fn broadcast(app: &AppHandle) {
    let _ = app.emit("tasks://changed", ());
    refresh(app);
}
