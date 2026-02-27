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
  hasAuthToken,
  type DownloaderSettings,
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

export type DashboardRouteLoaderData = {
  allowedDownloadRoots: string[];
  settings: DownloaderSettings;
  tasks: TaskSummary[];
};

const dashboardRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  loader: async (): Promise<DashboardRouteLoaderData> => {
    const authStatus = await api.getAuthStatus();
    if (!authStatus.configured) {
      throw redirect({ to: '/login' });
    }

    if (!hasAuthToken()) {
      throw redirect({ to: '/login' });
    }

    try {
      const [settings, tasks] = await Promise.all([api.getSettings(), api.listTasks()]);
      return {
        allowedDownloadRoots: authStatus.allowed_download_roots ?? [],
        settings: normalizeSettings(settings),
        tasks
      };
    } catch (error) {
      if (error instanceof UnauthorizedError) {
        clearAuthToken();
        throw redirect({ to: '/login' });
      }
      throw error;
    }
  },
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
      throw redirect({ to: '/' });
    }
  },
  component: LoginPage
});

const routeTree = rootRoute.addChildren([dashboardRoute, loginRoute]);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
