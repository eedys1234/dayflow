use std::path::{Path, PathBuf};

use chrono::{Local, TimeZone};
use serde::Serialize;
use tauri::{AppHandle, Manager, State};

use crate::db::Db;
use crate::models::now;

/// 복원 대기 파일 이름.
///
/// 앱이 DB 커넥션을 쥔 채로 파일을 바꿔치기하면 위험하므로, 복원은
/// "다음 시작 때 적용"으로 미룬다. 시작 시 이 파일이 있으면 본 DB 자리로 옮긴다.
const PENDING: &str = "schedule.db.restore-pending";

/// 백업 파일 접두사. 이 이름 규칙에 맞는 것만 목록/정리 대상으로 본다.
const PREFIX: &str = "schedule-";
const EXT: &str = "db";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupInfo {
    pub name: String,
    pub path: String,
    pub size_bytes: u64,
    /// 파일명에서 뽑은 생성 시각(epoch 초). 실패하면 파일 수정 시각.
    pub created_at: i64,
}

pub fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|e| format!("앱 데이터 폴더를 찾지 못했습니다: {e}"))
}

pub fn backups_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = data_dir(app)?.join("backups");
    std::fs::create_dir_all(&dir).map_err(|e| format!("백업 폴더 생성 실패: {e}"))?;
    Ok(dir)
}

/// `schedule-20260820-143012.db`
fn file_name(ts: i64) -> String {
    let stamp = Local
        .timestamp_opt(ts, 0)
        .single()
        .map(|d| d.format("%Y%m%d-%H%M%S").to_string())
        .unwrap_or_else(|| ts.to_string());
    format!("{PREFIX}{stamp}.{EXT}")
}

fn parse_stamp(name: &str) -> Option<i64> {
    let core = name.strip_prefix(PREFIX)?.strip_suffix(".db")?;
    let dt = chrono::NaiveDateTime::parse_from_str(core, "%Y%m%d-%H%M%S").ok()?;
    Local
        .from_local_datetime(&dt)
        .single()
        .map(|d| d.timestamp())
}

/// 시작 시점에 대기 중인 복원을 적용한다. DB를 열기 **전에** 불러야 한다.
///
/// 되돌리기가 불가능한 작업이므로, 덮어쓰기 직전의 원본을 백업 폴더에 먼저 남긴다.
pub fn apply_pending_restore(data_dir: &Path) -> Result<Option<String>, String> {
    let pending = data_dir.join(PENDING);
    if !pending.exists() {
        return Ok(None);
    }

    let live = data_dir.join("schedule.db");
    let backups = data_dir.join("backups");
    std::fs::create_dir_all(&backups).map_err(|e| format!("백업 폴더 생성 실패: {e}"))?;

    if live.exists() {
        let safety = backups.join(format!("{PREFIX}pre-restore-{}.{EXT}", now()));
        std::fs::copy(&live, &safety).map_err(|e| format!("복원 전 안전 백업 실패: {e}"))?;
    }

    // WAL/SHM 이 남아 있으면 옛 데이터가 되살아난다. 반드시 함께 지운다.
    for suffix in ["-wal", "-shm"] {
        let side = data_dir.join(format!("schedule.db{suffix}"));
        let _ = std::fs::remove_file(side);
    }

    std::fs::rename(&pending, &live).map_err(|e| format!("복원 적용 실패: {e}"))?;

    Ok(Some(live.to_string_lossy().to_string()))
}

/// 지금 상태를 백업 파일 하나로 남긴다.
///
/// 파일 복사가 아니라 SQLite 온라인 백업 API를 쓴다. 쓰기 중이어도 일관된
/// 스냅샷이 나오고 WAL 내용까지 반영된다.
pub fn create(db: &Db, dir: &Path) -> Result<PathBuf, String> {
    let dest = dir.join(file_name(now()));
    let conn = db.0.lock().map_err(|_| "DB 잠금 실패".to_string())?;

    conn.backup(rusqlite::MAIN_DB, &dest, None)
        .map_err(|e| format!("백업 실패: {e}"))?;

    Ok(dest)
}

