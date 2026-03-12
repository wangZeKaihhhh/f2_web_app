import { useEffect, useState } from "react";
import { getRouteApi, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  UnauthorizedError,
  api,
  clearAuthToken,
  type ScheduleSummary,
  type UserTarget,
} from "../../lib/api";
import { emitDashboardMeta } from "../../lib/dashboardBus";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../ui/table";
import { StatusBadge } from "../dashboard/PanelScaffold";

const dashboardRouteApi = getRouteApi("/$panel");
const USER_PAGE_SIZE = 10;

interface CronPreset {
  label: string;
  value: string;
}

const CRON_PRESETS: CronPreset[] = [
  { label: "每天 02:00", value: "0 2 * * *" },
  { label: "每天 06:00", value: "0 6 * * *" },
  { label: "每 6 小时", value: "0 */6 * * *" },
  { label: "每 12 小时", value: "0 */12 * * *" },
  { label: "每周一 02:00", value: "0 2 * * 1" },
];

function describeCron(expr: string): string {
  const preset = CRON_PRESETS.find((p) => p.value === expr);
  if (preset) {
    return preset.label;
  }

  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) {
    return expr;
  }

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;

  const weekDays: Record<string, string> = {
    "0": "日",
    "1": "一",
    "2": "二",
    "3": "三",
    "4": "四",
    "5": "五",
    "6": "六",
    "7": "日",
  };

  if (dayOfMonth === "*" && month === "*" && dayOfWeek === "*") {
    if (hour.startsWith("*/") && minute === "0") {
      return `每 ${hour.slice(2)} 小时`;
    }
    if (minute.startsWith("*/") && hour === "*") {
      return `每 ${minute.slice(2)} 分钟`;
    }
    if (!hour.includes("*") && !minute.includes("*")) {
      return `每天 ${hour.padStart(2, "0")}:${minute.padStart(2, "0")}`;
    }
  }

  if (dayOfMonth === "*" && month === "*" && dayOfWeek !== "*") {
    const dayName = weekDays[dayOfWeek] ?? dayOfWeek;
    if (!hour.includes("*") && !minute.includes("*")) {
      return `每周${dayName} ${hour.padStart(2, "0")}:${minute.padStart(2, "0")}`;
    }
  }

  return expr;
}

function normalizeUserList(userList: UserTarget[]): UserTarget[] {
  return userList
    .map((item) => ({
      name: item.name.trim(),
      url: item.url.trim(),
    }))
    .filter((item) => item.url.length > 0);
}

