# syntax=docker/dockerfile:1

# Prebuilt use-practice lab image. We COPY only the baked artifacts out of it
# (the dispatcher + workload binaries + scenarios and the privileged helper);
# none of its other layers ship in the final doom-perf image. Bump this pinned
# tag to adopt a newer use-practice. The referenced image must be published
# (ghcr.io/lpmi-13/use-practice-rootfs) before building doom-perf.
ARG USE_PRACTICE_ROOTFS=ghcr.io/lpmi-13/use-practice-rootfs:v12

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

# Source stage for the bundled use-practice load generator. Nothing is built
# here; the artifacts were already compiled into the pinned use-practice-rootfs
# image and are copied verbatim in the final stage.
FROM ${USE_PRACTICE_ROOTFS} AS use-practice

FROM ghcr.io/iximiuz/labs/rootfs:ubuntu-24-04

USER root
ENV HOME=/root

COPY --from=web-build /src/public /opt/doom-perf/public
COPY --from=telemetry-build /out/doomperf-telemetry /usr/local/bin/doomperf-telemetry
COPY --from=use-practice /opt/use-practice /opt/use-practice
COPY --from=use-practice /usr/local/libexec/use-practice-privileged /usr/local/libexec/use-practice-privileged
COPY playground/iximiuz/image/use-practice-wrapper.sh /usr/local/bin/use-practice
COPY playground/iximiuz/image/use-practice.sudoers /opt/iximiuz-labs/use-practice.sudoers
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
    iproute2 \
    nginx \
    procps \
    sudo \
    sysstat; \
  rm -rf /var/lib/apt/lists/*; \
  install -m 0644 /opt/iximiuz-labs/nginx-doom-perf.conf /etc/nginx/sites-available/doom-perf.conf; \
  rm -f /etc/nginx/sites-enabled/default; \
  ln -sf /etc/nginx/sites-available/doom-perf.conf /etc/nginx/sites-enabled/doom-perf.conf; \
  chmod 755 /usr/local/bin/doomperf-telemetry \
    /opt/iximiuz-labs/bootstrap-doom-perf.sh \
    /opt/iximiuz-labs/wait-doom-perf-ready.sh; \
  chmod 755 /usr/local/bin/use-practice \
    /usr/local/libexec/use-practice-privileged \
    /opt/use-practice/use-practice \
    /opt/use-practice/bin/uworker \
    /opt/use-practice/bin/updisk \
    /opt/use-practice/bin/uwait; \
  find /opt/use-practice/scenarios -name '*.sh' -exec chmod 755 {} +; \
  chown -R root:root /opt/use-practice; \
  install -m 0440 /opt/iximiuz-labs/use-practice.sudoers /etc/sudoers.d/use-practice; \
  visudo -cf /etc/sudoers.d/use-practice; \
  mkdir -p /etc/systemd/system/multi-user.target.wants; \
  ln -sf /etc/systemd/system/doomperf-telemetry.service \
    /etc/systemd/system/multi-user.target.wants/doomperf-telemetry.service; \
  ln -sf /lib/systemd/system/nginx.service \
    /etc/systemd/system/multi-user.target.wants/nginx.service; \
  ln -sf /etc/systemd/system/doomperf-bootstrap.service \
    /etc/systemd/system/multi-user.target.wants/doomperf-bootstrap.service; \
  install -d -m 0755 /var/lib/use-practice; \
  if id laborant >/dev/null 2>&1; then \
    chown -R laborant:laborant /opt/doom-perf; \
    ln -sfn /opt/doom-perf /home/laborant/doom-perf; \
    chown -h laborant:laborant /home/laborant/doom-perf; \
    grep -qxF 'cd ~/doom-perf' /home/laborant/.bashrc || echo 'cd ~/doom-perf' >> /home/laborant/.bashrc; \
    install -d -o laborant -g laborant -m 0755 /var/lib/use-practice/state; \
    ln -sfn /opt/use-practice /home/laborant/use-practice; \
    chown -h laborant:laborant /home/laborant/use-practice; \
  fi; \
  nginx -t; \
  command -v curl >/dev/null; \
  command -v nginx >/dev/null; \
  command -v doomperf-telemetry >/dev/null; \
  command -v ip >/dev/null; \
  command -v sudo >/dev/null; \
  command -v setpriv >/dev/null; \
  command -v sar >/dev/null; \
  command -v use-practice >/dev/null; \
  test -x /opt/use-practice/use-practice; \
  test -x /opt/use-practice/bin/uworker; \
  test -x /opt/use-practice/bin/updisk; \
  test -x /opt/use-practice/bin/uwait; \
  test -x /usr/local/libexec/use-practice-privileged; \
  test -f /opt/use-practice/scripts/lib.sh; \
  test -d /opt/use-practice/scenarios; \
  test -f /opt/doom-perf/public/index.html; \
  test -f /opt/doom-perf/public/game/index.html; \
  test -f /opt/doom-perf/public/dist/index.js; \
  test -f /opt/doom-perf/public/engine/doom.js; \
  test -f /opt/doom-perf/public/engine/doom.wasm; \
  test -f /opt/doom-perf/public/maps/doomperf-lab.wad

USER laborant
ENV HOME=/home/laborant
