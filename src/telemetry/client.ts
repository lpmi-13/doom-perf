// Telemetry source resolution + the Server-Sent-Events client that streams
// normalized snapshots to the caller.
import type { TelemetryClient, TelemetrySnapshot, TelemetryStatus } from "./types";
import { emptyTelemetry, normalizeTelemetry, parseMessage } from "./normalize";

const isLocalHost = (hostname: string) =>
  hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";

const isAllowedLocalTelemetryEndpoint = (url: URL) =>
  isLocalHost(window.location.hostname) &&
  (url.hostname === "localhost" || url.hostname === "127.0.0.1") &&
  url.protocol === "http:" &&
  url.port === "9999" &&
  url.pathname === "/telemetry";

export const resolveTelemetrySource = (): string | null => {
  const params = new URLSearchParams(window.location.search);
  const raw = params.get("telemetry") ?? params.get("telemetryUrl");
  if (!raw) {
    // Same-origin in every environment: the iximiuz prod VM fronts the collector
    // with nginx, and the local dev server (scripts/build-web.mjs) proxies
    // /telemetry to the Go collector the same way. No cross-origin request, so
    // the collector needs no CORS. An explicit ?telemetry=<url> can still point
    // at the loopback collector directly (see isAllowedLocalTelemetryEndpoint).
    return "/telemetry";
  }
  const value = raw.trim();
  if (!value || /^(0|false|off|none|disabled)$/i.test(value)) {
    return null;
  }
  if (/^(same-origin|sameorigin|relative)$/i.test(value)) {
    return "/telemetry";
  }

  let url: URL;
  try {
    url = new URL(value, window.location.href);
  } catch {
    console.warn(`Ignoring invalid telemetry source: ${value}`);
    return null;
  }

  if (url.origin === window.location.origin) {
    return `${url.pathname}${url.search}${url.hash}`;
  }

  if (isAllowedLocalTelemetryEndpoint(url)) {
    return url.href;
  }

  console.warn(`Ignoring disallowed telemetry source: ${value}`);
  return null;
};

export const createTelemetryClient = (
  source: string | null,
  onTelemetry: (telemetry: TelemetrySnapshot) => void
): TelemetryClient => {
  if (!source) {
    onTelemetry(emptyTelemetry("disabled", "disabled"));
    return { close: () => undefined };
  }

  let lastTelemetry: TelemetrySnapshot | undefined;

  const publish = (telemetry: TelemetrySnapshot) => {
    lastTelemetry = telemetry;
    onTelemetry(telemetry);
  };

  const publishStatus = (status: TelemetryStatus) => {
    publish({
      ...(lastTelemetry ?? emptyTelemetry(source, status)),
      status,
      source,
      updatedAt: Date.now(),
    });
  };

  publishStatus("connecting");
  const events = new EventSource(source);
  events.addEventListener("open", () => publishStatus("live"));
  const handleMessage = (event: Event) => {
    const message = event as MessageEvent;
    const telemetry = normalizeTelemetry(parseMessage(String(message.data)), source, "live");
    if (telemetry) {
      publish(telemetry);
    }
  };
  events.addEventListener("telemetry", handleMessage);
  events.addEventListener("message", handleMessage);
  events.addEventListener("error", () => publishStatus("error"));

  return {
    close: () => {
      events.close();
    },
  };
};
