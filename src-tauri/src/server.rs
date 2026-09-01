//! 로컬 HTTP API — 모바일(Flutter)·터널(ngrok, Cloudflare) 접근의 토대.
//!
//! 앱 안에 작은 axum 서버를 띄우고, 폰이나 다른 기기는 터널을 통해 여기에
//! 붙는다. 모든 요청은 Bearer 토큰을 요구하며, 변경 사항은 SSE 로 흘려보내
//! 클라이언트가 실시간 알림을 받을 수 있게 한다.
//!
//! 기본은 꺼져 있고 127.0.0.1 에만 바인딩한다. 터널은 같은 PC 에서 돌므로
//! 이것으로 충분하고, 폰이 같은 Wi-Fi 에서 직접 붙는 경우만 LAN 바인딩을 켠다.

use std::convert::Infallible;
use std::sync::Mutex;

use axum::{
    extract::{Path, Request, State},
    http::{header, StatusCode},
    middleware::{self, Next},
    response::{
        sse::{Event, KeepAlive, Sse},
        IntoResponse, Response,
    },
    routing::{get, patch},
    Json, Router,
};
use serde::Deserialize;
use serde_json::json;
use tauri::{AppHandle, Manager};
use tokio::sync::broadcast;
use tokio_stream::wrappers::BroadcastStream;
use tokio_stream::StreamExt;
use uuid::Uuid;

use crate::db::{self, row_to_task, Db, TASK_COLUMNS};
use crate::models::{compute_remind_at, now, Status};

pub const DEFAULT_PORT: u16 = 17800;

/// 변경 사항을 SSE 구독자에게 흘려보내는 버스.
///
/// 송신자만 들고 있으면 된다. 구독자가 없을 때의 send 실패는 정상이다.
pub struct ApiBus(pub broadcast::Sender<String>);

impl Default for ApiBus {
    fn default() -> Self {
        ApiBus(broadcast::channel(64).0)
    }
}

/// 버스에 이벤트 하나를 싣는다. 서버가 꺼져 있어도 호출은 안전하다.
pub fn publish(app: &AppHandle, kind: &str, payload: serde_json::Value) {
    if let Some(bus) = app.try_state::<ApiBus>() {
        let _ = bus
            .0
            .send(json!({ "type": kind, "payload": payload }).to_string());
    }
}

struct Running {
    shutdown: tokio::sync::oneshot::Sender<()>,
    port: u16,
    lan: bool,
}

/// 실행 중인 서버 핸들. 없으면 꺼진 상태다.
#[derive(Default)]
pub struct ApiServer(Mutex<Option<Running>>);

#[derive(Clone)]
struct Ctx {
    app: AppHandle,
    token: String,
}

// ---------------------------------------------------------------------------
// 인증
// ---------------------------------------------------------------------------

/// Bearer 헤더 또는 `?token=` 쿼리로 토큰을 검사한다.
///
/// 쿼리를 허용하는 이유: 브라우저 EventSource 는 헤더를 붙일 수 없어서
/// SSE 만큼은 쿼리 파라미터가 사실상 표준 우회로다.
async fn auth(State(ctx): State<Ctx>, req: Request, next: Next) -> Response {
    let by_header = req
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .map(|t| t == ctx.token)
        .unwrap_or(false);

    let by_query = req
        .uri()
        .query()
        .map(|q| {
            q.split('&')
                .any(|kv| kv.strip_prefix("token=").map(|t| t == ctx.token) == Some(true))
        })
        .unwrap_or(false);

    if by_header || by_query {
        next.run(req).await
    } else {
        (
            StatusCode::UNAUTHORIZED,
            Json(json!({ "error": "invalid token" })),
        )
            .into_response()
    }
}

// ---------------------------------------------------------------------------
// 핸들러
// ---------------------------------------------------------------------------

/// 터널·클라이언트가 연결을 확인하는 용도. 인증 없이 이름과 버전만 돌려준다.
async fn health(State(ctx): State<Ctx>) -> Json<serde_json::Value> {
    Json(json!({
        "app": "dayflow",
        "version": ctx.app.package_info().version.to_string(),
    }))
}

