import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { getRouteApi, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  UnauthorizedError,
  api,
  clearAuthToken,
  type DownloaderSettings,
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
  DialogTrigger,
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
import { Textarea } from "../ui/textarea";
import { SectionCard } from "../dashboard/PanelScaffold";

type NumberSettingKey =
  | "max_tasks"
  | "page_counts"
  | "incremental_threshold"
  | "timeout"
  | "max_retries"
  | "max_connections";

type SettingsView = "users" | "access" | "advanced";

const dashboardRouteApi = getRouteApi("/$panel");
const NAMING_TEMPLATE_PATTERN =
  /^\{(?:nickname|create|aweme_id|desc|uid)\}(?:[_-]\{(?:nickname|create|aweme_id|desc|uid)\})*$/;
const SETTINGS_EXPORT_SCHEMA = "f2-web-settings" as const;
const SETTINGS_EXPORT_VERSION = 1;
const SETTINGS_FILE_ACCEPT = "application/json,.json";

type SettingsExportFile = {
  schema: typeof SETTINGS_EXPORT_SCHEMA;
  version: number;
  exported_at: string;
  settings: DownloaderSettings;
};

function normalizeUserList(userList: UserTarget[]): UserTarget[] {
  return userList
    .map((item) => ({
      name: item.name.trim(),
      url: item.url.trim(),
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

    let name = "";
    let url = "";

    if (text.includes("\t")) {
      const [first, ...rest] = text.split("\t");
      name = first.trim();
      url = rest.join("\t").trim();
    } else if (text.includes(",")) {
      const [first, ...rest] = text.split(",");
      name = first.trim();
      url = rest.join(",").trim();
    } else if (text.includes("|")) {
      const [first, ...rest] = text.split("|");
      name = first.trim();
      url = rest.join("|").trim();
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

function normalizeSettingsState(settings: DownloaderSettings): DownloaderSettings {
  return {
    ...settings,
    mode: "post",
    user_list: settings.user_list.length > 0 ? settings.user_list : [{ name: "", url: "" }],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasImportableSettings(value: Record<string, unknown>): boolean {
  return ["user_list", "download_path", "douyin_cookie", "naming"].some(
    (key) => key in value,
  );
}

function extractImportPayload(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error("配置文件格式无效");
  }

  if (value.schema !== SETTINGS_EXPORT_SCHEMA) {
    throw new Error("请选择通过“导出配置”生成的 JSON 文件");
  }

  const settings = value.settings;
  if (!isRecord(settings) || !hasImportableSettings(settings)) {
    throw new Error("配置文件缺少可导入的设置内容");
  }

  return settings;
}

function buildExportPayload(settings: DownloaderSettings): SettingsExportFile {
  return {
    schema: SETTINGS_EXPORT_SCHEMA,
    version: SETTINGS_EXPORT_VERSION,
    exported_at: new Date().toISOString(),
    settings: {
      ...settings,
      mode: "post",
      naming: settings.naming.trim(),
      user_list: normalizeUserList(settings.user_list),
    },
  };
}

function buildExportFileName() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `f2-settings-${timestamp}.json`;
}

function downloadFile(filename: string, content: string) {
  const blob = new Blob([content], { type: "application/json;charset=utf-8" });
  const objectUrl = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(objectUrl);
}

export function SettingsPanel() {
  const routeData = dashboardRouteApi.useLoaderData();
  const navigate = useNavigate();

  const [settings, setSettings] = useState<DownloaderSettings>(() =>
    normalizeSettingsState(routeData.settings),
  );
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [selectedUserIndexes, setSelectedUserIndexes] = useState<number[]>([]);
  const [batchDialogOpen, setBatchDialogOpen] = useState(false);
  const [batchInput, setBatchInput] = useState("");
  const [activeView, setActiveView] = useState<SettingsView>("users");
  const importFileInputRef = useRef<HTMLInputElement | null>(null);

  const allowedDownloadRoots = routeData.allowedDownloadRoots;
  const busy = saving || importing || exporting;
  const allRowsSelected =
    settings.user_list.length > 0 &&
    selectedUserIndexes.length === settings.user_list.length;
  const contentOptionCount = [
    settings.music,
    settings.cover,
    settings.desc,
  ].filter(Boolean).length;
  const automationOptionCount = [
    settings.incremental_mode,
    settings.update_exif,
    settings.live_compose,
    settings.folderize,
  ].filter(Boolean).length;

  useEffect(() => {
    emitDashboardMeta({ userCount: settings.user_list.length });
  }, [settings.user_list.length]);

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

  function applySavedSettings(saved: DownloaderSettings, message: string) {
    const nextSettings = normalizeSettingsState(saved);
    setSettings(nextSettings);
    setSelectedUserIndexes([]);
    emitDashboardMeta({
      message,
      userCount: nextSettings.user_list.length,
    });
    toast.success(message);
  }

  async function onSaveSettings() {
    setSaving(true);
    emitDashboardMeta({ message: "" });

    try {
      const naming = settings.naming.trim();
      if (!NAMING_TEMPLATE_PATTERN.test(naming)) {
        throw new Error(
          "命名模板仅支持 {nickname}/{create}/{aweme_id}/{desc}/{uid}，分隔符仅支持 _ 或 -",
        );
      }

      const normalizedUserList = normalizeUserList(settings.user_list);
      const payload: DownloaderSettings = {
        ...settings,
        mode: "post",
        naming,
        user_list: normalizedUserList,
      };

      const saved = await api.saveSettings(payload);
      applySavedSettings(saved, "设置已保存");
    } catch (error) {
      if (!handleUnauthorized(error)) {
        const text = `保存失败: ${errorMessage(error)}`;
        emitDashboardMeta({ message: text });
        toast.error(text);
      }
    } finally {
      setSaving(false);
    }
  }

  function updateSetting<K extends keyof DownloaderSettings>(
    key: K,
    value: DownloaderSettings[K],
  ) {
    setSettings((prev) => ({ ...prev, [key]: value }));
  }

  function updateNumberSetting(
    key: NumberSettingKey,
    rawValue: string,
    minimum = 1,
  ) {
    const parsed = Number.parseInt(rawValue, 10);
    if (Number.isNaN(parsed)) {
      return;
    }
    updateSetting(key, Math.max(minimum, parsed));
  }

  function updateUser(index: number, key: keyof UserTarget, value: string) {
    setSettings((prev) => ({
      ...prev,
      user_list: prev.user_list.map((item, i) =>
        i === index ? { ...item, [key]: value } : item,
      ),
    }));
  }

  function addUser() {
    setSettings((prev) => ({
      ...prev,
      user_list: [...prev.user_list, { name: "", url: "" }],
    }));
  }

  function removeUser(index: number) {
    setSettings((prev) => {
      const next = prev.user_list.filter((_, i) => i !== index);
      return {
        ...prev,
        user_list: next.length > 0 ? next : [{ name: "", url: "" }],
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
        user_list: next.length > 0 ? next : [{ name: "", url: "" }],
      };
    });
    setSelectedUserIndexes([]);
  }

  function confirmBatchAdd() {
    const parsed = parseBatchUsers(batchInput);
    if (parsed.length === 0) {
      const text = "批量新增失败：未解析到有效 URL";
      emitDashboardMeta({ message: text });
      toast.error(text);
      return;
    }

    setSettings((prev) => ({
      ...prev,
      user_list: [...prev.user_list, ...parsed],
    }));
    setBatchInput("");
    setBatchDialogOpen(false);
    emitDashboardMeta({
      message: `批量新增成功：${parsed.length} 条`,
      userCount: settings.user_list.length + parsed.length,
    });
  }

  function openImportPicker() {
    importFileInputRef.current?.click();
  }

  async function onImportSettings(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) {
      return;
    }

    setImporting(true);
    emitDashboardMeta({ message: "" });

    try {
      const rawText = await file.text();
      let parsed: unknown;

      try {
        parsed = JSON.parse(rawText) as unknown;
      } catch {
        throw new Error("配置文件不是有效的 JSON");
      }

      const payload = extractImportPayload(parsed);
      const saved = await api.importSettings(payload);
      applySavedSettings(saved, "配置已导入并保存");
    } catch (error) {
      if (!handleUnauthorized(error)) {
        const text = `导入失败: ${errorMessage(error)}`;
        emitDashboardMeta({ message: text });
        toast.error(text);
      }
    } finally {
      setImporting(false);
    }
  }

  async function onExportSettings() {
    setExporting(true);
    emitDashboardMeta({ message: "" });

    try {
      const latestSettings = await api.getSettings();
      const payload = buildExportPayload(latestSettings);
      downloadFile(
        buildExportFileName(),
        JSON.stringify(payload, null, 2),
      );
      emitDashboardMeta({
        message: "配置已导出，请妥善保管文件",
        userCount: latestSettings.user_list.length,
      });
      toast.success("配置已导出，请妥善保管文件");
    } catch (error) {
      if (!handleUnauthorized(error)) {
        const text = `导出失败: ${errorMessage(error)}`;
        emitDashboardMeta({ message: text });
        toast.error(text);
      }
    } finally {
      setExporting(false);
    }
  }

  return (
    <section className="space-y-6">
      <input
        ref={importFileInputRef}
        type="file"
        accept={SETTINGS_FILE_ACCEPT}
        className="hidden"
        onChange={onImportSettings}
      />

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="font-display text-2xl font-semibold tracking-[-0.05em] text-ink">
            采集设置
          </h2>
          <span className="ops-chip">
            <strong>{settings.user_list.length}</strong>
            <span>用户</span>
          </span>
          <span className="ops-chip">
            <strong>
              {activeView === "users"
                ? "用户池"
                : activeView === "access"
                  ? "鉴权与目录"
                  : "高级参数"}
            </strong>
            <span>当前焦点</span>
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" disabled={busy} onClick={openImportPicker}>
            {importing ? "导入中..." : "导入配置"}
          </Button>
          <Button variant="outline" disabled={busy} onClick={() => void onExportSettings()}>
            {exporting ? "导出中..." : "导出配置"}
          </Button>
          <span className="ops-chip">
            <strong>{settings.douyin_cookie ? "已配置" : "未配置"}</strong>
            <span>Cookie</span>
          </span>
          <Button disabled={busy} onClick={onSaveSettings}>
            {saving ? "保存中..." : "保存设置"}
          </Button>
        </div>
      </div>

      <div className="surface-soft rounded-[1.6rem] p-2">
        <div className="grid gap-2 md:grid-cols-3">
          <button
            type="button"
            className={`rounded-[1.2rem] px-4 py-3 text-left transition ${
              activeView === "users"
                ? "bg-pine/12 text-ink shadow-[inset_0_0_0_1px_rgb(var(--glow-rgb)_/_0.24)]"
                : "bg-transparent text-slate hover:bg-background/40"
            }`}
            onClick={() => setActiveView("users")}
          >
            <p className="subtle-label">用户池</p>
          </button>
          <button
            type="button"
            className={`rounded-[1.2rem] px-4 py-3 text-left transition ${
              activeView === "access"
                ? "bg-pine/12 text-ink shadow-[inset_0_0_0_1px_rgb(var(--glow-rgb)_/_0.24)]"
                : "bg-transparent text-slate hover:bg-background/40"
            }`}
            onClick={() => setActiveView("access")}
          >
            <p className="subtle-label">鉴权与目录</p>
          </button>
          <button
            type="button"
            className={`rounded-[1.2rem] px-4 py-3 text-left transition ${
              activeView === "advanced"
                ? "bg-pine/12 text-ink shadow-[inset_0_0_0_1px_rgb(var(--glow-rgb)_/_0.24)]"
                : "bg-transparent text-slate hover:bg-background/40"
            }`}
            onClick={() => setActiveView("advanced")}
          >
            <p className="subtle-label">高级参数</p>
          </button>
        </div>
      </div>

      {activeView === "users" ? (
        <SectionCard
          title="目标用户池"
          actions={
            <>
              <span className="ops-chip">
                <strong>{settings.user_list.length}</strong>
                <span>总数</span>
              </span>
              <span className="ops-chip">
                <strong>{selectedUserIndexes.length}</strong>
                <span>已选中</span>
              </span>
            </>
          }
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
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

          <div className="data-shell mt-4 sm:hidden">
            <div className="flex items-center gap-2 px-1 pb-2">
              <input
                type="checkbox"
                checked={allRowsSelected}
                onChange={(event) => toggleAllUserSelection(event.target.checked)}
              />
              <span className="text-[11px] text-slate">全选</span>
            </div>
            <div className="max-h-72 space-y-2 overflow-auto">
              {settings.user_list.map((item, index) => (
                <div key={`user-card-${index}`} className="surface-muted space-y-2 rounded-2xl p-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={selectedUserIndexes.includes(index)}
                        onChange={(event) => toggleUserSelection(index, event.target.checked)}
                      />
                      <span className="font-mono text-[11px] text-slate">#{index + 1}</span>
                    </div>
                    <Button variant="destructive" size="sm" onClick={() => removeUser(index)}>
                      删除
                    </Button>
                  </div>
                  <Input
                    value={item.name}
                    onChange={(event) => updateUser(index, "name", event.target.value)}
                    placeholder="名称（可选）"
                  />
                  <Input
                    className="font-mono text-xs"
                    value={item.url}
                    onChange={(event) => updateUser(index, "url", event.target.value)}
                    placeholder="主页链接或 sec_user_id"
                  />
                </div>
              ))}
            </div>
          </div>

          <div className="data-shell mt-4 hidden sm:block">
            <div className="max-h-72 overflow-y-auto pr-1">
              <Table className="min-w-[900px]">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">
                      <input
                        type="checkbox"
                        checked={allRowsSelected}
                        onChange={(event) =>
                          toggleAllUserSelection(event.target.checked)
                        }
                      />
                    </TableHead>
                    <TableHead className="w-12">#</TableHead>
                    <TableHead className="w-40">名称</TableHead>
                    <TableHead>URL / sec_user_id</TableHead>
                    <TableHead className="table-sticky-right table-sticky-right-head w-20 min-w-[6rem]">
                      操作
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {settings.user_list.map((item, index) => (
                    <TableRow key={`user-row-${index}`}>
                      <TableCell>
                        <input
                          type="checkbox"
                          checked={selectedUserIndexes.includes(index)}
                          onChange={(event) =>
                            toggleUserSelection(index, event.target.checked)
                          }
                        />
                      </TableCell>
                      <TableCell className="font-mono text-xs text-slate">
                        {index + 1}
                      </TableCell>
                      <TableCell>
                        <Input
                          value={item.name}
                          onChange={(event) =>
                            updateUser(index, "name", event.target.value)
                          }
                          placeholder="名称（可选）"
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          className="font-mono text-xs"
                          value={item.url}
                          onChange={(event) =>
                            updateUser(index, "url", event.target.value)
                          }
                          placeholder="https://www.douyin.com/user/... 或 sec_user_id"
                        />
                      </TableCell>
                      <TableCell className="table-sticky-right w-20 min-w-[6rem]">
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => removeUser(index)}
                        >
                          删除
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        </SectionCard>
      ) : null}

      {activeView === "access" ? (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.9fr)]">
          <SectionCard title="认证凭据">
            <label className="block text-xs text-slate">
              抖音 Cookie
              <Textarea
                className="mt-2 h-40 font-mono text-xs"
                value={settings.douyin_cookie}
                onChange={(event) =>
                  updateSetting("douyin_cookie", event.target.value)
                }
                placeholder="粘贴完整 Cookie"
              />
            </label>
          </SectionCard>

          <SectionCard title="存储目录">
            <label className="block text-xs text-slate">
              下载目录
              <Input
                type="text"
                className="mt-2 font-mono text-xs"
                value={settings.download_path}
                onChange={(event) =>
                  updateSetting("download_path", event.target.value)
                }
              />
            </label>
            {allowedDownloadRoots.length > 0 && (
              <p className="mt-3 font-mono text-[11px] leading-5 text-slate">
                授权目录参考: {allowedDownloadRoots.join("、")}
                （仅供参考，实际以可写性校验结果为准）
              </p>
            )}
          </SectionCard>

          <SectionCard title="下载内容" className="xl:col-span-2">
            <div className="surface-muted grid gap-3 rounded-2xl p-4 text-sm text-slate md:grid-cols-3">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={settings.music}
                  onChange={(event) => updateSetting("music", event.target.checked)}
                />
                下载音乐
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={settings.cover}
                  onChange={(event) => updateSetting("cover", event.target.checked)}
                />
                下载封面
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={settings.desc}
                  onChange={(event) => updateSetting("desc", event.target.checked)}
                />
                生成描述文本
              </label>
            </div>
          </SectionCard>
        </div>
      ) : null}

      {activeView === "advanced" ? (
        <SectionCard title="高级参数">
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
            <div className="space-y-6">
              <div>
                <p className="text-xs font-semibold text-ink">并发与网络</p>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <label className="block text-xs text-slate">
                    用户并发
                    <Input
                      type="number"
                      className="mt-1"
                      value={settings.max_tasks}
                      min={1}
                      onChange={(event) =>
                        updateNumberSetting("max_tasks", event.target.value)
                      }
                    />
                  </label>
                  <label className="block text-xs text-slate">
                    每页作品数
                    <Input
                      type="number"
                      className="mt-1"
                      value={settings.page_counts}
                      min={1}
                      onChange={(event) =>
                        updateNumberSetting("page_counts", event.target.value)
                      }
                    />
                  </label>
                  <label className="block text-xs text-slate">
                    超时（秒）
                    <Input
                      type="number"
                      className="mt-1"
                      value={settings.timeout}
                      min={1}
                      onChange={(event) =>
                        updateNumberSetting("timeout", event.target.value)
                      }
                    />
                  </label>
                  <label className="block text-xs text-slate">
                    最大重试次数
                    <Input
                      type="number"
                      className="mt-1"
                      value={settings.max_retries}
                      min={0}
                      onChange={(event) =>
                        updateNumberSetting("max_retries", event.target.value, 0)
                      }
                    />
                  </label>
                  <label className="block text-xs text-slate">
                    最大连接数
                    <Input
                      type="number"
                      className="mt-1"
                      value={settings.max_connections}
                      min={1}
                      onChange={(event) =>
                        updateNumberSetting("max_connections", event.target.value)
                      }
                    />
                  </label>
                  <label className="block text-xs text-slate">
                    增量阈值
                    <Input
                      type="number"
                      className="mt-1"
                      value={settings.incremental_threshold}
                      min={1}
                      onChange={(event) =>
                        updateNumberSetting(
                          "incremental_threshold",
                          event.target.value,
                        )
                      }
                    />
                  </label>
                  <label className="block text-xs text-slate sm:col-span-2">
                    HTTP 代理
                    <Input
                      type="text"
                      className="mt-1 font-mono text-xs"
                      value={settings.proxy_http}
                      onChange={(event) =>
                        updateSetting("proxy_http", event.target.value)
                      }
                      placeholder="http://127.0.0.1:7890"
                    />
                  </label>
                  <label className="block text-xs text-slate sm:col-span-2">
                    HTTPS 代理
                    <Input
                      type="text"
                      className="mt-1 font-mono text-xs"
                      value={settings.proxy_https}
                      onChange={(event) =>
                        updateSetting("proxy_https", event.target.value)
                      }
                      placeholder="http://127.0.0.1:7890"
                    />
                  </label>
                </div>
              </div>

              <div>
                <p className="text-xs font-semibold text-ink">命名规则</p>
                <label className="mt-3 block text-xs text-slate">
                  文件命名模板（naming）
                  <Input
                    type="text"
                    className="mt-1 font-mono text-xs"
                    value={settings.naming}
                    onChange={(event) =>
                      updateSetting("naming", event.target.value)
                    }
                    placeholder="{create}_{desc}"
                  />
                </label>
                <p className="mt-2 font-mono text-[11px] leading-5 text-slate">
                  支持变量: {"{nickname}"} {"{create}"} {"{aweme_id}"} {"{desc}"}{" "}
                  {"{uid}"}，分隔符仅支持{" _ "}和{" - "}
                </p>
              </div>
            </div>

            <div className="space-y-6">
              <div className="surface-muted rounded-2xl p-4">
                <p className="subtle-label">自动化增强</p>
                <div className="mt-4 space-y-3 text-sm text-slate">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={settings.incremental_mode}
                      onChange={(event) =>
                        updateSetting("incremental_mode", event.target.checked)
                      }
                    />
                    增量模式
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={settings.update_exif}
                      onChange={(event) =>
                        updateSetting("update_exif", event.target.checked)
                      }
                    />
                    EXIF 更新时间
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={settings.live_compose}
                      onChange={(event) =>
                        updateSetting("live_compose", event.target.checked)
                      }
                    />
                    实况合成 Motion Photo
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={settings.folderize}
                      onChange={(event) =>
                        updateSetting("folderize", event.target.checked)
                      }
                    />
                    作品单独文件夹
                  </label>
                </div>
              </div>

              <div className="surface-muted rounded-2xl p-4 text-sm text-slate">
                <p className="subtle-label">当前摘要</p>
                <div className="mt-4 space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <span>下载内容项</span>
                    <strong className="font-mono text-ink">{contentOptionCount}/3</strong>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span>自动化增强</span>
                    <strong className="font-mono text-ink">{automationOptionCount}/4</strong>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span>并发组合</span>
                    <strong className="font-mono text-ink">
                      {settings.max_tasks} x {settings.max_connections}
                    </strong>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </SectionCard>
      ) : null}
    </section>
  );
}
