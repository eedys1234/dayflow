use chrono::{Datelike, Local, TimeZone, Timelike};
use rust_xlsxwriter::{Color, ExcelDateTime, Format, FormatAlign, Workbook};
use tauri::State;

use crate::db::{row_to_task, Db, TASK_COLUMNS};
use crate::models::{Status, Task};

const WEEKDAYS: [&str; 7] = ["일", "월", "화", "수", "목", "금", "토"];

/// epoch 초를 로컬 시간대의 Excel 날짜/시각으로 바꾼다.
///
/// 저장은 UTC로 하지만 사람이 보는 표는 로컬 기준이어야 하므로, 여기서 한 번
/// 변환한 뒤 벽시계 값 그대로 기록한다.
fn to_excel(ts: i64) -> Option<(ExcelDateTime, ExcelDateTime, &'static str)> {
    let dt = Local.timestamp_opt(ts, 0).single()?;

    let date = ExcelDateTime::from_ymd(dt.year() as u16, dt.month() as u8, dt.day() as u8).ok()?;
    let time =
        ExcelDateTime::from_hms(dt.hour() as u16, dt.minute() as u8, dt.second() as u8).ok()?;
    let dow = WEEKDAYS[dt.weekday().num_days_from_sunday() as usize];

    Some((date, time, dow))
}

fn status_label(s: Status) -> &'static str {
    match s {
        Status::Pending => "대기",
        Status::InProgress => "진행 중",
        Status::Done => "완료",
    }
}

fn priority_label(p: i64) -> &'static str {
    match p {
        3 => "높음",
        2 => "보통",
        1 => "낮음",
        _ => "",
    }
}

fn repeat_label(interval: i64, count: i64) -> String {
    if interval == 0 {
        return String::new();
    }
    if count == 0 {
        format!("{interval}분마다 (완료까지)")
    } else {
        format!("{interval}분마다 {count}회")
    }
}

/// 기간 내 일정을 xlsx 파일로 내보낸다.
///
/// `from` / `to` 가 없으면 전체를 담는다. 반환값은 기록한 행 수.
#[tauri::command]
pub fn export_xlsx(
    db: State<Db>,
    path: String,
    from: Option<i64>,
    to: Option<i64>,
    label: String,
) -> Result<usize, String> {
    let tasks: Vec<Task> = {
        let conn = db.0.lock().map_err(|_| "DB 잠금 실패".to_string())?;

        // 기한 없는 항목은 캘린더에 올라가지 않으므로 전체 내보내기일 때만 포함한다.
        let sql = if from.is_some() {
            format!(
                "SELECT {TASK_COLUMNS} FROM tasks \
                 WHERE deleted_at IS NULL AND starts_at IS NOT NULL \
                   AND starts_at >= ?1 AND starts_at <= ?2 \
                 ORDER BY starts_at ASC"
            )
        } else {
            format!(
                "SELECT {TASK_COLUMNS} FROM tasks WHERE deleted_at IS NULL \
                 ORDER BY CASE WHEN starts_at IS NULL THEN 1 ELSE 0 END ASC, starts_at ASC"
            )
        };

        let mut stmt = conn
            .prepare(&sql)
            .map_err(|e| format!("쿼리 준비 실패: {e}"))?;

        let rows = if let (Some(f), Some(t)) = (from, to) {
            stmt.query_map([f, t], row_to_task)
        } else {
            stmt.query_map([], row_to_task)
        }
        .map_err(|e| format!("조회 실패: {e}"))?;

        rows.collect::<rusqlite::Result<Vec<_>>>()
            .map_err(|e| format!("변환 실패: {e}"))?
    };

    write_workbook(&tasks, &label, &path)?;
    Ok(tasks.len())
}

