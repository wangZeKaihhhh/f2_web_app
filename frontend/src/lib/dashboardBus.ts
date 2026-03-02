export type DashboardMetaPatch = {
  message?: string;
  userCount?: number;
  tasksTotal?: number;
  tasksPage?: number;
  schedulesTotal?: number;
};

const DASHBOARD_META_EVENT = "dashboard:meta";

export function emitDashboardMeta(patch: DashboardMetaPatch): void {
  if (typeof window === "undefined") {
    return;
  }
  window.dispatchEvent(
    new CustomEvent<DashboardMetaPatch>(DASHBOARD_META_EVENT, {
      detail: patch,
    }),
  );
}

export function subscribeDashboardMeta(
  handler: (patch: DashboardMetaPatch) => void,
): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }

  const listener: EventListener = (event) => {
    if (!(event instanceof CustomEvent)) {
      return;
    }
    handler((event.detail ?? {}) as DashboardMetaPatch);
  };

  window.addEventListener(DASHBOARD_META_EVENT, listener);
  return () => window.removeEventListener(DASHBOARD_META_EVENT, listener);
}
