import type { Config } from "tailwindcss"

import { fontFamily } from "tailwindcss/defaultTheme"
import colors from "tailwindcss/colors"

// Eight Sleep-style look: true black and neutral grays everywhere; color only on
// controls (cyan = cool, red/orange = warm, green = on). The app's classes use
// slate/indigo/purple, so remapping them here restyles every screen at once.
const gray = {
  ...colors.neutral,
  800: "#1c1c1e",
  900: "#111113",
  950: "#000000",
}
// "ink": the app's former accent (indigo/purple) becomes a neutral graphite, so icons,
// chips, tabs and primary buttons are gray. Color stays only where it means something:
// cyan/sky = cool, orange/red = warm, amber = warning, rose = error.
// The accent people can change in Settings → Preferences (src/lib/accents.ts sets the variables);
// the default is that graphite.
const accent = Object.fromEntries(
  ([[50,"242 242 247"],[100,"229 229 234"],[200,"209 209 214"],[300,"174 174 178"],[400,"142 142 147"],[500,"99 99 102"],[600,"58 58 60"],[700,"44 44 46"],[800,"35 35 37"],[900,"28 28 30"],[950,"17 17 19"]] as const).map(([k, rgb]) => [k, `rgb(var(--accent-${k}, ${rgb}) / <alpha-value>)`]),
)

// Switches and "on/OK" states (formerly green) are muted gray: in this look only
// temperature numbers carry color. A mid gray "on" track still shows the white knob.
const status = {
  50: "#f2f2f7",
  100: "#e5e5ea",
  200: "#d1d1d6",
  300: "#aeaeb2",
  400: "#8e8e93",
  500: "#636366",
  600: "#636366",
  700: "#48484a",
  800: "#3a3a3c",
  900: "#2c2c2e",
  950: "#1c1c1e",
}

const config = {
  darkMode: ["class"],
  content: [
    './pages/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './app/**/*.{ts,tsx}',
    './src/**/*.{ts,tsx}',
	],
  prefix: "",
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      colors: {
        slate: gray,
        indigo: accent,
        purple: accent,
        violet: accent,
        emerald: status,
        green: status,
        teal: status,
        // real green, kept for the one thing that must stand out: the Turn on button
        power: colors.emerald,
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
      },
      fontFamily: {
        sans: ["var(--font-sans)", ...fontFamily.sans],
        // technical HUD look for the 3D bed readouts
        hud: ["var(--font-hud)", ...fontFamily.mono],
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
} satisfies Config

export default config