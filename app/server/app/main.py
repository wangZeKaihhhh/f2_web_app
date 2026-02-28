from __future__ import annotations

import os
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from app.core.auth_service import AuthService, extract_bearer_token
from app.core.crawler_service import DouyinCrawlerService
from app.core.download_path_policy import DownloadPathPolicy
from app.core.login_rate_limiter import LoginRateLimiter
from app.core.settings_store import SettingsStore
from app.core.task_manager import TaskManager
from app.core.task_store import TaskStore
from app.models import (
    AuthPasswordRequest,
    AuthStatus,
    AuthTokenResponse,
    DownloaderSettings,
    TaskCreateRequest,
    TaskListResponse,
    TaskDetail,
    TaskSummary,
)


def _get_app_env() -> str:
    app_env = os.getenv("APP_ENV", "development").strip().lower()
    return app_env if app_env else "development"


def _env_defaults(app_env: str, runtime_root: Path) -> tuple[Path, Path, Path]:
    if app_env == "package":
        return (
            Path("/data/config/settings.json"),
            Path("/data/state"),
            Path("/data/downloads"),
        )

    return (
        runtime_root / "config" / "settings.development.json",
        runtime_root / "state",
        runtime_root / "downloads",
    )


def _resolve_writable_file(default_file: Path, fallback_file: Path) -> str:
    try:
        default_file.parent.mkdir(parents=True, exist_ok=True)
        return str(default_file)
    except OSError:
        fallback_file.parent.mkdir(parents=True, exist_ok=True)
        return str(fallback_file)


def _resolve_writable_dir(default_dir: Path, fallback_dir: Path) -> str:
    try:
        default_dir.mkdir(parents=True, exist_ok=True)
        return str(default_dir)
    except OSError:
        fallback_dir.mkdir(parents=True, exist_ok=True)
        return str(fallback_dir)


def _get_client_identity(request: Request) -> str:
    forwarded_for = request.headers.get("x-forwarded-for", "").strip()
    if forwarded_for:
        first = forwarded_for.split(",", 1)[0].strip()
        if first:
            return first

    real_ip = request.headers.get("x-real-ip", "").strip()
    if real_ip:
        return real_ip

    if request.client and request.client.host:
        return request.client.host
    return "unknown"


