import { useEffect, useState } from "react";
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

type NumberSettingKey =
  | "max_tasks"
  | "page_counts"
  | "incremental_threshold"
  | "timeout"
  | "max_retries"
  | "max_connections";

const dashboardRouteApi = getRouteApi("/$panel");
const NAMING_TEMPLATE_PATTERN =
  /^\{(?:nickname|create|aweme_id|desc|uid)\}(?:[_-]\{(?:nickname|create|aweme_id|desc|uid)\})*$/;

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

export function SettingsPanel() {
  const routeData = dashboardRouteApi.useLoaderData();
  const navigate = useNavigate();

  const [settings, setSettings] = useState<DownloaderSettings>(() => ({
    ...routeData.settings,
    mode: "post",
  }));
  const [saving, setSaving] = useState(false);
  const [selectedUserIndexes, setSelectedUserIndexes] = useState<number[]>([]);
  const [batchDialogOpen, setBatchDialogOpen] = useState(false);
  const [batchInput, setBatchInput] = useState("");

  const allowedDownloadRoots = routeData.allowedDownloadRoots;
  const allRowsSelected =
    settings.user_list.length > 0 &&
    selectedUserIndexes.length === settings.user_list.length;

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
      setSettings({
        ...saved,
        mode: "post",
        user_list:
          saved.user_list.length > 0 ? saved.user_list : [{ name: "", url: "" }],
      });
      setSelectedUserIndexes([]);
      emitDashboardMeta({
        message: "设置已保存",
        userCount: saved.user_list.length,
      });
      toast.success("设置已保存");
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

  return (
    <section className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-display text-2xl font-semibold tracking-tight text-ink">
            设置
          </h2>
          <div className="font-mono text-xs text-slate">Cookie 与用户列表持久化</div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button disabled={saving} onClick={onSaveSettings}>
            {saving ? "保存中..." : "保存设置"}
          </Button>
        </div>
      </div>

      <div className="mt-4 space-y-5">
        <div className="surface-soft rounded-xl p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="font-display text-lg font-semibold text-ink">目标用户</h3>
              <p className="mt-1 text-xs text-slate">
                用户总数 {settings.user_list.length}，已选中 {selectedUserIndexes.length}。
              </p>
            </div>
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

          <div className="surface-muted mt-3 rounded-xl p-2">
            <div className="max-h-72 overflow-auto pr-1">
              <Table>
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
                      <TableCell>
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
        </div>

        <div className="surface-soft rounded-xl p-4">
          <h3 className="font-display text-lg font-semibold text-ink">认证凭据</h3>
          <p className="mt-1 text-xs text-slate">
            Cookie 仅用于请求鉴权，请保持最新。
          </p>
          <label className="mt-3 block text-xs text-slate">
            抖音 Cookie
            <Textarea
              className="mt-1 h-32 font-mono text-xs"
              value={settings.douyin_cookie}
              onChange={(event) =>
                updateSetting("douyin_cookie", event.target.value)
              }
              placeholder="粘贴完整 Cookie"
            />
          </label>
        </div>

        <div className="surface-soft rounded-xl p-4">
          <h3 className="font-display text-lg font-semibold text-ink">下载内容</h3>
          <p className="mt-1 text-xs text-slate">控制是否下载附加资源。</p>
          <div className="surface-muted mt-3 space-y-2 rounded-lg p-3 text-xs text-slate">
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
        </div>

        <details className="surface-soft rounded-xl p-4">
          <summary className="cursor-pointer select-none text-sm font-semibold text-ink">
            高级参数（并发、重试、增量、命名）
          </summary>

          <div className="mt-4 space-y-4">
            <div>
              <p className="text-xs font-semibold text-ink">并发与网络</p>
              <div className="mt-2 grid max-w-3xl gap-3 md:grid-cols-3">
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
                <label className="block text-xs text-slate">
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
              <p className="text-xs font-semibold text-ink">增量与写入行为</p>
              <div className="mt-2 grid max-w-3xl gap-3 md:grid-cols-2">
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
              </div>
              <div className="surface-muted mt-2 space-y-2 rounded-lg p-3 text-xs text-slate">
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
                    checked={settings.folderize}
                    onChange={(event) =>
                      updateSetting("folderize", event.target.checked)
                    }
                  />
                  作品单独文件夹
                </label>
              </div>
            </div>

            <div>
              <p className="text-xs font-semibold text-ink">命名规则</p>
              <label className="mt-2 block text-xs text-slate">
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
              <p className="mt-1 font-mono text-[11px] text-slate">
                支持变量: {"{nickname}"} {"{create}"} {"{aweme_id}"} {"{desc}"}{" "}
                {"{uid}"}，分隔符仅支持{" _ "}和{" - "}
              </p>
            </div>
          </div>
        </details>

        <div className="surface-soft rounded-xl p-4">
          <h3 className="font-display text-lg font-semibold text-ink">存储目录</h3>
          <p className="mt-1 text-xs text-slate">
            下载文件将写入该目录。保存设置和启动任务前会校验目录是否可写。
          </p>
          <label className="mt-3 block text-xs text-slate">
            下载目录
            <Input
              type="text"
              className="mt-1 font-mono text-xs"
              value={settings.download_path}
              onChange={(event) =>
                updateSetting("download_path", event.target.value)
              }
            />
          </label>
          {allowedDownloadRoots.length > 0 && (
            <p className="mt-2 font-mono text-[11px] text-slate">
              授权目录参考: {allowedDownloadRoots.join("、")}
              （仅供参考，实际以可写性校验结果为准）
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
