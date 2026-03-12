import { getRouteApi } from "@tanstack/react-router";
import { DashboardSidebar } from "./components/layout/DashboardSidebar";
import { DashboardTopBar } from "./components/layout/DashboardTopBar";
import { SchedulesPanel } from "./components/panels/SchedulesPanel";
import { SettingsPanel } from "./components/panels/SettingsPanel";
import { TasksPanel } from "./components/panels/TasksPanel";

const dashboardRouteApi = getRouteApi("/$panel");
type SidebarPanel = "tasks" | "schedules" | "settings";

export default function App() {
  const activePanel = dashboardRouteApi.useParams().panel as SidebarPanel;

  return (
    <div className="dashboard-frame">
      <div className="dashboard-layout">
        <DashboardSidebar />
        <div className="dashboard-main">
          <header className="shell-panel surface-card rounded-[1.6rem] p-3 md:p-4">
            <DashboardTopBar />
          </header>

          <main className="dashboard-main-inner">
            <div className="w-full space-y-6">
              <div className={activePanel === "settings" ? "block" : "hidden"}>
                <SettingsPanel />
              </div>

              <div className={activePanel === "tasks" ? "block" : "hidden"}>
                <TasksPanel />
              </div>

              <div className={activePanel === "schedules" ? "block" : "hidden"}>
                <SchedulesPanel />
              </div>
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}
