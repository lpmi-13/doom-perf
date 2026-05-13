# Doom Perf

A project to visualize working through the USE methodology by walking around in a Doom-esque environment.

## MVP Plan

The initial implementation uses a browser-based Doom-style renderer instead of a literal Doom mod. That keeps the diagnostic visuals free of combat mechanics and lets the environment render native UI concepts like CPU light columns, memory reservoirs, storage rotors, and network conduits.

The app runs through Vite so the frontend has hot module reloading. A small Vite dev-server middleware exposes `/api/telemetry` as a Server-Sent Events stream. Four selectable scenarios simulate load on CPU, memory, storage, and network resources. A fifth scenario reads local Linux data from `/proc` and streams host metrics plus a process sample.

## Why SSE Instead Of A Project WebSocket

The telemetry flow is one-way: the local server pushes metric snapshots to the browser once per second. Server-Sent Events are simpler for that shape because they use normal HTTP, reconnect automatically, and avoid custom socket lifecycle code. A WebSocket would become useful later if the browser needs to send frequent bidirectional commands, for example starting profilers, changing sampling rates, or acknowledging interactive probes.

Vite still uses its own WebSocket internally for hot module reloading. That is separate from the project telemetry channel.

## Run Locally

```bash
npm install
npm run dev
```

Open the Vite URL printed by the command, usually `http://127.0.0.1:5173`.

## Controls

- `W` / `S`: walk forward and backward
- `A` / `D`: turn left and right
- `Q` / `E`: strafe left and right
- `Shift`: move faster
- Walk through open doorways to enter rooms and wings
- `1` to `4`: optional shortcuts to CPU, memory, storage, or network wing entrances
- `0`: return to the atrium
- `Tab`: toggle the automap
- `Esc`: return to the splash screen
