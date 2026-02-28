import { useEffect, useRef, useState } from "react";
import { getRouteApi, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  DEFAULT_TASK_LIST_LIMIT,
  UnauthorizedError,
  api,
  clearAuthToken,
  type LogEntry,
  type TaskDetail,
  type TaskSummary,
  type UserTarget,
} from "../../lib/api";
import { emitDashboardMeta } from "../../lib/dashboardBus";
import { connectTaskWs } from "../../lib/ws";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "../ui/pagination";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../ui/table";

type PaginationToken = number | "ellipsis-left" | "ellipsis-right";

const dashboardRouteApi = getRouteApi("/$panel");
const START_TASK_USER_PAGE_SIZE = 10;

function normalizeUserList(userList: UserTarget[]): UserTarget[] {
  return userList
    .map((item) => ({
      name: item.name.trim(),
      url: item.url.trim(),
    }))
    .filter((item) => item.url.length > 0);
}

function formatTaskTime(raw: string | null): string {
  if (!raw) {
    return "-";
  }
  return new Date(raw).toLocaleString();
}

function formatTaskDuration(task: TaskSummary): string {
  if (!task.started_at) {
    return "-";
  }

  const start = new Date(task.started_at).getTime();
  const end = task.ended_at ? new Date(task.ended_at).getTime() : Date.now();
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) {
    return "-";
  }

  let seconds = Math.floor((end - start) / 1000);
  const hours = Math.floor(seconds / 3600);
  seconds -= hours * 3600;
  const minutes = Math.floor(seconds / 60);
  seconds -= minutes * 60;
  return `${hours}h ${minutes}m ${seconds}s`;
}

function formatTaskStatus(status: TaskSummary["status"]): string {
  switch (status) {
    case "success":
      return "成功";
    case "failed":
      return "失败";
    case "cancelled":
      return "取消";
    case "running":
      return "运行中";
    case "pending":
      return "排队中";
    default:
      return status;
  }
}

function formatTaskSummary(task: TaskSummary): string {
  if (task.result) {
    return `成功 ${task.result.success} / 失败 ${task.result.failed} / 新增 ${task.result.total_new} / 跳过 ${task.result.total_skipped}`;
  }
  if (task.error) {
    return task.error;
  }
  return "-";
}

