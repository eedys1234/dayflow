import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import ReactDOM from "react-dom/client";
import { listen } from "@tauri-apps/api/event";
import * as api from "./api";
import { atMinutes, formatDue } from "./date";
import { followSettings } from "./settings";
import "./panel.css";

/**
 * 입력 한 줄에서 시각을 뽑아낸다.
 *
 * 지원하는 형태 — 뒤쪽에 붙은 것만 본다:
 *   "회의 15:00"        오늘 15시
 *   "회의 오후 3시"      오늘 15시
 *   "회의 내일 9:30"     내일 9시 30분
 *
 * 완전한 자연어 파서는 아니다. 실제로 자주 쓰는 몇 가지만 처리하고,
 * 나머지는 제목으로 남겨 사용자가 나중에 상세에서 채우도록 둔다.
 */
export function parseQuick(input: string): { title: string; startsAt: number | null } {
  const raw = input.trim();
  if (!raw) return { title: "", startsAt: null };

  let dayOffset = 0;
  let rest = raw;

  const dayWord = rest.match(/\s(오늘|내일|모레)\s*/);
  if (dayWord) {
    dayOffset = dayWord[1] === "내일" ? 1 : dayWord[1] === "모레" ? 2 : 0;
    rest = rest.replace(dayWord[0], " ");
  }

  let minutes: number | null = null;

  // 15:00 / 9:30
  const hhmm = rest.match(/\s(\d{1,2}):(\d{2})\s*$/);
  if (hhmm) {
    const h = Number(hhmm[1]);
    const m = Number(hhmm[2]);
    if (h < 24 && m < 60) {
      minutes = h * 60 + m;
      rest = rest.slice(0, hhmm.index).trim();
    }
  }

  // 오후 3시 / 오전 9시 30분 / 3시
  if (minutes === null) {
    const kr = rest.match(/\s(오전|오후)?\s*(\d{1,2})\s*시\s*(?:(\d{1,2})\s*분)?\s*$/);
    if (kr) {
      let h = Number(kr[2]);
      const m = Number(kr[3] ?? 0);
      if (kr[1] === "오후" && h < 12) h += 12;
      if (kr[1] === "오전" && h === 12) h = 0;
      if (h < 24 && m < 60) {
        minutes = h * 60 + m;
        rest = rest.slice(0, kr.index).trim();
      }
    }
  }

  if (minutes === null) return { title: rest.trim(), startsAt: null };

  const day = new Date();
  day.setDate(day.getDate() + dayOffset);
  return { title: rest.trim(), startsAt: atMinutes(day, minutes) };
}

function QuickAdd() {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => followSettings(), []);

  const reset = useCallback(() => {
    setText("");
    setError(null);
    // 창을 다시 열었을 때 바로 타이핑할 수 있어야 한다.
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }, []);

  useEffect(() => {
    reset();
    const un = listen("quickadd://reset", reset);
    return () => void un.then((f) => f());
  }, [reset]);

  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const sync = () => {
      const h = Math.ceil(el.getBoundingClientRect().height);
      if (h > 0) void api.resizeQuickadd(h);
    };
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    return () => ro.disconnect();
  }, [error, text]);

  const parsed = parseQuick(text);

  const submit = async () => {
    if (!parsed.title || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.createTask({
        title: parsed.title,
        startsAt: parsed.startsAt,
        endsAt: null,
        // 시각을 알아낸 경우에만 알림을 켠다. 시각이 없으면 울릴 수 없다.
        remind: parsed.startsAt !== null,
        remindOffsetMin: 10,
      });
      setText("");
      await api.hideQuickadd();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="quickadd" ref={rootRef}>
      <div className="q-row">
        <span className="q-mark" aria-hidden>
          ⌁
        </span>
        <input
          ref={inputRef}
          value={text}
          placeholder="할 일을 적으세요 — 예: 팀 회의 내일 15:00"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void submit();
            } else if (e.key === "Escape") {
              e.preventDefault();
              void api.hideQuickadd();
            }
          }}
        />
        <kbd>Enter</kbd>
      </div>

      {parsed.startsAt !== null && (
        <p className="q-hint">
          {formatDue(parsed.startsAt)} · 10분 전 알림
        </p>
      )}
      {error && <p className="q-error">{error}</p>}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(<QuickAdd />);
