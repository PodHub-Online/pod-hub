/**
 * Accent colors: each replaces the app's indigo (buttons, icons, highlights) through CSS
 * variables, so every screen follows without touching its classes. RGB triplets per shade.
 */
export const ACCENTS = ["classic", "ocean", "ember", "forest", "lavender"] as const;
export type Accent = (typeof ACCENTS)[number];

const SHADES = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const;

const PALETTES: Record<Accent, string[]> = {
  // the graphite the app has always used
  classic: ["242 242 247","229 229 234","209 209 214","174 174 178","142 142 147","99 99 102","58 58 60","44 44 46","35 35 37","28 28 30","17 17 19"],
  // sky/cyan
  ocean: ["236 254 255", "207 250 254", "165 243 252", "103 232 249", "34 211 238", "6 182 212", "8 145 178", "14 116 144", "21 94 117", "22 78 99", "8 51 68"],
  // orange
  ember: ["255 247 237", "255 237 213", "254 215 170", "253 186 116", "251 146 60", "249 115 22", "234 88 12", "194 65 12", "154 52 18", "124 45 18", "67 20 7"],
  // emerald
  forest: ["236 253 245", "209 250 229", "167 243 208", "110 231 183", "52 211 153", "16 185 129", "5 150 105", "4 120 87", "6 95 70", "6 78 59", "2 44 34"],
  // violet
  lavender: ["245 243 255", "237 233 254", "221 214 254", "196 181 253", "167 139 250", "139 92 246", "124 58 237", "109 40 217", "91 33 182", "76 29 149", "46 16 101"],
};

export const ACCENT_NAMES: Record<Accent, string> = {
  classic: "Classic",
  ocean: "Ocean",
  ember: "Ember",
  forest: "Forest",
  lavender: "Lavender",
};

/** The swatch shown in the picker (shade 500). */
export const swatch = (a: Accent) => `rgb(${PALETTES[a][5]!.replace(/ /g, ",")})`;

/** Sets the accent on the page (the CSS variables Tailwind's indigo reads). */
export function applyAccent(a: Accent) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  PALETTES[a].forEach((rgb, i) => root.style.setProperty(`--accent-${SHADES[i]}`, rgb));
}

export const ACCENT_KEY = "podhub-accent";
