import { useEffect, useRef, useState } from "react";
import * as api from "../api";
import { formatDue, formatRelative, fromLocalInput, toLocalInput } from "../date";
import { useSettings } from "../settings";
import {
  PRIORITIES,
  REMIND_OFFSETS,
  REPEAT_COUNTS,
  REPEAT_INTERVALS,
  STATUSES,
  type Status,
  type Task,
} from "../types";

interface FormState {
  title: string;
  start: string; // datetime-local 문자열
  end: string; // 비어 있으면 종료 시각 없음
  remind: boolean;
  remindOffsetMin: number;
  repeatIntervalMin: number;
  repeatCount: number;
  priority: number;
  notes: string;
}

/** 다음 정각 — 알림을 켰는데 시각이 비어 있을 때 채워 넣는다 */
function nextHour(): string {
  const d = new Date();
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  return toLocalInput(Math.floor(d.getTime() / 1000));
}

/**
 * 할 일 상세 모달. 등록과 수정을 한 화면에서 처리한다.
 *
 * 할 일 화면과 캘린더 화면이 같은 모달을 쓰기 때문에 편집 경로가 하나로 유지된다.
 */
export default function TaskModal({
  task,
  presetDue,
  onClose,
  onChanged,
}: {
  /** null 이면 신규 등록 */
  task: Task | null;
  /** 캘린더 빈 슬롯에서 열었을 때 미리 채울 시각 */
  presetDue?: number | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { settings } = useSettings();
  const isEdit = task !== null;

  const [form, setForm] = useState<FormState>(() =>
    task
      ? {
          title: task.title,
          start: toLocalInput(task.startsAt),
          end: toLocalInput(task.endsAt),
          remind: task.remind,
          remindOffsetMin: task.remindOffsetMin,
          repeatIntervalMin: task.repeatIntervalMin,
          repeatCount: task.repeatCount,
          priority: task.priority,
          notes: task.notes ?? "",
        }
      : {
          title: "",
          start: presetDue != null ? toLocalInput(presetDue) : "",
          end: "",
          remind: false,
          remindOffsetMin: settings.defaultRemindOffset,
          repeatIntervalMin: settings.defaultRepeatInterval,
          repeatCount: settings.defaultRepeatCount,
          priority: 0,
          notes: "",
        },
  );

  const [status, setStatus] = useState<Status>(task?.status ?? "pending");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  // Esc 로 닫기
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const patch = (p: Partial<FormState>) => setForm((f) => ({ ...f, ...p }));

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const title = form.title.trim();
    if (!title) {
      setError("제목을 입력하세요.");
      return;
    }

    const startsAt = fromLocalInput(form.start);
    const endsAt = fromLocalInput(form.end);

    if (form.remind && startsAt === null) {
      setError("알림을 사용하려면 시작 시각을 먼저 지정하세요.");
      return;
    }
    if (endsAt !== null && startsAt === null) {
      setError("종료 시각만 지정할 수는 없습니다. 시작 시각을 함께 넣어주세요.");
      return;
    }
    if (startsAt !== null && endsAt !== null && endsAt <= startsAt) {
      setError("종료 시각은 시작 시각보다 뒤여야 합니다.");
      return;
    }

    const payload = {
      title,
      notes: form.notes.trim() || null,
      startsAt,
      endsAt,
      remind: form.remind,
      remindOffsetMin: form.remindOffsetMin,
      repeatIntervalMin: form.repeatIntervalMin,
      repeatCount: form.repeatCount,
      priority: form.priority,
    };

    setBusy(true);
    try {
      if (task) {
        await api.updateTask({ ...payload, id: task.id });
        if (status !== task.status) await api.setTaskStatus(task.id, status);
      } else {
        const created = await api.createTask(payload);
        // 신규 등록에서 대기가 아닌 상태를 골랐다면 이어서 반영한다.
        if (status !== "pending") await api.setTaskStatus(created.id, status);
      }
      onChanged();
      onClose();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!task) return;
    setBusy(true);
    try {
      await api.deleteTask(task.id);
      onChanged();
      onClose();
    } catch (err) {
      setError(String(err));
      setBusy(false);
    }
  };

  const remindAt = (() => {
    const at = fromLocalInput(form.start);
    return at === null ? null : at - form.remindOffsetMin * 60;
  })();

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        // 배경을 눌렀을 때만 닫는다. 모달 안에서 드래그로 선택하다 마우스가
        // 밖에서 떨어지는 경우까지 닫히면 작성 중인 내용을 잃는다.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal" role="dialog" aria-modal="true" aria-label="할 일 상세">
        <form onSubmit={save}>
          <header className="modal-head">
            <h2>{isEdit ? "할 일 상세" : "새 할 일"}</h2>
            <button type="button" className="icon" onClick={onClose} aria-label="닫기">
              ✕
            </button>
          </header>

          <div className="modal-body">
            <input
              ref={titleRef}
              className="modal-title"
              placeholder="무엇을 해야 하나요?"
              value={form.title}
              onChange={(e) => patch({ title: e.target.value })}
            />

            <div className="field">
              <span>상태</span>
              <div className="seg wide">
                {STATUSES.map((s) => (
                  <button
                    key={s.value}
                    type="button"
                    className={`${status === s.value ? "on" : ""} st-${s.value}`}
                    onClick={() => setStatus(s.value)}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="modal-row">
              <label className="field">
                <span>시작 시각</span>
                <input
                  type="datetime-local"
                  value={form.start}
                  onChange={(e) => patch({ start: e.target.value })}
                />
              </label>

              <label className="field">
                <span>
                  종료 시각 <em className="optional">선택</em>
                </span>
                <input
                  type="datetime-local"
                  value={form.end}
                  disabled={!form.start}
                  onChange={(e) => patch({ end: e.target.value })}
                />
              </label>
            </div>

            {form.start && !form.end && (
              <div className="quick-dur">
                <span>소요 시간</span>
                {[30, 60, 90, 120].map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => {
                      const s = fromLocalInput(form.start);
                      if (s !== null) patch({ end: toLocalInput(s + m * 60) });
                    }}
                  >
                    {m < 60 ? `${m}분` : `${m / 60}시간`}
                  </button>
                ))}
              </div>
            )}

            <div className="modal-row">
              <label className="field narrow">
                <span>우선순위</span>
                <select
                  value={form.priority}
                  onChange={(e) => patch({ priority: Number(e.target.value) })}
                >
                  {PRIORITIES.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="remind-block">
              <label className="check">
                <input
                  type="checkbox"
                  checked={form.remind}
                  onChange={(e) => {
                    const remind = e.target.checked;
                    patch({ remind, start: remind && !form.start ? nextHour() : form.start });
                  }}
                />
                <span>알림 받기</span>
              </label>

              {form.remind && (
                <>
                  <div className="modal-row">
                    <label className="field">
                      <span>알림 시점</span>
                      <select
                        value={form.remindOffsetMin}
                        onChange={(e) => patch({ remindOffsetMin: Number(e.target.value) })}
                      >
                        {REMIND_OFFSETS.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="field">
                      <span>반복</span>
                      <select
                        value={form.repeatIntervalMin}
                        onChange={(e) => {
                          const v = Number(e.target.value);
                          // 반복을 끄면 횟수는 1번으로 되돌린다.
                          patch({
                            repeatIntervalMin: v,
                            repeatCount: v === 0 ? 1 : Math.max(2, form.repeatCount),
                          });
                        }}
                      >
                        {REPEAT_INTERVALS.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="field narrow">
                      <span>횟수</span>
                      <select
                        value={form.repeatCount}
                        disabled={form.repeatIntervalMin === 0}
                        onChange={(e) => patch({ repeatCount: Number(e.target.value) })}
                      >
                        {REPEAT_COUNTS.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>

                  {remindAt !== null && (
                    <p className="hint">
                      {formatDue(remindAt)}에 첫 알림
                      {form.repeatIntervalMin > 0 &&
                        ` · 이후 ${form.repeatIntervalMin}분마다 ` +
                          (form.repeatCount === 0
                            ? "완료할 때까지"
                            : `총 ${form.repeatCount}번`)}
                    </p>
                  )}
                </>
              )}
            </div>

            <label className="field">
              <span>메모</span>
              <textarea
                rows={3}
                placeholder="자세한 내용 (선택)"
                value={form.notes}
                onChange={(e) => patch({ notes: e.target.value })}
              />
            </label>

            {isEdit && (
              <dl className="modal-meta">
                {task.startsAt !== null && (
                  <>
                    <dt>시작</dt>
                    <dd>
                      {formatDue(task.startsAt)}
                      <em> · {formatRelative(task.startsAt)}</em>
                    </dd>
                  </>
                )}
                {task.endsAt !== null && (
                  <>
                    <dt>종료</dt>
                    <dd>
                      {formatDue(task.endsAt)}
                      <em> · {formatRelative(task.endsAt)}</em>
                    </dd>
                  </>
                )}
                {task.notifiedCount > 0 && (
                  <>
                    <dt>알림 발송</dt>
                    <dd>
                      {task.notifiedCount}회
                      {task.repeatIntervalMin > 0 && task.repeatCount > 0 &&
                        ` / ${task.repeatCount}회`}
                      {task.notifiedAt !== null && <em> · 마지막 {formatDue(task.notifiedAt)}</em>}
                      {task.notifiedAt === null && task.remindAt !== null && (
                        <em> · 다음 {formatDue(task.remindAt)}</em>
                      )}
                    </dd>
                  </>
                )}
                {task.startedAt !== null && (
                  <>
                    <dt>착수</dt>
                    <dd>{formatDue(task.startedAt)}</dd>
                  </>
                )}
                {task.completedAt !== null && (
                  <>
                    <dt>완료</dt>
                    <dd>{formatDue(task.completedAt)}</dd>
                  </>
                )}
                <dt>등록</dt>
                <dd>{formatDue(task.createdAt)}</dd>
              </dl>
            )}

            {error && <p className="error">{error}</p>}
          </div>

          <footer className="modal-foot">
            {isEdit &&
              (confirmDelete ? (
                <div className="confirm">
                  <span>삭제할까요?</span>
                  <button type="button" className="danger-solid" onClick={() => void remove()}>
                    삭제
                  </button>
                  <button type="button" className="ghost" onClick={() => setConfirmDelete(false)}>
                    취소
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  className="ghost danger-text"
                  onClick={() => setConfirmDelete(true)}
                >
                  삭제
                </button>
              ))}

            <div className="spacer" />
            <button type="button" className="ghost" onClick={onClose}>
              취소
            </button>
            <button type="submit" className="primary" disabled={busy}>
              {isEdit ? "저장" : "등록"}
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
}
