import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import * as api from "./api";
import TasksPage from "./pages/TasksPage";
import CalendarPage from "./pages/CalendarPage";
import SettingsPage from "./pages/SettingsPage";
import TaskModal from "./components/TaskModal";
import OverduePanel from "./components/OverduePanel";
import { endOfDay, isOverdue, startOfDay, toEpoch } from "./date";
import { useSettings } from "./settings";
import type { Status, Task, ThemeMode } from "./types";

type Page = "tasks" | "calendar" | "settings";

const NAV: { value: Page; label: string; icon: string; key: string }[] = [
  { value: "tasks", label: "Tasks", icon: "◧", key: "1" },
  { value: "calendar", label: "Calendar", icon: "▦", key: "2" },
  { value: "settings", label: "Settings", icon: "⚙", key: "3" },
];

const THEME_CYCLE: ThemeMode[] = ["system", "light", "dark"];
const THEME_ICON: Record<ThemeMode, string> = { system: "◐", light: "☀", dark: "☾" };

/** 모달 상태 — 닫힘 / 신규(시각 지정 가능) / 기존 항목 */
type Modal = null | { mode: "create"; presetDue: number | null } | { mode: "edit"; task: Task };

export default function App() {
  const { settings, set } = useSettings();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [page, setPage] = useState<Page>("tasks");
  const [modal, setModal] = useState<Modal>(null);
  const [error, setError] = useState<string | null>(null);
  const [undoId, setUndoId] = useState<string | null>(null);
  const [showOverdue, setShowOverdue] = useState(false);
  const [version, setVersion] = useState("");

  const undoTimer = useRef<number | null>(null);
  const prevIds = useRef<Set<string>>(new Set());

  const refresh = useCallback(async () => {
    try {
      const next = await api.listTasks();

      // 삭제된 항목을 감지해 실행 취소를 띄운다. 삭제 경로가 모달·보드 등
      // 여러 곳이라, 각 호출부에서 처리하는 대신 여기서 한 번에 잡는다.
      const nextIds = new Set(next.map((t) => t.id));
      if (prevIds.current.size > 0) {
        const gone = [...prevIds.current].filter((id) => !nextIds.has(id));
        if (gone.length === 1) {
          setUndoId(gone[0]!);
          if (undoTimer.current) window.clearTimeout(undoTimer.current);
          undoTimer.current = window.setTimeout(() => setUndoId(null), 8000);
        }
      }
      prevIds.current = nextIds;

      setTasks(next);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    void api.getAppVersion().then(setVersion).catch(() => {});
  }, []);

  useEffect(() => {
    void refresh();
    const a = listen("tasks://changed", () => void refresh());
    // 트레이 메뉴의 "새 할 일"
    const b = listen("tray://new-task", () => setModal({ mode: "create", presetDue: null }));
    return () => {
      void a.then((f) => f());
      void b.then((f) => f());
    };
  }, [refresh]);

  // 화면 전환 / 새 할 일 단축키
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (modal || showOverdue) return;
      const el = e.target as HTMLElement;
      if (el.matches("input, textarea, select")) return;

      const nav = NAV.find((n) => n.key === e.key);
      if (nav) setPage(nav.value);
      else if (e.key === "n" || e.key === "N") {
        e.preventDefault();
        setModal({ mode: "create", presetDue: null });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [modal, showOverdue]);

  const changeStatus = useCallback(
    async (id: string, status: Status) => {
      try {
        await api.setTaskStatus(id, status);
        await refresh();
      } catch (e) {
        setError(String(e));
      }
    },
    [refresh],
  );

  const reschedule = useCallback(
    async (id: string, epochSec: number) => {
      try {
        await api.rescheduleTask(id, epochSec);
        await refresh();
      } catch (e) {
        setError(String(e));
      }
    },
    [refresh],
  );

  const undo = async () => {
    if (!undoId) return;
    try {
      await api.restoreTask(undoId);
      setUndoId(null);
      await refresh();
    } catch (e) {
      setError(String(e));
    }
  };

  const openTask = useCallback((task: Task) => setModal({ mode: "edit", task }), []);

  const overdue = useMemo(() => tasks.filter(isOverdue), [tasks]);

  const todayCount = useMemo(() => {
    const from = toEpoch(startOfDay(new Date()));
    const to = toEpoch(endOfDay(new Date()));
    return tasks.filter(
      (t) => t.status !== "done" && t.startsAt !== null && t.startsAt >= from && t.startsAt <= to,
    ).length;
  }, [tasks]);

  const cycleTheme = () => {
    const i = THEME_CYCLE.indexOf(settings.theme);
    set("theme", THEME_CYCLE[(i + 1) % THEME_CYCLE.length]!);
  };

  return (
    <div className="shell">
      {/* ---------- 상단 앱바 ---------- */}
      <header className="appbar">
        <div className="brand">
          <span className="brand-mark" />
          <span className="brand-name">Dayflow</span>
        </div>

        <button
          type="button"
          className="primary"
          onClick={() => setModal({ mode: "create", presetDue: null })}
        >
          + 새 할 일
        </button>

        <div className="appbar-spacer" />

        <button
          type="button"
          className={`pill ${overdue.length > 0 ? "alert" : ""}`}
          onClick={() => setShowOverdue(true)}
          title="기한이 지난 항목 보기"
        >
          지남 <strong>{overdue.length}</strong>
        </button>

        <span className="pill quiet">
          오늘 <strong>{todayCount}</strong>
        </span>

        <button
          type="button"
          className="pill icon-pill"
          onClick={cycleTheme}
          title={`테마: ${settings.theme} — 눌러서 전환`}
        >
          {THEME_ICON[settings.theme]}
        </button>

        {version && <span className="pill quiet ver-pill">v{version}</span>}
      </header>

      {/* ---------- 아이콘 레일 + 본문 ---------- */}
      <div className="body">
        <nav className="rail">
          {NAV.map((n) => (
            <button
              key={n.value}
              type="button"
              className={`rail-item ${page === n.value ? "on" : ""}`}
              onClick={() => setPage(n.value)}
              title={`${n.label} (${n.key})`}
            >
              <span className="rail-icon" aria-hidden>
                {n.icon}
              </span>
              <span className="rail-label">{n.label}</span>
            </button>
          ))}
        </nav>

        <main className="main">
          {page === "tasks" && (
            <TasksPage
              tasks={tasks}
              onOpen={openTask}
              onNew={() => setModal({ mode: "create", presetDue: null })}
              onStatusChange={changeStatus}
            />
          )}

          {page === "calendar" && (
            <CalendarPage
              tasks={tasks}
              onOpen={openTask}
              onNewAt={(epochSec) => setModal({ mode: "create", presetDue: epochSec })}
              onStatusChange={changeStatus}
              onReschedule={reschedule}
            />
          )}

          {page === "settings" && <SettingsPage tasks={tasks} />}
        </main>
      </div>

      {showOverdue && (
        <OverduePanel
          tasks={overdue}
          onOpen={(t) => {
            setShowOverdue(false);
            openTask(t);
          }}
          onStatusChange={changeStatus}
          onClose={() => setShowOverdue(false)}
        />
      )}

      {modal && (
        <TaskModal
          task={modal.mode === "edit" ? modal.task : null}
          presetDue={modal.mode === "create" ? modal.presetDue : null}
          onClose={() => setModal(null)}
          onChanged={() => void refresh()}
        />
      )}

      {error && (
        <div className="toast error-toast">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)}>
            닫기
          </button>
        </div>
      )}

      {undoId && (
        <div className="toast">
          <span>할 일을 삭제했습니다.</span>
          <button type="button" onClick={() => void undo()}>
            실행 취소
          </button>
        </div>
      )}
    </div>
  );
}