async fn list_tasks(State(ctx): State<Ctx>) -> Response {
    let db = ctx.app.state::<Db>();
    let result = (|| -> Result<Vec<crate::models::Task>, String> {
        let conn = db.0.lock().map_err(|_| "DB 잠금 실패".to_string())?;
        let sql = format!(
            "SELECT {TASK_COLUMNS} FROM tasks WHERE deleted_at IS NULL \
             ORDER BY CASE status WHEN 'done' THEN 1 ELSE 0 END ASC, \
                      CASE WHEN starts_at IS NULL THEN 1 ELSE 0 END ASC, \
                      starts_at ASC, priority DESC, created_at ASC"
        );
        let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
        let rows = stmt.query_map([], row_to_task).map_err(|e| e.to_string())?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
            .map_err(|e| e.to_string())
    })();

    match result {
        Ok(tasks) => Json(tasks).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": e })),
        )
            .into_response(),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct NewTaskBody {
    title: String,
    #[serde(default)]
    notes: Option<String>,
    #[serde(default)]
    starts_at: Option<i64>,
    #[serde(default)]
    ends_at: Option<i64>,
    #[serde(default)]
    remind: bool,
    #[serde(default)]
    remind_offset_min: Option<i64>,
    #[serde(default)]
    priority: Option<i64>,
}

/// 등록. 데스크탑 UI 의 create_task 와 같은 규칙을 따른다.
async fn create_task(State(ctx): State<Ctx>, Json(body): Json<NewTaskBody>) -> Response {
    let title = body.title.trim().to_string();
    if title.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "제목을 입력하세요." })),
        )
            .into_response();
    }
    if body.remind && body.starts_at.is_none() {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "알림을 사용하려면 시작 시각이 필요합니다." })),
        )
            .into_response();
    }
    if let (Some(s), Some(e)) = (body.starts_at, body.ends_at) {
        if e <= s {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": "종료 시각은 시작 시각보다 뒤여야 합니다." })),
            )
                .into_response();
        }
    }

    let db = ctx.app.state::<Db>();
    let offset = body.remind_offset_min.unwrap_or(10).max(0);
    let remind_at = compute_remind_at(body.remind, body.starts_at, offset);
    let ts = now();
    let id = Uuid::new_v4().to_string();

    let result = (|| -> Result<crate::models::Task, String> {
        let conn = db.0.lock().map_err(|_| "DB 잠금 실패".to_string())?;
        conn.execute(
            "INSERT INTO tasks \
             (id, title, notes, starts_at, ends_at, remind, remind_offset_min, remind_at, \
              priority, status, sort_order, created_at, updated_at, \
              repeat_interval_min, repeat_count, notified_count) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'pending', 0, ?10, ?10, 0, 1, 0)",
            rusqlite::params![
                id,
                title,
                body.notes.as_deref().filter(|s| !s.trim().is_empty()),
                body.starts_at,
                body.ends_at,
                body.remind as i64,
                offset,
                remind_at,
                body.priority.unwrap_or(0),
                ts,
            ],
        )
        .map_err(|e| e.to_string())?;

        let sql = format!("SELECT {TASK_COLUMNS} FROM tasks WHERE id = ?1");
        conn.query_row(&sql, [&id], row_to_task)
            .map_err(|e| e.to_string())
    })();

    match result {
        Ok(task) => {
            // 데스크탑 UI·트레이·위젯·다른 SSE 구독자에게 모두 알린다.
            crate::tray::broadcast(&ctx.app);
            (StatusCode::CREATED, Json(task)).into_response()
        }
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": e })),
        )
            .into_response(),
    }
}

#[derive(Deserialize)]
struct StatusBody {
    status: Status,
}

async fn set_status(
    State(ctx): State<Ctx>,
    Path(id): Path<String>,
    Json(body): Json<StatusBody>,
) -> Response {
    let db = ctx.app.state::<Db>();
    let ts = now();

    let result = (|| -> Result<crate::models::Task, String> {
        let conn = db.0.lock().map_err(|_| "DB 잠금 실패".to_string())?;

        let prev_started: Option<i64> = conn
            .query_row(
                "SELECT started_at FROM tasks WHERE id = ?1 AND deleted_at IS NULL",
                [&id],
                |r| r.get(0),
            )
            .map_err(|_| "할 일을 찾지 못했습니다.".to_string())?;

        // 데스크탑 set_task_status 와 같은 규칙.
        let started_at = match body.status {
            Status::InProgress => prev_started.or(Some(ts)),
            Status::Pending => None,
            Status::Done => prev_started,
        };
        let completed_at = if body.status == Status::Done {
            Some(ts)
        } else {
            None
        };

        conn.execute(
            "UPDATE tasks SET status = ?2, started_at = ?3, completed_at = ?4, updated_at = ?5 \
             WHERE id = ?1 AND deleted_at IS NULL",
            rusqlite::params![id, body.status.as_str(), started_at, completed_at, ts],
        )
        .map_err(|e| e.to_string())?;

        let sql = format!("SELECT {TASK_COLUMNS} FROM tasks WHERE id = ?1 AND deleted_at IS NULL");
        conn.query_row(&sql, [&id], row_to_task)
            .map_err(|e| e.to_string())
    })();

    match result {
        Ok(task) => {
            crate::tray::broadcast(&ctx.app);
            Json(task).into_response()
        }
        Err(e) => (StatusCode::NOT_FOUND, Json(json!({ "error": e }))).into_response(),
    }
}

