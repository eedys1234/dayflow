# 스케줄 관리 데스크탑 앱 — 기능 제안서

> **스택**: Rust (코어/백엔드) + Tauri v2 (셸) + 웹 프론트엔드
> **타깃**: Windows / macOS / Linux 데스크탑
> **작성일**: 2026-08-20

---

## 1. 제품 컨셉 정의 (먼저 결정할 것)

기능 목록보다 "어떤 앱인가"를 먼저 좁혀야 스코프가 폭발하지 않습니다. 세 방향 중 하나를 고르시길 권합니다.

| 방향 | 설명 | 차별점 |
|---|---|---|
| **A. 로컬 우선 개인 캘린더** | 클라우드 없이 내 PC에서 빠르게 도는 캘린더. ICS/CalDAV로만 외부 연동 | 프라이버시 + 즉각적인 속도. Rust/Tauri의 강점과 가장 잘 맞음 |
| **B. 캘린더 + 할 일 통합 (타임블로킹)** | 할 일을 캘린더에 드래그해 시간을 배정. Sunsama/Motion 류 | "계획 → 실행" 워크플로우. 개인 생산성 앱으로 차별화가 쉬움 |
| **C. 멀티 계정 애그리게이터** | Google/Outlook/CalDAV 일정을 한 화면에 통합 | 연동 난이도와 유지보수 비용이 가장 높음 |

**추천: A로 시작해 B로 확장.** 아래 로드맵은 이 가정을 따릅니다.