def create_app() -> FastAPI:
    app = FastAPI(title="F2 Web App", version="0.1.0")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    runtime_root = Path.cwd() / ".runtime"
    app_env = _get_app_env()
    default_settings_file, default_state_dir, default_download_dir = _env_defaults(
        app_env, runtime_root
    )

    settings_file = os.getenv("SETTINGS_FILE") or _resolve_writable_file(
        default_settings_file,
        runtime_root / "config" / "settings.json",
    )

    if "STATE_DIR" not in os.environ:
        os.environ["STATE_DIR"] = _resolve_writable_dir(
            default_state_dir,
            runtime_root / "state",
        )

    if "DOWNLOAD_PATH" not in os.environ:
        os.environ["DOWNLOAD_PATH"] = _resolve_writable_dir(
            default_download_dir,
            runtime_root / "downloads",
        )

    task_db_file = os.getenv("TASK_DB_FILE") or _resolve_writable_file(
        Path(os.environ["STATE_DIR"]) / "tasks.sqlite3",
        runtime_root / "state" / "tasks.sqlite3",
    )

    default_auth_file = (
        Path("/data/config/auth.json")
        if app_env == "package"
        else runtime_root / "config" / "auth.development.json"
    )
    auth_file = os.getenv("AUTH_FILE") or _resolve_writable_file(
        default_auth_file,
        runtime_root / "config" / "auth.json",
    )

    try:
        task_history_limit = int(os.getenv("TASK_HISTORY_LIMIT", "200"))
    except ValueError:
        task_history_limit = 200

    try:
        auth_token_ttl = int(os.getenv("AUTH_TOKEN_TTL", str(12 * 60 * 60)))
    except ValueError:
        auth_token_ttl = 12 * 60 * 60

    try:
        login_max_attempts = int(os.getenv("AUTH_LOGIN_MAX_ATTEMPTS", "6"))
    except ValueError:
        login_max_attempts = 6
    try:
        login_window_seconds = int(os.getenv("AUTH_LOGIN_WINDOW_SECONDS", "300"))
    except ValueError:
        login_window_seconds = 300
    try:
        login_block_seconds = int(os.getenv("AUTH_LOGIN_BLOCK_SECONDS", "600"))
    except ValueError:
        login_block_seconds = 600

    download_path_policy = DownloadPathPolicy(
        app_env=app_env,
        default_download_dir=Path(os.environ["DOWNLOAD_PATH"]),
    )

    settings_store = SettingsStore(settings_file)
    task_store = TaskStore(task_db_file, max_tasks=task_history_limit)
    auth_service = AuthService(
        auth_file,
        token_ttl_seconds=auth_token_ttl,
        bootstrap_password=os.getenv("APP_PASSWORD", ""),
    )
    login_rate_limiter = LoginRateLimiter(
        max_attempts=login_max_attempts,
        window_seconds=login_window_seconds,
        block_seconds=login_block_seconds,
    )
    task_manager = TaskManager(
        DouyinCrawlerService(),
        task_store=task_store,
    )

    @app.middleware("http")
    async def _auth_guard(request: Request, call_next):
        path = request.url.path
        if request.method == "OPTIONS":
            return await call_next(request)

        if not path.startswith("/api"):
            return await call_next(request)

        public_api_paths = {
            "/api/health",
            "/api/auth/status",
            "/api/auth/setup",
            "/api/auth/login",
        }
        if path in public_api_paths:
            return await call_next(request)

        configured = await auth_service.is_configured()
        if not configured:
            return JSONResponse(
                status_code=401,
                content={"detail": "请先设置访问密码"},
            )

        token = extract_bearer_token(request.headers.get("Authorization"))
        if not await auth_service.verify_token(token):
            return JSONResponse(
                status_code=401,
                content={"detail": "未授权，请先登录"},
            )

        return await call_next(request)

    @app.on_event("startup")
    async def _startup() -> None:
        await auth_service.ensure()
        settings = await settings_store.ensure()
        if app_env != "package" and settings.download_path == "/data/downloads":
            settings.download_path = os.environ["DOWNLOAD_PATH"]

        try:
            settings.download_path = download_path_policy.normalize(settings.download_path)
        except ValueError:
            settings.download_path = os.environ["DOWNLOAD_PATH"]

        await settings_store.save(settings)

        await task_manager.startup()

    @app.on_event("shutdown")
    async def _shutdown() -> None:
        await task_manager.shutdown()

    @app.get("/api/health")
    async def health() -> dict[str, bool]:
        return {"ok": True}

    @app.get("/api/auth/status", response_model=AuthStatus)
    async def get_auth_status() -> AuthStatus:
        return AuthStatus(
            configured=await auth_service.is_configured(),
            allowed_download_roots=download_path_policy.allowed_roots,
        )

    @app.post("/api/auth/setup", response_model=AuthTokenResponse)
    async def post_auth_setup(request: Request, payload: AuthPasswordRequest) -> AuthTokenResponse:
        identity = _get_client_identity(request)
        blocked = await login_rate_limiter.blocked_seconds(identity)
        if blocked > 0:
            raise HTTPException(
                status_code=429,
                detail=f"尝试过于频繁，请 {blocked} 秒后重试",
            )

        try:
            token = await auth_service.setup_password(payload.password)
            await login_rate_limiter.register_success(identity)
            return AuthTokenResponse(token=token)
        except ValueError as exc:
            wait = await login_rate_limiter.register_failure(identity)
            if wait > 0:
                raise HTTPException(
                    status_code=429,
                    detail=f"尝试过于频繁，请 {wait} 秒后重试",
                ) from exc
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.post("/api/auth/login", response_model=AuthTokenResponse)
    async def post_auth_login(request: Request, payload: AuthPasswordRequest) -> AuthTokenResponse:
        identity = _get_client_identity(request)
        blocked = await login_rate_limiter.blocked_seconds(identity)
        if blocked > 0:
            raise HTTPException(
                status_code=429,
                detail=f"尝试过于频繁，请 {blocked} 秒后重试",
            )

        try:
            token = await auth_service.login(payload.password)
            await login_rate_limiter.register_success(identity)
            return AuthTokenResponse(token=token)
        except PermissionError as exc:
            wait = await login_rate_limiter.register_failure(identity)
            if wait > 0:
                raise HTTPException(
                    status_code=429,
                    detail=f"尝试过于频繁，请 {wait} 秒后重试",
                ) from exc
            raise HTTPException(status_code=401, detail=str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.get("/api/settings", response_model=DownloaderSettings)
    async def get_settings() -> DownloaderSettings:
        return await settings_store.load()

    @app.put("/api/settings", response_model=DownloaderSettings)
    async def put_settings(payload: DownloaderSettings) -> DownloaderSettings:
        try:
            normalized = payload.model_copy(deep=True)
            normalized.download_path = download_path_policy.ensure_writable(
                payload.download_path
            )
            return await settings_store.save(normalized)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.post("/api/tasks", response_model=TaskSummary)
    async def post_task(payload: TaskCreateRequest) -> TaskSummary:
        settings = await settings_store.load()
        try:
            normalized_download_path = download_path_policy.ensure_writable(
                settings.download_path
            )
            if normalized_download_path != settings.download_path:
                settings.download_path = normalized_download_path
                await settings_store.save(settings)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

        user_list = payload.user_list if payload.user_list is not None else settings.user_list

        if not user_list:
            raise HTTPException(status_code=400, detail="用户列表为空，请先配置后再启动")

        return await task_manager.create_task(settings=settings, user_list=user_list)

    @app.get("/api/tasks", response_model=TaskListResponse)
    async def list_tasks(
        offset: int = Query(default=0, ge=0),
        limit: int = Query(default=50, ge=1, le=200),
    ) -> TaskListResponse:
        items, total = await task_manager.list_tasks(offset=offset, limit=limit)
        return TaskListResponse(
            items=items,
            total=total,
            offset=offset,
            limit=limit,
            has_more=offset + len(items) < total,
        )

    @app.get("/api/tasks/{task_id}", response_model=TaskDetail)
    async def get_task(task_id: str) -> TaskDetail:
        try:
            return await task_manager.get_task_detail(task_id)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail="任务不存在") from exc

    @app.get("/api/tasks/{task_id}/logs")
    async def get_task_logs(task_id: str):
        try:
            return await task_manager.get_logs(task_id)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail="任务不存在") from exc

    @app.post("/api/tasks/{task_id}/cancel", response_model=TaskSummary)
    async def post_task_cancel(task_id: str) -> TaskSummary:
        try:
            return await task_manager.cancel_task(task_id)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail="任务不存在") from exc

    @app.websocket("/ws/tasks/{task_id}")
    async def ws_task(websocket: WebSocket, task_id: str) -> None:
        configured = await auth_service.is_configured()
        token = websocket.query_params.get("token")
        authorized = configured and await auth_service.verify_token(token)

        await websocket.accept()
        if not authorized:
            message = "请先设置访问密码" if not configured else "未授权，请先登录"
            await websocket.send_json({"type": "error", "message": message})
            await websocket.close(code=1008)
            return

        try:
            queue = await task_manager.subscribe(task_id)
            detail = await task_manager.get_task_detail(task_id)
            await websocket.send_json(
                {
                    "type": "snapshot",
                    "task": detail.model_dump(mode="json"),
                }
            )
        except KeyError:
            await websocket.send_json({"type": "error", "message": "任务不存在"})
            await websocket.close(code=1008)
            return

        try:
            while True:
                event = await queue.get()
                await websocket.send_json(event.model_dump(mode="json"))
        except WebSocketDisconnect:
            pass
        finally:
            try:
                await task_manager.unsubscribe(task_id, queue)
            except KeyError:
                pass

    dist_path = Path(os.getenv("FRONTEND_DIST", "/opt/f2_web/frontend_dist"))
    assets_path = dist_path / "assets"

    if assets_path.exists():
        app.mount("/assets", StaticFiles(directory=str(assets_path)), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    async def spa_fallback(full_path: str):
        if full_path.startswith("api") or full_path.startswith("ws"):
            raise HTTPException(status_code=404, detail="Not Found")

        index_file = dist_path / "index.html"
        request_file = dist_path / full_path

        if request_file.exists() and request_file.is_file():
            return FileResponse(request_file)

        if index_file.exists():
            return FileResponse(index_file)

        raise HTTPException(status_code=404, detail="前端资源不存在，请先构建 frontend")

    return app


app = create_app()
