# syntax=docker/dockerfile:1

FROM node:24-bookworm-slim AS web-build

WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci

COPY public ./public
COPY scripts ./scripts
COPY src ./src
COPY tsconfig.json ./
RUN npm run build:map && npm run build

FROM golang:1.22-bookworm AS telemetry-build

WORKDIR /src
COPY go.mod ./
COPY cmd ./cmd
RUN go build -o /out/doomperf-telemetry ./cmd/telemetry

FROM ghcr.io/iximiuz/labs/rootfs:ubuntu-24-04

USER root
ENV HOME=/root

COPY --from=web-build /src/public /opt/doom-perf/public
COPY --from=telemetry-build /out/doomperf-telemetry /usr/local/bin/doomperf-telemetry
COPY playground/iximiuz/image/bootstrap-doom-perf.sh /opt/iximiuz-labs/bootstrap-doom-perf.sh
COPY playground/iximiuz/image/wait-doom-perf-ready.sh /opt/iximiuz-labs/wait-doom-perf-ready.sh
COPY playground/iximiuz/image/doomperf-telemetry.service /etc/systemd/system/doomperf-telemetry.service
COPY playground/iximiuz/image/doomperf-bootstrap.service /etc/systemd/system/doomperf-bootstrap.service
COPY playground/iximiuz/image/nginx-doom-perf.conf /opt/iximiuz-labs/nginx-doom-perf.conf

RUN set -eu; \
  apt-get update; \
  DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    nginx \
    procps; \
  rm -rf /var/lib/apt/lists/*; \
  install -m 0644 /opt/iximiuz-labs/nginx-doom-perf.conf /etc/nginx/sites-available/doom-perf.conf; \
  rm -f /etc/nginx/sites-enabled/default; \
  ln -sf /etc/nginx/sites-available/doom-perf.conf /etc/nginx/sites-enabled/doom-perf.conf; \
  chmod 755 /usr/local/bin/doomperf-telemetry \
    /opt/iximiuz-labs/bootstrap-doom-perf.sh \
    /opt/iximiuz-labs/wait-doom-perf-ready.sh; \
  mkdir -p /etc/systemd/system/multi-user.target.wants; \
  ln -sf /etc/systemd/system/doomperf-telemetry.service \
    /etc/systemd/system/multi-user.target.wants/doomperf-telemetry.service; \
  ln -sf /lib/systemd/system/nginx.service \
    /etc/systemd/system/multi-user.target.wants/nginx.service; \
  ln -sf /etc/systemd/system/doomperf-bootstrap.service \
    /etc/systemd/system/multi-user.target.wants/doomperf-bootstrap.service; \
  if id laborant >/dev/null 2>&1; then \
    chown -R laborant:laborant /opt/doom-perf; \
    ln -sfn /opt/doom-perf /home/laborant/doom-perf; \
    chown -h laborant:laborant /home/laborant/doom-perf; \
    grep -qxF 'cd ~/doom-perf' /home/laborant/.bashrc || echo 'cd ~/doom-perf' >> /home/laborant/.bashrc; \
  fi; \
  nginx -t; \
  command -v curl >/dev/null; \
  command -v nginx >/dev/null; \
  command -v doomperf-telemetry >/dev/null; \
  test -f /opt/doom-perf/public/index.html; \
  test -f /opt/doom-perf/public/dist/index.js; \
  test -f /opt/doom-perf/public/engine/doom.js; \
  test -f /opt/doom-perf/public/engine/doom.wasm; \
  test -f /opt/doom-perf/public/maps/doomperf-lab.wad

USER laborant
ENV HOME=/home/laborant
