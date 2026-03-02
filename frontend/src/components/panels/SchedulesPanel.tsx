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
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-2xl font-semibold tracking-tight text-ink">
          计划
        </h2>
        <Button onClick={() => void openCreateDialog()}>新建计划</Button>
      </div>

      {/* Schedule list */}
      <div className="surface-soft rounded-xl p-2">
        <div className="max-h-[30rem] overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-44">名称</TableHead>
                <TableHead className="w-44">执行周期</TableHead>
                <TableHead className="w-20">状态</TableHead>
                <TableHead className="w-44">上次执行</TableHead>
                <TableHead className="w-44">下次执行</TableHead>
                <TableHead>操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {schedules.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-sm text-slate">
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
                      <span
                        className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${
                          schedule.enabled
                            ? "bg-emerald-100 text-emerald-700"
                            : "bg-gray-100 text-gray-500"
                        }`}
                      >
                        {schedule.enabled ? "启用" : "禁用"}
                      </span>
                    </TableCell>
                    <TableCell className="text-xs">
                      {formatTime(schedule.last_run_at)}
                    </TableCell>
                    <TableCell className="text-xs">
                      {formatTime(schedule.next_run_at)}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-2">
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

      {/* Create / Edit Dialog */}
      <Dialog open={formDialogOpen} onOpenChange={closeFormDialog}>
        <DialogContent className="sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>{editingScheduleId ? "编辑计划" : "新建计划"}</DialogTitle>
            <DialogDescription>
              设置计划名称、执行周期和要抓取的用户。
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
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
            <div>
              <p className="text-xs text-slate">执行周期</p>
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
                  <div className="surface-muted rounded-lg p-3 text-[11px] leading-relaxed text-slate">
                    <p className="font-semibold text-ink">Cron 表达式格式: 分 时 日 月 周</p>
                    <div className="mt-1.5 font-mono">
                      <p>┌─── 分钟 (0-59)</p>
                      <p>│ ┌─── 小时 (0-23)</p>
                      <p>│ │ ┌─── 日 (1-31)</p>
                      <p>│ │ │ ┌─── 月 (1-12)</p>
                      <p>│ │ │ │ ┌─── 星期 (0-7, 0 和 7 均为周日)</p>
                      <p>* * * * *</p>
                    </div>
                    <p className="mt-1.5">
                      <span className="font-medium text-ink">特殊符号: </span>
                      <span className="font-mono">*</span> 任意值 &nbsp;
                      <span className="font-mono">,</span> 多个值 &nbsp;
                      <span className="font-mono">-</span> 范围 &nbsp;
                      <span className="font-mono">*/n</span> 每隔 n
                    </p>
                    <p className="mt-1">
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
            <div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    className="max-w-md"
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

              <div className="mt-2 max-h-56 overflow-auto rounded-xl border border-paper/70 p-2">
                <Table>
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
                  第 {safeUserPage} / {userTotalPages} 页 · 共 {filteredUsers.length} 条
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
