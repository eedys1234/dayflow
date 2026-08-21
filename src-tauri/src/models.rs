use serde::{Deserialize, Serialize};

/// 할 일의 진행 상태. 일별 보드 뷰의 세 열에 그대로 대응한다.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Status {
    /// 대기
    Pending,
    /// 진행 중
    InProgress,
    /// 완료
    Done,
}

impl Status {
    pub fn as_str(self) -> &'static str {
        match self {
            Status::Pending => "pending",
            Status::InProgress => "in_progress",
            Status::Done => "done",
        }
    }

    /// DB에 예상치 못한 값이 있어도 앱이 멈추지 않도록 대기로 떨어뜨린다.
    pub fn from_db(s: &str) -> Self {
        match s {
            "in_progress" => Status::InProgress,
            "done" => Status::Done,
            _ => Status::Pending,
        }
    }
}

/// 할 일 한 건.
///
/// 시각은 모두 Unix epoch 초(UTC)로 저장한다. 표시용 변환은 프론트엔드가 담당한다.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    pub id: String,
    pub title: String,
    pub notes: Option<String>,
    /// 시작(예정) 시각
    pub starts_at: Option<i64>,
    /// 종료 시각 (선택). 이 시각이 지나면 화면에서 "지남"으로 표시된다.
    pub ends_at: Option<i64>,
    /// 알림 사용 여부 (등록 화면의 체크박스)
    pub remind: bool,
    /// `starts_at` 기준 몇 분 전에 알릴지
    pub remind_offset_min: i64,
    /// `starts_at - remind_offset_min * 60`. 스케줄러가 이 값만 본다.
    pub remind_at: Option<i64>,
    /// 알림을 실제로 띄운 시각. NULL이면 아직 안 띄웠다는 뜻.
    pub notified_at: Option<i64>,
    pub priority: i64,
    pub status: Status,
    pub started_at: Option<i64>,
    pub completed_at: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
    /// 반복 알림 주기(분). 0 이면 반복하지 않는다.
    pub repeat_interval_min: i64,
    /// 총 알림 횟수. 1 = 한 번만, 0 = 완료할 때까지 무제한.
    pub repeat_count: i64,
    /// 지금까지 실제로 보낸 횟수.
    pub notified_count: i64,
}

/// 신규 등록 입력.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewTask {
    pub title: String,
    #[serde(default)]
    pub notes: Option<String>,
    #[serde(default)]
    pub starts_at: Option<i64>,
    #[serde(default)]
    pub ends_at: Option<i64>,
    #[serde(default)]
    pub remind: bool,
    #[serde(default)]
    pub remind_offset_min: Option<i64>,
    #[serde(default)]
    pub repeat_interval_min: Option<i64>,
    #[serde(default)]
    pub repeat_count: Option<i64>,
    #[serde(default)]
    pub priority: Option<i64>,
}

/// 수정 입력. 전체 필드를 받아 통째로 덮어쓴다.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskUpdate {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub notes: Option<String>,
    #[serde(default)]
    pub starts_at: Option<i64>,
    #[serde(default)]
    pub ends_at: Option<i64>,
    #[serde(default)]
    pub remind: bool,
    #[serde(default)]
    pub remind_offset_min: Option<i64>,
    #[serde(default)]
    pub repeat_interval_min: Option<i64>,
    #[serde(default)]
    pub repeat_count: Option<i64>,
    #[serde(default)]
    pub priority: Option<i64>,
}

/// 알림 창에 전달되는 한 건의 알림.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NotificationPayload {
    /// 알림 인스턴스 고유 id. 프론트에서 중복 제거에 사용한다.
    pub nid: String,
    /// 원본 할 일 id. 완료/스누즈 버튼이 이 값을 쓴다.
    pub task_id: Option<String>,
    pub title: String,
    pub body: Option<String>,
    pub starts_at: Option<i64>,
    pub ends_at: Option<i64>,
    /// "reminder" | "overdue" | "test"
    pub kind: String,
    /// 반복 알림의 몇 번째인지. 반복이 아니면 None.
    pub repeat_seq: Option<i64>,
    /// 총 반복 횟수. 무제한이면 None.
    pub repeat_total: Option<i64>,
}

/// 현재 Unix epoch 초.
pub fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// `remind` / `starts_at` / offset 으로부터 실제 알림 시각을 계산한다.
///
/// 알림을 켰더라도 예정 시각이 없으면 알릴 수 없으므로 None 이 된다.
pub fn compute_remind_at(remind: bool, starts_at: Option<i64>, offset_min: i64) -> Option<i64> {
    if !remind {
        return None;
    }
    starts_at.map(|d| d - offset_min * 60)
}
