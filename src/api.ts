import { invoke } from "@tauri-apps/api/core";
import type { NewTask, NotificationPayload, Status, Task, TaskUpdate } from "./types";

export const listTasks = () => invoke<Task[]>("list_tasks");

export const createTask = (input: NewTask) => invoke<Task>("create_task", { input });

export const updateTask = (input: TaskUpdate) => invoke<Task>("update_task", { input });

export const deleteTask = (id: string) => invoke<void>("delete_task", { id });

export const restoreTask = (id: string) => invoke<Task>("restore_task", { id });

export const setTaskStatus = (id: string, status: Status) =>
  invoke<Task>("set_task_status", { id, status });

/** 캘린더에서 카드를 다른 날짜·시간으로 옮길 때 */
export const rescheduleTask = (id: string, startsAt: number | null) =>
  invoke<Task>("reschedule_task", { id, startsAt });

export const snoozeTask = (id: string, minutes: number) =>
  invoke<Task>("snooze_task", { id, minutes });

export const sendTestNotification = () => invoke<void>("send_test_notification");

export const getAppVersion = () => invoke<string>("app_version");

/** 기간(from~to)을 xlsx 로 저장. from 이 null 이면 전체. 반환값은 기록한 건수 */
export const exportXlsx = (
  path: string,
  from: number | null,
  to: number | null,
  label: string,
) => invoke<number>("export_xlsx", { path, from, to, label });

// --- 설정 ---

export const getSetting = (key: string) => invoke<string | null>("get_setting", { key });

export const setSetting = (key: string, value: string) =>
  invoke<void>("set_setting", { key, value });

// --- 알림 창 전용 ---

export const notificationReady = () => invoke<void>("notification_ready");

export const drainNotifications = () =>
  invoke<NotificationPayload[]>("drain_notifications");

export const resizeNotificationWindow = (height: number) =>
  invoke<void>("resize_notification_window", { height });

export const hideNotificationWindow = () => invoke<void>("hide_notification_window");
