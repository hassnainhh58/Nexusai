# syntax=docker/dockerfile:1

FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    NEXUSAI_DB_PATH=/data/nexusai.db

WORKDIR /app

# Dependencies first so the layer is cached between code changes.
COPY requirements.txt ./
RUN pip install --upgrade pip && pip install -r requirements.txt

COPY app ./app

# The container never needs to write to the application code, and it writes the
# SQLite database to the mounted /data volume.
RUN useradd --create-home --uid 10001 nexusai \
    && mkdir -p /data \
    && chown -R nexusai:nexusai /data /app
USER nexusai

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD python -c "import urllib.request,sys; \
sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/health/ready', timeout=4).status == 200 else 1)"

# One worker: SQLite is the datastore, so concurrent writers must stay in a
# single process. Scale out only after moving to a server database.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