> ⚠️ **단, "다른 계정에 캘린더 공유" 요구사항은 이 판단을 바꿉니다.**
> 공유는 본질적으로 서버가 필요한 기능이라 로컬 전용 앱으로는 구현할 수 없습니다.
> 자세한 선택지는 [3.10 캘린더 공유](#310-캘린더-공유--아키텍처-결정-필요)를 참고하세요.

### 타임블로킹(Time Blocking)이란

할 일 목록을 "언제 할지" 캘린더에 직접 배치하는 방식입니다.

```
[일반 할 일 목록]              [타임블로킹]
□ 보고서 작성                  09:00-11:00  보고서 작성
□ 이메일 정리          →       11:00-11:30  이메일 정리
□ 코드 리뷰                    14:00-15:00  코드 리뷰
(언제 할지는 미정)             (시간이 확보된 상태)
```

할 일에 실제 시간을 배정하기 때문에 하루에 담을 수 있는 양이 눈에 보이고, 과도한 계획을 미리 걸러낼 수 있습니다. UI 상으로는 **사이드바의 할 일을 캘린더로 드래그하면 그 시간대의 일정이 되는** 형태가 일반적입니다 (Google Calendar의 "작업", Sunsama, Motion 등).

---

## 2. 기능 우선순위 요약

✅ = 사용자 확정 요구사항 · 🟢 = 구현 완료

| 단계 | 목표 | 포함 기능 |
|---|---|---|
| **MVP (v0.1)** | 혼자 쓸 수 있는 최소 캘린더 | 🟢 할 일 CRUD, 🟢 일/주/월 뷰, 🟢 상태 보드, 🟢 로컬 저장, 🟢 우측 하단 알림, 🟢 다크모드, 일정(Event) CRUD, 트레이 상주 |
| **v0.5** | 매일 쓸 만한 앱 | 반복 일정, 태그/캘린더 분류, 검색, 빠른 입력, 전역 단축키 |
| **v1.0** | 배포 가능한 제품 | ✅ 캘린더 공유, ICS 가져오기/내보내기, 백업/복구, 자동 업데이트, 다국어 |
| **v1.5+** | 확장 | 타임블로킹, 실시간 협업, 통계 대시보드, 미니 위젯 창 |

---

## 3. 핵심 기능 상세

### 3.1 일정(Event) 관리 — MVP

- 생성 / 조회 / 수정 / 삭제 / 복제
- 필드: 제목, 설명(마크다운), 시작·종료 시각, 종일 여부, 장소, 색상, 태그, 참석자(텍스트), URL
- **드래그 앤 드롭**: 캘린더에서 일정 이동, 가장자리 드래그로 시간 늘리기
- **되돌리기(Undo/Redo)**: 실수로 지운 일정 복구. 스택 기반으로 Rust 쪽에 구현
- **휴지통**: soft delete 후 30일 보관 (`deleted_at` 컬럼)
- 겹치는 일정의 시각적 표시 및 충돌 경고

### 3.2 뷰(View) — MVP ✅ 확정 · 🟢 구현 완료

**일별 / 주별 / 월별** 3종이 필수 요구사항입니다. 각각의 요건이 꽤 다르므로 분리해 정리합니다.

| 뷰 | 레이아웃 | 구현 난이도 | 핵심 과제 |
|---|---|---|---|
| **일별(Day)** | 세로 시간축 1일, 24시간 그리드 | 낮음 | 현재 시각 표시선, 종일 일정 상단 고정 |
| **주별(Week)** | 세로 시간축 × 가로 7일 | **높음** | 겹치는 일정의 열 분할 배치 알고리즘 |
| **월별(Month)** | 7×5~6 날짜 그리드 | 중간 | 칸 넘침 시 "+3개 더" 처리, 여러 날 걸친 일정의 가로 바 |

- **아젠다(목록) 뷰** — 구현 비용이 거의 없고 검색 결과 표시에 재사용되므로 함께 넣기를 권합니다
- 공통: 미니 캘린더 사이드바, 오늘로 이동, 캘린더별 표시/숨김 토글
- 키보드 내비게이션 (`T`=오늘, `←/→`=이전/다음, `D/W/M`=뷰 전환)
- 다중 주(2주/4주) 뷰, 연간 히트맵 뷰 *(v1.5)*

> 주별 뷰의 **겹침 레이아웃**이 캘린더 UI에서 가장 까다로운 부분입니다.
> 이 하나 때문에 라이브러리(`@schedule-x/calendar` 등)를 쓸 가치가 있습니다.

### 3.3 반복 일정 — v0.5

- **iCalendar RRULE 표준 준수** (매일/매주/매월/매년, 간격, 요일 지정, 횟수·종료일 제한)
- 예외 처리: "이 일정만 수정", "이후 모든 일정 수정", "전체 수정" 3가지 모드
- 특정 회차 건너뛰기 (EXDATE)
- 주의: 가장 버그가 잦은 영역입니다. 반복 규칙은 저장 시 전개(expand)하지 말고 **조회 구간에서만 계산**하세요. Rust `rrule` 크레이트 권장.

### 3.4 알림 / 리마인더 — MVP 🟢 구현 완료

> 구현 방식과 동작 흐름은 [README.md](README.md#알림-동작-방식) 참고.
> OS 기본 알림 대신 **투명한 별도 창을 우측 하단에 띄우는 방식**을 택했습니다.
> 위치·모양·버튼을 직접 제어할 수 있고, OS별 알림 정책(방해 금지, 알림 센터 흡수)에
> 좌우되지 않기 때문입니다.


- 일정 전 N분/시간/일 알림 (일정당 복수 알림 설정)
- OS 네이티브 알림 (`tauri-plugin-notification`)
- 스누즈 (5분 / 10분 / 1시간 뒤 다시 알림)
- 알림 소리 on/off, 방해 금지 시간대
- **앱이 닫혀 있을 때의 알림**: 트레이 상주(백그라운드 유지)를 전제로 설계하는 게 현실적입니다. 완전 종료 상태의 알림은 OS 스케줄러 등록(Windows Task Scheduler / launchd)이 필요해 v1.5 이후를 권합니다.

### 3.5 빠른 입력 (Quick Add) — v0.5

- 자연어 파싱: `"내일 오후 3시 팀 회의 2시간"` → 구조화된 일정
  - 한국어는 규칙 기반으로 직접 구현이 필요할 수 있습니다 (영어는 `chrono-english` 등 참고)
- 전역 단축키(`Ctrl+Shift+Space`)로 어느 앱에서든 팝업 입력창 호출 → **데스크탑 앱의 핵심 차별점**
- 클립보드에서 일정 텍스트 붙여넣기 감지

### 3.6 분류 / 검색 — v0.5

- 여러 개의 캘린더(업무/개인/가족)와 색상 지정
- 태그(다대다) 및 태그별 필터
- 전체 텍스트 검색 — **SQLite FTS5** 사용, 제목·설명·장소 대상
- 필터 저장 (스마트 뷰: "이번 주 업무 일정만")

### 3.7 할 일(Task) 관리 — MVP ✅ 확정 · 🟢 구현 완료

**등록 / 수정 / 삭제**가 필수 요구사항입니다.
아래 중 정렬·필터·하위 작업·일괄 작업은 아직 미구현입니다.

**기본 CRUD**
- 등록: 제목(필수) + 마감일, 우선순위, 메모, 소속 캘린더/태그 (선택)
- 수정: 인라인 편집(제목·체크박스)과 상세 패널 편집 두 경로 모두 제공
- 삭제: soft delete + Undo 토스트("실행 취소") → 30일 후 완전 삭제
- 완료 처리: 체크박스 토글, `completed_at` 기록 (완료 이력 통계에 활용)

**목록 기능**
- 정렬: 마감일순 / 우선순위순 / 수동(드래그) 순서
- 필터: 오늘 / 이번 주 / 기한 지남 / 완료됨 / 태그별
- 하위 작업(subtask) — 1단계 중첩까지만 권장 (무한 중첩은 UI가 복잡해짐)
- 일괄 작업: 다중 선택 후 완료/삭제/마감일 변경

**캘린더와의 연결**
- 마감일이 있는 할 일은 해당 날짜 칸 상단 밴드에 표시 (일정과 시각적으로 구분)
- 미완료 할 일 자동 이월(rollover) — 옵션으로 on/off
- **타임블로킹**: 사이드바의 할 일을 캘린더로 드래그하면 그 시간의 일정으로 배정 *(v1.5)*
  → `tasks.event_id` 로 연결하며, 일정 시간을 옮기면 할 일 배정 시간도 함께 이동

### 3.8 데이터 이동 / 백업 — v1.0

- **ICS(iCalendar) 가져오기/내보내기** — 락인 방지, 사용자 신뢰의 핵심
- JSON / CSV 내보내기
- 자동 로컬 백업 (일 1회, 최근 N개 보관) + 수동 복구
- DB 파일 위치 변경 가능 (Dropbox/OneDrive 폴더에 두면 저비용 동기화)

### 3.9 외부 동기화 — v1.5+

- **ICS URL 구독(읽기 전용)** — 공휴일 캘린더 등. 구현이 가장 쉬우면서 체감 효용이 큼 ← 여기부터 시작
- **CalDAV** — 표준이라 Apple/Fastmail/Nextcloud를 한 번에 커버
- Google Calendar (OAuth 2.0 + PKCE, 토큰은 OS 키체인에 저장)
- Outlook / Microsoft 365
- 충돌 해결 정책 (최신 우선 / 수동 선택)

### 3.10 캘린더 공유 — 아키텍처 결정 필요 ✅ 확정 요구사항

"작성한 캘린더를 다른 계정에 공유"는 **이 프로젝트에서 가장 비용이 큰 요구사항**입니다.
데스크탑 앱끼리는 서로를 직접 볼 수 없으므로, 중간에 **무언가 서버 역할을 하는 것**이 반드시 필요합니다.
문제는 "그 서버를 직접 만들 것인가, 남의 것을 빌릴 것인가"입니다.

#### 선택지 비교

| | 방식 | 공유 수준 | 계정 시스템 | 서버 운영 | 구현 기간(추정) |
|---|---|---|---|---|---|
| **1** | **ICS 파일/URL 내보내기** | 단방향 읽기 전용 | 불필요 | 정적 호스팅만 | 3~5일 |
| **2** | **Google Calendar를 저장소로 사용** | 양방향, 권한 관리까지 | Google 계정 | **불필요** | 2~3주 |
| **3** | **CalDAV 서버 연동** | 양방향 | 기존 CalDAV 계정 | 불필요(사용자 서버) | 3~4주 |
| **4** | **자체 백엔드 구축** | 완전 제어 | **직접 구현** | **직접 운영** | 2~3개월+ |

#### 방식 2 (Google Calendar 백엔드) — 권장

> 앱은 **뷰어이자 에디터**이고, 데이터의 소유·공유·권한은 Google이 담당합니다.

- 사용자가 Google 계정을 연결(OAuth) → 앱이 그 계정의 캘린더를 읽고 씀
- "이 캘린더를 `someone@gmail.com` 에게 공유" 는 Google Calendar API의 **ACL(Access Control List)** 호출 한 번
  - 권한 등급: `reader`(보기) / `writer`(편집) / `owner`(관리)
- 상대방은 우리 앱을 설치하지 않아도 자기 Google 캘린더에서 바로 봅니다 → **네트워크 효과**
- 계정 시스템, 비밀번호 재설정, 초대 메일, 서버 비용, 개인정보 보관 책임이 **전부 사라집니다**

**대가로 감수할 것**
- 오프라인 우선 설계가 복잡해짐 (로컬 캐시 + 동기화 큐 + 충돌 해결 필요)
- Google API 할당량과 정책에 종속
- 앱 배포 시 Google OAuth 심사 필요 (민감 스코프인 캘린더는 검토 대상)
- Google 계정이 없는 사용자는 공유 기능을 쓸 수 없음

#### 방식 4 (자체 백엔드) — 필요한 것들

독자적인 공유를 원한다면 최소한 이만큼이 필요합니다. **앱 개발과 맞먹는 별도 프로젝트로 보셔야 합니다.**

- 서버: Axum 또는 Actix-web (Rust 유지) + PostgreSQL
- 계정: 회원가입/로그인, 이메일 인증, 비밀번호 재설정, 세션·토큰 관리
- 공유: 초대 메일 발송, 초대 수락 플로우, 권한(읽기/쓰기/관리) 모델
- 동기화: 변경 추적(delta sync), 충돌 해결, 오프라인 큐, 실시간 반영(WebSocket)
- 운영: 호스팅, 백업, 모니터링, 개인정보 처리방침, 데이터 삭제 요청 대응

```sql
-- 자체 백엔드를 택할 경우 추가로 필요한 테이블
CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  display_name  TEXT NOT NULL,
  created_at    INTEGER NOT NULL
);

CREATE TABLE calendar_shares (
  calendar_id  TEXT NOT NULL REFERENCES calendars(id) ON DELETE CASCADE,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role         TEXT NOT NULL,          -- reader | writer | owner
  invited_at   INTEGER NOT NULL,
  accepted_at  INTEGER,                -- NULL = 초대 대기중
  PRIMARY KEY (calendar_id, user_id)
);

-- 동기화용 변경 로그
CREATE TABLE change_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  entity      TEXT NOT NULL,           -- event | task | calendar
  entity_id   TEXT NOT NULL,
  op          TEXT NOT NULL,           -- create | update | delete
  payload     TEXT,                    -- JSON
  changed_at  INTEGER NOT NULL,
  synced_at   INTEGER                  -- NULL = 서버 미반영
);
```

#### 권장 진행 순서

1. **MVP는 공유 없이 로컬로 완성** — 캘린더 코어(뷰·CRUD·반복 일정)가 먼저 안정돼야 합니다
2. **v0.5에 ICS 내보내기 추가** — 며칠이면 "읽기 전용 공유" 요구를 절반은 충족합니다
3. **v1.0에 Google Calendar 연동** — 여기서 진짜 양방향 공유가 열립니다
4. 자체 백엔드는 사용자가 실제로 늘어난 뒤 검토

단, **공유를 결국 할 예정이라면 지금 지켜야 할 설계 원칙**이 있습니다.

- ID는 UUID (서버 자동증가 ID와 충돌 방지)
- 모든 테이블에 `updated_at`, `deleted_at` (soft delete) 유지 — 동기화의 전제 조건
- `events` 테이블에 `external_id`, `etag`, `sync_status` 컬럼을 **미리** 넣어두기
- 삭제는 물리 삭제 금지 (tombstone 없이는 "삭제됨"을 전파할 수 없음)

---

## 4. 데스크탑 네이티브 강점 기능

웹 캘린더 대비 우위를 만드는 부분입니다. **여기에 투자하세요.**

- **시스템 트레이 상주**: 아이콘 클릭 시 오늘 일정 팝오버, 우클릭 메뉴
- **전역 단축키**: 빠른 입력, 앱 토글 (`tauri-plugin-global-shortcut`)
- **부팅 시 자동 시작** (`tauri-plugin-autostart`)
- **완전 오프라인 동작** — 네트워크 없이 100% 기능
- **항상 위에 뜨는 미니 위젯 창**: 오늘 일정만 표시하는 작고 투명한 창
- **창 닫기 = 트레이로 최소화** (설정으로 변경 가능)
- **딥링크**: `myapp://event/{id}` 로 외부에서 특정 일정 열기 (`tauri-plugin-deep-link`)
- **자동 업데이트** (`tauri-plugin-updater`) — GitHub Releases를 바라보는 방식.
  워크플로와 설정 전문은 **[RELEASE.md](RELEASE.md)** 참고 ✅ 확정
- 다중 모니터에서 창 위치·크기 기억
- OS 다크모드 자동 연동

---

## 5. 기술 스택 제안

### Rust 크레이트

| 용도 | 크레이트 | 비고 |
|---|---|---|
| DB | `sqlx` (SQLite) 또는 `rusqlite` | `sqlx`는 컴파일 타임 쿼리 검증 + 마이그레이션 내장 |
| 날짜/시간 | `chrono` + `chrono-tz` | **UTC 저장, 표시 시 변환** 원칙 |
| 반복 규칙 | `rrule` | RFC 5545 RRULE 처리 |
| ICS 파싱 | `icalendar` | 가져오기/내보내기 |
| 직렬화 | `serde`, `serde_json` | Tauri IPC 경계 |
| 에러 | `thiserror` (라이브러리) / `anyhow` (앱) | |
| 로깅 | `tracing` + `tracing-subscriber` | 파일 로테이션 포함 |
| 비동기 | `tokio` | Tauri v2 기본 |
| 키체인 | `keyring` | OAuth 토큰 보관 |

### Tauri 플러그인

`notification`, `global-shortcut`, `autostart`, `updater`, `dialog`, `fs`, `store`(설정), `single-instance`, `deep-link`, `log`, `opener`

### 프론트엔드

- **프레임워크**: React + TypeScript (생태계 최대) 또는 Svelte (번들 최소, Tauri와 궁합 좋음)
- **캘린더 UI**
  - `@schedule-x/calendar` — MIT, 가벼움 ← **추천**
  - FullCalendar — 기능은 완비돼 있으나 상용 라이선스 확인 필요
  - 직접 구현 — 통제력은 최대, 다만 주/일 뷰의 겹침 레이아웃 계산이 만만치 않음
- 상태 관리: TanStack Query (Rust 커맨드를 비동기 소스로 취급) + Zustand
- 스타일: Tailwind CSS

### 아키텍처 원칙

- **비즈니스 로직은 전부 Rust에.** 프론트는 렌더링과 입력만 담당 → 테스트 가능성·성능 확보
- Tauri command는 얇은 API 레이어로 유지하고, 도메인 로직은 별도 crate로 분리 (`core/` + `src-tauri/`)
- 일정 변경 시 Rust → 프론트로 이벤트 emit (`app.emit("events:changed", ...)`)

---

## 6. 데이터 모델 초안

```sql
-- 캘린더(그룹)
CREATE TABLE calendars (
  id          TEXT PRIMARY KEY,               -- UUID
  name        TEXT NOT NULL,
  color       TEXT NOT NULL,                  -- #RRGGBB
  is_visible  INTEGER NOT NULL DEFAULT 1,
  source      TEXT NOT NULL DEFAULT 'local',  -- local | caldav | google | ics_url
  sort_order  INTEGER NOT NULL DEFAULT 0
);

-- 일정
CREATE TABLE events (
  id            TEXT PRIMARY KEY,
  calendar_id   TEXT NOT NULL REFERENCES calendars(id) ON DELETE CASCADE,
  title         TEXT NOT NULL,
  description   TEXT,
  location      TEXT,
  starts_at     INTEGER NOT NULL,        -- Unix epoch (UTC)
  ends_at       INTEGER NOT NULL,
  timezone      TEXT NOT NULL,           -- IANA, 예: Asia/Seoul
  is_all_day    INTEGER NOT NULL DEFAULT 0,
  rrule         TEXT,                    -- RFC 5545 RRULE 문자열
  recurrence_id TEXT,                    -- 반복 예외인 경우 원본 이벤트 id
  color         TEXT,
  -- 동기화/공유 대비 (지금은 비워두더라도 컬럼은 미리 확보)
  external_id   TEXT,                    -- Google/CalDAV 쪽 원본 id
  etag          TEXT,                    -- 서버 버전 (충돌 감지용)
  sync_status   TEXT NOT NULL DEFAULT 'local',  -- local | synced | pending | conflict
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  deleted_at    INTEGER                  -- soft delete (tombstone)
);
CREATE INDEX idx_events_range ON events(starts_at, ends_at);
CREATE INDEX idx_events_sync  ON events(sync_status) WHERE sync_status != 'synced';

-- 반복 예외 (건너뛴 회차)
CREATE TABLE event_exceptions (
  event_id      TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  occurrence_at INTEGER NOT NULL,
  PRIMARY KEY (event_id, occurrence_at)
);

-- 알림
CREATE TABLE reminders (
  id         TEXT PRIMARY KEY,
  event_id   TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  offset_min INTEGER NOT NULL,           -- 시작 기준 분 (음수 = 이전)
  fired_at   INTEGER
);

-- 할 일
CREATE TABLE tasks (
  id           TEXT PRIMARY KEY,
  calendar_id  TEXT REFERENCES calendars(id) ON DELETE SET NULL,
  title        TEXT NOT NULL,
  notes        TEXT,
  due_at       INTEGER,
  priority     INTEGER NOT NULL DEFAULT 0,   -- 0=없음 1=낮음 2=보통 3=높음
  is_done      INTEGER NOT NULL DEFAULT 0,
  completed_at INTEGER,
  sort_order   INTEGER NOT NULL DEFAULT 0,   -- 수동 정렬용
  parent_id    TEXT REFERENCES tasks(id) ON DELETE CASCADE,
  event_id     TEXT REFERENCES events(id) ON DELETE SET NULL,  -- 타임블로킹 연결
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  deleted_at   INTEGER
);
CREATE INDEX idx_tasks_due ON tasks(due_at) WHERE deleted_at IS NULL;

-- 태그
CREATE TABLE tags (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, color TEXT);
CREATE TABLE event_tags (
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  tag_id   TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (event_id, tag_id)
);

-- 전문 검색
CREATE VIRTUAL TABLE events_fts USING fts5(
  title, description, location, content='events', content_rowid='rowid'
);
```

**핵심 원칙**

1. 시각은 **UTC epoch로 저장**하고 IANA 타임존 문자열을 함께 보관 → 표시할 때만 변환
2. 종일 일정은 시각이 아니라 **날짜**의 문제 — 타임존 변환을 적용하지 말 것 (흔한 버그)
3. 반복 일정은 원본 1행 + 예외만 저장. 전개는 조회 시점에 메모리에서
4. ID는 UUID 문자열 — 향후 동기화 시 서버 자동증가 ID와의 충돌 회피

---

## 7. 비기능 요구사항

| 항목 | 목표 |
|---|---|
| **성능** | 콜드 스타트 1초 이내, 뷰 전환 16ms 이내, 일정 1만 건에서도 월 뷰 즉시 렌더 |
| **번들 크기** | 설치본 15MB 이하 (Tauri의 강점 — 유지할 것) |
| **메모리** | 트레이 상주 시 100MB 이하 |
| **보안** | Tauri CSP 엄격 설정, `fs` 스코프 최소화, 토큰 평문 저장 금지(키체인 사용) |
| **데이터 안전** | 마이그레이션 전 자동 백업, WAL 모드, 시작 시 무결성 체크 |
| **국제화** | 한국어/영어. 주 시작 요일, 12/24시간제, 날짜 형식 설정 |
| **접근성** | 키보드만으로 전체 조작, 스크린리더 대응, 고대비 테마 |
| **로깅** | 로컬 파일 로그 + "로그 폴더 열기" 메뉴 (원격 전송 없음) |

---

## 8. 단계별 로드맵

### Phase 0 — 배포 파이프라인 (2~3일) ✅ 확정 요구사항
GitHub 저장소 생성 · 서명 키 발급 및 Secrets 등록 · `release.yml` 워크플로 · **v0.0.1 더미 릴리스로 업데이트 왕복 검증** · CI(clippy/test) 구성
→ 상세: **[RELEASE.md](RELEASE.md)**

> 배포 파이프라인은 **맨 처음에 만드는 것을 강력히 권합니다.**
> 기능이 쌓인 뒤에 붙이면 빌드 실패 원인을 찾기 어렵고, 서명 키 설정을 잘못한 채로
> 첫 배포를 하면 이후 사용자에게 업데이트를 보낼 수 없습니다.

### Phase 1 — 뼈대 (1~2주)
Tauri v2 프로젝트 셋업 · SQLite 연결 및 마이그레이션 · 일정 CRUD 커맨드 · **월별 뷰** 렌더링 · 일정 생성/수정 모달

### Phase 2 — 3종 뷰 + 할 일 (2~3주) ✅ 확정 요구사항 구간
**일별 / 주별 뷰** (겹침 레이아웃 포함) · 아젠다 뷰 · 드래그 앤 드롭 · **할 일 CRUD + 목록 UI** · 캘린더 그룹과 색상

### Phase 3 — 실사용 가능 (2~3주)
알림 + 트레이 상주 · 설정 화면 · 다크모드 · 반복 일정(RRULE) · 검색(FTS5) · Undo/Redo · 키보드 단축키 전반

### Phase 4 — 공유 1단계 (1주)
ICS 가져오기/내보내기 · ICS URL 게시(읽기 전용 공유) · 백업/복구

### Phase 5 — 공유 2단계 (3~4주) ✅ 확정 요구사항
**Google Calendar 연동** — OAuth 인증 · 캘린더 목록 동기화 · 양방향 이벤트 동기화 · **ACL 기반 계정 공유 UI** · 충돌 해결

### Phase 6 — 배포 다듬기 (2주)
코드 서명(Windows / macOS 공증) · 앱 내 업데이트 UI 및 설정 · 온보딩 · 다국어 · 빠른 입력 + 전역 단축키

### Phase 7 — 확장
타임블로킹 · CalDAV · 통계 대시보드 · 미니 위젯 창 · (필요 시) 자체 백엔드

---

## 9. 미리 알아둘 함정

1. **타임존과 DST** — 압도적 1위 버그 원인. 처음부터 UTC 저장 원칙을 지키고, DST 전환일 테스트를 반드시 작성하세요.
2. **반복 일정 수정 시맨틱** — "이 일정만 / 이후 전체 / 전체"의 데이터 처리가 각각 다릅니다. 설계 단계에서 확정하세요.
3. **종일 일정 경계** — 타임존 변환 시 하루가 밀리는 문제.
4. **코드 서명 비용** — Windows 인증서, Apple Developer Program(연 $99). 배포 계획이 있다면 미리 예산에 반영.
5. **Linux WebView 파편화** — WebKitGTK 버전 차이로 렌더링이 달라집니다. 대상 배포판을 좁히세요.
6. **앱 종료 상태의 알림** — Tauri만으로는 불가. 트레이 상주를 전제로 설계하거나 OS 스케줄러 연동이 필요합니다.
7. **드래그 앤 드롭 성능** — 프론트에서 매 프레임 Rust를 호출하지 말고, 드롭 시점에만 커밋하세요.
8. **주별 뷰 겹침 레이아웃** — 같은 시간대에 겹치는 일정을 몇 개의 열로 나눌지 계산하는 로직. 직접 구현하면 예상보다 오래 걸립니다.
9. **동기화 컬럼 후행 추가** — `external_id`/`etag`/`deleted_at` 없이 출시한 뒤 공유를 붙이면 기존 사용자 데이터 마이그레이션이 필요합니다. **처음부터 넣어두세요.**
10. **Google OAuth 심사** — 캘린더는 민감 스코프라 공개 배포 시 검증 절차가 필요합니다. 개발 기간에 미리 반영하세요.
11. **업데이트 서명 키 분실** — 이 키를 잃으면 기존 사용자에게 **영구히 업데이트를 배포할 수 없습니다.** 복구 경로가 없으니 생성 즉시 별도 백업하세요. ([RELEASE.md](RELEASE.md) 2절)
12. **비공개 저장소 + 자동 업데이트** — 조합이 불가능합니다. 저장소를 공개하거나 별도 프록시가 필요합니다. 앱에 토큰을 넣는 방식은 금물입니다.

---

## 10. 결정이 필요한 사항

### 확정됨 ✅
- [x] 일별 / 주별 / 월별 캘린더 뷰 제공
- [x] 할 일 등록 / 수정 / 삭제
- [x] 캘린더를 다른 계정에 공유
- [x] GitHub Actions 빌드 → GitHub Releases 자동 업로드
- [x] GitHub Repository를 바라보는 자동 업데이트

### 미정 — 결정 필요
- [ ] **공유 방식** ← 가장 시급. 1(ICS) / 2(Google 연동) / 4(자체 백엔드) 중 선택. 3.10 참고
- [ ] **저장소 공개 여부** — 비공개면 자동 업데이트가 동작하지 않습니다 ([RELEASE.md](RELEASE.md) 7.2)
- [ ] 개인용인가, 배포·판매 목적인가 (코드 서명·OAuth 심사 필요 여부가 갈림)
- [ ] 프론트엔드 프레임워크 (React vs Svelte)
- [ ] 캘린더 UI 라이브러리 사용 vs 직접 구현
- [ ] 대상 OS 범위 (Windows 전용인가, 3종 전부인가)
