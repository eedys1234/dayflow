use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

use crate::db::{row_to_task, Db, TASK_COLUMNS};
use crate::models::{
    compute_remind_at, now, NewTask, NotificationPayload, Status, Task, TaskUpdate,
};
use crate::notify;

/// 할 일 목록이 바뀌었음을 모든 창에 알린다.
fn broadcast_changed(app: &AppHandle) {
    let _ = app.emit("tasks://changed", ());
}

fn load_task(conn: &rusqlite::Connection, id: &str) -> Result<Task, String> {
    let sql = format!("SELECT {TASK_COLUMNS} FROM tasks WHERE id = ?1 AND deleted_at IS NULL");
    conn.query_row(&sql, [id], row_to_task)
        .map_err(|e| format!("할 일 조회 실패: {e}"))
}

/// 반복 알림 옵션을 안전한 범위로 다듬는다.
///
/// 주기가 0이면 반복하지 않으므로 횟수는 1(한 번만)로 고정한다.
/// 횟수 0은 "완료할 때까지 무제한"을 뜻한다.
fn normalize_repeat(interval: Option<i64>, count: Option<i64>) -> (i64, i64) {
    let interval = interval.unwrap_or(0).clamp(0, 24 * 60);
    if interval == 0 {
        return (0, 1);
    }
    let count = count.unwrap_or(1).clamp(0, 50);
    (interval, count)
}

/// 종료 시각은 선택이지만, 넣었다면 시작보다 뒤여야 한다.
fn validate_range(starts_at: Option<i64>, ends_at: Option<i64>) -> Result<(), String> {
    match (starts_at, ends_at) {
        (_, None) => Ok(()),
        (None, Some(_)) => {
            Err("종료 시각만 지정할 수는 없습니다. 시작 시각을 함께 넣어주세요.".into())
        }
        (Some(s), Some(e)) if e <= s => Err("종료 시각은 시작 시각보다 뒤여야 합니다.".into()),
        _ => Ok(()),
    }
}

#[tauri::command]
pub fn list_tasks(db: State<Db>) -> Result<Vec<Task>, String> {
    let conn = db.0.lock().map_err(|_| "DB 잠금 실패".to_string())?;

    let sql = format!(
        "SELECT {TASK_COLUMNS} FROM tasks \
         WHERE deleted_at IS NULL \
         ORDER BY CASE status WHEN 'done' THEN 1 ELSE 0 END ASC, \
                  CASE WHEN starts_at IS NULL THEN 1 ELSE 0 END ASC, \
                  starts_at ASC, \
                  priority DESC, \
                  created_at ASC"
    );

    let mut stmt = conn
        .prepare(&sql)
        .map_err(|e| format!("쿼리 준비 실패: {e}"))?;

    let rows = stmt
        .query_map([], row_to_task)
        .map_err(|e| format!("목록 조회 실패: {e}"))?;

    rows.collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|e| format!("목록 변환 실패: {e}"))
}

#[tauri::command]
pub fn create_task(app: AppHandle, db: State<Db>, input: NewTask) -> Result<Task, String> {
    let title = input.title.trim();
    if title.is_empty() {
        return Err("제목을 입력하세요.".into());
    }
    if input.remind && input.starts_at.is_none() {
        return Err("알림을 사용하려면 시작 시각을 지정해야 합니다.".into());
    }
    validate_range(input.starts_at, input.ends_at)?;

    let offset = input.remind_offset_min.unwrap_or(0).max(0);
    let (repeat_interval, repeat_count) =
        normalize_repeat(input.repeat_interval_min, input.repeat_count);
    let remind_at = compute_remind_at(input.remind, input.starts_at, offset);
    let ts = now();
    let id = Uuid::new_v4().to_string();

    let conn = db.0.lock().map_err(|_| "DB 잠금 실패".to_string())?;
    conn.execute(
        "INSERT INTO tasks \
         (id, title, notes, starts_at, ends_at, remind, remind_offset_min, remind_at, \
          priority, status, sort_order, created_at, updated_at, \
          repeat_interval_min, repeat_count, notified_count) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'pending', 0, ?10, ?10, ?11, ?12, 0)",
        rusqlite::params![
            id,
            title,
            input.notes.as_deref().filter(|s| !s.trim().is_empty()),
            input.starts_at,
            input.ends_at,
            input.remind as i64,
            offset,
            remind_at,
            input.priority.unwrap_or(0),
            ts,
            repeat_interval,
            repeat_count,
        ],
    )
    .map_err(|e| format!("등록 실패: {e}"))?;

    let task = load_task(&conn, &id)?;
    drop(conn);

    broadcast_changed(&app);
    Ok(task)
}

