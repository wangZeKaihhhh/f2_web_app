import { useEffect, useState } from "react";
import { getRouteApi, useNavigate } from "@tanstack/react-router";
import { DEFAULT_TASK_LIST_LIMIT } from "../../lib/api";
import {
  subscribeDashboardMeta,
  type DashboardMetaPatch,
} from "../../lib/dashboardBus";

type SidebarPanel = "tasks" | "settings";
const dashboardRouteApi = getRouteApi("/$panel");

export function DashboardSidebar() {
  const routeData = dashboardRouteApi.useLoaderData();
  const params = dashboardRouteApi.useParams();
  const navigate = useNavigate();

  const activePanel = params.panel as SidebarPanel;
  const [tasksTotal, setTasksTotal] = useState(routeData.tasksTotal);
  const [tasksPage, setTasksPage] = useState(1);
  const [userCount, setUserCount] = useState(routeData.settings.user_list.length);
  const [message, setMessage] = useState("");

  const tasksTotalPages = Math.max(1, Math.ceil(tasksTotal / DEFAULT_TASK_LIST_LIMIT));

  useEffect(() => {
    return subscribeDashboardMeta((patch: DashboardMetaPatch) => {
      if (typeof patch.tasksTotal === "number") {
        setTasksTotal(patch.tasksTotal);
      }
      if (typeof patch.tasksPage === "number") {
        setTasksPage(patch.tasksPage);
      }
      if (typeof patch.userCount === "number") {
        setUserCount(patch.userCount);
      }
      if (typeof patch.message === "string") {
        setMessage(patch.message);
      }
    });
  }, []);

  function onSelectPanel(panel: SidebarPanel) {
    void navigate({ to: "/$panel", params: { panel } });
  }

  return (
    <aside className="z-30 shrink-0 border-b border-slate/25 bg-paper/85 px-3 py-3 backdrop-blur-xl md:h-full md:w-72 md:border-b-0 md:border-r md:px-4 md:py-6">
      <nav className="grid grid-cols-2 gap-2 md:mt-4 md:block md:space-y-2">
        <button
          type="button"
          className={`w-full rounded-xl border px-3 py-2 text-left transition ${
            activePanel === "tasks"
              ? "border-ink bg-ink text-paper"
              : "surface-soft hover:border-slate/45"
          }`}
          onClick={() => onSelectPanel("tasks")}
        >
          <p className="text-sm font-semibold">任务</p>
          <p className="mt-0.5 font-mono text-[11px] opacity-80">列表、详情与日志</p>
        </button>
        <button
          type="button"
          className={`w-full rounded-xl border px-3 py-2 text-left transition ${
            activePanel === "settings"
              ? "border-ink bg-ink text-paper"
              : "surface-soft hover:border-slate/45"
          }`}
          onClick={() => onSelectPanel("settings")}
        >
          <p className="text-sm font-semibold">设置</p>
          <p className="mt-0.5 font-mono text-[11px] opacity-80">参数、Cookie 与目录</p>
        </button>
      </nav>

      <div className="surface-muted mt-4 hidden rounded-xl p-3 font-mono text-[11px] text-slate md:block">
        <p>任务总数: {tasksTotal}</p>
        <p className="mt-1">
          当前页: {tasksPage}/{tasksTotalPages}
        </p>
        <p className="mt-1">用户数量: {userCount}</p>
      </div>

      {message && <p className="mt-3 hidden font-mono text-xs text-slate md:block">{message}</p>}
    </aside>
  );
}
