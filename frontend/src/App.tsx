import { useEffect, useMemo, useRef, useState } from 'react';
import { getRouteApi, useNavigate, useRouter } from '@tanstack/react-router';
import {
  UnauthorizedError,
  api,
  clearAuthToken,
  type DownloaderSettings,
  type LogEntry,
  type TaskDetail,
  type TaskSummary,
  type UserTarget
} from './lib/api';
import { connectTaskWs } from './lib/ws';
import { Button } from './components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from './components/ui/dialog';
import { Input } from './components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from './components/ui/table';
import { Textarea } from './components/ui/textarea';
import { THEME_OPTIONS, getInitialThemeMode, persistThemeMode, type ThemeMode } from './lib/theme';

const dashboardRouteApi = getRouteApi('/');

function normalizeUserList(userList: UserTarget[]): UserTarget[] {
  return userList
    .map((item) => ({
      name: item.name.trim(),
      url: item.url.trim()
    }))
    .filter((item) => item.url.length > 0);
}

function parseBatchUsers(input: string): UserTarget[] {
  const users: UserTarget[] = [];
  const lines = input.split(/\r?\n/);

  for (const line of lines) {
    const text = line.trim();
    if (!text) {
      continue;
    }

    let name = '';
    let url = '';

    if (text.includes('\t')) {
      const [first, ...rest] = text.split('\t');
      name = first.trim();
      url = rest.join('\t').trim();
    } else if (text.includes(',')) {
      const [first, ...rest] = text.split(',');
      name = first.trim();
      url = rest.join(',').trim();
    } else if (text.includes('|')) {
      const [first, ...rest] = text.split('|');
      name = first.trim();
      url = rest.join('|').trim();
    } else {
      url = text;
    }

    if (url) {
      users.push({ name, url });
    }
  }

  return users;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export default function App() {
  const routeData = dashboardRouteApi.useLoaderData();
  const navigate = useNavigate();
  const router = useRouter();
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => getInitialThemeMode());
  const [settings, setSettings] = useState<DownloaderSettings>(() => routeData.settings);
  const [tasks, setTasks] = useState<TaskSummary[]>(() => routeData.tasks);
  const [selectedTaskId, setSelectedTaskId] = useState<string>(() => routeData.tasks[0]?.task_id ?? '');
  const [selectedTask, setSelectedTask] = useState<TaskDetail | null>(null);
  const [selectedTaskLogs, setSelectedTaskLogs] = useState<LogEntry[]>([]);
  const [saving, setSaving] = useState(false);
  const [starting, setStarting] = useState(false);
  const [message, setMessage] = useState('');
  const [selectedUserIndexes, setSelectedUserIndexes] = useState<number[]>([]);
  const [batchDialogOpen, setBatchDialogOpen] = useState(false);
  const [batchInput, setBatchInput] = useState('');
  const [allowedDownloadRoots, setAllowedDownloadRoots] = useState<string[]>(
    () => routeData.allowedDownloadRoots
  );
  const [loaderSyncTick, setLoaderSyncTick] = useState(0);

  const logsPanelRef = useRef<HTMLDivElement | null>(null);
  const stickToBottomRef = useRef(true);

  const selectedTaskPreviewLogs = useMemo(() => selectedTaskLogs.slice(-6), [selectedTaskLogs]);

  const allRowsSelected =
    settings.user_list.length > 0 && selectedUserIndexes.length === settings.user_list.length;

  useEffect(() => {
    persistThemeMode(themeMode);
  }, [themeMode]);

  useEffect(() => {
    if (loaderSyncTick <= 0) {
      return;
    }
    applyLoaderData(routeData);
  }, [loaderSyncTick, routeData]);

  useEffect(() => {
    if (!selectedTaskId) {
      return;
    }
    stickToBottomRef.current = true;
    setSelectedTask(null);
    setSelectedTaskLogs([]);
    void refreshTask(selectedTaskId);
  }, [selectedTaskId]);

  useEffect(() => {
    if (!stickToBottomRef.current) {
      return;
    }

    const panel = logsPanelRef.current;
    if (!panel) {
      return;
    }

    panel.scrollTop = panel.scrollHeight;
  }, [selectedTaskLogs]);

  useEffect(() => {
    if (!selectedTaskId) {
      return;
    }

    const terminalEvents = new Set([
      'task_started',
      'task_completed',
      'task_failed',
      'task_cancelled',
      'task_cancel_requested'
    ]);

    const ws = connectTaskWs(selectedTaskId, (evt: any) => {
      if (evt.type === 'error') {
        clearAuthToken();
        setMessage(typeof evt.message === 'string' ? evt.message : '未授权，请重新登录');
        void navigate({ to: '/login' });
        return;
      }

      if (evt.type === 'snapshot' && evt.task) {
        setSelectedTask(evt.task);
        setSelectedTaskLogs(evt.task.logs ?? []);
        return;
      }

      if (evt.message) {
        const levelFromData =
          typeof evt?.data?.level === 'string' && evt.data.level
            ? String(evt.data.level).toLowerCase()
            : '';

        const log: LogEntry = {
          timestamp: evt.timestamp,
          level: levelFromData || (evt.type.endsWith('failed') ? 'error' : 'info'),
          message: evt.message
        };
        setSelectedTaskLogs((prev) => [...prev, log].slice(-1000));
      }

      if (terminalEvents.has(evt.type)) {
        void refreshTasks();
        void refreshTask(selectedTaskId);
      }
    });

    return () => ws.close();
  }, [selectedTaskId, navigate]);

  function handleUnauthorized(error: unknown): boolean {
    if (!(error instanceof UnauthorizedError)) {
      return false;
    }

    clearAuthToken();
    setMessage('登录已失效，请重新登录');
    void navigate({ to: '/login' });
    return true;
  }

  function applyLoaderData(data: typeof routeData): void {
    setAllowedDownloadRoots(data.allowedDownloadRoots);
    setSettings(data.settings);
    setTasks(data.tasks);
    setSelectedUserIndexes([]);
    setSelectedTaskId((prev) => {
      if (prev && data.tasks.some((task) => task.task_id === prev)) {
        return prev;
      }
      return data.tasks[0]?.task_id ?? '';
    });
  }

  async function refreshAll(showSuccessMessage = true): Promise<boolean> {
    try {
      await router.invalidate();
      setLoaderSyncTick((prev) => prev + 1);
      if (showSuccessMessage) {
        setMessage('配置与任务列表已同步');
      }
      return true;
    } catch (error) {
      if (handleUnauthorized(error)) {
        return false;
      }
      setMessage(`加载失败: ${errorMessage(error)}`);
      return false;
    }
  }

  async function refreshTasks() {
    try {
      const tasksResp = await api.listTasks();
      setTasks(tasksResp);
    } catch (error) {
      if (!handleUnauthorized(error)) {
        setMessage(`任务列表刷新失败: ${errorMessage(error)}`);
      }
    }
  }

  async function refreshTask(taskId: string) {
    try {
      const detail = await api.getTask(taskId);
      setSelectedTask(detail);
      setSelectedTaskLogs(detail.logs ?? []);
    } catch (error) {
      handleUnauthorized(error);
    }
  }

  function onLogout() {
    clearAuthToken();
    void navigate({ to: '/login' });
  }

  async function onSaveSettings() {
    setSaving(true);
    setMessage('');
    try {
      const normalizedUserList = normalizeUserList(settings.user_list);
      const payload: DownloaderSettings = {
        ...settings,
        user_list: normalizedUserList
      };
      const saved = await api.saveSettings(payload);
      setSettings({
        ...saved,
        user_list: saved.user_list.length > 0 ? saved.user_list : [{ name: '', url: '' }]
      });
      setSelectedUserIndexes([]);
      setMessage('设置已保存');
    } catch (error) {
      if (!handleUnauthorized(error)) {
        setMessage(`保存失败: ${errorMessage(error)}`);
      }
    } finally {
      setSaving(false);
    }
  }

  async function onStartTask() {
    setStarting(true);
    setMessage('');
    try {
      const userList = normalizeUserList(settings.user_list);
      if (userList.length === 0) {
        throw new Error('用户列表为空');
      }

      const task = await api.createTask(userList);
      setSelectedTaskId(task.task_id);
      await refreshTasks();
      setMessage(`任务已创建: ${task.task_id}`);
    } catch (error) {
      if (!handleUnauthorized(error)) {
        setMessage(`启动失败: ${errorMessage(error)}`);
      }
    } finally {
      setStarting(false);
    }
  }

  async function onCancelTask() {
    if (!selectedTaskId) {
      return;
    }
    try {
      await api.cancelTask(selectedTaskId);
      await refreshTasks();
      await refreshTask(selectedTaskId);
      setMessage('已发送取消请求');
    } catch (error) {
      if (!handleUnauthorized(error)) {
        setMessage(`取消失败: ${errorMessage(error)}`);
      }
    }
  }

  function updateSetting<K extends keyof DownloaderSettings>(key: K, value: DownloaderSettings[K]) {
    setSettings((prev) => ({ ...prev, [key]: value }));
  }

  function updateUser(index: number, key: keyof UserTarget, value: string) {
    setSettings((prev) => ({
      ...prev,
      user_list: prev.user_list.map((item, i) => (i === index ? { ...item, [key]: value } : item))
    }));
  }

  function addUser() {
    setSettings((prev) => ({
      ...prev,
      user_list: [...prev.user_list, { name: '', url: '' }]
    }));
  }

  function removeUser(index: number) {
    setSettings((prev) => {
      const next = prev.user_list.filter((_, i) => i !== index);
      return {
        ...prev,
        user_list: next.length > 0 ? next : [{ name: '', url: '' }]
      };
    });
    setSelectedUserIndexes([]);
  }

  function toggleUserSelection(index: number, checked: boolean) {
    setSelectedUserIndexes((prev) => {
      if (checked) {
        return Array.from(new Set([...prev, index])).sort((a, b) => a - b);
      }
      return prev.filter((item) => item !== index);
    });
  }

  function toggleAllUserSelection(checked: boolean) {
    if (!checked) {
      setSelectedUserIndexes([]);
      return;
    }

    setSelectedUserIndexes(settings.user_list.map((_, index) => index));
  }

  function removeSelectedUsers() {
    if (selectedUserIndexes.length === 0) {
      return;
    }

    const selected = new Set(selectedUserIndexes);
    setSettings((prev) => {
      const next = prev.user_list.filter((_, index) => !selected.has(index));
      return {
        ...prev,
        user_list: next.length > 0 ? next : [{ name: '', url: '' }]
      };
    });
    setSelectedUserIndexes([]);
  }

  function confirmBatchAdd() {
    const parsed = parseBatchUsers(batchInput);
    if (parsed.length === 0) {
      setMessage('批量新增失败：未解析到有效 URL');
      return;
    }

    setSettings((prev) => ({
      ...prev,
      user_list: [...prev.user_list, ...parsed]
    }));
    setBatchInput('');
    setBatchDialogOpen(false);
    setMessage(`批量新增成功：${parsed.length} 条`);
  }

  function onLogsScroll() {
    const panel = logsPanelRef.current;
    if (!panel) {
      return;
    }

    const distanceToBottom = panel.scrollHeight - panel.scrollTop - panel.clientHeight;
    stickToBottomRef.current = distanceToBottom <= 8;
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 md:px-8 md:py-8">
      <header className="surface-card mb-6 rounded-2xl p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="font-display text-3xl font-semibold tracking-tight text-ink md:text-4xl">F2 下载器</p>
            <p className="mt-2 text-sm text-slate/90">多用户抖音主页下载控制台</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="surface-muted inline-flex flex-wrap gap-1 rounded-2xl p-1">
              {THEME_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={themeMode === option.value}
                  className={`rounded-xl px-3 py-1 text-xs font-medium transition ${
                    themeMode === option.value
                      ? 'bg-ink text-paper shadow-sm'
                      : 'text-slate hover:bg-paper/70'
                  }`}
                  onClick={() => setThemeMode(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <Button variant="outline" size="sm" onClick={onLogout}>
              退出登录
            </Button>
          </div>
        </div>
      </header>

      <div className="grid gap-5 lg:grid-cols-[1.15fr_0.85fr]">
        <section className="surface-card rounded-2xl p-4 md:p-5">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-2xl font-semibold tracking-tight text-ink">设置</h2>
            <div className="font-mono text-xs text-slate">Cookie 与用户列表持久化</div>
          </div>

          <div className="mt-4 grid gap-4">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm text-slate">用户列表（支持批量新增/删除/修改）</span>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" onClick={addUser}>
                    新增一行
                  </Button>

                  <Dialog open={batchDialogOpen} onOpenChange={setBatchDialogOpen}>
                    <DialogTrigger asChild>
                      <Button variant="outline" size="sm">
                        批量新增
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="sm:max-w-2xl">
                      <DialogHeader>
                        <DialogTitle>批量新增用户</DialogTitle>
                        <DialogDescription>
                          每行一条，支持 `name,url`、`name\turl`、`name|url` 或仅 `url`。
                        </DialogDescription>
                      </DialogHeader>
                      <Textarea
                        className="h-40 font-mono text-xs"
                        placeholder="示例：\n小红,https://www.douyin.com/user/xxx\nMS4wLjABAAAA..."
                        value={batchInput}
                        onChange={(event) => setBatchInput(event.target.value)}
                      />
                      <DialogFooter>
                        <DialogClose asChild>
                          <Button variant="outline">取消</Button>
                        </DialogClose>
                        <Button onClick={confirmBatchAdd}>确认新增</Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>

                  <Button
                    variant="destructive"
                    size="sm"
                    disabled={selectedUserIndexes.length === 0}
                    onClick={removeSelectedUsers}
                  >
                    批量删除 ({selectedUserIndexes.length})
                  </Button>
                </div>
              </div>

              <div className="surface-soft rounded-xl p-2">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10">
                        <input
                          type="checkbox"
                          checked={allRowsSelected}
                          onChange={(event) => toggleAllUserSelection(event.target.checked)}
                        />
                      </TableHead>
                      <TableHead className="w-12">#</TableHead>
                      <TableHead className="w-40">名称</TableHead>
                      <TableHead>URL / sec_user_id</TableHead>
                      <TableHead className="w-20">操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {settings.user_list.map((item, index) => (
                      <TableRow key={`user-row-${index}`}>
                        <TableCell>
                          <input
                            type="checkbox"
                            checked={selectedUserIndexes.includes(index)}
                            onChange={(event) => toggleUserSelection(index, event.target.checked)}
                          />
                        </TableCell>
                        <TableCell className="font-mono text-xs text-slate">{index + 1}</TableCell>
                        <TableCell>
                          <Input
                            value={item.name}
                            onChange={(event) => updateUser(index, 'name', event.target.value)}
                            placeholder="名称（可选）"
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            className="font-mono text-xs"
                            value={item.url}
                            onChange={(event) => updateUser(index, 'url', event.target.value)}
                            placeholder="https://www.douyin.com/user/... 或 sec_user_id"
                          />
                        </TableCell>
                        <TableCell>
                          <Button variant="destructive" size="sm" onClick={() => removeUser(index)}>
                            删除
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>

            <label className="text-sm text-slate">
              抖音 Cookie
              <Textarea
                className="mt-1 h-28 font-mono text-xs"
                value={settings.douyin_cookie}
                onChange={(event) => updateSetting('douyin_cookie', event.target.value)}
                placeholder="粘贴完整 Cookie"
              />
            </label>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-xs text-slate">
                用户并发
                <Input
                  type="number"
                  className="mt-1"
                  value={settings.max_tasks}
                  min={1}
                  onChange={(event) => updateSetting('max_tasks', Number(event.target.value))}
                />
              </label>

              <label className="text-xs text-slate">
                每页作品数
                <Input
                  type="number"
                  className="mt-1"
                  value={settings.page_counts}
                  min={1}
                  onChange={(event) => updateSetting('page_counts', Number(event.target.value))}
                />
              </label>

              <label className="text-xs text-slate">
                增量阈值
                <Input
                  type="number"
                  className="mt-1"
                  value={settings.incremental_threshold}
                  min={1}
                  onChange={(event) => updateSetting('incremental_threshold', Number(event.target.value))}
                />
              </label>

              <label className="text-xs text-slate">
                下载目录
                <Input
                  type="text"
                  className="mt-1 font-mono text-xs"
                  value={settings.download_path}
                  onChange={(event) => updateSetting('download_path', event.target.value)}
                />
              </label>
            </div>
            {allowedDownloadRoots.length > 0 && (
              <p className="font-mono text-[11px] text-slate">
                可用下载目录范围: {allowedDownloadRoots.join('、')}
              </p>
            )}

            <div className="grid gap-2 text-xs text-slate sm:grid-cols-3">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={settings.incremental_mode}
                  onChange={(event) => updateSetting('incremental_mode', event.target.checked)}
                />
                增量模式
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={settings.update_exif}
                  onChange={(event) => updateSetting('update_exif', event.target.checked)}
                />
                EXIF 更新时间
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={settings.folderize}
                  onChange={(event) => updateSetting('folderize', event.target.checked)}
                />
                作品单独文件夹
              </label>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" disabled={saving} onClick={onSaveSettings}>
                {saving ? '保存中...' : '保存设置'}
              </Button>
              <Button disabled={starting} onClick={onStartTask}>
                {starting ? '启动中...' : '启动任务'}
              </Button>
              <Button variant="destructive" onClick={onCancelTask}>
                取消所选任务
              </Button>
              <Button variant="outline" onClick={() => void refreshAll()}>
                刷新
              </Button>
            </div>
            {message && <p className="font-mono text-xs text-slate">{message}</p>}
          </div>
        </section>

        <section className="surface-card rounded-2xl p-4 md:p-5">
          <h2 className="font-display text-2xl font-semibold tracking-tight text-ink">任务</h2>
          <div className="mt-3 max-h-64 space-y-2 overflow-auto pr-1">
            {tasks.length === 0 && <p className="text-sm text-slate">暂无任务</p>}
            {tasks.map((task) => (
              <button
                key={task.task_id}
                className={`w-full rounded-xl border p-3 text-left transition ${
                  task.task_id === selectedTaskId
                    ? 'border-ink bg-ink text-paper shadow-card'
                    : 'surface-soft hover:border-slate/45'
                }`}
                onClick={() => setSelectedTaskId(task.task_id)}
              >
                <p className="font-mono text-xs">{task.task_id}</p>
                <p className="mt-1 text-sm">状态: {task.status}</p>
              </button>
            ))}
          </div>

          <div className="surface-soft mt-4 rounded-xl p-3">
            <p className="font-mono text-xs text-slate">当前任务详情</p>
            {selectedTask ? (
              <div className="mt-2 space-y-1 text-sm text-ink">
                <p>状态: {selectedTask.status}</p>
                <p>创建: {new Date(selectedTask.created_at).toLocaleString()}</p>
                <p>完成: {selectedTask.ended_at ? new Date(selectedTask.ended_at).toLocaleString() : '-'}</p>
                <p>错误: {selectedTask.error || '-'}</p>
                {selectedTask.result && (
                  <p>
                    汇总: 用户 {selectedTask.result.total} / 成功 {selectedTask.result.success} / 失败{' '}
                    {selectedTask.result.failed} / 新增 {selectedTask.result.total_new} / 跳过{' '}
                    {selectedTask.result.total_skipped}
                  </p>
                )}
                <div className="surface-muted mt-3 rounded-lg p-2">
                  <p className="font-mono text-[11px] text-slate">所选任务最近日志</p>
                  <div className="mt-1 max-h-28 space-y-1 overflow-auto font-mono text-[11px]">
                    {selectedTaskPreviewLogs.length === 0 ? (
                      <p className="text-slate">暂无日志</p>
                    ) : (
                      selectedTaskPreviewLogs.map((log, idx) => (
                        <p key={`${log.timestamp}-preview-${idx}`}>
                          [{new Date(log.timestamp).toLocaleTimeString()}] {log.message}
                        </p>
                      ))
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <p className="mt-2 text-sm text-slate">请选择任务查看详情</p>
            )}
          </div>
        </section>
      </div>

      <section className="surface-card mt-5 rounded-2xl p-4 md:p-5">
        <h2 className="font-display text-2xl font-semibold tracking-tight text-ink">所选任务日志</h2>
        <p className="mt-1 font-mono text-xs text-slate">
          {selectedTaskId ? `任务ID: ${selectedTaskId}` : '未选择任务'}
        </p>
        <div
          ref={logsPanelRef}
          onScroll={onLogsScroll}
          className="surface-log mt-3 max-h-80 overflow-auto rounded-xl p-3 font-mono text-xs text-paper"
        >
          {selectedTaskLogs.length === 0 ? (
            <p className="opacity-70">暂无日志</p>
          ) : (
            selectedTaskLogs.map((log, idx) => (
              <p key={`${log.timestamp}-${idx}`} className={log.level === 'error' ? 'text-red-300' : 'text-emerald-200'}>
                [{new Date(log.timestamp).toLocaleTimeString()}] {log.message}
              </p>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