/// 실제 xlsx 를 만드는 부분. DB와 분리해 두어 단독으로 검증할 수 있다.
pub fn write_workbook(tasks: &[Task], label: &str, path: &str) -> Result<(), String> {
    let mut wb = Workbook::new();

    // --- 서식 ---
    let title_fmt = Format::new().set_bold().set_font_size(14);
    let head_fmt = Format::new()
        .set_bold()
        .set_font_color(Color::White)
        .set_background_color(Color::RGB(0x4263EB))
        .set_align(FormatAlign::Center)
        .set_align(FormatAlign::VerticalCenter);
    let date_fmt = Format::new().set_num_format("yyyy-mm-dd");
    let time_fmt = Format::new().set_num_format("hh:mm");
    let center = Format::new().set_align(FormatAlign::Center);
    let done_fmt = Format::new().set_font_color(Color::RGB(0x8B95A3));
    let overdue_fmt = Format::new()
        .set_font_color(Color::RGB(0xC92A2A))
        .set_bold();

    // ---------------------------------------------------------------- 일정 시트
    let sheet = wb
        .add_worksheet()
        .set_name("일정")
        .map_err(|e| format!("시트 생성 실패: {e}"))?;

    sheet
        .write_with_format(0, 0, format!("Dayflow — {label}"), &title_fmt)
        .map_err(|e| e.to_string())?;

    let headers = [
        ("날짜", 12.0),
        ("요일", 6.0),
        ("시작", 8.0),
        ("종료", 8.0),
        ("소요(분)", 10.0),
        ("제목", 38.0),
        ("상태", 9.0),
        ("우선순위", 10.0),
        ("알림", 12.0),
        ("반복 알림", 18.0),
        ("메모", 40.0),
    ];

    for (i, (name, width)) in headers.iter().enumerate() {
        let col = i as u16;
        sheet
            .write_with_format(2, col, *name, &head_fmt)
            .map_err(|e| e.to_string())?;
        sheet
            .set_column_width(col, *width)
            .map_err(|e| e.to_string())?;
    }

    let now = crate::models::now();
    let mut row: u32 = 3;

    for t in tasks {
        let is_done = t.status == Status::Done;
        let deadline = t.ends_at.or(t.starts_at);
        let is_overdue = !is_done && deadline.map(|d| d < now).unwrap_or(false);

        // 상태에 따라 제목 줄의 색만 바꾼다. 표 전체를 물들이면 오히려 읽기 어렵다.
        let text_fmt = if is_overdue {
            &overdue_fmt
        } else if is_done {
            &done_fmt
        } else {
            &center
        };

        if let Some(start) = t.starts_at {
            if let Some((d, tm, dow)) = to_excel(start) {
                sheet
                    .write_with_format(row, 0, &d, &date_fmt)
                    .map_err(|e| e.to_string())?;
                sheet
                    .write_with_format(row, 1, dow, &center)
                    .map_err(|e| e.to_string())?;
                sheet
                    .write_with_format(row, 2, &tm, &time_fmt)
                    .map_err(|e| e.to_string())?;
            }
        }

        if let Some(end) = t.ends_at {
            if let Some((_, tm, _)) = to_excel(end) {
                sheet
                    .write_with_format(row, 3, &tm, &time_fmt)
                    .map_err(|e| e.to_string())?;
            }
        }

        if let (Some(s), Some(e)) = (t.starts_at, t.ends_at) {
            sheet
                .write_number(row, 4, ((e - s) / 60) as f64)
                .map_err(|err| err.to_string())?;
        }

        sheet
            .write_with_format(row, 5, &t.title, text_fmt)
            .map_err(|e| e.to_string())?;
        sheet
            .write_with_format(row, 6, status_label(t.status), &center)
            .map_err(|e| e.to_string())?;
        sheet
            .write_with_format(row, 7, priority_label(t.priority), &center)
            .map_err(|e| e.to_string())?;

        if t.remind {
            let when = if t.remind_offset_min == 0 {
                "정시".to_string()
            } else {
                format!("{}분 전", t.remind_offset_min)
            };
            sheet
                .write_with_format(row, 8, when, &center)
                .map_err(|e| e.to_string())?;
            sheet
                .write_string(row, 9, repeat_label(t.repeat_interval_min, t.repeat_count))
                .map_err(|e| e.to_string())?;
        }

        sheet
            .write_string(row, 10, t.notes.clone().unwrap_or_default())
            .map_err(|e| e.to_string())?;

        row += 1;
    }

    // 머리글 고정 + 필터. 행이 많아지면 이 둘이 없으면 못 쓴다.
    sheet.set_freeze_panes(3, 0).map_err(|e| e.to_string())?;
    if row > 3 {
        sheet
            .autofilter(2, 0, row - 1, headers.len() as u16 - 1)
            .map_err(|e| e.to_string())?;
    }

    // ---------------------------------------------------------------- 요약 시트
    let sum = wb
        .add_worksheet()
        .set_name("요약")
        .map_err(|e| format!("시트 생성 실패: {e}"))?;

    sum.write_with_format(0, 0, "Dayflow 요약", &title_fmt)
        .map_err(|e| e.to_string())?;
    sum.set_column_width(0, 16.0).map_err(|e| e.to_string())?;
    sum.set_column_width(1, 22.0).map_err(|e| e.to_string())?;

    let done = tasks.iter().filter(|t| t.status == Status::Done).count();
    let progress = tasks
        .iter()
        .filter(|t| t.status == Status::InProgress)
        .count();
    let pending = tasks.iter().filter(|t| t.status == Status::Pending).count();
    let overdue = tasks
        .iter()
        .filter(|t| {
            t.status != Status::Done && t.ends_at.or(t.starts_at).map(|d| d < now).unwrap_or(false)
        })
        .count();

    let rows: [(&str, String); 7] = [
        ("기간", label.to_string()),
        ("전체", tasks.len().to_string()),
        ("대기", pending.to_string()),
        ("진행 중", progress.to_string()),
        ("완료", done.to_string()),
        ("지남", overdue.to_string()),
        (
            "완료율",
            if tasks.is_empty() {
                "-".into()
            } else {
                format!("{:.0}%", done as f64 / tasks.len() as f64 * 100.0)
            },
        ),
    ];

    for (i, (k, v)) in rows.iter().enumerate() {
        let r = i as u32 + 2;
        sum.write_with_format(r, 0, *k, &head_fmt)
            .map_err(|e| e.to_string())?;
        sum.write_string(r, 1, v).map_err(|e| e.to_string())?;
    }

    wb.save(path).map_err(|e| format!("엑셀 저장 실패: {e}"))?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample(title: &str, offset: i64, status: Status) -> Task {
        let now = crate::models::now();
        Task {
            id: title.into(),
            title: title.into(),
            notes: Some("메모 テスト mixed".into()),
            starts_at: Some(now + offset),
            ends_at: Some(now + offset + 3600),
            remind: true,
            remind_offset_min: 10,
            remind_at: Some(now + offset - 600),
            notified_at: None,
            priority: 2,
            status,
            started_at: None,
            completed_at: None,
            created_at: now,
            updated_at: now,
            repeat_interval_min: 10,
            repeat_count: 3,
            notified_count: 1,
        }
    }

    /// xlsx 는 zip 컨테이너다. 서명(PK)이 맞으면 Excel 이 열 수 있는 형식이다.
    #[test]
    fn writes_a_valid_xlsx() {
        let dir = std::env::temp_dir();
        let path = dir.join("dayflow_export_test.xlsx");
        let p = path.to_string_lossy().to_string();

        let tasks = vec![
            sample("지난 일정", -7200, Status::Pending),
            sample("완료한 일정", -3600, Status::Done),
            sample("한글 제목 · 진행 중", 3600, Status::InProgress),
        ];

        write_workbook(&tasks, "2026년 8월", &p).expect("워크북 작성 실패");

        let bytes = std::fs::read(&path).expect("파일 읽기 실패");
        assert!(bytes.len() > 1000, "파일이 너무 작습니다: {}", bytes.len());
        assert_eq!(&bytes[0..4], b"PK", "zip 서명이 아닙니다");

        std::fs::remove_file(&path).ok();
    }

    /// 항목이 없어도 빈 표가 정상적으로 만들어져야 한다.
    #[test]
    fn writes_empty_range() {
        let path = std::env::temp_dir().join("dayflow_export_empty.xlsx");
        let p = path.to_string_lossy().to_string();
        write_workbook(&[], "빈 기간", &p).expect("빈 워크북 작성 실패");
        assert!(std::fs::metadata(&path).unwrap().len() > 0);
        std::fs::remove_file(&path).ok();
    }
}
