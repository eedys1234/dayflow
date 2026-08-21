use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, WebviewWindow,
};

/// 메인 창을 화면 앞으로 가져온다. 최소화·숨김 상태 모두에서 동작해야 한다.
pub fn focus_main(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.show();
        let _ = win.unminimize();
        let _ = win.set_focus();
    }
}

/// 창 닫기(X)를 종료가 아니라 트레이로 숨기기로 바꾼다.
///
/// 알림 스케줄러가 계속 돌아야 하므로, 앱이 살아 있는 편이 사용자의 기대에 맞다.
/// 진짜 종료는 트레이 메뉴의 "종료"로만 한다.
pub fn hide_on_close(win: &WebviewWindow) {
    let handle = win.clone();
    win.on_window_event(move |event| {
        if let tauri::WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            let _ = handle.hide();
        }
    });
}

pub fn setup(app: &AppHandle) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Dayflow 열기", true, None::<&str>)?;
    let new_task = MenuItem::with_id(app, "new", "새 할 일", true, None::<&str>)?;
    let sep = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "종료", true, None::<&str>)?;

    let menu = Menu::with_items(app, &[&open, &new_task, &sep, &quit])?;

    TrayIconBuilder::with_id("main-tray")
        .icon(app.default_window_icon().unwrap().clone())
        .tooltip("Dayflow")
        .menu(&menu)
        // 좌클릭은 메뉴가 아니라 창 열기로 쓴다. 메뉴는 우클릭에서만 뜬다.
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => focus_main(app),
            "new" => {
                focus_main(app);
                // 프론트가 새 할 일 모달을 열도록 신호만 보낸다.
                let _ = app.emit("tray://new-task", ());
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
