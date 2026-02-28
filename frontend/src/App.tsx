import { getRouteApi } from "@tanstack/react-router";
import { DashboardSidebar } from "./components/layout/DashboardSidebar";
import { DashboardTopBar } from "./components/layout/DashboardTopBar";
import { SettingsPanel } from "./components/panels/SettingsPanel";
import { TasksPanel } from "./components/panels/TasksPanel";

const dashboardRouteApi = getRouteApi("/$panel");
type SidebarPanel = "tasks" | "settings";

export default function App() {
  const activePanel = dashboardRouteApi.useParams().panel as SidebarPanel;

  return (
    <div className="relative flex h-screen flex-col overflow-hidden">
      <header className="z-40 shrink-0 border-b border-slate/25 bg-paper/85 px-3 py-3 backdrop-blur-xl md:px-6">
        <DashboardTopBar />
      </header>

      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        <DashboardSidebar />

        <main className="relative min-h-0 flex-1 overflow-y-auto bg-paper/35">
          <div className="relative min-h-full px-4 pb-8 pt-4 md:px-8 md:pb-10 md:pt-6">
            <div className={activePanel === "settings" ? "block" : "hidden"}>
              <SettingsPanel />
            </div>

            <div className={activePanel === "tasks" ? "block" : "hidden"}>
              <TasksPanel />
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
