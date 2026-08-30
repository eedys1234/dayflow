import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import ReactDOM from "react-dom/client";
import { listen } from "@tauri-apps/api/event";
import * as api from "./api";
import { endOfDay, formatTime, isOverdue, startOfDay, toEpoch } from "./date";
import { followSettings } from "./settings";
import { STATUS_LABEL, type Status, type Task } from "./types";
import "./panel.css";

/** 위젯에 한 번에 보여줄 다음 일정 개수 */
const UPCOMING = 4;

function Widget() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const rootRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    try {
      setTasks(await api.listTasks());
    } catch {
      /* 조회 실패는 위젯을 비우기만 하면 된다 */
    }
  }, []);

  useEffect(() => followSettings(), []);

  useEffect(() => {
    void refresh();
    const un = listen("tasks://changed", () => void refresh());
    return () => void un.then((f) => f());
  }, [refresh]);

  // 내용 높이에 맞춰 창을 줄인다. 투명 영역도 클릭을 가로채기 때문에
  // 남는 공간이 있으면 뒤쪽 창을 못 누르게 된다.
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const sync = () => {
      const h = Math.ceil(el.getBoundingClientRect().height);
      if (h > 0) void api.resizeWidget(h);
    };
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    return () => ro.disconnect();
  }, [tasks.length]);

  const from = toEpoch(startOfDay(new Date()));
  const to = toEpoch(endOfDay(new Date()));

  const today = tasks.filter(
    (t) => t.startsAt !== null && t.startsAt >= from && t.startsAt <= to,
  );
  const counts: Record<Status, number> = {
    pending: today.filter((t) => t.status === "pending").length,
    in_progress: today.filter((t) => t.status === "in_progress").length,
    done: today.filter((t) => t.status === "done").length,
  };
  const overdue = tasks.filter(isOverdue);

  // 아직 끝나지 않은 오늘 일정을 시간순으로.
  const upcoming = today
    .filter((t) => t.status !== "done")
    .sort((a, b) => (a.startsAt ?? 0) - (b.startsAt ?? 0))
    .slice(0, UPCOMING);

  const dateLabel = new Intl.DateTimeFormat("ko-KR", {
    month: "long",
    day: "numeric",
    weekday: "short",
  }).format(new Date());

  return (
    <div className="widget" ref={rootRef}>
      <header className="w-head">
        <div>
          <strong>오늘</strong>
          <span className="w-date">{dateLabel}</span>
        </div>
        <div className="w-actions">
          <button type="button" onClick={() => void api.openMain()} title="Dayflow 열기">
            ⤢
          </button>
          <button
            type="button"
            onClick={() => void api.setWidgetVisible(false)}
            title="위젯 닫기"
          >
            ✕
          </button>
        </div>
      </header>

      <div className="w-counts">
        {(["pending", "in_progress", "done"] as Status[]).map((s) => (
          <div key={s} className={`w-count ${s}`}>
            <strong>{counts[s]}</strong>
            <span>{STATUS_LABEL[s]}</span>
          </div>
        ))}
      </div>

      {overdue.length > 0 && (
        <div className="w-overdue">기한 지남 {overdue.length}건</div>
      )}

      <ul className="w-list">
        {upcoming.map((t) => (
          <li key={t.id} className={`w-item st-${t.status}`}>
            <span className="w-time">{t.startsAt !== null ? formatTime(t.startsAt) : ""}</span>
            <span className="w-title">{t.title}</span>
          </li>
        ))}
        {upcoming.length === 0 && <li className="w-empty">남은 일정이 없습니다</li>}
      </ul>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(<Widget />);
