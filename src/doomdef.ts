export const VERSION = 110;

export enum GameMode {
  shareware,
  registered,
  commercial,
  retail,
  indetermined,
}

export enum GameMission {
  doom,
  doom2,
  pack_tnt,
  pack_plut,
  none,
}

export enum Language {
  english,
  french,
  german,
  unknown,
}

export const RANGECHECK = true;
export const SNDSERV = 1;

export const BASE_WIDTH = 320;
export const SCREEN_MUL = 1;
export const INV_ASPECT_RATIO = 0.625;

export const SCREENWIDTH = 320;
export const SCREENHEIGHT = 200;

export const MAXPLAYERS = 4;
export const TICRATE = 35;

export enum GameState {
  GS_LEVEL,
  GS_INTERMISSION,
  GS_FINALE,
  GS_DEMOSCREEN,
}

export const MTF_EASY = 1;
export const MTF_NORMAL = 2;
export const MTF_HARD = 4;
export const MTF_AMBUSH = 8;

export enum Skill {
  sk_baby,
  sk_easy,
  sk_medium,
  sk_hard,
  sk_nightmare,
}

export enum Card {
  it_bluecard,
  it_yellowcard,
  it_redcard,
  it_blueskull,
  it_yellowskull,
  it_redskull,
  NUMCARDS,
}

export enum WeaponType {
  wp_fist,
  wp_pistol,
  wp_shotgun,
  wp_chaingun,
  wp_missile,
  wp_plasma,
  wp_bfg,
  wp_chainsaw,
  wp_supershotgun,
  NUMWEAPONS,
  wp_nochange,
}

export enum AmmoType {
  am_clip,
  am_shell,
  am_cell,
  am_misl,
  NUMAMMO,
  am_noammo,
}

export enum PowerType {
  pw_invulnerability,
  pw_strength,
  pw_invisibility,
  pw_ironfeet,
  pw_allmap,
  pw_infrared,
  NUMPOWERS,
}

export enum PowerDuration {
  INVULNTICS = 30 * TICRATE,
  INVISTICS = 60 * TICRATE,
  INFRATICS = 120 * TICRATE,
  IRONTICS = 60 * TICRATE,
}

export const KEY_RIGHTARROW = 0xae;
export const KEY_LEFTARROW = 0xac;
export const KEY_UPARROW = 0xad;
export const KEY_DOWNARROW = 0xaf;
export const KEY_ESCAPE = 27;
export const KEY_ENTER = 13;
export const KEY_TAB = 9;
export const KEY_F1 = 0x80 + 0x3b;
export const KEY_F2 = 0x80 + 0x3c;
export const KEY_F3 = 0x80 + 0x3d;
export const KEY_F4 = 0x80 + 0x3e;
export const KEY_F5 = 0x80 + 0x3f;
export const KEY_F6 = 0x80 + 0x40;
export const KEY_F7 = 0x80 + 0x41;
export const KEY_F8 = 0x80 + 0x42;
export const KEY_F9 = 0x80 + 0x43;
export const KEY_F10 = 0x80 + 0x44;
export const KEY_F11 = 0x80 + 0x57;
export const KEY_F12 = 0x80 + 0x58;
export const KEY_BACKSPACE = 127;
export const KEY_PAUSE = 0xff;
export const KEY_EQUALS = 0x3d;
export const KEY_MINUS = 0x2d;
export const KEY_RSHIFT = 0x80 + 0x36;
export const KEY_RCTRL = 0x80 + 0x1d;
export const KEY_RALT = 0x80 + 0x38;
export const KEY_LALT = KEY_RALT;