function formatTime(raw: string | null): string {
  if (!raw) {
    return "-";
  }
  return new Date(raw).toLocaleString();
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function scheduleStateTone(enabled: boolean): "success" | "neutral" {
  return enabled ? "success" : "neutral";
}

export function SchedulesPanel() {
  const routeData = dashboardRouteApi.useLoaderData();
  const navigate = useNavigate();

  const [schedules, setSchedules] = useState<ScheduleSummary[]>(() => routeData.schedules);

  // form dialog state
  const [formDialogOpen, setFormDialogOpen] = useState(false);
  const [editingScheduleId, setEditingScheduleId] = useState<string | null>(null);
  const [formName, setFormName] = useState("");
  const [formCronExpr, setFormCronExpr] = useState("0 2 * * *");
  const [formCustomCron, setFormCustomCron] = useState("");
  const [formIsCustomCron, setFormIsCustomCron] = useState(false);
  const [formUserCandidates, setFormUserCandidates] = useState<UserTarget[]>([]);
  const [formSelectedUserIndexes, setFormSelectedUserIndexes] = useState<number[]>([]);
  const [formUserSearch, setFormUserSearch] = useState("");
  const [formUserPage, setFormUserPage] = useState(1);
  const [formSaving, setFormSaving] = useState(false);

  // delete dialog state
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const effectiveCronExpr = formIsCustomCron ? formCustomCron : formCronExpr;
  const enabledCount = schedules.filter((schedule) => schedule.enabled).length;
  const pausedCount = schedules.length - enabledCount;
  const scheduledNextRuns = schedules.filter((schedule) => schedule.next_run_at).length;

  // user list filtering & pagination
  const searchText = formUserSearch.trim().toLowerCase();
  const filteredUsers = formUserCandidates
    .map((user, index) => ({ user, index }))
    .filter(({ user }) => {
      if (!searchText) return true;
      return (
        user.name.toLowerCase().includes(searchText) ||
        user.url.toLowerCase().includes(searchText)
      );
    });
  const userTotalPages = Math.max(1, Math.ceil(filteredUsers.length / USER_PAGE_SIZE));
  const safeUserPage = Math.max(1, Math.min(formUserPage, userTotalPages));
  const userPageOffset = (safeUserPage - 1) * USER_PAGE_SIZE;
  const pagedUsers = filteredUsers.slice(userPageOffset, userPageOffset + USER_PAGE_SIZE);
  const allPagedSelected =
    pagedUsers.length > 0 &&
    pagedUsers.every(({ index }) => formSelectedUserIndexes.includes(index));

  useEffect(() => {
    emitDashboardMeta({ schedulesTotal: schedules.length });
  }, [schedules.length]);

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

  async function refreshSchedules() {
    try {
      const resp = await api.listSchedules();
      setSchedules(resp.items);
    } catch (error) {
      if (!handleUnauthorized(error)) {
        toast.error(`刷新计划列表失败: ${errorMessage(error)}`);
      }
    }
  }

  async function openCreateDialog() {
    try {
      const latestSettings = await api.getSettings();
      const users = normalizeUserList(latestSettings.user_list);

      if (users.length === 0) {
        toast.error("用户列表为空，请先在设置中添加有效用户");
        return;
      }

      setEditingScheduleId(null);
      setFormName("");
      setFormCronExpr("0 2 * * *");
      setFormCustomCron("");
      setFormIsCustomCron(false);
      setFormUserCandidates(users);
      setFormSelectedUserIndexes(users.map((_, i) => i));
      setFormUserSearch("");
      setFormUserPage(1);
      setFormDialogOpen(true);
    } catch (error) {
      if (!handleUnauthorized(error)) {
        toast.error(`读取用户列表失败: ${errorMessage(error)}`);
      }
    }
  }

  async function openEditDialog(schedule: ScheduleSummary) {
    try {
      const latestSettings = await api.getSettings();
      const allUsers = normalizeUserList(latestSettings.user_list);

      // merge schedule's user_list into allUsers if not already present
      const allUrls = new Set(allUsers.map((u) => u.url));
      for (const u of schedule.user_list) {
        if (!allUrls.has(u.url)) {
          allUsers.push(u);
        }
      }

      const scheduleUrls = new Set(schedule.user_list.map((u) => u.url));
      const selectedIndexes = allUsers
        .map((u, i) => ({ u, i }))
        .filter(({ u }) => scheduleUrls.has(u.url))
        .map(({ i }) => i);

      const isPreset = CRON_PRESETS.some((p) => p.value === schedule.cron_expr);

      setEditingScheduleId(schedule.schedule_id);
      setFormName(schedule.name);
      if (isPreset) {
        setFormCronExpr(schedule.cron_expr);
        setFormIsCustomCron(false);
        setFormCustomCron("");
      } else {
        setFormCronExpr("");
        setFormIsCustomCron(true);
        setFormCustomCron(schedule.cron_expr);
      }
      setFormUserCandidates(allUsers);
      setFormSelectedUserIndexes(selectedIndexes);
      setFormUserSearch("");
      setFormUserPage(1);
      setFormDialogOpen(true);
    } catch (error) {
      if (!handleUnauthorized(error)) {
        toast.error(`读取用户列表失败: ${errorMessage(error)}`);
      }
    }
  }

  function closeFormDialog(open: boolean) {
    setFormDialogOpen(open);
    if (!open) {
      setEditingScheduleId(null);
      setFormUserSearch("");
      setFormSelectedUserIndexes([]);
    }
  }

  async function onSaveSchedule() {
    const name = formName.trim();
    if (!name) {
      toast.error("请输入计划名称");
      return;
    }

    const cronExpr = effectiveCronExpr.trim();
    if (!cronExpr) {
      toast.error("请选择或输入 Cron 表达式");
      return;
    }

    const selectedUsers = formSelectedUserIndexes
      .map((i) => formUserCandidates[i])
      .filter((u): u is UserTarget => Boolean(u));

    if (selectedUsers.length === 0) {
      toast.error("请至少选择一个用户");
      return;
    }

    setFormSaving(true);
    try {
      if (editingScheduleId) {
        await api.updateSchedule(editingScheduleId, {
          name,
          cron_expr: cronExpr,
          user_list: selectedUsers,
        });
        toast.success("计划已更新");
      } else {
        await api.createSchedule({
          name,
          cron_expr: cronExpr,
          user_list: selectedUsers,
        });
        toast.success("计划已创建");
      }
      setFormDialogOpen(false);
      await refreshSchedules();
    } catch (error) {
      if (!handleUnauthorized(error)) {
        toast.error(`保存失败: ${errorMessage(error)}`);
      }
    } finally {
      setFormSaving(false);
    }
  }

  async function onToggle(scheduleId: string) {
    try {
      await api.toggleSchedule(scheduleId);
      await refreshSchedules();
    } catch (error) {
      if (!handleUnauthorized(error)) {
        toast.error(`切换状态失败: ${errorMessage(error)}`);
      }
    }
  }

  async function onRunNow(scheduleId: string) {
    try {
      const result = await api.runScheduleNow(scheduleId);
      toast.success(`任务已创建: ${result.task_id}`);
      await refreshSchedules();
    } catch (error) {
      if (!handleUnauthorized(error)) {
        toast.error(`执行失败: ${errorMessage(error)}`);
      }
    }
  }

  function openDeleteDialog(scheduleId: string) {
    setDeleteTargetId(scheduleId);
    setDeleteDialogOpen(true);
  }

  function closeDeleteDialog(open: boolean) {
    setDeleteDialogOpen(open);
    if (!open) {
      setDeleteTargetId(null);
    }
  }

  async function confirmDelete() {
    if (!deleteTargetId) return;
    setDeleting(true);
    try {
      await api.deleteSchedule(deleteTargetId);
      toast.success("计划已删除");
      setDeleteDialogOpen(false);
      await refreshSchedules();
    } catch (error) {
      if (!handleUnauthorized(error)) {
        toast.error(`删除失败: ${errorMessage(error)}`);
      }
    } finally {
      setDeleting(false);
    }
  }

  function selectCronPreset(value: string) {
    setFormCronExpr(value);
    setFormIsCustomCron(false);
    setFormCustomCron("");
  }

  function switchToCustomCron() {
    setFormIsCustomCron(true);
    setFormCronExpr("");
  }

  function toggleUser(index: number, checked: boolean) {
    setFormSelectedUserIndexes((prev) => {
      if (checked) {
        return Array.from(new Set([...prev, index])).sort((a, b) => a - b);
      }
      return prev.filter((i) => i !== index);
    });
  }

  function toggleAllPagedUsers(checked: boolean) {
    const pagedIndexes = pagedUsers.map(({ index }) => index);
    if (!checked) {
      const pagedSet = new Set(pagedIndexes);
      setFormSelectedUserIndexes((prev) => prev.filter((i) => !pagedSet.has(i)));
      return;
    }
    setFormSelectedUserIndexes((prev) => {
      const merged = new Set([...prev, ...pagedIndexes]);
      return Array.from(merged).sort((a, b) => a - b);
    });
  }

  return (
    <section className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="font-display text-2xl font-semibold tracking-[-0.05em] text-ink">
            计划列表
          </h2>
          <span className="ops-chip">
            <strong>{enabledCount}/{pausedCount}</strong>
            <span>启用/暂停</span>
          </span>
          <span className="ops-chip">
            <strong>{scheduledNextRuns}</strong>
            <span>已排程</span>
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="ops-chip">
            <strong>{schedules.length}</strong>
            <span>计划</span>
          </span>
          <Button onClick={() => void openCreateDialog()}>新建计划</Button>
        </div>
      </div>

      <section className="section-card shell-panel surface-soft">
        <div className="space-y-4">
          {/* 移动端卡片视图 */}
          <div className="space-y-3 sm:hidden">
            {schedules.length === 0 ? (
              <div className="data-shell p-6 text-center text-sm text-slate">
                暂无计划任务
              </div>
            ) : (
              schedules.map((schedule) => (
                <div
                  key={schedule.schedule_id}
                  className="shell-panel surface-muted rounded-[1.4rem] p-4 space-y-3"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-medium text-ink">{schedule.name}</span>
                    <StatusBadge tone={scheduleStateTone(schedule.enabled)}>
                      {schedule.enabled ? "启用" : "禁用"}
                    </StatusBadge>
                  </div>
                  <div className="space-y-1.5 text-[11px] leading-5 text-slate">
                    <p>
                      执行周期:{" "}
                      <span className="font-mono">{describeCron(schedule.cron_expr)}</span>
                    </p>
                    <p>上次执行: {formatTime(schedule.last_run_at)}</p>
                    <p>下次执行: {formatTime(schedule.next_run_at)}</p>
                  </div>
                  <div className="flex flex-wrap gap-2 pt-1">
                    <Button size="sm" variant="outline" onClick={() => void openEditDialog(schedule)}>
                      编辑
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => void onToggle(schedule.schedule_id)}>
                      {schedule.enabled ? "禁用" : "启用"}
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => void onRunNow(schedule.schedule_id)}>
                      立即执行
                    </Button>
                    <Button size="sm" variant="destructive" onClick={() => openDeleteDialog(schedule.schedule_id)}>
                      删除
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* 桌面端表格视图 */}
          <div className="data-shell hidden sm:block">
            <div className="max-h-[30rem] overflow-y-auto">
              <Table className="min-w-[1080px]">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-44">名称</TableHead>
                    <TableHead className="w-44">执行周期</TableHead>
                    <TableHead className="w-28">状态</TableHead>
                    <TableHead className="w-44">上次执行</TableHead>
                    <TableHead className="w-44">下次执行</TableHead>
                    <TableHead className="table-sticky-right table-sticky-right-head min-w-[20rem]">
                      操作
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {schedules.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="py-10 text-center text-sm text-slate">
                        暂无计划任务
                      </TableCell>
                    </TableRow>
                  ) : (
                    schedules.map((schedule) => (
                      <TableRow key={schedule.schedule_id}>
                        <TableCell className="text-xs font-medium">
                          {schedule.name}
                        </TableCell>
                        <TableCell className="font-mono text-[11px]">
                          {describeCron(schedule.cron_expr)}
                        </TableCell>
                        <TableCell>
                          <StatusBadge tone={scheduleStateTone(schedule.enabled)}>
                            {schedule.enabled ? "启用" : "禁用"}
                          </StatusBadge>
                        </TableCell>
                        <TableCell className="text-xs">
                          {formatTime(schedule.last_run_at)}
                        </TableCell>
                        <TableCell className="text-xs">
                          {formatTime(schedule.next_run_at)}
                        </TableCell>
                        <TableCell className="table-sticky-right min-w-[20rem]">
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => void openEditDialog(schedule)}
                            >
                              编辑
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => void onToggle(schedule.schedule_id)}
                            >
                              {schedule.enabled ? "禁用" : "启用"}
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => void onRunNow(schedule.schedule_id)}
                            >
                              立即执行
                            </Button>
                            <Button
                              size="sm"
                              variant="destructive"
                              onClick={() => openDeleteDialog(schedule.schedule_id)}
                            >
                              删除
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        </div>
      </section>

      {/* Create / Edit Dialog */}
      <Dialog open={formDialogOpen} onOpenChange={closeFormDialog}>
        <DialogContent className="sm:max-w-5xl">
          <DialogHeader>
            <DialogTitle>{editingScheduleId ? "编辑计划" : "新建计划"}</DialogTitle>
            <DialogDescription>
              设置计划名称、执行周期和要抓取的用户。
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto">
            {/* Name */}
            <label className="block text-xs text-slate">
              计划名称
              <Input
                className="mt-1"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="例如: 每日定时备份"
              />
            </label>

            {/* Cron expression */}
            <div className="data-shell">
              <p className="subtle-label">执行周期</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {CRON_PRESETS.map((preset) => (
                  <Button
                    key={preset.value}
                    size="sm"
                    variant={
                      !formIsCustomCron && formCronExpr === preset.value
                        ? "default"
                        : "outline"
                    }
                    onClick={() => selectCronPreset(preset.value)}
                  >
                    {preset.label}
                  </Button>
                ))}
                <Button
                  size="sm"
                  variant={formIsCustomCron ? "default" : "outline"}
                  onClick={switchToCustomCron}
                >
                  自定义
                </Button>
              </div>

              {formIsCustomCron && (
                <div className="mt-2 space-y-2">
                  <Input
                    className="max-w-sm font-mono text-xs"
                    value={formCustomCron}
                    onChange={(e) => setFormCustomCron(e.target.value)}
                    placeholder="Cron 表达式，例如: 30 3 * * 0,6"
                  />
                  <div className="surface-muted rounded-2xl p-3 text-[11px] leading-relaxed text-slate">
                    <p className="font-semibold text-ink">Cron 表达式格式: 分 时 日 月 周</p>
                    <div className="mt-1.5 hidden font-mono sm:block">
                      <p>┌─── 分钟 (0-59)</p>
                      <p>│ ┌─── 小时 (0-23)</p>
                      <p>│ │ ┌─── 日 (1-31)</p>
                      <p>│ │ │ ┌─── 月 (1-12)</p>
                      <p>│ │ │ │ ┌─── 星期 (0-7, 0 和 7 均为周日)</p>
                      <p>* * * * *</p>
                    </div>
                    <p className="mt-1.5">
                      <span className="font-medium text-ink">示例: </span>
                      <span className="font-mono">30 3 * * *</span> 每天 03:30 &nbsp;
                      <span className="font-mono">0 8 * * 1-5</span> 工作日 08:00 &nbsp;
                      <span className="font-mono">0 */4 * * *</span> 每 4 小时
                    </p>
                  </div>
                </div>
              )}

              {effectiveCronExpr.trim() && (
                <p className="mt-1 font-mono text-[11px] text-slate">
                  {describeCron(effectiveCronExpr.trim())}
                </p>
              )}
            </div>

            {/* User selection */}
            <div className="space-y-3">
              <div className="data-shell space-y-2 sm:flex sm:flex-wrap sm:items-center sm:justify-between sm:gap-2 sm:space-y-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    className="w-full sm:max-w-md"
                    value={formUserSearch}
                    onChange={(e) => {
                      setFormUserSearch(e.target.value);
                      setFormUserPage(1);
                    }}
                    placeholder="搜索名称或 URL / sec_user_id"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    type="button"
                    onClick={() =>
                      setFormSelectedUserIndexes(
                        formUserCandidates.map((_, i) => i),
                      )
                    }
                  >
                    全选
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    type="button"
                    onClick={() => setFormSelectedUserIndexes([])}
                  >
                    清空
                  </Button>
                </div>
                <p className="font-mono text-xs text-slate">
                  已选 {formSelectedUserIndexes.length} / {formUserCandidates.length}
                </p>
              </div>

              {/* 移动端卡片列表 */}
              <div className="data-shell mt-2 max-h-56 space-y-2 overflow-auto sm:hidden">
                {filteredUsers.length === 0 ? (
                  <p className="py-4 text-center text-xs text-slate">未找到匹配用户</p>
                ) : (
                  pagedUsers.map(({ user, index }, rowIndex) => (
                    <label
                      key={`sched-user-card-${index}`}
                      className="surface-muted flex items-start gap-2 rounded-2xl p-3"
                    >
                      <input
                        type="checkbox"
                        className="mt-0.5 shrink-0"
                        checked={formSelectedUserIndexes.includes(index)}
                        onChange={(e) => toggleUser(index, e.target.checked)}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono text-[11px] text-slate">#{userPageOffset + rowIndex + 1}</span>
                          <span className="text-xs font-medium truncate">{user.name || "-"}</span>
                        </div>
                        <p className="mt-0.5 truncate font-mono text-[11px] text-slate">{user.url}</p>
                      </div>
                    </label>
                  ))
                )}
              </div>

              {/* 桌面端表格 */}
              <div className="data-shell mt-2 hidden max-h-56 overflow-y-auto sm:block">
                <Table className="min-w-[760px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10">
                        <input
                          type="checkbox"
                          checked={allPagedSelected}
                          onChange={(e) => toggleAllPagedUsers(e.target.checked)}
                        />
                      </TableHead>
                      <TableHead className="w-12">#</TableHead>
                      <TableHead className="w-44">名称</TableHead>
                      <TableHead>URL / sec_user_id</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredUsers.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={4} className="text-center text-xs text-slate">
                          未找到匹配用户
                        </TableCell>
                      </TableRow>
                    ) : (
                      pagedUsers.map(({ user, index }, rowIndex) => (
                        <TableRow key={`sched-user-${index}`}>
                          <TableCell>
                            <input
                              type="checkbox"
                              checked={formSelectedUserIndexes.includes(index)}
                              onChange={(e) => toggleUser(index, e.target.checked)}
                            />
                          </TableCell>
                          <TableCell className="font-mono text-xs text-slate">
                            {userPageOffset + rowIndex + 1}
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

              <div className="mt-2 flex items-center justify-between">
                <p className="font-mono text-xs text-slate">
                  {safeUserPage}/{userTotalPages} 页 · {filteredUsers.length} 条
                </p>
                <div className="flex gap-1">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={safeUserPage <= 1}
                    onClick={() => setFormUserPage((p) => Math.max(1, p - 1))}
                  >
                    上一页
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={safeUserPage >= userTotalPages}
                    onClick={() =>
                      setFormUserPage((p) => Math.min(userTotalPages, p + 1))
                    }
                  >
                    下一页
                  </Button>
                </div>
              </div>
            </div>
          </div>

          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" disabled={formSaving}>
                取消
              </Button>
            </DialogClose>
            <Button disabled={formSaving} onClick={() => void onSaveSchedule()}>
              {formSaving
                ? "保存中..."
                : editingScheduleId
                  ? "更新计划"
                  : `创建计划（${formSelectedUserIndexes.length}）`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={closeDeleteDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>确认删除</DialogTitle>
            <DialogDescription>
              删除后无法恢复，确定要删除该计划吗？
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" disabled={deleting}>
                取消
              </Button>
            </DialogClose>
            <Button
              variant="destructive"
              disabled={deleting}
              onClick={() => void confirmDelete()}
            >
              {deleting ? "删除中..." : "确认删除"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
