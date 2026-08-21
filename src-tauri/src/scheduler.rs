use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager};
use uuid::Uuid;

use crate::db::Db;
use crate::models::{now, NotificationPayload};
use crate::notify;

/// 알림 대상을 확인하는 주기.
///
/// 짧을수록 정확하지만 그만큼 자주 깨어난다. 20초면 사용자가 체감하는
/// 지연이 없으면서 유휴 시 CPU 사용량도 무시할 수 있는 수준이다.
const TICK: Duration = Duration::from_secs(20);

/// 앱이 꺼져 있는 동안 지나간 알림을 어디까지 되살릴지.
///
/// 이보다 오래된 것은 지금 띄워도 의미가 없으므로 조용히 발송 처리만 한다.
const GRACE: i64 = 24 * 60 * 60;

pub fn spawn(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        // 앱 시작 직후 한 번 확인한다. 꺼져 있는 사이에 지난 알림을 바로 보여주기 위해서다.
        tokio::time::sleep(Duration::from_secs(2)).await;

        let mut ticker = tokio::time::interval(TICK);
        loop {
            ticker.tick().await;
            if let Err(e) = tick(&app) {
                eprintln!("[scheduler] {e}");
            }
        }
    });
}

struct Due {
    id: String,
    title: String,
    notes: Option<String>,
    starts_at: Option<i64>,
    ends_at: Option<i64>,
    remind_at: i64,
    repeat_interval_min: i64,
    repeat_count: i64,
    notified_count: i64,
}

fn tick(app: &AppHandle) -> Result<(), String> {
    let ts = now();

    // 락은 조회 구간에서만 잡는다. 알림 표시는 창 생성까지 포함해 오래 걸릴 수
    // 있는데, 그동안 UI 쪽 커맨드가 DB를 못 쓰면 앱이 멎은 것처럼 보인다.
    let due: Vec<Due> = {
        let db = app.state::<Db>();
        let conn = db.0.lock().map_err(|_| "DB 잠금 실패".to_string())?;

        let mut stmt = conn
            .prepare(
                "SELECT id, title, notes, starts_at, ends_at, remind_at, \
                 repeat_interval_min, repeat_count, notified_count FROM tasks \
                 WHERE deleted_at IS NULL \
                   AND status <> 'done' \
                   AND remind = 1 \
                   AND notified_at IS NULL \
                   AND remind_at IS NOT NULL \
                   AND remind_at <= ?1 \
                 ORDER BY remind_at ASC \
                 LIMIT 20",
            )
            .map_err(|e| format!("알림 쿼리 준비 실패: {e}"))?;

        let rows = stmt
            .query_map([ts], |row| {
                Ok(Due {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    notes: row.get(2)?,
                    starts_at: row.get(3)?,
                    ends_at: row.get(4)?,
                    remind_at: row.get(5)?,
                    repeat_interval_min: row.get(6)?,
                    repeat_count: row.get(7)?,
                    notified_count: row.get(8)?,
                })
            })
            .map_err(|e| format!("알림 대상 조회 실패: {e}"))?;

        // 읽지 못하는 행은 건너뛴다. 여기서 배치 전체를 중단하면 손상된 행
        // 하나가 이후 모든 알림을 영구히 막는다. 외부 도구가 잘못된 인코딩으로
        // 써 넣은 경우가 실제로 그렇다.
        rows.filter_map(|r| match r {
            Ok(due) => Some(due),
            Err(e) => {
                eprintln!("[scheduler] 손상된 행을 건너뜁니다: {e}");
                None
            }
        })
        .collect()
    };

    if due.is_empty() {
        return Ok(());
    }

    for item in &due {
        let sent = item.notified_count + 1;

        // 더 울릴 차례가 남았는가.
        // repeat_count == 0 은 "완료할 때까지 무제한"을 뜻한다.
        // 완료되면 위 쿼리의 status <> 'done' 조건에서 걸러지므로 자연히 멈춘다.
        let has_more =
            item.repeat_interval_min > 0 && (item.repeat_count == 0 || sent < item.repeat_count);

        // 먼저 발송 처리를 한다. 알림 표시가 실패하더라도 같은 항목을 20초마다
        // 무한히 재시도하는 것보다는 한 번 놓치는 편이 낫다.
        {
            let db = app.state::<Db>();
            let conn = db.0.lock().map_err(|_| "DB 잠금 실패".to_string())?;

            if has_more {
                // notified_at 을 비워 두면 다음 주기에 스케줄러가 다시 집어간다.
                conn.execute(
                    "UPDATE tasks SET notified_at = NULL, notified_count = ?2, remind_at = ?3 \
                     WHERE id = ?1",
                    rusqlite::params![item.id, sent, ts + item.repeat_interval_min * 60],
                )
            } else {
                conn.execute(
                    "UPDATE tasks SET notified_at = ?2, notified_count = ?3 WHERE id = ?1",
                    rusqlite::params![item.id, ts, sent],
                )
            }
            .map_err(|e| format!("알림 발송 기록 실패: {e}"))?;
        }

        // 너무 오래 지난 것은 표시하지 않는다.
        if ts - item.remind_at > GRACE {
            continue;
        }

        // 종료 시각이 있으면 그것을, 없으면 시작 시각을 기준으로 지남을 판단한다.
        let deadline = item.ends_at.or(item.starts_at);
        let overdue = deadline.map(|d| d < ts).unwrap_or(false);

        let payload = NotificationPayload {
            nid: Uuid::new_v4().to_string(),
            task_id: Some(item.id.clone()),
            title: item.title.clone(),
            body: item.notes.clone(),
            starts_at: item.starts_at,
            ends_at: item.ends_at,
            kind: if overdue { "overdue" } else { "reminder" }.into(),
            // 반복 알림이면 "2/3회" 처럼 진행 상황을 보여준다.
            repeat_seq: if item.repeat_interval_min > 0 {
                Some(sent)
            } else {
                None
            },
            repeat_total: if item.repeat_interval_min > 0 && item.repeat_count > 0 {
                Some(item.repeat_count)
            } else {
                None
            },
        };

        if let Err(e) = notify::push(app, payload) {
            eprintln!("[scheduler] 알림 표시 실패: {e}");
        }
    }

    // 목록의 알림 배지 등을 갱신하도록 모든 창에 알린다.
    let _ = app.emit("tasks://changed", ());

    Ok(())
}
