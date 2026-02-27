FROM node:20-alpine AS frontend
WORKDIR /workspace/frontend
COPY context/frontend_dist ./dist

FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    SETTINGS_FILE=/data/config/settings.json \
    STATE_DIR=/data/state \
    FRONTEND_DIST=/opt/f2_web/frontend_dist

RUN apt-get update \
    && apt-get install -y --no-install-recommends libimage-exiftool-perl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/f2_web/backend

COPY context/backend/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Use f2 config switch to disable Bark push by default in NAS deployment.
RUN python - <<'PY'
from pathlib import Path
from importlib.resources import files
import yaml

conf_path = Path(str(files("f2") / "conf" / "conf.yaml"))
conf = yaml.safe_load(conf_path.read_text(encoding="utf-8")) or {}
conf.setdefault("f2", {})["enable_bark"] = False
conf_path.write_text(
    yaml.safe_dump(conf, allow_unicode=True, sort_keys=False),
    encoding="utf-8",
)
print(f"patched f2 config: {conf_path}")
PY

COPY context/backend/app ./app
COPY --from=frontend /workspace/frontend/dist /opt/f2_web/frontend_dist

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
