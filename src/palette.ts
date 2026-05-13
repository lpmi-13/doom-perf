export const palette = {
  void: "#09080c",
  ceiling: "#17141e",
  floor: "#221d1a",
  wallDark: "#211b22",
  wallMid: "#3b3034",
  wallLight: "#6d5b50",
  ink: "#f2e7cc",
  dim: "#9b8d7a",
  blue: "#4aa0c8",
  cyan: "#6fd2c2",
  green: "#7dbd55",
  yellow: "#d7bd52",
  orange: "#d17838",
  red: "#c74438",
  hot: "#ffdf77",
  purple: "#8b6fcb"
};

export function clamp(value: number, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

export function mixColor(a: string, b: string, amount: number) {
  const av = parseInt(a.slice(1), 16);
  const bv = parseInt(b.slice(1), 16);
  const ar = (av >> 16) & 255;
  const ag = (av >> 8) & 255;
  const ab = av & 255;
  const br = (bv >> 16) & 255;
  const bg = (bv >> 8) & 255;
  const bb = bv & 255;
  const t = clamp(amount);
  const rr = Math.round(ar + (br - ar) * t);
  const rg = Math.round(ag + (bg - ag) * t);
  const rb = Math.round(ab + (bb - ab) * t);
  return `rgb(${rr}, ${rg}, ${rb})`;
}

export function heat(value: number) {
  const v = clamp(value);
  if (v < 0.25) return mixColor(palette.blue, palette.cyan, v / 0.25);
  if (v < 0.5) return mixColor(palette.cyan, palette.green, (v - 0.25) / 0.25);
  if (v < 0.72) return mixColor(palette.green, palette.yellow, (v - 0.5) / 0.22);
  if (v < 0.88) return mixColor(palette.yellow, palette.orange, (v - 0.72) / 0.16);
  return mixColor(palette.orange, palette.red, (v - 0.88) / 0.12);
}