/// 최신 `keep` 개만 남기고 지운다. 지운 개수를 돌려준다.
pub fn prune(dir: &Path, keep: usize) -> usize {
    let mut files = list_files(dir);
    if files.len() <= keep {
        return 0;
    }
    files.sort_by_key(|b| std::cmp::Reverse(b.created_at));

    let mut removed = 0;
    for old in files.iter().skip(keep) {
        if std::fs::remove_file(&old.path).is_ok() {
            removed += 1;
        }
    }
    removed
}

fn list_files(dir: &Path) -> Vec<BackupInfo> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };

    entries
        .filter_map(|e| {
            let e = e.ok()?;
            let name = e.file_name().to_string_lossy().to_string();
            if !name.starts_with(PREFIX) || !name.ends_with(".db") {
                return None;
            }
            let meta = e.metadata().ok()?;
            let created_at = parse_stamp(&name).unwrap_or_else(|| {
                meta.modified()
                    .ok()
                    .and_then(|m| m.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|d| d.as_secs() as i64)
                    .unwrap_or(0)
            });
            Some(BackupInfo {
                name,
                path: e.path().to_string_lossy().to_string(),
                size_bytes: meta.len(),
                created_at,
            })
        })
        .collect()
}

// ---------------------------------------------------------------------------
// 커맨드
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn list_backups(app: AppHandle) -> Result<Vec<BackupInfo>, String> {
    let dir = backups_dir(&app)?;
    let mut list = list_files(&dir);
    list.sort_by_key(|b| std::cmp::Reverse(b.created_at));
    Ok(list)
}

#[tauri::command]
pub fn create_backup(
    app: AppHandle,
    db: State<Db>,
    keep: Option<usize>,
) -> Result<BackupInfo, String> {
    let dir = backups_dir(&app)?;
    let path = create(&db, &dir)?;
    prune(&dir, keep.unwrap_or(10).max(1));

    let meta = std::fs::metadata(&path).map_err(|e| format!("백업 파일 확인 실패: {e}"))?;
    Ok(BackupInfo {
        name: path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default(),
        path: path.to_string_lossy().to_string(),
        size_bytes: meta.len(),
        created_at: now(),
    })
}

/// 선택한 백업을 "다음 시작 때 적용"으로 예약한다.
#[tauri::command]
pub fn restore_backup(app: AppHandle, path: String) -> Result<(), String> {
    let src = PathBuf::from(&path);
    if !src.exists() {
        return Err("백업 파일을 찾을 수 없습니다.".into());
    }

    // 정말 SQLite 파일인지 최소한으로 확인한다. 엉뚱한 파일을 얹으면
    // 다음 시작에서 앱이 열리지 않는다.
    let mut header = [0u8; 16];
    {
        use std::io::Read;
        let mut f = std::fs::File::open(&src).map_err(|e| format!("백업 열기 실패: {e}"))?;
        f.read_exact(&mut header)
            .map_err(|e| format!("백업 읽기 실패: {e}"))?;
    }
    if &header != b"SQLite format 3\0" {
        return Err("SQLite 백업 파일이 아닙니다.".into());
    }

    let dest = data_dir(&app)?.join(PENDING);
    std::fs::copy(&src, &dest).map_err(|e| format!("복원 예약 실패: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn delete_backup(path: String) -> Result<(), String> {
    std::fs::remove_file(&path).map_err(|e| format!("삭제 실패: {e}"))
}

#[tauri::command]
pub fn backups_path(app: AppHandle) -> Result<String, String> {
    Ok(backups_dir(&app)?.to_string_lossy().to_string())
}

/// 복원을 반영하려면 다시 시작해야 한다.
#[tauri::command]
pub fn restart_app(app: AppHandle) {
    app.restart();
}