/// SSE — 할 일 변경과 알림이 실시간으로 흐른다.
///
/// 클라이언트(Flutter/웹)는 이 스트림을 유지하다가 `notification` 이벤트를
/// 받으면 로컬 알림을 띄우면 된다. "앱이 켜져 있는 동안의 백그라운드 노티"는
/// 이 연결 하나로 해결된다.
async fn events(
    State(ctx): State<Ctx>,
) -> Sse<impl tokio_stream::Stream<Item = Result<Event, Infallible>>> {
    let rx = ctx.app.state::<ApiBus>().0.subscribe();
    let stream = BroadcastStream::new(rx)
        .filter_map(|m| m.ok())
        .map(|m| Ok(Event::default().data(m)));

    Sse::new(stream).keep_alive(KeepAlive::default())
}

// ---------------------------------------------------------------------------
// 서버 수명
// ---------------------------------------------------------------------------

fn ensure_token(app: &AppHandle) -> Result<String, String> {
    let db = app.state::<Db>();
    let conn = db.0.lock().map_err(|_| "DB 잠금 실패".to_string())?;

    if let Some(t) = db::setting(&conn, "apiToken") {
        if !t.is_empty() {
            return Ok(t);
        }
    }
    // 하이픈 없는 32자 16진수. 복사하기 쉽고 URL 에 넣어도 안전하다.
    let token = Uuid::new_v4().simple().to_string();
    db::put_setting(&conn, "apiToken", &token).map_err(|e| e.to_string())?;
    Ok(token)
}

pub fn is_running(app: &AppHandle) -> Option<(u16, bool)> {
    app.try_state::<ApiServer>().and_then(|s| {
        s.0.lock()
            .ok()
            .and_then(|g| g.as_ref().map(|r| (r.port, r.lan)))
    })
}

pub fn start(app: &AppHandle) -> Result<(), String> {
    // 이미 떠 있으면 그대로 둔다.
    if is_running(app).is_some() {
        return Ok(());
    }

    let (port, lan) = {
        let db = app.state::<Db>();
        let conn = db.0.lock().map_err(|_| "DB 잠금 실패".to_string())?;
        (
            db::setting_i64(&conn, "apiPort", DEFAULT_PORT as i64) as u16,
            db::setting_bool(&conn, "apiLan", false),
        )
    };
    let token = ensure_token(app)?;

    let ctx = Ctx {
        app: app.clone(),
        token,
    };

    let protected = Router::new()
        .route("/api/tasks", get(list_tasks).post(create_task))
        .route("/api/tasks/{id}/status", patch(set_status))
        .route("/api/events", get(events))
        .layer(middleware::from_fn_with_state(ctx.clone(), auth));

    let router: Router = Router::new()
        .route("/health", get(health))
        .merge(protected)
        .with_state(ctx);

    // 기본은 루프백. 터널(ngrok 등)은 같은 PC 에서 접속하므로 이걸로 충분하고,
    // 폰이 같은 Wi-Fi 에서 직접 붙을 때만 LAN 바인딩을 켠다.
    let host = if lan { "0.0.0.0" } else { "127.0.0.1" };
    let addr = format!("{host}:{port}");

    let (tx, rx) = tokio::sync::oneshot::channel::<()>();
    let (ready_tx, ready_rx) = std::sync::mpsc::channel::<Result<(), String>>();

    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        let listener = match tokio::net::TcpListener::bind(&addr).await {
            Ok(l) => {
                let _ = ready_tx.send(Ok(()));
                l
            }
            Err(e) => {
                let _ = ready_tx.send(Err(format!("{addr} 바인딩 실패: {e}")));
                return;
            }
        };

        eprintln!("[api] listening on {addr}");
        let server = axum::serve(listener, router).with_graceful_shutdown(async {
            let _ = rx.await;
        });
        if let Err(e) = server.await {
            eprintln!("[api] 서버 종료: {e}");
        }
        // 어떤 이유로든 내려가면 핸들을 비워 상태가 실제와 어긋나지 않게 한다.
        if let Some(s) = handle.try_state::<ApiServer>() {
            if let Ok(mut g) = s.0.lock() {
                *g = None;
            }
        }
        eprintln!("[api] stopped");
    });

    // 포트 선점 같은 바인딩 실패를 호출자에게 즉시 알린다.
    ready_rx
        .recv_timeout(std::time::Duration::from_secs(5))
        .map_err(|_| "서버 시작 확인 시간 초과".to_string())??;

    let state = app.state::<ApiServer>();
    let mut guard = state
        .0
        .lock()
        .map_err(|_| "서버 상태 잠금 실패".to_string())?;
    *guard = Some(Running {
        shutdown: tx,
        port,
        lan,
    });

    Ok(())
}

