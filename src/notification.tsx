import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import ReactDOM from "react-dom/client";
import { listen } from "@tauri-apps/api/event";
import * as api from "./api";
import { formatDue, formatTime } from "./date";
import { followSettings } from "./settings";
import type { NotificationPayload } from "./types";
import "./notification.css";

/** 기본 유지 시간(초). 설정 화면에서 바꾸면 즉시 반영된다. */
const DEFAULT_TTL = 20;
/** 기한이 지난 항목은 조금 더 오래 남긴다 */
const OVERDUE_FACTOR = 1.5;
const TEST_TTL = 8;

interface Card {
  payload: NotificationPayload;
  expiresAt: number;
  /** 사라지는 애니메이션 중 */
  leaving?: boolean;
}

function NotificationApp() {
  const [cards, setCards] = useState<Card[]>([]);
  const hovered = useRef<Set<string>>(new Set());
  const rootRef = useRef<HTMLDivElement>(null);
  /** 카드를 한 번이라도 그린 적이 있는지 — 첫 마운트에서 창을 숨기지 않기 위함 */
  const everHadCards = useRef(false);
  const ttlSec = useRef(DEFAULT_TTL);

  const ttlFor = useCallback((kind: NotificationPayload["kind"]) => {
    if (kind === "test") return TEST_TTL * 1000;
    if (kind === "overdue") return ttlSec.current * OVERDUE_FACTOR * 1000;
    return ttlSec.current * 1000;
  }, []);

  // 메인 창에서 고른 테마와 유지 시간을 그대로 따라간다.
  useEffect(() => followSettings((sec) => (ttlSec.current = sec)), []);

  const add = useCallback(
    (payload: NotificationPayload) => {
      setCards((prev) => {
        // 큐에서 꺼낸 것과 실시간 이벤트가 겹칠 수 있으므로 nid로 중복을 막는다.
        if (prev.some((c) => c.payload.nid === payload.nid)) return prev;
        return [...prev, { payload, expiresAt: Date.now() + ttlFor(payload.kind) }];
      });
    },
    [ttlFor],
  );

  const dismiss = useCallback((nid: string) => {
    setCards((prev) => prev.map((c) => (c.payload.nid === nid ? { ...c, leaving: true } : c)));
    // 퇴장 애니메이션이 끝난 뒤 실제로 제거한다.
    window.setTimeout(() => {
      setCards((prev) => prev.filter((c) => c.payload.nid !== nid));
    }, 180);
  }, []);

  // 마운트: 큐에 쌓인 알림을 먼저 가져오고, 이후 실시간 이벤트를 받는다.
  useEffect(() => {
    let disposed = false;

    const unlisten = listen<NotificationPayload>("notification://push", (e) => {
      if (!disposed) add(e.payload);
    });

    void (async () => {
      try {
        const queued = await api.drainNotifications();
        if (!disposed) queued.forEach(add);
      } catch {
        // 큐가 비어 있거나 조회에 실패해도 실시간 수신에는 영향이 없다.
      }
      // 리스너를 붙인 뒤에 알려야 이후 emit이 유실되지 않는다.
      await api.notificationReady();
    })();

    return () => {
      disposed = true;
      void unlisten.then((f) => f());
    };
  }, [add]);

  // 만료 처리. 마우스를 올려둔 카드는 계속 시간을 뒤로 민다.
  useEffect(() => {
    const id = window.setInterval(() => {
      const now = Date.now();
      setCards((prev) => {
        let changed = false;
        const next = prev.map((c) => {
          if (hovered.current.has(c.payload.nid)) {
            changed = true;
            return { ...c, expiresAt: now + ttlFor(c.payload.kind) };
          }
          return c;
        });
        const alive = next.filter((c) => c.expiresAt > now);
        if (alive.length !== prev.length) changed = true;
        return changed ? alive : prev;
      });
    }, 250);
    return () => window.clearInterval(id);
  }, [ttlFor]);

  // 내용 높이에 맞춰 창 크기를 조절하고, 비면 창을 숨긴다.
  useLayoutEffect(() => {
    if (cards.length === 0) {
      // 첫 마운트 시점에는 아직 큐에서 카드를 못 가져온 상태다. 여기서 숨기면
      // 방금 push 가 띄운 창을 도로 감추게 되므로, 한 번이라도 카드를
      // 보여준 뒤에만 숨긴다.
      if (everHadCards.current) void api.hideNotificationWindow();
      return;
    }
    everHadCards.current = true;

    const el = rootRef.current;
    if (!el) return;

    const sync = () => {
      const h = Math.ceil(el.getBoundingClientRect().height);
      if (h > 0) void api.resizeNotificationWindow(h);
    };

    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    return () => ro.disconnect();
  }, [cards.length]);

  const complete = async (card: Card) => {
    const { taskId, nid } = card.payload;
    if (taskId) {
      try {
        await api.setTaskStatus(taskId, "done");
      } catch {
        /* 이미 삭제된 항목일 수 있다. 카드는 그대로 닫는다. */
      }
    }
    dismiss(nid);
  };

  const start = async (card: Card) => {
    const { taskId, nid } = card.payload;
    if (taskId) {
      try {
        await api.setTaskStatus(taskId, "in_progress");
      } catch {
        /* 위와 동일 */
      }
    }
    dismiss(nid);
  };

  const snooze = async (card: Card, minutes: number) => {
    const { taskId, nid } = card.payload;
    if (taskId) {
      try {
        await api.snoozeTask(taskId, minutes);
      } catch {
        /* 위와 동일 */
      }
    }
    dismiss(nid);
  };

  return (
    <div className="stack" ref={rootRef}>
      {cards.map((c) => (
        <article
          key={c.payload.nid}
          className={`card ${c.payload.kind} ${c.leaving ? "leaving" : ""}`}
          onMouseEnter={() => hovered.current.add(c.payload.nid)}
          onMouseLeave={() => hovered.current.delete(c.payload.nid)}
        >
          <header>
            <span className="tag">
              {c.payload.kind === "overdue"
                ? "기한 지남"
                : c.payload.kind === "test"
                  ? "미리보기"
                  : "예정된 할 일"}
              {c.payload.repeatSeq !== null && (
                <span className="seq">
                  {c.payload.repeatSeq}
                  {c.payload.repeatTotal !== null ? `/${c.payload.repeatTotal}` : ""}회
                </span>
              )}
            </span>
            <button
              type="button"
              className="close"
              onClick={() => dismiss(c.payload.nid)}
              aria-label="닫기"
            >
              ✕
            </button>
          </header>

          <h1>{c.payload.title}</h1>

          {c.payload.startsAt !== null && (
            <p className="when">
              {formatDue(c.payload.startsAt)}
              {c.payload.endsAt !== null && ` – ${formatTime(c.payload.endsAt)}`}
            </p>
          )}
          {c.payload.body && <p className="body">{c.payload.body}</p>}

          {c.payload.taskId && (
            <footer>
              <button type="button" className="primary" onClick={() => void complete(c)}>
                완료
              </button>
              <button type="button" onClick={() => void start(c)}>
                진행 중
              </button>
              <button type="button" onClick={() => void snooze(c, 10)}>
                10분 후
              </button>
            </footer>
          )}
        </article>
      ))}
    </div>
  );
}

// 알림 창은 StrictMode를 쓰지 않는다. 개발 모드의 이중 마운트가
// 창 크기 조절 호출을 불필요하게 두 번씩 일으키기 때문이다.
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(<NotificationApp />);
