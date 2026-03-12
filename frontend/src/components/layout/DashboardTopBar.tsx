import { useEffect, useState } from "react";
import dayjs from "dayjs";
import { getRouteApi, useNavigate } from "@tanstack/react-router";
import { LogOut, MoonStar, SunMedium } from "lucide-react";
import { clearAuthToken } from "../../lib/api";
import {
  subscribeDashboardMeta,
  type DashboardMetaPatch,
} from "../../lib/dashboardBus";
import {
  getInitialThemeMode,
  persistThemeMode,
  type ThemeMode,
} from "../../lib/theme";
import { Button } from "../ui/button";

type SidebarPanel = "tasks" | "schedules" | "settings";

const dashboardRouteApi = getRouteApi("/$panel");

const PANEL_COPY: Record<
  SidebarPanel,
  { title: string; eyebrow: string }
> = {
  tasks: {
    title: "任务执行",
    eyebrow: "Execution",
  },
  schedules: {
    title: "计划调度",
    eyebrow: "Scheduler",
  },
  settings: {
    title: "采集设置",
    eyebrow: "Configuration",
  },
};

export function DashboardTopBar() {
  const navigate = useNavigate();
  const routeData = dashboardRouteApi.useLoaderData();
  const params = dashboardRouteApi.useParams();

  const activePanel = params.panel as SidebarPanel;
  const copy = PANEL_COPY[activePanel] ?? PANEL_COPY.tasks;

  const [clock, setClock] = useState(() => dayjs());
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => getInitialThemeMode());
  const [message, setMessage] = useState("");
  const [tasksTotal, setTasksTotal] = useState(routeData.tasksTotal);
  const [userCount, setUserCount] = useState(routeData.settings.user_list.length);
  const [schedulesTotal, setSchedulesTotal] = useState(routeData.schedulesTotal);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setClock(dayjs());
    }, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    persistThemeMode(themeMode);
  }, [themeMode]);

  useEffect(() => {
    return subscribeDashboardMeta((patch: DashboardMetaPatch) => {
      if (typeof patch.message === "string") {
        setMessage(patch.message);
      }
      if (typeof patch.tasksTotal === "number") {
        setTasksTotal(patch.tasksTotal);
      }
      if (typeof patch.userCount === "number") {
        setUserCount(patch.userCount);
      }
      if (typeof patch.schedulesTotal === "number") {
        setSchedulesTotal(patch.schedulesTotal);
      }
    });
  }, []);

  function onLogout() {
    clearAuthToken();
    void navigate({ to: "/login" });
  }

  function toggleTheme() {
    setThemeMode((prev) => (prev === "apple-dark" ? "apple-light" : "apple-dark"));
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-2">
          <p className="section-title">{copy.eyebrow}</p>
          <h2 className="font-display text-2xl font-semibold tracking-[-0.05em] text-ink md:text-[2rem]">
            {copy.title}
          </h2>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={toggleTheme}>
            {themeMode === "apple-dark" ? (
              <SunMedium className="h-4 w-4" />
            ) : (
              <MoonStar className="h-4 w-4" />
            )}
            {themeMode === "apple-dark" ? "浅色" : "深色"}
          </Button>
          <Button variant="outline" size="sm" onClick={onLogout}>
            <LogOut className="h-4 w-4" />
            退出
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-slate">
        <span className="font-mono">{clock.format("YYYY-MM-DD HH:mm")}</span>
        <span>任务 {tasksTotal}</span>
        <span>计划 {schedulesTotal}</span>
        <span>用户 {userCount}</span>
        <span>下载根 {routeData.allowedDownloadRoots.length}</span>
      </div>

      {message ? (
        <p className="status-banner text-sm">{message}</p>
      ) : null}
    </div>
  );
}
