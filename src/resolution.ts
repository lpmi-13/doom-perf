export type Resolution = "320" | "640" | "960";

const storageKey = "doomperf-resolution";
const valid = (value: string | null): value is Resolution =>
  value === "320" || value === "640" || value === "960";

const savedResolution = (): Resolution | null => {
  try {
    const value = localStorage.getItem(storageKey);
    return valid(value) ? value : null;
  } catch {
    return null;
  }
};

const saveResolution = (resolution: Resolution): void => {
  try { localStorage.setItem(storageKey, resolution); } catch { /* private browsing */ }
};

// Load the default engine immediately so its animated flamegraph title appears
// behind the native Doom menu, including on a first visit.
export const chooseResolution = (): Resolution => {
  const override = new URL(location.href).searchParams.get("resolution");
  return valid(override) ? override : savedResolution() ?? "640";
};

// A resolution change reloads the page onto another engine build. When a level
// was running, its mode rides across the reload in sessionStorage (one-shot, so
// a later manual refresh still lands on the title menu) and is restarted there.
const resumeKey = "doomperf-resume-mode";

export const takeResumeMode = (): number | null => {
  try {
    const value = sessionStorage.getItem(resumeKey);
    sessionStorage.removeItem(resumeKey);
    const mode = Number(value);
    return value !== null && Number.isInteger(mode) && mode >= 0 ? mode : null;
  } catch {
    return null;
  }
};

export const applyResolutionRequest = (
  requested: number,
  current: Resolution,
  resumeMode: number | null = null,
): void => {
  const next = String(requested);
  if (!valid(next)) return;
  saveResolution(next);
  if (next === current) return;
  if (resumeMode !== null) {
    try { sessionStorage.setItem(resumeKey, String(resumeMode)); } catch { /* private browsing */ }
  }
  const url = new URL(location.href);
  url.pathname = "/game/";
  url.searchParams.set("resolution", next);
  location.assign(url.href);
};

export const engineUrls = (resolution: Resolution, version: string) => {
  const directory = resolution === "320" ? "/engine" : `/engine/${resolution}x${Number(resolution) * 5 / 8}`;
  return {
    script: `${directory}/doom.js?v=${version}`,
    wasm: `${directory}/doom.wasm?v=${version}`,
  };
};

export const showResolutionError = (resolution: Resolution): void => {
  if (resolution === "320") return;
  const loading = document.getElementById("loading");
  if (!loading) return;
  const button = document.createElement("button");
  button.className = "resolution-error-button";
  button.textContent = "Try Low";
  button.addEventListener("click", () => applyResolutionRequest(320, resolution));
  loading.append(button);
};
