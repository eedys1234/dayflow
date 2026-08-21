import { useEffect, useMemo, useState } from "react";
import * as api from "../api";
import { useSettings } from "../settings";
import {
  REMIND_OFFSETS,
  REPEAT_COUNTS,
  REPEAT_INTERVALS,
  type Task,
  type ThemeMode,
} from "../types";

const THEMES: { value: ThemeMode; label: string; icon: string; desc: string }[] = [
  { value: "light", label: "라이트", icon: "☀", desc: "항상 밝게" },
  { value: "dark", label: "다크", icon: "☾", desc: "항상 어둡게" },
  { value: "system", label: "시스템", icon: "◐", desc: "OS 설정을 따름" },
];

const TTL_OPTIONS = [10, 20, 30, 60];

type Tab = "display" | "notify" | "data" | "about";

const TABS: { value: Tab; label: string; icon: string }[] = [
  { value: "display", label: "화면", icon: "◐" },
  { value: "notify", label: "알림", icon: "🔔" },
  { value: "data", label: "데이터", icon: "🗄" },
  { value: "about", label: "정보", icon: "ℹ" },
];

export default function SettingsPage({ tasks }: { tasks: Task[] }) {
  const { settings, set } = useSettings();
  const [tab, setTab] = useState<Tab>("display");
  const [version, setVersion] = useState("");

  useEffect(() => {
    void api.getAppVersion().then(setVersion).catch(() => {});
  }, []);

  const stats = useMemo(
    () => ({
      total: tasks.length,
      pending: tasks.filter((t) => t.status === "pending").length,
      progress: tasks.filter((t) => t.status === "in_progress").length,
      done: tasks.filter((t) => t.status === "done").length,
      remind: tasks.filter((t) => t.remind && t.notifiedAt === null).length,
    }),
    [tasks],
  );

  return (
    <div className="page">
      <header className="page-head">
        <h1>⚙ Settings</h1>
      </header>

      <div className="tabs">
        {TABS.map((t) => (
          <button
            key={t.value}
            type="button"
            className={`tab ${tab === t.value ? "on" : ""}`}
            onClick={() => setTab(t.value)}
          >
            <span aria-hidden>{t.icon}</span>
            {t.label}
          </button>
        ))}
      </div>

      <div className="page-body settings">
        {tab === "display" && (
          <section className="card">
            <h2>◐ 테마</h2>
            <p className="section-desc">
              시스템을 고르면 OS의 밝기 설정을 따라갑니다. 알림 창도 같은 테마를 씁니다.
            </p>

            <div className="theme-cards">
              {THEMES.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  className={`theme-card ${settings.theme === t.value ? "on" : ""}`}
                  onClick={() => set("theme", t.value)}
                >
                  <span className="theme-icon" aria-hidden>
                    {t.icon}
                  </span>
                  <strong>{t.label}</strong>
                  <span className="theme-desc">{t.desc}</span>
                </button>
              ))}
            </div>

            <div className="setting">
              <div className="setting-label">
                <strong>주 시작 요일</strong>
                <span>주별 뷰와 월별 뷰의 첫 열이 바뀝니다.</span>
              </div>
              <div className="seg">
                <button
                  type="button"
                  className={settings.weekStart === 0 ? "on" : ""}
                  onClick={() => set("weekStart", 0)}
                >
                  일요일
                </button>
                <button
                  type="button"
                  className={settings.weekStart === 1 ? "on" : ""}
                  onClick={() => set("weekStart", 1)}
                >
                  월요일
                </button>
              </div>
            </div>
          </section>
        )}

        {tab === "notify" && (
          <section className="card">
            <h2>🔔 알림</h2>
            <p className="section-desc">
              알림은 OS 기본 알림이 아니라 화면 우측 하단의 전용 창에 표시됩니다.
              위치와 버튼을 직접 제어하기 위해서입니다.
            </p>

            <div className="setting">
              <div className="setting-label">
                <strong>기본 알림 시점</strong>
                <span>새 할 일에서 알림을 켤 때 처음 선택되는 값입니다.</span>
              </div>
              <select
                className="narrow-select"
                value={settings.defaultRemindOffset}
                onChange={(e) => set("defaultRemindOffset", Number(e.target.value))}
              >
                {REMIND_OFFSETS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="setting">
              <div className="setting-label">
                <strong>기본 반복</strong>
                <span>새 할 일의 반복 주기와 횟수 기본값입니다. 항목마다 따로 바꿀 수 있습니다.</span>
              </div>
              <div className="inline-selects">
                <select
                  value={settings.defaultRepeatInterval}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    set("defaultRepeatInterval", v);
                    if (v === 0) set("defaultRepeatCount", 1);
                    else if (settings.defaultRepeatCount === 1) set("defaultRepeatCount", 3);
                  }}
                >
                  {REPEAT_INTERVALS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <select
                  value={settings.defaultRepeatCount}
                  disabled={settings.defaultRepeatInterval === 0}
                  onChange={(e) => set("defaultRepeatCount", Number(e.target.value))}
                >
                  {REPEAT_COUNTS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="setting">
              <div className="setting-label">
                <strong>알림 카드 유지 시간</strong>
                <span>이 시간이 지나면 저절로 사라집니다. 마우스를 올려두면 멈춥니다.</span>
              </div>
              <div className="seg">
                {TTL_OPTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    className={settings.notifyTtlSec === s ? "on" : ""}
                    onClick={() => set("notifyTtlSec", s)}
                  >
                    {s}초
                  </button>
                ))}
              </div>
            </div>

            <div className="setting">
              <div className="setting-label">
                <strong>표시 위치 확인</strong>
                <span>화면 우측 하단에 샘플 알림을 띄웁니다.</span>
              </div>
              <button type="button" onClick={() => void api.sendTestNotification()}>
                알림 미리보기
              </button>
            </div>

            <p className="note">
              창을 닫아도 앱은 트레이에 남아 알림을 계속 확인합니다. 완전히 끄려면
              트레이 아이콘을 우클릭해 <strong>종료</strong>를 누르세요.
            </p>
          </section>
        )}

        {tab === "data" && (
          <section className="card">
            <h2>🗄 데이터</h2>

            <div className="stat-row">
              <div className="stat">
                <strong>{stats.total}</strong>
                <span>전체</span>
              </div>
              <div className="stat">
                <strong>{stats.pending}</strong>
                <span>대기</span>
              </div>
              <div className="stat">
                <strong>{stats.progress}</strong>
                <span>진행 중</span>
              </div>
              <div className="stat">
                <strong>{stats.done}</strong>
                <span>완료</span>
              </div>
              <div className="stat">
                <strong>{stats.remind}</strong>
                <span>알림 대기</span>
              </div>
            </div>

            <div className="setting">
              <div className="setting-label">
                <strong>저장 위치</strong>
                <span>
                  <code>%APPDATA%\com.colosseum.dayflow\schedule.db</code>
                </span>
              </div>
            </div>

            <p className="note">
              삭제한 할 일은 즉시 지워지지 않고 <code>deleted_at</code> 만 기록됩니다.
              실행 취소와 향후 기기 간 동기화를 위해서입니다.
            </p>
          </section>
        )}

        {tab === "about" && (
          <section className="card">
            <h2>ℹ 정보</h2>

            <div className="about">
              <span className="brand-mark" />
              <div>
                <strong>Dayflow</strong>
                <span className="ver">
                  {version ? `버전 ${version}` : "버전 확인 중"} · Rust + Tauri v2 · SQLite
                </span>
              </div>
            </div>

            <div className="setting">
              <div className="setting-label">
                <strong>단축키</strong>
                <span className="keys">
                  <kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd> 화면 전환 · <kbd>N</kbd> 새 할 일 ·{" "}
                  <kbd>Esc</kbd> 닫기
                  <br />
                  캘린더 — <kbd>T</kbd> 오늘 · <kbd>←</kbd> <kbd>→</kbd> 이전·다음 ·{" "}
                  <kbd>D</kbd> <kbd>W</kbd> <kbd>M</kbd> 뷰 전환
                </span>
              </div>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
