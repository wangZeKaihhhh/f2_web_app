# f2_web_app

面向飞牛 fnOS 的抖音数据采集与备份工具，核心爬虫能力引用自 [`f2`](https://github.com/Johnserf-Seed/f2)，并提供 Web 管理界面与飞牛 FPK 打包支持。

## 免责声明

本项目仅用于你有合法授权的数据采集与备份。请遵守目标平台服务条款及当地法律法规。
本项目与抖音及其关联公司无任何官方关系，仅供在合法授权范围内进行数据备份与研究。严禁用于未授权采集、隐私侵害、批量滥用、商业转售等行为。使用者应自行遵守相关法律法规及平台规则，并对自身行为及后果承担全部责任。因不当使用造成的任何法律风险或损失，项目作者与贡献者不承担责任。

## 功能概览

- Web 化任务管理（创建、查看、取消任务）
- 计划任务（Cron 定时调度，自动执行采集）
- 多用户批量采集与任务日志实时回传
- 任务状态持久化（SQLite）
- 访问密码鉴权与登录限流
- 配置持久化与敏感字段加密存储
- FPK 一键打包（适配飞牛 fnOS）

### 实况合成 Motion Photo

抖音实况（Live Photo）下载后会产生两组独立文件：`_image_N.webp`（静态图）和 `_live_N.mp4`（视频）。开启「实况合成 Motion Photo」后，下载完成会自动将配对文件合成为安卓 Motion Photo 格式（`_motion_N.jpg`），并删除原始分离文件。

- 在设置面板中通过「实况合成 Motion Photo」开关控制，默认开启
- 合成原理：JPG + MP4 字节拼接，通过 XMP-GCamera 元数据标识视频偏移量
- 依赖 `ffmpeg`（必需）和 `exiftool`（可选，缺失时退化为裸拼接，部分安卓系统仍可识别）
- 合成后的 `.jpg` 文件可传到安卓设备 Google Photos 中播放实况效果

### 计划任务

支持通过 Cron 表达式配置定时采集计划，到期后自动创建并执行任务。

- 在 Web 界面侧边栏点击"计划"进入管理页面
- 支持创建、编辑、删除、启用/禁用计划
- 内置常用周期预设（每天 02:00、每 6 小时、每周一等），也可自定义 Cron 表达式
- 每个计划可独立选择要采集的用户列表
- 支持"立即执行"手动触发一次
- 计划触发的任务与手动创建的任务统一在"任务"面板中展示

## 本地开发

### 前置依赖

- Python 3.11+
- Node.js 20+
- pnpm 10+
- fnpack（仅打包需要）

### 配置分层

项目按 `APP_ENV` 区分配置：

- 开发环境（`APP_ENV=development`）
  - `SETTINGS_FILE=backend/.runtime/config/settings.development.json`
  - `STATE_DIR=backend/.runtime/state`
  - `DOWNLOAD_PATH=backend/.runtime/downloads`
- 打包运行（`APP_ENV=package`）
  - `SETTINGS_FILE=${TRIM_PKGVAR}/config/settings.json`
  - `STATE_DIR=${TRIM_PKGVAR}/state`
  - `DOWNLOAD_PATH=${TRIM_DATA_SHARE_PATHS}`（未配置时回退到 `${TRIM_PKGVAR}/downloads`）

参考模板：

- [`scripts/dev.env`](scripts/dev.env)
- [`scripts/package.env`](scripts/package.env)
- [`backend/dev_settings.example.json`](backend/dev_settings.example.json)

### 启动前端（开发）

```bash
./scripts/dev_frontend.sh
```

### 启动后端（开发）

```bash
./scripts/dev_backend.sh
```

默认监听 `http://localhost:8001`，也支持通过 `BACKEND_PORT` 覆盖端口。

也可手动启动：

```bash
cd backend
source .venv/bin/activate
APP_ENV=development \
SETTINGS_FILE=./.runtime/config/settings.development.json \
STATE_DIR=./.runtime/state \
DOWNLOAD_PATH=./.runtime/downloads \
python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8001
```

## Docker 部署

项目提供了完整的 Docker 版本（多阶段构建：前端打包 + 后端运行）。

### 使用 Docker Compose（推荐）

```bash
docker compose up -d --build
```

启动后访问：

- `http://localhost:8000`

默认会创建名为 `f2_data` 的持久化卷，并在容器内使用：

- 配置：`/data/config/settings.json`
- 运行状态：`/data/state`
- 下载目录：`/data/downloads`

停止服务：

```bash
docker compose down
```

### 使用 Docker 命令

```bash
docker build -t f2-web-fpk:latest .
docker run -d \
  --name f2-web-fpk \
  -p 8000:8000 \
  -v f2_data:/data \
  f2-web-fpk:latest
```

## 打包 FPK

```bash
./scripts/build_fpk.sh
```

脚本会执行：

1. 构建 frontend dist
2. 同步 backend + dist 到 `app/server` 与 `app/frontend_dist`
3. 运行 `fnpack build`

## 安全与运维

### 访问密码与登录

- 首次访问需设置密码。
- 登录成功后会签发 Bearer Token。
- 默认 Token 有效期：`12h`（`AUTH_TOKEN_TTL=43200`）。

可配置环境变量：

- `APP_PASSWORD`：可选，应用首次启动时预置密码
- `AUTH_TOKEN_TTL`：Token 有效期（秒）
- `AUTH_LOGIN_MAX_ATTEMPTS`：窗口内最大失败次数（默认 6）
- `AUTH_LOGIN_WINDOW_SECONDS`：统计窗口（默认 300 秒）
- `AUTH_LOGIN_BLOCK_SECONDS`：触发后封禁时长（默认 600 秒）

### 忘记密码

当前版本无“找回密码”接口。可通过重置认证文件恢复：

1. 停止应用服务
2. 删除 `${TRIM_PKGVAR}/config/auth.json`
3. 重启应用
4. 重新设置访问密码

### 下载目录限制（fnOS 打包环境）

在 `APP_ENV=package` 时，下载目录支持用户自定义绝对路径。后端会在保存设置和任务启动前执行“创建目录 + 写入探针文件”检查；如果无写权限会返回明确错误信息。

## 许可证

本项目采用 Apache License 2.0，详见 [`LICENSE`](LICENSE)。

上游与衍生说明见 [`NOTICE`](NOTICE)。
