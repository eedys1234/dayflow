import { useEffect, useMemo, useState } from "react";
import * as api from "../api";
import { exportToExcel } from "../export";
import { formatDue } from "../date";
import { disable as autostartOff, enable as autostartOn, isEnabled as autostartIsOn } from "@tauri-apps/plugin-autostart";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
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

/** 가속기 문자열을 사람이 읽는 형태로 */
function label(accelerator: string): string {
  if (!accelerator) return "사용 안 함";
  return accelerator.replace("CommandOrControl", "Ctrl/⌘").replace(/\+/g, " + ");
}

type Tab = "general" | "display" | "notify" | "data" | "connect" | "about";

const TABS: { value: Tab; label: string; icon: string }[] = [
  { value: "general", label: "일반", icon: "⚙" },
  { value: "display", label: "화면", icon: "◐" },
  { value: "notify", label: "알림", icon: "🔔" },
  { value: "data", label: "데이터", icon: "🗄" },
  { value: "connect", label: "연결", icon: "🔗" },
  { value: "about", label: "정보", icon: "ℹ" },
];

export default function SettingsPage({ tasks }: { tasks: Task[] }) {
  const { settings, set } = useSettings();
  const [tab, setTab] = useState<Tab>("general");
  const [version, setVersion] = useState("");

  const [autostart, setAutostart] = useState(false);
  const [backups, setBackups] = useState<api.BackupInfo[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmRestore, setConfirmRestore] = useState<string | null>(null);
  const [activeSc, setActiveSc] = useState("");
  const [apiInfo, setApiInfo] = useState<api.ApiInfo | null>(null);
  const [showToken, setShowToken] = useState(false);

  useEffect(() => {
    void api.getAppVersion().then(setVersion).catch(() => {});
    void autostartIsOn().then(setAutostart).catch(() => {});
    void api.activeShortcut().then(setActiveSc).catch(() => {});
  }, []);

  const loadBackups = () => {
    void api.listBackups().then(setBackups).catch(() => {});
  };

  useEffect(() => {
    if (tab === "data") loadBackups();
    if (tab === "connect") void api.apiInfo().then(setApiInfo).catch((e) => setNotice(String(e)));
  }, [tab]);

  const toggleAutostart = async (on: boolean) => {
    try {
      if (on) await autostartOn();
      else await autostartOff();
      setAutostart(await autostartIsOn());
    } catch (e) {
      setNotice(`자동 시작 설정 실패: ${e}`);
    }
  };

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
        {notice && (
          <p className="notice-bar">
            {notice}
            <button type="button" className="ghost" onClick={() => setNotice(null)}>
              닫기
            </button>
          </p>
        )}

        {tab === "general" && (
          <>
            <section className="card">
              <h2>⚙ 시작</h2>

              <div className="setting">
                <div className="setting-label">
                  <strong>부팅 시 자동 시작</strong>
                  <span>
                    창은 띄우지 않고 트레이로만 조용히 올라옵니다.
                    알림을 놓치지 않으려면 켜두는 편이 좋습니다.
                  </span>
                </div>
                <label className="switch">
                  <input
                    type="checkbox"
                    checked={autostart}
                    onChange={(e) => void toggleAutostart(e.target.checked)}
                  />
                  <span>{autostart ? "켜짐" : "꺼짐"}</span>
                </label>
              </div>

              <div className="setting">
                <div className="setting-label">
                  <strong>창 닫기 동작</strong>
                  <span>
                    트레이로 숨기면 알림이 계속 동작합니다. 종료를 고르면 X 를 누를 때
                    앱이 완전히 끝납니다.
                  </span>
                </div>
                <div className="seg">
                  <button
                    type="button"
                    className={settings.closeToTray ? "on" : ""}
                    onClick={() => set("closeToTray", true)}
                  >
                    트레이로 숨김
                  </button>
                  <button
                    type="button"
                    className={!settings.closeToTray ? "on" : ""}
                    onClick={() => set("closeToTray", false)}
                  >
                    종료
                  </button>
                </div>
              </div>
            </section>

            <section className="card">
              <h2>⌁ 빠른 입력</h2>
              <p className="section-desc">
                어느 프로그램에서든 단축키를 누르면 화면 가운데 위에 입력창이 뜹니다.
                <code>팀 회의 내일 15:00</code> 처럼 적으면 시각까지 함께 등록됩니다.
              </p>

              <div className="setting">
                <div className="setting-label">
                  <strong>전역 단축키</strong>
                  <span>
                    {activeSc
                      ? `현재 동작 중: ${label(activeSc)}`
                      : "지금은 단축키가 등록돼 있지 않습니다."}
                    {activeSc && activeSc !== settings.quickAddShortcut &&
                      " — 고른 조합을 다른 프로그램이 쓰고 있어 대체됐습니다."}
                  </span>
                </div>
                <div className="inline-selects">
                  <select
                    value={settings.quickAddShortcut}
                    onChange={async (e) => {
                      const v = e.target.value;
                      try {
                        const got = await api.setShortcut(v);
                        set("quickAddShortcut", v);
                        setActiveSc(got);
                        if (!v) setNotice("단축키를 껐습니다.");
                        else if (got !== v)
                          setNotice(`${label(v)} 는 다른 프로그램이 쓰고 있어 ${label(got)} 로 대체했습니다.`);
                        else setNotice(`단축키를 ${label(got)} 로 바꿨습니다.`);
                      } catch (err) {
                        setNotice(String(err));
                      }
                    }}
                  >
                    <option value="CommandOrControl+Shift+Space">Ctrl/⌘ + Shift + Space</option>
                    <option value="CommandOrControl+Shift+N">Ctrl/⌘ + Shift + N</option>
                    <option value="CommandOrControl+Alt+Space">Ctrl/⌘ + Alt + Space</option>
                    <option value="">사용 안 함</option>
                  </select>
                </div>
              </div>
            </section>

            <section className="card">
              <h2>▣ 요약 위젯</h2>
              <p className="section-desc">
                화면 <strong>우측 상단</strong>에 고정되는 작은 창입니다. 오늘 남은 일과
                다음 일정 몇 개만 보여주며, 다른 창 위에 항상 떠 있습니다.
              </p>

              <div className="setting">
                <div className="setting-label">
                  <strong>위젯 표시</strong>
                  <span>트레이 메뉴의 "요약 위젯 켜기 / 끄기" 로도 전환할 수 있습니다.</span>
                </div>
                <label className="switch">
                  <input
                    type="checkbox"
                    checked={settings.widgetVisible}
                    onChange={(e) => {
                      set("widgetVisible", e.target.checked);
                      void api.setWidgetVisible(e.target.checked);
                    }}
                  />
                  <span>{settings.widgetVisible ? "켜짐" : "꺼짐"}</span>
                </label>
              </div>
            </section>
          </>
        )}
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
                <strong>아침 브리핑</strong>
                <span>정한 시각에 그날 할 일 요약을 한 번 띄웁니다.</span>
              </div>
              <div className="inline-selects">
                <label className="switch">
                  <input
                    type="checkbox"
                    checked={settings.briefingEnabled}
                    onChange={(e) => set("briefingEnabled", e.target.checked)}
                  />
                  <span>{settings.briefingEnabled ? "켜짐" : "꺼짐"}</span>
                </label>
                <select
                  value={settings.briefingAtMin}
                  disabled={!settings.briefingEnabled}
                  onChange={(e) => set("briefingAtMin", Number(e.target.value))}
                >
                  {Array.from({ length: 24 }, (_, h) => (
                    <option key={h} value={h * 60}>
                      {String(h).padStart(2, "0")}:00
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
                <strong>자동 백업</strong>
                <span>
                  하루에 한 번 스냅샷을 남기고, 정한 개수만큼만 보관합니다.
                  파일 복사가 아니라 SQLite 온라인 백업이라 사용 중에도 안전합니다.
                </span>
              </div>
              <div className="inline-selects">
                <label className="switch">
                  <input
                    type="checkbox"
                    checked={settings.autoBackup}
                    onChange={(e) => set("autoBackup", e.target.checked)}
                  />
                  <span>{settings.autoBackup ? "켜짐" : "꺼짐"}</span>
                </label>
                <select
                  value={settings.backupKeep}
                  disabled={!settings.autoBackup}
                  onChange={(e) => set("backupKeep", Number(e.target.value))}
                >
                  {[5, 10, 20, 30].map((n) => (
                    <option key={n} value={n}>
                      {n}개 보관
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="setting">
              <div className="setting-label">
                <strong>지금 백업</strong>
                <span>백업 폴더에 스냅샷을 하나 더 만듭니다.</span>
              </div>
              <div className="inline-selects">
                <button
                  type="button"
                  disabled={busy === "backup"}
                  onClick={async () => {
                    setBusy("backup");
                    try {
                      const b = await api.createBackup(settings.backupKeep);
                      setNotice(`백업 완료 — ${b.name}`);
                      loadBackups();
                    } catch (e) {
                      setNotice(String(e));
                    } finally {
                      setBusy(null);
                    }
                  }}
                >
                  ⭳ 지금 백업
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      await revealItemInDir(await api.backupsPath());
                    } catch (e) {
                      setNotice(String(e));
                    }
                  }}
                >
                  폴더 열기
                </button>
              </div>
            </div>

            <div className="backups">
              <h3>백업 목록 <span className="count">{backups.length}</span></h3>
              {backups.length === 0 && <p className="note">아직 백업이 없습니다.</p>}

              {backups.map((b) => (
                <div key={b.path} className="backup-row">
                  <div className="backup-info">
                    <strong>{formatDue(b.createdAt)}</strong>
                    <span>
                      {b.name} · {(b.sizeBytes / 1024).toFixed(0)} KB
                    </span>
                  </div>

                  {confirmRestore === b.path ? (
                    <div className="confirm">
                      <span>복원 후 재시작합니다.</span>
                      <button
                        type="button"
                        className="danger-solid"
                        onClick={async () => {
                          try {
                            await api.restoreBackup(b.path);
                            await api.restartApp();
                          } catch (e) {
                            setNotice(String(e));
                            setConfirmRestore(null);
                          }
                        }}
                      >
                        복원
                      </button>
                      <button type="button" className="ghost" onClick={() => setConfirmRestore(null)}>
                        취소
                      </button>
                    </div>
                  ) : (
                    <div className="backup-actions">
                      <button type="button" onClick={() => setConfirmRestore(b.path)}>
                        복원
                      </button>
                      <button
                        type="button"
                        className="ghost danger-text"
                        onClick={async () => {
                          try {
                            await api.deleteBackup(b.path);
                            loadBackups();
                          } catch (e) {
                            setNotice(String(e));
                          }
                        }}
                      >
                        삭제
                      </button>
                    </div>
                  )}
                </div>
              ))}

              <p className="note">
                복원은 즉시 적용되지 않고 <strong>다음 시작 때</strong> 반영됩니다.
                앱이 DB 파일을 쥔 채로 바꿔치기하면 데이터가 깨질 수 있어서입니다.
                덮어쓰기 직전의 원본도 자동으로 한 부 남깁니다.
              </p>
            </div>

            <div className="setting">
              <div className="setting-label">
                <strong>Excel 로 내보내기</strong>
                <span>
                  기한 없는 항목까지 포함해 전체를 <code>.xlsx</code> 파일로 저장합니다.
                  일정 시트와 요약 시트가 함께 만들어집니다.
                </span>
              </div>
              <button type="button" onClick={() => void exportToExcel("전체", null, null)}>
                ⭳ 전체 내보내기
              </button>
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

        {tab === "connect" && (
          <>
            <section className="card">
              <h2>🔗 로컬 API 서버</h2>
              <p className="section-desc">
                이 PC 안에 작은 HTTP 서버를 띄워 폰이나 다른 기기가 할 일을 읽고
                등록할 수 있게 합니다. 모든 요청은 아래 토큰이 있어야 하고,
                변경 사항과 알림은 SSE(<code>/api/events</code>)로 실시간 전달됩니다.
              </p>

              <div className="setting">
                <div className="setting-label">
                  <strong>API 서버</strong>
                  <span>
                    {apiInfo?.running
                      ? `실행 중 — ${apiInfo.lan ? "0.0.0.0" : "127.0.0.1"}:${apiInfo.port}`
                      : "꺼져 있음"}
                  </span>
                </div>
                <label className="switch">
                  <input
                    type="checkbox"
                    checked={apiInfo?.enabled ?? false}
                    onChange={async (e) => {
                      try {
                        setApiInfo(await api.setApiEnabled(e.target.checked));
                      } catch (err) {
                        setNotice(String(err));
                      }
                    }}
                  />
                  <span>{apiInfo?.enabled ? "켜짐" : "꺼짐"}</span>
                </label>
              </div>

              <div className="setting">
                <div className="setting-label">
                  <strong>같은 Wi-Fi 에서 직접 접근 허용</strong>
                  <span>
                    끄면 이 PC(127.0.0.1)에서만 접근됩니다 — ngrok·Cloudflare 터널은
                    이 상태로 충분합니다. 켜면 같은 네트워크의 폰이 터널 없이 붙습니다.
                  </span>
                </div>
                <label className="switch">
                  <input
                    type="checkbox"
                    checked={apiInfo?.lan ?? false}
                    disabled={!apiInfo?.enabled}
                    onChange={async (e) => {
                      try {
                        setApiInfo(await api.setApiLan(e.target.checked));
                      } catch (err) {
                        setNotice(String(err));
                      }
                    }}
                  />
                  <span>{apiInfo?.lan ? "LAN" : "이 PC만"}</span>
                </label>
              </div>

              <div className="setting">
                <div className="setting-label">
                  <strong>접근 토큰</strong>
                  <span>유출됐다면 재발급하세요. 기존 클라이언트는 전부 끊깁니다.</span>
                </div>
                <div className="inline-selects">
                  <input
                    type="text"
                    readOnly
                    className="token-box"
                    value={
                      showToken ? (apiInfo?.token ?? "") : "•".repeat(Math.min(32, apiInfo?.token.length ?? 0))
                    }
                    onFocus={(e) => e.currentTarget.select()}
                  />
                  <button type="button" onClick={() => setShowToken((v) => !v)}>
                    {showToken ? "가리기" : "보기"}
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(apiInfo?.token ?? "");
                        setNotice("토큰을 복사했습니다.");
                      } catch {
                        setShowToken(true);
                        setNotice("자동 복사가 막혀 있습니다. 토큰을 드래그해 복사하세요.");
                      }
                    }}
                  >
                    복사
                  </button>
                  <button
                    type="button"
                    className="ghost danger-text"
                    onClick={async () => {
                      try {
                        setApiInfo(await api.regenerateApiToken());
                        setNotice("토큰을 재발급했습니다. 기존 클라이언트는 재인증이 필요합니다.");
                      } catch (err) {
                        setNotice(String(err));
                      }
                    }}
                  >
                    재발급
                  </button>
                </div>
              </div>
            </section>

            <section className="card">
              <h2>📱 연결 방법</h2>

              <p className="note">
                <strong>1. 연결 확인</strong> — 서버를 켜고 이 PC 브라우저에서{" "}
                <code>http://127.0.0.1:{apiInfo?.port ?? 17800}/health</code> 를 열면
                버전 정보가 보입니다.
              </p>
              <p className="note">
                <strong>2. 외부에서 접근 (터널)</strong> —{" "}
                <code>ngrok http {apiInfo?.port ?? 17800}</code> 또는{" "}
                <code>cloudflared tunnel --url http://127.0.0.1:{apiInfo?.port ?? 17800}</code>.
                ngrok 무료 플랜은 재시작마다 주소가 바뀌므로, 고정 주소가 필요하면
                Cloudflare Tunnel 을 권합니다.
              </p>
              <p className="note">
                <strong>3. 요청 예시</strong> — 모든 API 는{" "}
                <code>Authorization: Bearer 토큰</code> 헤더가 필요합니다.
                <br />
                <code>GET /api/tasks</code> 목록 · <code>POST /api/tasks</code> 등록 ·{" "}
                <code>PATCH /api/tasks/:id/status</code> 상태 변경
              </p>
              <p className="note">
                <strong>4. 실시간 알림</strong> — <code>GET /api/events?token=토큰</code> 을
                SSE 로 구독하면 <code>tasks_changed</code> 와 <code>notification</code> 이벤트가
                흐릅니다. 폰 앱(Flutter)은 이 연결을 유지하다가 notification 을 받으면
                로컬 알림으로 띄우면 됩니다.
              </p>
            </section>
          </>
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
