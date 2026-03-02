import {
  Outlet,
  createRootRoute,
  createRoute,
  createRouter,
  redirect
} from '@tanstack/react-router';
import App from './App';
import LoginPage from './pages/LoginPage';
import {
  UnauthorizedError,
  api,
  clearAuthToken,
  DEFAULT_TASK_LIST_LIMIT,
  hasAuthToken,
  type DownloaderSettings,
  type ScheduleSummary,
  type TaskSummary
} from './lib/api';

async function verifyTokenOrClear(): Promise<boolean> {
  if (!hasAuthToken()) {
    return false;
  }

  try {
    await api.getSettings();
    return true;
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      clearAuthToken();
      return false;
    }
    throw error;
  }
}

function normalizeSettings(settings: DownloaderSettings): DownloaderSettings {
  return {
    ...settings,
    user_list: settings.user_list.length > 0 ? settings.user_list : [{ name: '', url: '' }]
  };
}

const rootRoute = createRootRoute({
  component: () => <Outlet />
});

const DASHBOARD_PANELS = ['tasks', 'schedules', 'settings'] as const;
export type DashboardPanel = (typeof DASHBOARD_PANELS)[number];

export type DashboardRouteLoaderData = {
  allowedDownloadRoots: string[];
  settings: DownloaderSettings;
  tasks: TaskSummary[];
  tasksHasMore: boolean;
  tasksTotal: number;
  schedules: ScheduleSummary[];
  schedulesTotal: number;
};

async function loadDashboardData(): Promise<DashboardRouteLoaderData> {
  const authStatus = await api.getAuthStatus();
  if (!authStatus.configured) {
    throw redirect({ to: '/login' });
  }

  if (!hasAuthToken()) {
    throw redirect({ to: '/login' });
  }

  try {
    const [settings, tasksPage, schedulesResp] = await Promise.all([
      api.getSettings(),
      api.listTasks({ offset: 0, limit: DEFAULT_TASK_LIST_LIMIT }),
      api.listSchedules()
    ]);
    return {
      allowedDownloadRoots: authStatus.allowed_download_roots ?? [],
      settings: normalizeSettings(settings),
      tasks: tasksPage.items,
      tasksHasMore: tasksPage.has_more,
      tasksTotal: tasksPage.total,
      schedules: schedulesResp.items,
      schedulesTotal: schedulesResp.total
    };
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      clearAuthToken();
      throw redirect({ to: '/login' });
    }
    throw error;
  }
}

const dashboardIndexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  beforeLoad: async () => {
    const authStatus = await api.getAuthStatus();
    if (!authStatus.configured) {
      throw redirect({ to: '/login' });
    }
    if (!hasAuthToken()) {
      throw redirect({ to: '/login' });
    }
    throw redirect({ to: '/$panel', params: { panel: 'tasks' } });
  },
  component: () => null
});

const dashboardPanelRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/$panel',
  beforeLoad: ({ params }) => {
    if (!DASHBOARD_PANELS.includes(params.panel as DashboardPanel)) {
      throw redirect({ to: '/$panel', params: { panel: 'tasks' } });
    }
  },
  loader: loadDashboardData,
  component: App
});

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  beforeLoad: async () => {
    const authStatus = await api.getAuthStatus();
    if (!authStatus.configured) {
      return;
    }

    const valid = await verifyTokenOrClear();
    if (valid) {
      throw redirect({ to: '/$panel', params: { panel: 'tasks' } });
    }
  },
  component: LoginPage
});

const routeTree = rootRoute.addChildren([dashboardIndexRoute, dashboardPanelRoute, loginRoute]);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
