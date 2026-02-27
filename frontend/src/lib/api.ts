export type TaskStatus = 'pending' | 'running' | 'success' | 'failed' | 'cancelled';

export interface UserTarget {
  name: string;
  url: string;
}

export interface DownloaderSettings {
  user_list: UserTarget[];
  douyin_cookie: string;
  max_tasks: number;
  page_counts: number;
  max_counts: number | null;
  timeout: number;
  max_retries: number;
  max_connections: number;
  mode: string;
  music: boolean;
  cover: boolean;
  desc: boolean;
  folderize: boolean;
  naming: string;
  interval: string;
  update_exif: boolean;
  incremental_mode: boolean;
  incremental_threshold: number;
  download_path: string;
}

export interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
}

export interface UserStat {
  nickname: string;
  success: boolean;
  new: number;
  skipped: number;
  status: string;
}

export interface TaskResult {
  total: number;
  success: number;
  failed: number;
  total_new: number;
  total_skipped: number;
  users: UserStat[];
}

export interface TaskSummary {
  task_id: string;
  status: TaskStatus;
  created_at: string;
  started_at: string | null;
  ended_at: string | null;
  error: string | null;
}

export interface TaskDetail extends TaskSummary {
  settings: DownloaderSettings;
  user_list: UserTarget[];
  result: TaskResult | null;
  logs: LogEntry[];
}

export interface TaskEvent {
  task_id: string;
  type: string;
  timestamp: string;
  message: string;
  data: Record<string, unknown>;
}

export interface AuthStatus {
  configured: boolean;
  allowed_download_roots: string[];
}

export interface AuthTokenResponse {
  token: string;
}

const AUTH_TOKEN_STORAGE_KEY = 'f2_auth_token';

let authToken: string | null = null;
if (typeof window !== 'undefined') {
  try {
    authToken = window.localStorage.getItem(AUTH_TOKEN_STORAGE_KEY);
  } catch {
    authToken = null;
  }
}

export class UnauthorizedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnauthorizedError';
  }
}

export function setAuthToken(token: string) {
  authToken = token;
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, token);
  } catch {
    // ignore storage errors
  }
}

export function clearAuthToken() {
  authToken = null;
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
  } catch {
    // ignore storage errors
  }
}

export function hasAuthToken(): boolean {
  return Boolean(authToken);
}

export function getAuthToken(): string | null {
  return authToken;
}

async function readErrorMessage(response: Response): Promise<string> {
  const contentType = response.headers.get('Content-Type') ?? '';
  if (contentType.includes('application/json')) {
    try {
      const payload = (await response.json()) as Record<string, unknown>;
      if (typeof payload.detail === 'string') {
        return payload.detail;
      }
      if (typeof payload.message === 'string') {
        return payload.message;
      }
      return JSON.stringify(payload);
    } catch {
      return `Request failed: ${response.status}`;
    }
  }

  const text = await response.text();
  return text || `Request failed: ${response.status}`;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers ?? {});
  if (!headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  if (authToken) {
    headers.set('Authorization', `Bearer ${authToken}`);
  }

  const response = await fetch(url, { ...init, headers });

  if (!response.ok) {
    const message = await readErrorMessage(response);
    if (response.status === 401) {
      throw new UnauthorizedError(message || '未授权，请先登录');
    }
    throw new Error(message || `Request failed: ${response.status}`);
  }

  return response.json() as Promise<T>;
}

export const api = {
  getAuthStatus: () => request<AuthStatus>('/api/auth/status'),
  setupPassword: (password: string) =>
    request<AuthTokenResponse>('/api/auth/setup', {
      method: 'POST',
      body: JSON.stringify({ password })
    }),
  login: (password: string) =>
    request<AuthTokenResponse>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ password })
    }),
  getSettings: () => request<DownloaderSettings>('/api/settings'),
  saveSettings: (payload: DownloaderSettings) =>
    request<DownloaderSettings>('/api/settings', {
      method: 'PUT',
      body: JSON.stringify(payload)
    }),
  createTask: (userList?: UserTarget[]) =>
    request<TaskSummary>('/api/tasks', {
      method: 'POST',
      body: JSON.stringify({ user_list: userList })
    }),
  listTasks: () => request<TaskSummary[]>('/api/tasks'),
  getTask: (taskId: string) => request<TaskDetail>(`/api/tasks/${taskId}`),
  cancelTask: (taskId: string) =>
    request<TaskSummary>(`/api/tasks/${taskId}/cancel`, {
      method: 'POST'
    })
};
