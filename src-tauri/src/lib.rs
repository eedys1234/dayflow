mod backup;
mod commands;
mod db;
mod export;
mod models;
mod notify;
mod quickadd;
mod scheduler;
mod tray;
mod widget;

use tauri::Manager;
use tauri_plugin_autostart::MacosLauncher;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // 두 번째 실행은 스스로 종료하고, 대신 이미 떠 있는 창을 앞으로 가져온다.
        // 트레이에 상주하는 앱이라 사용자가 아이콘을 다시 눌러 중복 실행하기 쉽다.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            tray::focus_main(app);
        }))
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            // 부팅 직후 창이 튀어나오면 방해가 된다. 트레이로만 조용히 올라온다.
            Some(vec!["--hidden"]),
        ))
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(notify::NotifyQueue::default())
        .setup(|app| {
            let handle = app.handle().clone();

            let dir = backup::data_dir(&handle)?;
            std::fs::create_dir_all(&dir)?;

            // 복원 예약이 있으면 DB를 열기 전에 적용한다.
            if let Some(p) = backup::apply_pending_restore(&dir)? {
                eprintln!("[backup] 복원 적용: {p}");
            }

            let db = db::Db::open(&dir.join("schedule.db"))?;

            // 창 닫기 동작과 전역 단축키는 설정에 따라 달라진다. 먼저 읽어둔다.
            let (close_to_tray, shortcut, show_widget) = {
                let conn = db.0.lock().map_err(|_| "DB 잠금 실패".to_string())?;
                (
                    db::setting_bool(&conn, "closeToTray", true),
                    db::setting(&conn, "quickAddShortcut")
                        .unwrap_or_else(|| quickadd::DEFAULT_SHORTCUT.to_string()),
                    db::setting_bool(&conn, "widgetVisible", false),
                )
            };
            app.manage(db);

            tray::set_close_to_tray(close_to_tray);
            tray::setup(&handle)?;
            tray::refresh(&handle);

            if let Some(win) = handle.get_webview_window("main") {
                tray::hide_on_close(&win);

                // 자동 시작으로 켜졌으면 창을 띄우지 않고 트레이에만 있는다.
                if std::env::args().any(|a| a == "--hidden") {
                    let _ = win.hide();
                }
            }

            // 단축키가 다른 프로그램과 겹치면 대안으로 자동 대체된다.
            // 모두 실패해도 앱은 계속 뜬다.
            match quickadd::register(&handle, &shortcut) {
                Ok(active) if !active.is_empty() => {
                    eprintln!("[quickadd] 단축키: {active}");
                }
                Ok(_) => {}
                Err(e) => eprintln!("[quickadd] {e}"),
            }

            if show_widget {
                let _ = widget::show(&handle);
            }

            scheduler::spawn(handle);

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_tasks,
            commands::create_task,
            commands::update_task,
            commands::delete_task,
            commands::restore_task,
            commands::set_task_status,
            commands::reschedule_task,
            commands::snooze_task,
            commands::app_version,
            commands::get_setting,
            commands::set_setting,
            commands::notification_ready,
            commands::drain_notifications,
            commands::resize_notification_window,
            commands::hide_notification_window,
            commands::send_test_notification,
            export::export_xlsx,
            backup::list_backups,
            backup::create_backup,
            backup::restore_backup,
            backup::delete_backup,
            backup::backups_path,
            backup::restart_app,
            widget::resize_widget,
            widget::set_widget_visible,
            widget::widget_visible,
            widget::open_main,
            quickadd::hide_quickadd,
            quickadd::resize_quickadd,
            quickadd::set_shortcut,
            quickadd::active_shortcut,
        ])
        .run(tauri::generate_context!())
        .expect("Tauri 앱 실행에 실패했습니다");
}
