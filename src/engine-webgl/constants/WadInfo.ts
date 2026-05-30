export const flatSize = 64;

export const skyTextures = ['SKY1', 'SKY2', 'SKY3'];

export const skyFlats = ['F_SKY1', 'F_SKY'];

export enum difficulty {
  easy,
  intermediate,
  hard
};

export const animatedFlatMap: Record<string, string> = {
	NUKAGE1: 'NUKAGE3',
	FWATER1: 'FWATER4',
	SWATER1: 'SWATER4',
	LAVA1: 'LAVA4',
	BLOOD1: 'BLOOD3',
	RROCK05: 'RROCK08',
	SLIME01: 'SLIME04',
	SLIME05: 'SLIME08',
	SLIME09: 'SLIME12'
};

export const animatedTextureMap: Record<string, string> = {
	BLODGR1:'BLODGR4',
	BLODRIP1: 'BLODRIP4',
	FIREBLU1: 'FIREBLU2',
	FIRLAV3: 'FIRELAVA',
	FIREMAG1: 'FIREMAG3',
	FIREWALA: 'FIREWALL',
	GSTFONT1: 'GSTFONT3',
	ROCKRED1: 'ROCKRED3',
	SLADRIP1: 'SLADRIP3',
	BFALL1: 'BFALL4',
	SFALL1: 'SFALL4',
	WFALL1: 'WFALL4',
	DBRAIN1: 'DBRAIN4'
};

export const animatedFlatFps = 4;

export const animatedWallFps = 4;

export const animatedSpriteFps = 8;

export const hudPatchInventory = {
  statusBar: "STBAR",
  statusFont: "STCFN033-095, STCFN121",
  ammoIcon: "STIMA0",
  armsBackground: "STARMS",
  percent: "STTPRCNT",
  minus: "STTMINUS",
  tallNumbers: [
    "STTNUM0",
    "STTNUM1",
    "STTNUM2",
    "STTNUM3",
    "STTNUM4",
    "STTNUM5",
    "STTNUM6",
    "STTNUM7",
    "STTNUM8",
    "STTNUM9",
  ],
  greenNumbers: [
    "STGNUM0",
    "STGNUM1",
    "STGNUM2",
    "STGNUM3",
    "STGNUM4",
    "STGNUM5",
    "STGNUM6",
    "STGNUM7",
    "STGNUM8",
    "STGNUM9",
  ],
  yellowNumbers: [
    "STYSNUM0",
    "STYSNUM1",
    "STYSNUM2",
    "STYSNUM3",
    "STYSNUM4",
    "STYSNUM5",
    "STYSNUM6",
    "STYSNUM7",
    "STYSNUM8",
    "STYSNUM9",
  ],
  keys: ["STKEYS0", "STKEYS1", "STKEYS2", "STKEYS3", "STKEYS4", "STKEYS5"],
  face: {
    straight: [
      "STFST00",
      "STFST01",
      "STFST02",
      "STFST10",
      "STFST11",
      "STFST12",
      "STFST20",
      "STFST21",
      "STFST22",
      "STFST30",
      "STFST31",
      "STFST32",
      "STFST40",
      "STFST41",
      "STFST42",
    ],
    turnLeft: ["STFTL00", "STFTL10", "STFTL20", "STFTL30", "STFTL40"],
    turnRight: ["STFTR00", "STFTR10", "STFTR20", "STFTR30", "STFTR40"],
    ouch: ["STFOUCH0", "STFOUCH1", "STFOUCH2", "STFOUCH3", "STFOUCH4"],
    evilGrin: ["STFEVL0", "STFEVL1", "STFEVL2", "STFEVL3", "STFEVL4"],
    kill: ["STFKILL0", "STFKILL1", "STFKILL2", "STFKILL3", "STFKILL4"],
    god: ["STFGOD0"],
    dead: ["STFDEAD0"],
  },
  faceBackground: ["STFB0", "STFB1", "STFB2", "STFB3"],
  playerBox: ["STPB0", "STPB1", "STPB2", "STPB3"],
  weaponSprites: {
    doom1: [
      "PISGA0",
      "PISGB0",
      "PISGC0",
      "PISGD0",
      "PISGE0",
      "SHTGA0",
      "SHTGB0",
      "SHTGC0",
      "SHTGD0",
      "CHGGA0",
      "CHGGB0",
      "SAWGA0",
      "SAWGB0",
      "SAWGC0",
      "SAWGD0",
      "LAUNA0",
    ],
    doom2: [
      "PISGA0",
      "PISGB0",
      "PISGC0",
      "PISGD0",
      "PISGE0",
      "SHTGA0",
      "SHTGB0",
      "SHTGC0",
      "SHTGD0",
      "CHGGA0",
      "CHGGB0",
      "SAWGA0",
      "SAWGB0",
      "SAWGC0",
      "SAWGD0",
      "LAUNA0",
      "BFGGA0",
      "BFGGB0",
      "BFGGC0",
      "PLSGA0",
      "PLSGB0",
    ],
  },
};