#[tauri::command]
pub fn update_task(app: AppHandle, db: State<Db>, input: TaskUpdate) -> Result<Task, String> {
    let title = input.title.trim();
    if title.is_empty() {
        return Err("제목을 입력하세요.".into());
    }
    if input.remind && input.starts_at.is_none() {
        return Err("알림을 사용하려면 시작 시각을 지정해야 합니다.".into());
    }
    validate_range(input.starts_at, input.ends_at)?;

    let offset = input.remind_offset_min.unwrap_or(0).max(0);
    let (repeat_interval, repeat_count) =
        normalize_repeat(input.repeat_interval_min, input.repeat_count);
    let remind_at = compute_remind_at(input.remind, input.starts_at, offset);
    let ts = now();

    let conn = db.0.lock().map_err(|_| "DB 잠금 실패".to_string())?;

    // 알림 시각이 바뀌었다면 이미 띄운 기록을 지워 다시 알리도록 한다.
    let (prev_remind_at, prev_notified_at): (Option<i64>, Option<i64>) = conn
        .query_row(
            "SELECT remind_at, notified_at FROM tasks WHERE id = ?1 AND deleted_at IS NULL",
            [&input.id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(|e| format!("기존 알림 정보 조회 실패: {e}"))?;

    // 알림 시각이 바뀌면 발송 기록과 횟수를 초기화해 처음부터 다시 울리게 한다.
    let rescheduled = prev_remind_at != remind_at;
    let notified_at = if rescheduled { None } else { prev_notified_at };
    let notified_count_sql = if rescheduled { "0" } else { "notified_count" };

    let affected = conn
        .execute(
            &format!(
                "UPDATE tasks SET \
                   title = ?2, notes = ?3, starts_at = ?4, ends_at = ?5, remind = ?6, \
                   remind_offset_min = ?7, remind_at = ?8, notified_at = ?9, \
                   priority = ?10, updated_at = ?11, \
                   repeat_interval_min = ?12, repeat_count = ?13, \
                   notified_count = {notified_count_sql} \
                 WHERE id = ?1 AND deleted_at IS NULL"
            ),
            rusqlite::params![
                input.id,
                title,
                input.notes.as_deref().filter(|s| !s.trim().is_empty()),
                input.starts_at,
                input.ends_at,
                input.remind as i64,
                offset,
                remind_at,
                notified_at,
                input.priority.unwrap_or(0),
                ts,
                repeat_interval,
                repeat_count,
            ],
        )
        .map_err(|e| format!("수정 실패: {e}"))?;

    if affected == 0 {
        return Err("수정할 할 일을 찾지 못했습니다.".into());
    }

    let task = load_task(&conn, &input.id)?;
    drop(conn);

    broadcast_changed(&app);
    Ok(task)
}

/// 물리 삭제 대신 `deleted_at` 을 채운다. 실행 취소와 향후 동기화를 위해서다.
#[tauri::command]
pub fn delete_task(app: AppHandle, db: State<Db>, id: String) -> Result<(), String> {
    {
        let conn = db.0.lock().map_err(|_| "DB 잠금 실패".to_string())?;
        let ts = now();
        conn.execute(
            "UPDATE tasks SET deleted_at = ?2, updated_at = ?2 WHERE id = ?1",
            rusqlite::params![id, ts],
        )
        .map_err(|e| format!("삭제 실패: {e}"))?;
    }
    broadcast_changed(&app);
    Ok(())
}

/// 삭제 직후 "실행 취소" 용도.
#[tauri::command]
pub fn restore_task(app: AppHandle, db: State<Db>, id: String) -> Result<Task, String> {
    let conn = db.0.lock().map_err(|_| "DB 잠금 실패".to_string())?;
    conn.execute(
        "UPDATE tasks SET deleted_at = NULL, updated_at = ?2 WHERE id = ?1",
        rusqlite::params![id, now()],
    )
    .map_err(|e| format!("복구 실패: {e}"))?;

    let task = load_task(&conn, &id)?;
    drop(conn);

    broadcast_changed(&app);
    Ok(task)
}

/// 대기 / 진행 중 / 완료 사이를 옮긴다. 보드의 드래그가 이 커맨드를 쓴다.
#[tauri::command]
pub fn set_task_status(
    app: AppHandle,
    db: State<Db>,
    id: String,
    status: Status,
) -> Result<Task, String> {
    let ts = now();

    let conn = db.0.lock().map_err(|_| "DB 잠금 실패".to_string())?;

    let prev_started: Option<i64> = conn
        .query_row(
            "SELECT started_at FROM tasks WHERE id = ?1 AND deleted_at IS NULL",
            [&id],
            |r| r.get(0),
        )
        .map_err(|e| format!("기존 상태 조회 실패: {e}"))?;

    // 진행 중으로 처음 옮길 때만 착수 시각을 남긴다. 대기로 되돌렸다가
    // 다시 진행하는 경우 최초 착수 시점을 잃지 않기 위해서다.
    let started_at = match status {
        Status::InProgress => prev_started.or(Some(ts)),
        Status::Pending => None,
        Status::Done => prev_started,
    };
    let completed_at = if status == Status::Done {
        Some(ts)
    } else {
        None
    };

    conn.execute(
        "UPDATE tasks SET status = ?2, started_at = ?3, completed_at = ?4, updated_at = ?5 \
         WHERE id = ?1 AND deleted_at IS NULL",
        rusqlite::params![id, status.as_str(), started_at, completed_at, ts],
    )
    .map_err(|e| format!("상태 변경 실패: {e}"))?;

    let task = load_task(&conn, &id)?;
    drop(conn);

    broadcast_changed(&app);
    Ok(task)
}

/// 시각만 옮긴다. 캘린더에서 카드를 다른 날짜/시간으로 끌어다 놓을 때 쓴다.
///
/// 종료 시각이 있으면 **길이를 유지한 채** 함께 이동한다.
#[tauri::command]
pub fn reschedule_task(
    app: AppHandle,
    db: State<Db>,
    id: String,
    starts_at: Option<i64>,
) -> Result<Task, String> {
    let ts = now();

    let conn = db.0.lock().map_err(|_| "DB 잠금 실패".to_string())?;

    let (remind, offset, prev_start, prev_end): (i64, i64, Option<i64>, Option<i64>) = conn
        .query_row(
            "SELECT remind, remind_offset_min, starts_at, ends_at FROM tasks \
             WHERE id = ?1 AND deleted_at IS NULL",
            [&id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .map_err(|e| format!("기존 일정 조회 실패: {e}"))?;

    let duration = match (prev_start, prev_end) {
        (Some(s), Some(e)) => Some(e - s),
        _ => None,
    };
    let ends_at = match (starts_at, duration) {
        (Some(s), Some(d)) => Some(s + d),
        _ => None,
    };

    let remind_at = compute_remind_at(remind != 0, starts_at, offset);

    // 시각이 바뀌었으니 알림도 다시 울려야 한다.
    conn.execute(
        "UPDATE tasks SET starts_at = ?2, ends_at = ?3, remind_at = ?4, \
                          notified_at = NULL, notified_count = 0, updated_at = ?5 \
         WHERE id = ?1 AND deleted_at IS NULL",
        rusqlite::params![id, starts_at, ends_at, remind_at, ts],
    )
    .map_err(|e| format!("일정 이동 실패: {e}"))?;

    let task = load_task(&conn, &id)?;
    drop(conn);

    broadcast_changed(&app);
    Ok(task)
}

/// 알림을 N분 뒤로 미룬다. `notified_at` 을 비워 스케줄러가 다시 잡도록 한다.
#[tauri::command]
pub fn snooze_task(
    app: AppHandle,
    db: State<Db>,
    id: String,
    minutes: i64,
) -> Result<Task, String> {
    let minutes = minutes.clamp(1, 24 * 60);
    let ts = now();
    let next = ts + minutes * 60;

    let conn = db.0.lock().map_err(|_| "DB 잠금 실패".to_string())?;
    conn.execute(
        "UPDATE tasks SET remind = 1, remind_at = ?2, notified_at = NULL, \
                          notified_count = 0, updated_at = ?3 \
         WHERE id = ?1 AND deleted_at IS NULL",
        rusqlite::params![id, next, ts],
    )
    .map_err(|e| format!("다시 알림 설정 실패: {e}"))?;

    let task = load_task(&conn, &id)?;
    drop(conn);

    broadcast_changed(&app);
    Ok(task)
}

/// `tauri.conf.json` 의 version 을 그대로 돌려준다.
///
/// 릴리스 워크플로가 git 태그(`v0.2.0`)와 이 값이 같은지 검사하므로,
/// 화면에 뜨는 버전은 곧 그 빌드가 나온 태그와 일치한다.
#[tauri::command]
pub fn app_version(app: AppHandle) -> String {
    app.package_info().version.to_string()
}

// ---------------------------------------------------------------------------
// 설정
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn get_setting(db: State<Db>, key: String) -> Result<Option<String>, String> {
    let conn = db.0.lock().map_err(|_| "DB 잠금 실패".to_string())?;
    conn.query_row("SELECT value FROM settings WHERE key = ?1", [&key], |r| {
        r.get::<_, String>(0)
    })
    .map(Some)
    .or_else(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => Ok(None),
        other => Err(format!("설정 조회 실패: {other}")),
    })
}

/// 설정을 저장하고 모든 창에 알린다.
///
/// 테마처럼 메인 창과 알림 창이 함께 따라야 하는 값이 있어서, 저장과 전파를
/// 한 커맨드로 묶는다.
#[tauri::command]
pub fn set_setting(
    app: AppHandle,
    db: State<Db>,
    key: String,
    value: String,
) -> Result<(), String> {
    {
        let conn = db.0.lock().map_err(|_| "DB 잠금 실패".to_string())?;
        conn.execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2) \
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            rusqlite::params![key, value],
        )
        .map_err(|e| format!("설정 저장 실패: {e}"))?;
    }

    let _ = app.emit("settings://changed", (key, value));
    Ok(())
}

// ---------------------------------------------------------------------------
// 알림 창 전용 커맨드
// ---------------------------------------------------------------------------

/// 알림 창 프론트가 마운트를 마쳤을 때 호출한다.
#[tauri::command]
pub fn notification_ready() {
    notify::mark_ready(true);
}

/// 창이 뜨기 전에 발생해 큐에 쌓인 알림을 가져간다.
#[tauri::command]
pub fn drain_notifications(app: AppHandle) -> Result<Vec<NotificationPayload>, String> {
    notify::drain(&app)
}

/// 카드 높이에 맞춰 창 크기를 조절한다.
#[tauri::command]
pub fn resize_notification_window(app: AppHandle, height: f64) -> Result<(), String> {
    notify::resize(&app, height)
}

/// 표시할 카드가 없을 때 창을 숨긴다.
#[tauri::command]
pub fn hide_notification_window(app: AppHandle) -> Result<(), String> {
    notify::hide(&app)
}

/// 위치와 모양을 눈으로 확인하기 위한 테스트 알림.
#[tauri::command]
pub fn send_test_notification(app: AppHandle) -> Result<(), String> {
    notify::push(
        &app,
        NotificationPayload {
            nid: Uuid::new_v4().to_string(),
            task_id: None,
            title: "테스트 알림".into(),
            body: Some("우측 하단에 이렇게 표시됩니다.".into()),
            starts_at: Some(now()),
            ends_at: None,
            kind: "test".into(),
            repeat_seq: None,
            repeat_total: None,
        },
    )
}
