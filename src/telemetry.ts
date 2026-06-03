// Public telemetry surface, kept stable for src/index.ts. Implementation is
// split across ./telemetry/types (schema), ./telemetry/normalize (payload
// parsing), ./telemetry/client (source resolution + SSE), and ./ui/terminalOverlay
// (the instrument-terminal UI). This barrel is a file (not telemetry/index.ts) so
// the import resolves regardless of the tsconfig moduleResolution setting.
export * from "./telemetry/types";
export { resolveTelemetrySource, createTelemetryClient } from "./telemetry/client";
export { createTerminalOverlay } from "./ui/terminalOverlay";
