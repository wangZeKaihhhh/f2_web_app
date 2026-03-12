import { useEffect, useState } from "react";
import { getRouteApi, useNavigate } from "@tanstack/react-router";
import {
  Activity,
  CalendarClock,
  ChevronRight,
  SlidersHorizontal,
  type LucideIcon,
} from "lucide-react";
import {
  subscribeDashboardMeta,
  type DashboardMetaPatch,
} from "../../lib/dashboardBus";
import { cn } from "../../lib/utils";

type SidebarPanel = "tasks" | "schedules" | "settings";

const dashboardRouteApi = getRouteApi("/$panel");

const PANEL_META: Record<
  SidebarPanel,
  {
    label: string;
    icon: LucideIcon;
    metricLabel: string;
  }
> = {
  tasks: {
    label: "任务执行",
    icon: Activity,
    metricLabel: "任务",
  },
  schedules: {
    label: "计划调度",
    icon: CalendarClock,
    metricLabel: "计划",
  },
  settings: {
    label: "采集设置",
    icon: SlidersHorizontal,
    metricLabel: "用户",
  },
};

export function DashboardSidebar() {
  const routeData = dashboardRouteApi.useLoaderData();
  const params = dashboardRouteApi.useParams();
  const navigate = useNavigate();

  const activePanel = params.panel as SidebarPanel;
  const [tasksTotal, setTasksTotal] = useState(routeData.tasksTotal);
  const [userCount, setUserCount] = useState(routeData.settings.user_list.length);
  const [schedulesTotal, setSchedulesTotal] = useState(routeData.schedulesTotal);
  const [message, setMessage] = useState("");

  useEffect(() => {
    return subscribeDashboardMeta((patch: DashboardMetaPatch) => {
      if (typeof patch.tasksTotal === "number") {
        setTasksTotal(patch.tasksTotal);
      }
      if (typeof patch.userCount === "number") {
        setUserCount(patch.userCount);
      }
      if (typeof patch.schedulesTotal === "number") {
        setSchedulesTotal(patch.schedulesTotal);
      }
      if (typeof patch.message === "string") {
        setMessage(patch.message);
      }
    });
  }, []);

  function onSelectPanel(panel: SidebarPanel) {
    void navigate({ to: "/$panel", params: { panel } });
  }

  function getPanelMetric(panel: SidebarPanel): string {
    if (panel === "tasks") {
      return String(tasksTotal);
    }
    if (panel === "schedules") {
      return String(schedulesTotal);
    }
    return String(userCount);
  }

  return (
    <aside className="flex shrink-0 flex-col gap-4 lg:w-[12.5rem]">
      <nav className="grid gap-3">
        {(Object.keys(PANEL_META) as SidebarPanel[]).map((panel) => {
          const item = PANEL_META[panel];
          const Icon = item.icon;

          return (
            <button
              key={panel}
              type="button"
              className={cn(
                "group shell-panel surface-soft rounded-[1.5rem] p-4 text-left transition-transform duration-200 hover:-translate-y-0.5",
                activePanel === panel &&
                  "border-pine/35 bg-pine/10 shadow-[0_18px_42px_rgb(var(--glow-rgb)_/_0.16)]",
              )}
              onClick={() => onSelectPanel(panel)}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3">
                  <div
                    className={cn(
                      "mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-border/60 bg-background/40 text-slate transition-colors",
                      activePanel === panel && "border-pine/30 bg-pine/12 text-pine",
                    )}
                  >
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-ink">{item.label}</p>
                  </div>
                </div>
                <ChevronRight
                  className={cn(
                    "h-4 w-4 shrink-0 text-slate transition-transform duration-200 group-hover:translate-x-0.5",
                    activePanel === panel && "text-pine",
                  )}
                />
              </div>

              <div className="mt-4 flex items-center justify-between gap-3 border-t border-border/40 pt-3">
                <span className="text-[11px] uppercase tracking-[0.18em] text-slate">
                  {item.metricLabel}
                </span>
                <span className="font-mono text-lg font-semibold text-ink">
                  {getPanelMetric(panel)}
                </span>
              </div>
            </button>
          );
        })}
      </nav>

      {message ? (
        <section className="shell-panel surface-muted rounded-[1.4rem] p-4">
          <p className="status-banner text-sm">{message}</p>
        </section>
      ) : null}
    </aside>
  );
}