function buildPaginationTokens(
  totalPages: number,
  currentPage: number,
): PaginationToken[] {
  if (totalPages <= 1) {
    return [1];
  }

  const safeCurrentPage = Math.max(1, Math.min(totalPages, currentPage));

  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }

  const tokens: PaginationToken[] = [1];
  const windowStart = Math.max(2, safeCurrentPage - 1);
  const windowEnd = Math.min(totalPages - 1, safeCurrentPage + 1);

  if (windowStart > 2) {
    tokens.push("ellipsis-left");
  }

  for (let page = windowStart; page <= windowEnd; page += 1) {
    tokens.push(page);
  }

  if (windowEnd < totalPages - 1) {
    tokens.push("ellipsis-right");
  }

  tokens.push(totalPages);
  return tokens;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export function TasksPanel() {
  const routeData = dashboardRouteApi.useLoaderData();
  const navigate = useNavigate();

  const [tasks, setTasks] = useState<TaskSummary[]>(() => routeData.tasks);
  const [tasksHasMore, setTasksHasMore] = useState<boolean>(() => routeData.tasksHasMore);
  const [tasksTotal, setTasksTotal] = useState<number>(() => routeData.tasksTotal);
  const [tasksPage, setTasksPage] = useState(1);
  const [selectedTaskId, setSelectedTaskId] = useState<string>("");
  const [selectedTask, setSelectedTask] = useState<TaskDetail | null>(null);
  const [selectedTaskLogs, setSelectedTaskLogs] = useState<LogEntry[]>([]);
  const [logsDialogOpen, setLogsDialogOpen] = useState(false);
  const [starting, setStarting] = useState(false);
  const [startTaskDialogOpen, setStartTaskDialogOpen] = useState(false);
  const [startTaskSearch, setStartTaskSearch] = useState("");
  const [startTaskPage, setStartTaskPage] = useState(1);
  const [selectedStartUserIndexes, setSelectedStartUserIndexes] = useState<number[]>([]);
  const [startTaskCandidates, setStartTaskCandidates] = useState<UserTarget[]>(() =>
    normalizeUserList(routeData.settings.user_list),
  );

  const logsPanelRef = useRef<HTMLDivElement | null>(null);
  const stickToBottomRef = useRef(true);

  const startTaskSearchText = startTaskSearch.trim().toLowerCase();
  const filteredStartTaskCandidates = startTaskCandidates
    .map((user, index) => ({ user, index }))
    .filter(({ user }) => {
      if (!startTaskSearchText) {
        return true;
      }
      return (
        user.name.toLowerCase().includes(startTaskSearchText) ||
        user.url.toLowerCase().includes(startTaskSearchText)
      );
    });
  const startTaskTotalPages = Math.max(
    1,
    Math.ceil(filteredStartTaskCandidates.length / START_TASK_USER_PAGE_SIZE),
  );
  const startTaskSafePage = Math.max(1, Math.min(startTaskPage, startTaskTotalPages));
  const startTaskPageOffset = (startTaskSafePage - 1) * START_TASK_USER_PAGE_SIZE;
  const pagedStartTaskCandidates = filteredStartTaskCandidates.slice(
    startTaskPageOffset,
    startTaskPageOffset + START_TASK_USER_PAGE_SIZE,
  );
  const startTaskPageTokens = buildPaginationTokens(startTaskTotalPages, startTaskSafePage);
  const tasksTotalPages = Math.max(1, Math.ceil(tasksTotal / DEFAULT_TASK_LIST_LIMIT));
  const taskPageTokens = buildPaginationTokens(tasksTotalPages, tasksPage);
  const allPagedStartUsersSelected =
    pagedStartTaskCandidates.length > 0 &&
    pagedStartTaskCandidates.every(({ index }) => selectedStartUserIndexes.includes(index));

  useEffect(() => {
    emitDashboardMeta({ tasksTotal, tasksPage });
  }, [tasksPage, tasksTotal]);

  useEffect(() => {
    if (startTaskPage === startTaskSafePage) {
      return;
    }
    setStartTaskPage(startTaskSafePage);
  }, [startTaskPage, startTaskSafePage]);

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
    if (!selectedTaskId || !logsDialogOpen) {
      return;
    }

    const terminalEvents = new Set([
      "task_started",
      "task_completed",
      "task_failed",
      "task_cancelled",
      "task_cancel_requested",
    ]);

    const ws = connectTaskWs(selectedTaskId, (evt: any) => {
      if (evt.type === "error") {
        const wsMessage =
          typeof evt.message === "string" ? evt.message : "未授权，请重新登录";
        emitDashboardMeta({ message: wsMessage });
        toast.error(wsMessage);
        clearAuthToken();
        void navigate({ to: "/login" });
        return;
      }

      if (evt.type === "snapshot" && evt.task) {
        setSelectedTask(evt.task);
        setSelectedTaskLogs(evt.task.logs ?? []);
        return;
      }

      if (evt.message) {
        const levelFromData =
          typeof evt?.data?.level === "string" && evt.data.level
            ? String(evt.data.level).toLowerCase()
            : "";

        const log: LogEntry = {
          timestamp: evt.timestamp,
          level: levelFromData || (evt.type.endsWith("failed") ? "error" : "info"),
          message: evt.message,
        };
        setSelectedTaskLogs((prev) => [...prev, log].slice(-1000));
      }

      if (terminalEvents.has(evt.type)) {
        void refreshTasks(tasksPage);
        void refreshTask(selectedTaskId);
      }
    });

    return () => ws.close();
  }, [logsDialogOpen, navigate, selectedTaskId, tasksPage]);

  function handleUnauthorized(error: unknown): boolean {
    if (!(error instanceof UnauthorizedError)) {
      return false;
    }

    const text = "登录已失效，请重新登录";
    emitDashboardMeta({ message: text });
    toast.error(text);
    clearAuthToken();
    void navigate({ to: "/login" });
    return true;
  }

  async function refreshTasks(page = tasksPage) {
    const safePage = Math.max(1, page);
    const offset = (safePage - 1) * DEFAULT_TASK_LIST_LIMIT;
    try {
      const tasksResp = await api.listTasks({
        offset,
        limit: DEFAULT_TASK_LIST_LIMIT,
      });
      if (tasksResp.items.length === 0 && safePage > 1 && tasksResp.total > 0) {
        await refreshTasks(safePage - 1);
        return;
      }
      setTasks(tasksResp.items);
      setTasksHasMore(tasksResp.has_more);
      setTasksTotal(tasksResp.total);
      setTasksPage(safePage);
    } catch (error) {
      if (!handleUnauthorized(error)) {
        const text = `任务列表刷新失败: ${errorMessage(error)}`;
        emitDashboardMeta({ message: text });
        toast.error(text);
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

  async function onStartTask(userList: UserTarget[]) {
    setStarting(true);
    emitDashboardMeta({ message: "" });

    try {
      if (userList.length === 0) {
        throw new Error("用户列表为空");
      }

      const task = await api.createTask(userList);
      await refreshTasks(1);
      emitDashboardMeta({ message: `任务已创建: ${task.task_id}` });
      toast.success(`任务已创建: ${task.task_id}`);
      setStartTaskDialogOpen(false);
      setStartTaskSearch("");
      setSelectedStartUserIndexes([]);
    } catch (error) {
      if (!handleUnauthorized(error)) {
        const text = `启动失败: ${errorMessage(error)}`;
        emitDashboardMeta({ message: text });
        toast.error(text);
      }
    } finally {
      setStarting(false);
    }
  }

  async function onCancelTask(taskId: string) {
    if (!taskId) {
      return;
    }

    try {
      await api.cancelTask(taskId);
      await refreshTasks(tasksPage);
      if (selectedTaskId === taskId) {
        await refreshTask(taskId);
      }
      emitDashboardMeta({ message: "已发送取消请求" });
    } catch (error) {
      if (!handleUnauthorized(error)) {
        const text = `取消失败: ${errorMessage(error)}`;
        emitDashboardMeta({ message: text });
        toast.error(text);
      }
    }
  }

  async function openStartTaskDialog() {
    try {
      const latestSettings = await api.getSettings();
      const users = normalizeUserList(latestSettings.user_list);
      setStartTaskCandidates(users);

      if (users.length === 0) {
        const text = "用户列表为空，请先在设置中添加有效用户";
        emitDashboardMeta({ message: text });
        toast.error(text);
        return;
      }

      setSelectedStartUserIndexes(users.map((_, index) => index));
      setStartTaskSearch("");
      setStartTaskPage(1);
      setStartTaskDialogOpen(true);
    } catch (error) {
      if (!handleUnauthorized(error)) {
        const text = `读取用户列表失败: ${errorMessage(error)}`;
        emitDashboardMeta({ message: text });
        toast.error(text);
      }
    }
  }

  function closeStartTaskDialog(open: boolean) {
    setStartTaskDialogOpen(open);
    if (!open) {
      setStartTaskSearch("");
      setStartTaskPage(1);
      setSelectedStartUserIndexes([]);
    }
  }

  function toggleStartTaskUser(index: number, checked: boolean) {
    setSelectedStartUserIndexes((prev) => {
      if (checked) {
        return Array.from(new Set([...prev, index])).sort((a, b) => a - b);
      }
      return prev.filter((item) => item !== index);
    });
  }

  function toggleAllPagedStartTaskUsers(checked: boolean) {
    const pagedIndexes = pagedStartTaskCandidates.map(({ index }) => index);
    if (!checked) {
      const pagedSet = new Set(pagedIndexes);
      setSelectedStartUserIndexes((prev) => prev.filter((item) => !pagedSet.has(item)));
      return;
    }

    setSelectedStartUserIndexes((prev) => {
      const merged = new Set([...prev, ...pagedIndexes]);
      return Array.from(merged).sort((a, b) => a - b);
    });
  }

  function onPrevStartTaskPage() {
    setStartTaskPage((prev) => Math.max(1, prev - 1));
  }

  function onNextStartTaskPage() {
    setStartTaskPage((prev) => Math.min(startTaskTotalPages, prev + 1));
  }

  function onStartTaskPageChange(page: number) {
    setStartTaskPage(Math.max(1, Math.min(startTaskTotalPages, page)));
  }

  function confirmStartTaskWithSelectedUsers() {
    const selectedUsers = selectedStartUserIndexes
      .map((index) => startTaskCandidates[index])
      .filter((item): item is UserTarget => Boolean(item));

    if (selectedUsers.length === 0) {
      const text = "请至少选择一个用户";
      emitDashboardMeta({ message: text });
      toast.error(text);
      return;
    }

    void onStartTask(selectedUsers);
  }

  function openLogsDialog(taskId: string) {
    setSelectedTaskId(taskId);
    setSelectedTask(null);
    setSelectedTaskLogs([]);
    stickToBottomRef.current = true;
    setLogsDialogOpen(true);
  }

  function closeLogsDialog(open: boolean) {
    setLogsDialogOpen(open);
    if (!open) {
      setSelectedTaskId("");
      setSelectedTask(null);
      setSelectedTaskLogs([]);
    }
  }

  function onPrevPage() {
    if (tasksPage <= 1) {
      return;
    }
    void refreshTasks(tasksPage - 1);
  }

  function onNextPage() {
    if (!tasksHasMore) {
      return;
    }
    void refreshTasks(tasksPage + 1);
  }

  function onTasksPageChange(page: number) {
    const nextPage = Math.max(1, Math.min(tasksTotalPages, page));
    if (nextPage === tasksPage) {
      return;
    }
    void refreshTasks(nextPage);
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
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-2xl font-semibold tracking-tight text-ink">
          任务
        </h2>
        <div className="flex items-center gap-2">
          <Button disabled={starting} onClick={() => void openStartTaskDialog()}>
            {starting ? "启动中..." : "开始任务"}
          </Button>
          <p className="font-mono text-xs text-slate">
            表格视图 / 每页 {DEFAULT_TASK_LIST_LIMIT} 条
          </p>
        </div>
      </div>

      <Dialog open={startTaskDialogOpen} onOpenChange={closeStartTaskDialog}>
        <DialogContent className="sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>开始任务</DialogTitle>
            <DialogDescription>
              请选择要启动抓取的用户，默认全部选中，支持搜索。
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <Input
                className="max-w-md"
                value={startTaskSearch}
                onChange={(event) => {
                  setStartTaskSearch(event.target.value);
                  setStartTaskPage(1);
                }}
                placeholder="搜索名称或 URL / sec_user_id"
              />
              <Button
                variant="outline"
                size="sm"
                type="button"
                onClick={() =>
                  setSelectedStartUserIndexes(
                    startTaskCandidates.map((_, index) => index),
                  )
                }
              >
                全选
              </Button>
              <Button
                variant="outline"
                size="sm"
                type="button"
                onClick={() => setSelectedStartUserIndexes([])}
              >
                清空
              </Button>
            </div>
            <p className="font-mono text-xs text-slate">
              已选 {selectedStartUserIndexes.length} / {startTaskCandidates.length}
            </p>
          </div>

          <div className="max-h-80 overflow-auto rounded-xl border border-paper/70 p-2">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <input
                      type="checkbox"
                      checked={allPagedStartUsersSelected}
                      onChange={(event) =>
                        toggleAllPagedStartTaskUsers(event.target.checked)
                      }
                    />
                  </TableHead>
                  <TableHead className="w-12">#</TableHead>
                  <TableHead className="w-44">名称</TableHead>
                  <TableHead>URL / sec_user_id</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredStartTaskCandidates.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-xs text-slate">
                      未找到匹配用户
                    </TableCell>
                  </TableRow>
                ) : (
                  pagedStartTaskCandidates.map(({ user, index }, rowIndex) => (
                    <TableRow key={`start-user-${index}`}>
                      <TableCell>
                        <input
                          type="checkbox"
                          checked={selectedStartUserIndexes.includes(index)}
                          onChange={(event) =>
                            toggleStartTaskUser(index, event.target.checked)
                          }
                        />
                      </TableCell>
                      <TableCell className="font-mono text-xs text-slate">
                        {startTaskPageOffset + rowIndex + 1}
                      </TableCell>
                      <TableCell className="text-xs">{user.name || "-"}</TableCell>
                      <TableCell className="font-mono text-[11px]">
                        {user.url}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-mono text-xs text-slate">
              第 {startTaskSafePage} / {startTaskTotalPages} 页 · 共 {filteredStartTaskCandidates.length} 条 · 每页{" "}
              {START_TASK_USER_PAGE_SIZE} 条
            </p>
            <Pagination className="mx-0 w-auto justify-end">
              <PaginationContent>
                <PaginationItem>
                  <PaginationPrevious
                    href="#"
                    className={
                      startTaskSafePage <= 1
                        ? "pointer-events-none opacity-50"
                        : undefined
                    }
                    onClick={(event) => {
                      event.preventDefault();
                      onPrevStartTaskPage();
                    }}
                  />
                </PaginationItem>
                {startTaskPageTokens.map((token, index) =>
                  typeof token === "number" ? (
                    <PaginationItem key={`start-task-page-${token}`}>
                      <PaginationLink
                        href="#"
                        isActive={token === startTaskSafePage}
                        onClick={(event) => {
                          event.preventDefault();
                          onStartTaskPageChange(token);
                        }}
                      >
                        {token}
                      </PaginationLink>
                    </PaginationItem>
                  ) : (
                    <PaginationItem key={`start-task-ellipsis-${token}-${index}`}>
                      <PaginationEllipsis />
                    </PaginationItem>
                  ),
                )}
                <PaginationItem>
                  <PaginationNext
                    href="#"
                    className={
                      startTaskSafePage >= startTaskTotalPages
                        ? "pointer-events-none opacity-50"
                        : undefined
                    }
                    onClick={(event) => {
                      event.preventDefault();
                      onNextStartTaskPage();
                    }}
                  />
                </PaginationItem>
              </PaginationContent>
            </Pagination>
          </div>

          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" disabled={starting}>
                取消
              </Button>
            </DialogClose>
            <Button disabled={starting} onClick={confirmStartTaskWithSelectedUsers}>
              {starting
                ? "启动中..."
                : `确认启动（${selectedStartUserIndexes.length}）`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="surface-soft rounded-xl p-2">
        <div className="max-h-[30rem] overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-44">任务 ID</TableHead>
                <TableHead className="w-44">开始时间</TableHead>
                <TableHead className="w-44">结束时间</TableHead>
                <TableHead className="w-24">用时</TableHead>
                <TableHead className="w-24">状态</TableHead>
                <TableHead>汇总</TableHead>
                <TableHead className="w-44">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tasks.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-sm text-slate">
                    暂无任务
                  </TableCell>
                </TableRow>
              ) : (
                tasks.map((task) => {
                  const canCancel = !["success", "failed", "cancelled"].includes(
                    task.status,
                  );
                  return (
                    <TableRow key={task.task_id}>
                      <TableCell className="font-mono text-[11px]">
                        {task.task_id}
                      </TableCell>
                      <TableCell className="text-xs">
                        {formatTaskTime(task.started_at)}
                      </TableCell>
                      <TableCell className="text-xs">
                        {formatTaskTime(task.ended_at)}
                      </TableCell>
                      <TableCell className="font-mono text-[11px]">
                        {formatTaskDuration(task)}
                      </TableCell>
                      <TableCell className="text-xs">
                        {formatTaskStatus(task.status)}
                      </TableCell>
                      <TableCell className="max-w-[22rem] truncate text-xs text-slate">
                        {formatTaskSummary(task)}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => openLogsDialog(task.task_id)}
                          >
                            查看日志
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            disabled={!canCancel}
                            onClick={() => void onCancelTask(task.task_id)}
                          >
                            取消
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <div className="surface-muted flex flex-wrap items-center justify-between gap-2 rounded-xl p-3">
        <p className="font-mono text-xs text-slate">
          第 {tasksPage} 页 / 共 {tasksTotalPages} 页
        </p>
        <Pagination className="mx-0 w-auto justify-end">
          <PaginationContent>
            <PaginationItem>
              <PaginationPrevious
                href="#"
                className={tasksPage <= 1 ? "pointer-events-none opacity-50" : undefined}
                onClick={(event) => {
                  event.preventDefault();
                  onPrevPage();
                }}
              />
            </PaginationItem>
            {taskPageTokens.map((token, index) =>
              typeof token === "number" ? (
                <PaginationItem key={`task-page-${token}`}>
                  <PaginationLink
                    href="#"
                    isActive={token === tasksPage}
                    onClick={(event) => {
                      event.preventDefault();
                      onTasksPageChange(token);
                    }}
                  >
                    {token}
                  </PaginationLink>
                </PaginationItem>
              ) : (
                <PaginationItem key={`task-ellipsis-${token}-${index}`}>
                  <PaginationEllipsis />
                </PaginationItem>
              ),
            )}
            <PaginationItem>
              <PaginationNext
                href="#"
                className={!tasksHasMore ? "pointer-events-none opacity-50" : undefined}
                onClick={(event) => {
                  event.preventDefault();
                  onNextPage();
                }}
              />
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      </div>

      <Dialog open={logsDialogOpen} onOpenChange={closeLogsDialog}>
        <DialogContent className="sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>任务日志</DialogTitle>
            <DialogDescription>
              {selectedTaskId ? `任务 ID: ${selectedTaskId}` : "未选择任务"}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-2 rounded-lg border border-paper/60 p-3 text-xs text-slate md:grid-cols-2">
            <p>状态: {selectedTask ? formatTaskStatus(selectedTask.status) : "-"}</p>
            <p>创建: {selectedTask ? formatTaskTime(selectedTask.created_at) : "-"}</p>
            <p>开始: {selectedTask ? formatTaskTime(selectedTask.started_at) : "-"}</p>
            <p>结束: {selectedTask ? formatTaskTime(selectedTask.ended_at) : "-"}</p>
            <p className="md:col-span-2">
              汇总: {selectedTask ? formatTaskSummary(selectedTask) : "-"}
            </p>
          </div>

          <div className="surface-log mt-2 rounded-xl p-3 font-mono text-xs text-paper">
            <div ref={logsPanelRef} onScroll={onLogsScroll} className="max-h-80 overflow-auto">
              {selectedTaskLogs.length === 0 ? (
                <p className="opacity-70">暂无日志</p>
              ) : (
                selectedTaskLogs.map((log, idx) => (
                  <p
                    key={`${log.timestamp}-${idx}`}
                    className={log.level === "error" ? "text-red-300" : "text-emerald-200"}
                  >
                    [{new Date(log.timestamp).toLocaleTimeString()}] {log.message}
                  </p>
                ))
              )}
            </div>
          </div>

          <DialogFooter>
            {selectedTaskId ? (
              <Button
                variant="destructive"
                onClick={() => void onCancelTask(selectedTaskId)}
                disabled={
                  !selectedTask ||
                  ["success", "failed", "cancelled"].includes(selectedTask.status)
                }
              >
                取消任务
              </Button>
            ) : null}
            <DialogClose asChild>
              <Button variant="outline">关闭</Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