pub fn stop(app: &AppHandle) {
    if let Some(state) = app.try_state::<ApiServer>() {
        if let Ok(mut guard) = state.0.lock() {
            if let Some(running) = guard.take() {
                let _ = running.shutdown.send(());
            }
        }
    }
}

// ---------------------------------------------------------------------------
// 커맨드 (설정 화면용)
// ---------------------------------------------------------------------------

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiInfo {
    pub enabled: bool,
    pub running: bool,
    pub port: u16,
    pub lan: bool,
    pub token: String,
}

fn info(app: &AppHandle) -> Result<ApiInfo, String> {
    let (enabled, port, lan) = {
        let db = app.state::<Db>();
        let conn = db.0.lock().map_err(|_| "DB 잠금 실패".to_string())?;
        (
            db::setting_bool(&conn, "apiEnabled", false),
            db::setting_i64(&conn, "apiPort", DEFAULT_PORT as i64) as u16,
            db::setting_bool(&conn, "apiLan", false),
        )
    };
    let token = ensure_token(app)?;
    Ok(ApiInfo {
        enabled,
        running: is_running(app).is_some(),
        port,
        lan,
        token,
    })
}

#[tauri::command]
pub fn api_info(app: AppHandle) -> Result<ApiInfo, String> {
    info(&app)
}

#[tauri::command]
pub fn set_api_enabled(app: AppHandle, enabled: bool) -> Result<ApiInfo, String> {
    {
        let db = app.state::<Db>();
        let conn = db.0.lock().map_err(|_| "DB 잠금 실패".to_string())?;
        db::put_setting(&conn, "apiEnabled", if enabled { "true" } else { "false" })
            .map_err(|e| e.to_string())?;
    }

    if enabled {
        start(&app)?;
    } else {
        stop(&app);
    }
    info(&app)
}

#[tauri::command]
pub fn set_api_lan(app: AppHandle, lan: bool) -> Result<ApiInfo, String> {
    let was_running = is_running(&app).is_some();
    {
        let db = app.state::<Db>();
        let conn = db.0.lock().map_err(|_| "DB 잠금 실패".to_string())?;
        db::put_setting(&conn, "apiLan", if lan { "true" } else { "false" })
            .map_err(|e| e.to_string())?;
    }
    // 바인딩 주소가 바뀌므로 재시작해야 반영된다.
    if was_running {
        stop(&app);
        start(&app)?;
    }
    info(&app)
}

/// 토큰이 새면 이것 하나로 접근을 끊는다. 기존 클라이언트는 전부 재인증해야 한다.
#[tauri::command]
pub fn regenerate_api_token(app: AppHandle) -> Result<ApiInfo, String> {
    let was_running = is_running(&app).is_some();
    {
        let db = app.state::<Db>();
        let conn = db.0.lock().map_err(|_| "DB 잠금 실패".to_string())?;
        let token = Uuid::new_v4().simple().to_string();
        db::put_setting(&conn, "apiToken", &token).map_err(|e| e.to_string())?;
    }
    // 서버는 시작 시점의 토큰을 캐시하므로 재시작으로 갈아끼운다.
    if was_running {
        stop(&app);
        start(&app)?;
    }
    info(&app)
}
