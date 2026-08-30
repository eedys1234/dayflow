mod commands;
mod db;
mod export;
mod models;
mod notify;
mod scheduler;
mod tray;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // 두 번째 실행은 스스로 종료하고, 대신 이미 떠 있는 창을 앞으로 가져온다.
        // 트레이에 상주하는 앱이라 사용자가 아이콘을 다시 눌러 중복 실행하기 쉽다.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            tray::focus_main(app);
        }))
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(notify::NotifyQueue::default())
        .setup(|app| {
            let handle = app.handle().clone();

            let dir = handle
                .path()
                .app_data_dir()
                .map_err(|e| format!("앱 데이터 폴더를 찾지 못했습니다: {e}"))?;
            let db = db::Db::open(&dir.join("schedule.db"))?;
            app.manage(db);

            tray::setup(&handle)?;
            if let Some(win) = handle.get_webview_window("main") {
                tray::hide_on_close(&win);
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
            export::export_xlsx,
            commands::get_setting,
            commands::set_setting,
            commands::notification_ready,
            commands::drain_notifications,
            commands::resize_notification_window,
            commands::hide_notification_window,
            commands::send_test_notification,
        ])
        .run(tauri::generate_context!())
        .expect("Tauri 앱 실행에 실패했습니다");
}
