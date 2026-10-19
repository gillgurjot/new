# syntax=docker/dockerfile:1

# ---- web app ----
FROM node:22-alpine AS web
WORKDIR /src/web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
RUN npm run build

# ---- server ----
FROM golang:1.26-alpine AS server
WORKDIR /src/server
COPY server/go.mod server/go.sum ./
RUN go mod download
COPY server/ ./
COPY --from=web /src/web/dist ./web/dist
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/lumen ./cmd/lumen

# ---- runtime: ffmpeg + Intel/AMD VAAPI & QSV drivers ----
FROM debian:trixie-slim
RUN sed -i 's/^Components: main$/Components: main contrib non-free non-free-firmware/' /etc/apt/sources.list.d/debian.sources \
 && apt-get update \
 && apt-get install -y --no-install-recommends \
      ffmpeg ca-certificates tzdata \
      intel-media-va-driver-non-free i965-va-driver mesa-va-drivers libvpl2 libmfx-gen1.2 vainfo \
 && rm -rf /var/lib/apt/lists/* \
 && useradd --uid 1000 --user-group --no-create-home --home-dir /config lumen \
 && mkdir -p /config /transcode /media \
 && chown lumen:lumen /config /transcode

COPY --from=server /out/lumen /usr/local/bin/lumen

ENV LUMEN_CONFIG_DIR=/config \
    LUMEN_TRANSCODE_DIR=/transcode \
    LUMEN_LISTEN=:8096
USER lumen
EXPOSE 8096
VOLUME ["/config", "/transcode"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD ["lumen", "healthcheck"]
ENTRYPOINT ["lumen"]
