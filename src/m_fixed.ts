import { MAXINT, MININT } from "./doomtype";

export type Fixed = number;

export const FRACBITS = 16;
export const FRACUNIT = 1 << FRACBITS;

export const FixedMul = (a: Fixed, b: Fixed): Fixed => {
  return Math.trunc((a * b) / FRACUNIT);
};

export const FixedDiv = (a: Fixed, b: Fixed): Fixed => {
  if ((Math.abs(a) >> 14) >= Math.abs(b)) {
    return (a ^ b) < 0 ? MININT : MAXINT;
  }
  return FixedDiv2(a, b);
};

export const FixedDiv2 = (a: Fixed, b: Fixed): Fixed => {
  const c = (a / b) * FRACUNIT;
  if (c >= 2147483648.0 || c < -2147483648.0) {
    throw new Error("FixedDiv: divide by zero");
  }
  return Math.trunc(c);
};
