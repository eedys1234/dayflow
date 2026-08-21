use rusqlite::{Connection, Row};
use std::path::Path;
use std::sync::Mutex;

use crate::models::{Status, Task};

/// SQLite 커넥션 하나를 Mutex로 감싼 것.
///
/// 데스크탑 단일 사용자 앱이라 커넥션 풀은 과합니다. 쓰기 경합이 사실상 없으므로
/// 커넥션 하나를 잠금으로 직렬화하는 편이 단순하고 충분합니다.
pub struct Db(pub Mutex<Connection>);

impl Db {
    pub fn open(path: &Path) -> Result<Self, String> {
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir).map_err(|e| format!("데이터 폴더 생성 실패: {e}"))?;
        }

        let conn = Connection::open(path).map_err(|e| format!("DB 열기 실패: {e}"))?;

        // WAL: 읽기와 쓰기가 서로를 막지 않게 한다. 스케줄러가 주기적으로
        // 읽는 구조라 기본 rollback journal 보다 유리하다.
        conn.pragma_update(None, "journal_mode", "WAL")
            .map_err(|e| format!("WAL 설정 실패: {e}"))?;
        conn.pragma_update(None, "foreign_keys", "ON")
            .map_err(|e| format!("foreign_keys 설정 실패: {e}"))?;

        migrate(&conn)?;

        Ok(Db(Mutex::new(conn)))
    }
}

/// `user_version` 기반 순차 마이그레이션.
///
/// 새 스키마 변경은 아래에 단계를 하나씩 덧붙이면 된다. 이미 적용된 단계는
/// 건너뛰므로 기존 사용자의 DB도 안전하게 따라온다.
fn migrate(conn: &Connection) -> Result<(), String> {
    let version: i64 = conn
        .query_row("PRAGMA user_version", [], |r| r.get(0))
        .map_err(|e| format!("스키마 버전 조회 실패: {e}"))?;

    if version < 1 {
        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS tasks (
              id                TEXT    PRIMARY KEY,
              title             TEXT    NOT NULL,
              notes             TEXT,
              due_at            INTEGER,
              remind            INTEGER NOT NULL DEFAULT 0,
              remind_offset_min INTEGER NOT NULL DEFAULT 0,
              remind_at         INTEGER,
              notified_at       INTEGER,
              priority          INTEGER NOT NULL DEFAULT 0,
              is_done           INTEGER NOT NULL DEFAULT 0,
              completed_at      INTEGER,
              sort_order        INTEGER NOT NULL DEFAULT 0,
              created_at        INTEGER NOT NULL,
              updated_at        INTEGER NOT NULL,
              deleted_at        INTEGER
            );

            CREATE INDEX IF NOT EXISTS idx_tasks_due
              ON tasks(due_at) WHERE deleted_at IS NULL;

            -- 스케줄러가 20초마다 때리는 쿼리. 대상이 되는 행만 인덱스에 남긴다.
            CREATE INDEX IF NOT EXISTS idx_tasks_pending_remind
              ON tasks(remind_at)
              WHERE deleted_at IS NULL AND is_done = 0 AND remind = 1 AND notified_at IS NULL;

            PRAGMA user_version = 1;
            "#,
        )
        .map_err(|e| format!("마이그레이션 v1 실패: {e}"))?;
    }

    if version < 2 {
        // 완료 여부(불리언)를 3단계 상태로 넓힌다. 일별 보드 뷰의
        // 대기 / 진행 중 / 완료 세 열이 이 컬럼 하나에 대응한다.
        conn.execute_batch(
            r#"
            ALTER TABLE tasks ADD COLUMN status TEXT NOT NULL DEFAULT 'pending';
            ALTER TABLE tasks ADD COLUMN started_at INTEGER;

            UPDATE tasks SET status = CASE WHEN is_done = 1 THEN 'done' ELSE 'pending' END;

            DROP INDEX IF EXISTS idx_tasks_pending_remind;
            ALTER TABLE tasks DROP COLUMN is_done;

            CREATE INDEX idx_tasks_pending_remind
              ON tasks(remind_at)
              WHERE deleted_at IS NULL AND status <> 'done' AND remind = 1 AND notified_at IS NULL;

            CREATE TABLE IF NOT EXISTS settings (
              key   TEXT PRIMARY KEY,
              value TEXT NOT NULL
            );

            PRAGMA user_version = 2;
            "#,
        )
        .map_err(|e| format!("마이그레이션 v2 실패: {e}"))?;
    }

    if version < 3 {
        // 종료 시각이 생기면서 `due_at` 이라는 이름이 모호해졌다.
        // 시작/종료 한 쌍으로 정리한다.
        conn.execute_batch(
            r#"
            ALTER TABLE tasks RENAME COLUMN due_at TO starts_at;
            ALTER TABLE tasks ADD COLUMN ends_at INTEGER;

            DROP INDEX IF EXISTS idx_tasks_due;
            CREATE INDEX idx_tasks_starts ON tasks(starts_at) WHERE deleted_at IS NULL;
            CREATE INDEX idx_tasks_ends
              ON tasks(ends_at) WHERE deleted_at IS NULL AND ends_at IS NOT NULL;

            PRAGMA user_version = 3;
            "#,
        )
        .map_err(|e| format!("마이그레이션 v3 실패: {e}"))?;
    }

    if version < 4 {
        // 할 일별 반복 알림. 기본값은 기존 동작(한 번만 알림)과 같다.
        conn.execute_batch(
            r#"
            ALTER TABLE tasks ADD COLUMN repeat_interval_min INTEGER NOT NULL DEFAULT 0;
            ALTER TABLE tasks ADD COLUMN repeat_count        INTEGER NOT NULL DEFAULT 1;
            ALTER TABLE tasks ADD COLUMN notified_count      INTEGER NOT NULL DEFAULT 0;

            -- 이미 알림을 보낸 항목은 1회 발송한 것으로 본다.
            UPDATE tasks SET notified_count = 1 WHERE notified_at IS NOT NULL;

            PRAGMA user_version = 4;
            "#,
        )
        .map_err(|e| format!("마이그레이션 v4 실패: {e}"))?;
    }

    Ok(())
}

/// SELECT 시 공통으로 쓰는 컬럼 순서. `row_to_task` 와 반드시 짝을 맞춰야 한다.
pub const TASK_COLUMNS: &str = "id, title, notes, starts_at, ends_at, remind, remind_offset_min, \
     remind_at, notified_at, priority, status, started_at, completed_at, created_at, updated_at, \
     repeat_interval_min, repeat_count, notified_count";

pub fn row_to_task(row: &Row) -> rusqlite::Result<Task> {
    Ok(Task {
        id: row.get(0)?,
        title: row.get(1)?,
        notes: row.get(2)?,
        starts_at: row.get(3)?,
        ends_at: row.get(4)?,
        remind: row.get::<_, i64>(5)? != 0,
        remind_offset_min: row.get(6)?,
        remind_at: row.get(7)?,
        notified_at: row.get(8)?,
        priority: row.get(9)?,
        status: Status::from_db(&row.get::<_, String>(10)?),
        started_at: row.get(11)?,
        completed_at: row.get(12)?,
        created_at: row.get(13)?,
        updated_at: row.get(14)?,
        repeat_interval_min: row.get(15)?,
        repeat_count: row.get(16)?,
        notified_count: row.get(17)?,
    })
}
