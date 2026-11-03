"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Power } from "lucide-react";
import { ContactShadows, Html, OrbitControls, RoundedBox, Sparkles } from "@react-three/drei";
import { AdditiveBlending, CanvasTexture, Color, Object3D, SRGBColorSpace, type InstancedMesh, type Mesh, type MeshBasicMaterial, type MeshStandardMaterial } from "three";
import { SkyScene, type SkyLabel } from "~/components/skyScene";
import { type SkyState } from "~/lib/sky";
import { MODE_COLOR, modeOf, type Mode, type SideState } from "~/components/bedDiagram";
import { tx } from "~/lib/i18n";
import { formatLevel } from "~/lib/presets";
import { formatTemp, useTempUnit } from "~/lib/tempUnit";


const MATTRESS_W = 2.1; // whole mattress width (x)
const MATTRESS_L = 2.5; // length (z), head at -z
const MATTRESS_H = 0.32;

/** Bed colors for each theme: light gray furniture in light mode, the dark Pod look in dark mode. */
const PALETTE = {
  dark: { mattress: "#1f2937", base: "#334155", headboard: "#475569", legs: "#1e293b", hub: "#1e293b" },
  light: { mattress: "#cfd4dc", base: "#e2e5ea", headboard: "#d6dae0", legs: "#9aa1ac", hub: "#c4c9d1" },
};
type Theme = keyof typeof PALETTE;
const TOP_Y = 0.42 + MATTRESS_H / 2;

/** The single mattress: a dark knit cover, like the Pod's. One bed, not two. */
function Mattress({ theme }: { theme: Theme }) {
  return (
    <>
      <RoundedBox args={[MATTRESS_W, MATTRESS_H, MATTRESS_L]} radius={0.09} smoothness={4} position={[0, 0.42, 0]} castShadow receiveShadow>
        <meshStandardMaterial color={PALETTE[theme].mattress} roughness={0.95} />
      </RoundedBox>
    </>
  );
}

const DOT_COLS = 38; // across the bed
const DOT_ROWS = 44; // head to foot
const DOT_R = 0.013;

/**
 * Grid of glowing dots across the whole cover, colored per zone. A soft wave runs
 * through each zone: toward the foot when cooling, toward the head when warming.
 */
function DotMatrix({
  leftMode,
  rightMode,
  wholeBed,
  still = false,
}: {
  leftMode: Mode;
  rightMode: Mode;
  wholeBed: boolean;
  /** no wave (icon renders) */
  still?: boolean;
}) {
  const mesh = useRef<InstancedMesh>(null);
  const count = DOT_COLS * DOT_ROWS;
  const dots = useMemo(() => {
    const list: { x: number; z: number; row: number; side: "left" | "right" }[] = [];
    const usableW = MATTRESS_W - 0.22;
    const usableL = MATTRESS_L - 0.62; // leave room for pillows at the head
    for (let r = 0; r < DOT_ROWS; r++) {
      for (let c = 0; c < DOT_COLS; c++) {
        const x = -usableW / 2 + (c + 0.5) * (usableW / DOT_COLS);
        const z = -MATTRESS_L / 2 + 0.52 + (r + 0.5) * (usableL / DOT_ROWS);
        list.push({ x, z, row: r, side: c < DOT_COLS / 2 ? "left" : "right" });
      }
    }
    return list;
  }, []);

  // Place the dots once
  useEffect(() => {
    const m = mesh.current;
    if (!m) return;
    const o = new Object3D();
    dots.forEach((d, i) => {
      o.position.set(d.x, TOP_Y + 0.004, d.z);
      o.rotation.set(-Math.PI / 2, 0, 0);
      o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
    });
    m.instanceMatrix.needsUpdate = true;
  }, [dots]);

  const base = useMemo(
    () => ({ left: new Color(MODE_COLOR[leftMode]), right: new Color(MODE_COLOR[wholeBed ? leftMode : rightMode]) }),
    [leftMode, rightMode, wholeBed],
  );
  const tmp = useMemo(() => new Color(), []);

  useFrame(({ clock }) => {
    const m = mesh.current;
    if (!m) return;
    const t = clock.elapsedTime;
    dots.forEach((d, i) => {
      const mode = d.side === "left" || wholeBed ? leftMode : rightMode;
      if (mode === "off") {
        tmp.setRGB(0.22, 0.25, 0.3);
      } else {
        const moving = mode === "cooling" || mode === "warming";
        // cooling: wave travels toward the foot; warming: toward the head
        const dir = mode === "warming" || mode === "holding-warm" ? 1 : -1;
        const wave = Math.sin(d.row * 0.38 + dir * t * (moving ? 3 : 1.2));
        // gentle shimmer only, never dark bands
        const k = still ? 1 : moving ? 0.82 + 0.18 * wave : 0.9 + 0.08 * wave;
        tmp.copy(d.side === "left" ? base.left : base.right).multiplyScalar(k);
      }
      m.setColorAt(i, tmp);
    });
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  });

  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, count]}>
      <circleGeometry args={[DOT_R, 10]} />
      <meshBasicMaterial toneMapped={false} />
    </instancedMesh>
  );
}

/**
 * The "living" bed: frost on a cool side, a warm haze on a warm one. The glow breathes slowly
 * while the side is still cooling or warming, and holds still once it reaches its level.
 */
function ZoneAura({ width, mode, still }: { width: number; mode: Mode; still: boolean }) {
  const glow = useRef<MeshBasicMaterial>(null);
  const cool = mode === "cooling" || mode === "holding-cool";
  const warm = mode === "warming" || mode === "holding-warm";
  const moving = mode === "cooling" || mode === "warming";
  useFrame(({ clock }) => {
    if (!glow.current) return;
    glow.current.opacity = still || !moving ? 0.1 : 0.1 + 0.09 * Math.sin(clock.elapsedTime * 1.4);
  });
  if (!cool && !warm) return null;
  return (
    <>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.006, 0]}>
        <planeGeometry args={[width, MATTRESS_L - 0.5]} />
        <meshBasicMaterial ref={glow} color={cool ? "#a5f3fc" : "#fb923c"} transparent opacity={0.1} blending={AdditiveBlending} depthWrite={false} toneMapped={false} />
      </mesh>
      {!still &&
        (cool ? (
          // frost: tiny pale crystals settling onto the cover
          <Sparkles count={30} scale={[width * 0.95, 0.25, MATTRESS_L * 0.8]} position={[0, 0.13, 0]} size={1.1} speed={0.15} noise={[0.1, -0.4, 0.1]} color="#e0f2fe" opacity={0.9} />
        ) : (
          // warm haze: big soft specks drifting up
          <Sparkles count={12} scale={[width * 0.9, 1.1, MATTRESS_L * 0.75]} position={[0, 0.6, 0]} size={5} speed={0.2} noise={[0.1, 1, 0.1]} color="#fdba74" opacity={0.35} />
        ))}
    </>
  );
}

/** A small moon over the headboard: a schedule runs tonight. */
function Moon3D() {
  const g = useRef<Mesh>(null);
  useFrame(({ clock }) => {
    if (g.current) g.current.position.y = 1.62 + Math.sin(clock.elapsedTime * 0.8) * 0.03;
  });
  return (
    <group position={[0.75, 0, -MATTRESS_L / 2 - 0.05]}>
      <mesh ref={g} position={[0, 1.62, 0]}>
        <sphereGeometry args={[0.11, 24, 24]} />
        <meshBasicMaterial color="#fde68a" toneMapped={false} />
      </mesh>
      {/* the shadow that makes it a crescent */}
      <mesh position={[0.055, 1.655, 0.05]}>
        <sphereGeometry args={[0.1, 24, 24]} />
        <meshBasicMaterial color="#0f172a" transparent opacity={0.92} />
      </mesh>
      <pointLight position={[0, 1.62, 0.2]} intensity={0.25} color="#fde68a" distance={1.5} />
    </group>
  );
}

/** Invisible tap target over a zone; shows a soft highlight when selected. */
function ZoneHit({
  x,
  width,
  mode,
  selected,
  onSelect,
  still = false,
}: {
  x: number;
  width: number;
  mode: Mode;
  selected: boolean;
  onSelect: () => void;
  still?: boolean;
}) {
  const moving = mode === "cooling" || mode === "warming";
  return (
    <group position={[x, TOP_Y + 0.01, 0.12]}>
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        onClick={(e) => {
          e.stopPropagation();
          onSelect();
        }}
        onPointerOver={() => {
          document.body.style.cursor = "pointer";
        }}
        onPointerOut={() => {
          document.body.style.cursor = "";
        }}
      >
        <planeGeometry args={[width, MATTRESS_L - 0.5]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={selected ? 0.22 : 0} depthWrite={false} />
      </mesh>
      <ZoneAura width={width} mode={mode} still={still} />
      {mode !== "off" && (
        <Sparkles
          count={moving ? 26 : 8}
          scale={[width * 0.9, 0.8, MATTRESS_L * 0.8]}
          position={[0, 0.42, 0]}
          size={moving ? 2.6 : 1.6}
          speed={moving ? 0.8 : 0.3}
          noise={mode === "cooling" || mode === "holding-cool" ? [0.2, -1, 0.2] : [0.2, 1, 0.2]}
          color={MODE_COLOR[mode]}
          opacity={0.8}
        />
      )}
    </group>
  );
}

/** What a side tag says under the temperature: its schedule state ("Auto", "Manual until 03:00"…) */
export interface SideNote {
  text: string;
  tone: "auto" | "manual" | "off";
}

/**
 * Callout for a side of the mattress: a dot on the bed, a line that rises at an angle and
 * bends flat, and the side's numbers floating at its end (no box). Left side points out
 * to the left, right side to the right. The picked side is brighter.
 */
/** Tapping the temperature shown on the bed: a small − / + bubble next to it (A). */
export interface TagAdjust {
  /** the readout was tapped */
  onTap: () => void;
  /** the bubble is open */
  open: boolean;
  /** the level the bubble shows (a change not sent yet, else the pod's target), already formatted */
  text: string;
  /** the same level raw, for the line on the bed */
  raw: number | null;
  onStep: (delta: 1 | -1) => void;
  /** the side is on (the power button is green, − / + work) */
  isOn: boolean;
  /** the power button (the same icon as on the Temperature card) */
  onPower: () => void;
}

function TempTag({
  x,
  s,
  mode,
  note,
  title,
  selected,
  dir = 1,
  theme = "dark",
  adjust,
}: {
  adjust?: TagAdjust;
  x: number;
  s: SideState | undefined;
  mode: Mode;
  note?: SideNote;
  title?: string;
  selected?: boolean;
  /** 1 = callout goes up-right, -1 = up-left */
  dir?: 1 | -1;
  theme?: Theme;
}) {
  const unit = useTempUnit();
  const deg = (f: number | null | undefined) => formatTemp(f, unit);
  // whole steps (-10…+10) like the rest of the app; the pod reports finer levels
  const step = (raw: number | null | undefined) => formatLevel(Math.round((raw ?? 0) / 10) * 10);
  const color = mode === "off" ? "#94a3b8" : MODE_COLOR[mode];
  const light = theme === "light";
  const ink = light ? "15,23,42" : "255,255,255";
  const lineColor = selected ? `rgba(${ink},.85)` : `rgba(${ink},.4)`;
  // elbow: up 38px while going 16px out, then 26px flat
  const rise = 38;
  const run = 16;
  const flat = 26;
  const stepBtn = (d: 1 | -1) => (
    <button
      type="button"
      aria-label={d < 0 ? tx("Cooler") : tx("Warmer")}
      disabled={!adjust?.isOn}
      onClick={(e) => {
        e.stopPropagation();
        adjust?.onStep(d);
      }}
      style={{
        opacity: adjust?.isOn ? 1 : 0.3, width: 20, height: 20, borderRadius: 10, background: light ? "#e2e8f0" : "#2a3550", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 13, lineHeight: 1 }}
    >
      {d < 0 ? "−" : "+"}
    </button>
  );
  return (
    <Html position={[x, TOP_Y + 0.03, 0.25]} distanceFactor={3.2} zIndexRange={[10, 0]} pointerEvents="none">
      <div style={{ position: "relative", width: 0, height: 0 }}>
        <svg
          width={run + flat + 2}
          height={rise + 4}
          style={{
            position: "absolute",
            left: dir === 1 ? -2 : -(run + flat),
            top: -rise - 2,
            overflow: "visible",
          }}
        >
          <polyline
            points={
              dir === 1
                ? `2,${rise + 2} ${run + 2},2 ${run + flat + 2},2`
                : `${run + flat},${rise + 2} ${flat},2 0,2`
            }
            fill="none"
            stroke={lineColor}
            strokeWidth={selected ? 1.6 : 1.1}
          />
          <circle cx={dir === 1 ? 2 : run + flat} cy={rise + 2} r={selected ? 3 : 2.2} fill={color} />
        </svg>
        <div
          role={adjust ? "button" : undefined}
          onClick={adjust?.onTap}
          className="whitespace-nowrap font-hud uppercase leading-tight tracking-wider"
          style={{
            pointerEvents: adjust ? "auto" : undefined,
            cursor: adjust ? "pointer" : undefined,
            borderRadius: 6,
            position: "absolute",
            top: -rise - 9,
            [dir === 1 ? "left" : "right"]: run + flat + 4,
            textAlign: dir === 1 ? "left" : "right",
            textShadow: light ? "0 1px 2px rgba(255,255,255,.9)" : "0 1px 3px rgba(0,0,0,.9)",
            opacity: selected ? 1 : 0.8,
          }}
        >
          <div className="text-[11px] font-bold" style={{ color }}>
            {title && <span className={light ? "text-slate-900" : "text-white"}>{title} · </span>}
            {deg(s?.tempF)} · {mode === "off" ? tx("off") : tx("on")}
          </div>
          {/* while on: the offset now, and the one it's moving to */}
          {mode !== "off" && (
            <div className="text-[11px] font-bold">
              {mode === "warming" || mode === "cooling"
                ? `${step(s?.level)} → ${step(adjust?.raw ?? s?.target)}`
                : step(adjust?.raw ?? s?.target ?? s?.level)}
            </div>
          )}
          {note && (
            <div
              className="text-[9px] normal-case tracking-normal"
              style={{ color: note.tone === "manual" ? (light ? "#b45309" : "#fcd34d") : light ? "rgba(30,41,59,.75)" : "rgba(226,232,240,.8)" }}
            >
              {note.text}
            </div>
          )}
        </div>
        {adjust?.open && (
          <div
            style={{
              position: "absolute",
              top: -rise + 30,
              left: dir === 1 ? 8 : -60,
              pointerEvents: "auto",
              display: "flex",
              alignItems: "center",
              gap: 5,
              padding: "2px 5px",
              borderRadius: 12,
              background: light ? "rgba(255,255,255,.96)" : "rgba(27,36,52,.96)",
              border: `1px solid ${light ? "#cbd5e1" : "#4b6bd6"}`,
              boxShadow: "0 6px 18px rgba(0,0,0,.35)",
              color: light ? "#0f172a" : "#fff",
              fontWeight: 800,
              fontSize: 11,
              whiteSpace: "nowrap",
            }}
          >
            <button
              type="button"
              aria-label={adjust.isOn ? tx("Turn off") : tx("Turn on")}
              onClick={(e) => {
                e.stopPropagation();
                adjust.onPower();
              }}
              style={{ width: 24, height: 24, display: "inline-flex", alignItems: "center", justifyContent: "center", color: adjust.isOn ? "#10b981" : light ? "#94a3b8" : "#64748b" }}
            >
              <Power size={18} />
            </button>
            {stepBtn(-1)}
            <span style={{ minWidth: 30, textAlign: "center", opacity: adjust.isOn ? 1 : 0.5 }}>{adjust.isOn ? adjust.text : tx("Off")}</span>
            {stepBtn(1)}
          </div>
        )}
      </div>
    </Html>
  );
}

function Pillow({ x }: { x: number }) {
  return (
    <RoundedBox args={[0.78, 0.14, 0.42]} radius={0.07} smoothness={4} position={[x, TOP_Y + 0.08, -MATTRESS_L / 2 + 0.34]} castShadow>
      <meshStandardMaterial color="#f1f5f9" roughness={0.9} />
    </RoundedBox>
  );
}

/** The Pod hub on the left of the bed (where it really sits); its light follows the LED setting. */
function Hub({ online, led, theme = "dark", onTap }: { online: boolean | null; led: number | null; theme?: Theme; onTap?: () => void }) {
  const light = useRef<Mesh>(null);
  useFrame(({ clock }) => {
    if (!light.current) return;
    const m = light.current.material as MeshStandardMaterial;
    m.emissiveIntensity = online ? ((led ?? 50) / 100) * (0.8 + Math.sin(clock.elapsedTime * 1.5) * 0.2) : 0.05;
  });
  return (
    <group position={[-(MATTRESS_W / 2 + 0.55), 0, -MATTRESS_L / 2 + 0.5]}>
      <RoundedBox args={[0.42, 0.5, 0.42]} radius={0.06} position={[0, 0.25, 0]} castShadow>
        <meshStandardMaterial color={PALETTE[theme].hub} roughness={0.4} metalness={0.3} />
      </RoundedBox>
      <mesh ref={light} position={[0, 0.36, 0.212]}>
        <boxGeometry args={[0.2, 0.03, 0.005]} />
        <meshStandardMaterial color="#e2e8f0" emissive="#a5f3fc" emissiveIntensity={0.6} />
      </mesh>
      {/* a bigger, invisible box around the Pod so it's easy to tap with a finger */}
      {onTap && (
        <mesh
          position={[0, 0.3, 0]}
          onClick={(e) => {
            e.stopPropagation();
            onTap();
          }}
          onPointerOver={() => {
            document.body.style.cursor = "pointer";
          }}
          onPointerOut={() => {
            document.body.style.cursor = "";
          }}
        >
          <boxGeometry args={[0.85, 0.85, 0.85]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
      )}
    </group>
  );
}

/**
 * Flat decal drawn on a 2D canvas (no font downloads): used for the engraved headboard
 * text and the mark on the mattress. Redraws once web fonts are ready.
 */
function Decal({
  width,
  height,
  position,
  rotation,
  draw,
}: {
  width: number;
  height: number;
  position: [number, number, number];
  rotation?: [number, number, number];
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number, hud: string) => void;
}) {
  const texture = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(width * 600);
    canvas.height = Math.round(height * 600);
    const t = new CanvasTexture(canvas);
    t.colorSpace = SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  }, [width, height]);

  useEffect(() => {
    const canvas = texture.image as HTMLCanvasElement;
    const paint = () => {
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const hud = getComputedStyle(document.documentElement).getPropertyValue("--font-hud").trim() || "monospace";
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      draw(ctx, canvas.width, canvas.height, hud);
      texture.needsUpdate = true;
    };
    paint();
    void document.fonts?.ready.then(paint);
  }, [texture, draw]);

  return (
    <mesh position={position} rotation={rotation}>
      <planeGeometry args={[width, height]} />
      <meshBasicMaterial map={texture} transparent depthWrite={false} toneMapped={false} />
    </mesh>
  );
}

/** The headboard name (e.g. "ALEX'S BED"), laser-engraved look: thin, light gray, low contrast, wide spacing. */
const makeEngraving = (text: string, deep = false) => (ctx: CanvasRenderingContext2D, w: number, h: number, hud: string) => {
  // letter spacing by hand (canvas letterSpacing isn't everywhere yet); shrinks to fit the plate
  const measure = (k: number) => {
    const f = `${deep ? "700 " : ""}${Math.round(h * 0.62 * k)}px ${hud}`;
    ctx.font = f;
    const g = h * 0.32 * k;
    const ws = [...text].map((c) => ctx.measureText(c).width);
    return { f, g, ws, t: ws.reduce((a, b) => a + b, 0) + g * (text.length - 1) };
  };
  let m = measure(1);
  if (m.t > w * 0.92) m = measure((w * 0.92) / m.t);
  const { f: font, g: gap, ws: widths, t: total } = m;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const xs: number[] = [];
  let x = (w - total) / 2;
  [...text].forEach((_, i) => {
    xs.push(x + widths[i]! / 2);
    x += widths[i]! + gap;
  });
  const each = (c: CanvasRenderingContext2D, dx: number, dy: number) =>
    [...text].forEach((ch, i) => c.fillText(ch, xs[i]! + dx, h / 2 + dy));

  if (!deep) {
    // a faint darker offset under the light stroke reads as an etched groove
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    each(ctx, 1.5, 1.5);
    ctx.fillStyle = "rgba(203,213,225,0.38)";
    each(ctx, 0, 0);
    return;
  }

  // Deep laser cut: light catches the lower lip, the upper wall falls into shadow,
  // and the floor of the groove is a burnt, darker tone.
  const d = Math.max(2, h * 0.05);
  ctx.fillStyle = "rgba(203,213,225,0.30)";
  each(ctx, d * 0.5, d * 0.6); // lower/right lip catching the light
  const cut = document.createElement("canvas");
  cut.width = w;
  cut.height = h;
  const c = cut.getContext("2d");
  if (!c) return;
  c.font = font;
  c.textAlign = "center";
  c.textBaseline = "middle";
  c.fillStyle = "rgba(2,4,8,0.96)"; // the cavity, in shadow
  each(c, 0, 0);
  c.globalCompositeOperation = "source-atop";
  c.fillStyle = "rgba(30,36,46,0.95)"; // the burnt floor, offset so the top wall stays dark
  each(c, d * 0.7, d * 0.9);
  ctx.drawImage(cut, 0, 0);
};

export const DEFAULT_ENGRAVING = "POD HUB";

function Frame({
  engraving = DEFAULT_ENGRAVING,
  engravingScale = 1,
  backEngraving,
  theme = "dark",
}: {
  engraving?: string;
  engravingScale?: number;
  backEngraving?: string;
  theme?: Theme;
}) {
  const drawEngraving = useMemo(() => makeEngraving(engraving), [engraving]);
  const drawBack = useMemo(() => (backEngraving ? makeEngraving(backEngraving, true) : null), [backEngraving]);
  return (
    <group>
      {/* base */}
      <RoundedBox args={[MATTRESS_W + 0.2, 0.26, MATTRESS_L + 0.2]} radius={0.05} position={[0, 0.13 + 0.05, 0]} castShadow receiveShadow>
        <meshStandardMaterial color={PALETTE[theme].base} roughness={0.7} />
      </RoundedBox>
      {/* headboard */}
      <RoundedBox args={[MATTRESS_W + 0.3, 1.15, 0.14]} radius={0.06} position={[0, 0.62, -MATTRESS_L / 2 - 0.16]} castShadow>
        <meshStandardMaterial color={PALETTE[theme].headboard} roughness={0.6} />
      </RoundedBox>
      {/* engraved name above the pillows */}
      <Decal
        width={Math.min(2.3, 1.8 * engravingScale)}
        height={0.18 * engravingScale}
        position={[0, 0.99, -MATTRESS_L / 2 - 0.088]}
        draw={drawEngraving}
      />
      {/* big engraving on the back of the headboard */}
      {drawBack && (
        <Decal
          width={2.15}
          height={0.36}
          position={[0, 0.66, -MATTRESS_L / 2 - 0.232]}
          rotation={[0, Math.PI, 0]}
          draw={drawBack}
        />
      )}
      {/* legs */}
      {[-1, 1].flatMap((sx) =>
        [-1, 1].map((sz) => (
          <mesh key={`${sx}${sz}`} position={[sx * (MATTRESS_W / 2), 0.03, sz * (MATTRESS_L / 2)]}>
            <cylinderGeometry args={[0.04, 0.04, 0.06, 12]} />
            <meshStandardMaterial color={PALETTE[theme].legs} />
          </mesh>
        )),
      )}
    </group>
  );
}

export interface Bed3DProps {
  sides: SideState[];
  wholeBed: boolean;
  online: boolean | null;
  led: number | null;
  /** which side is selected for the control strip */
  selected: "left" | "right" | null;
  onSelect: (side: "left" | "right" | null) => void;
  /** Static render for the app icon: no labels, no hub, fixed camera */
  iconMode?: boolean;
  /** camera override for icon renders */
  cameraPosition?: [number, number, number];
  /** text engraved on the headboard, and how big (1 = default) */
  engraving?: string;
  engravingScale?: number;
  /** big text on the back of the headboard */
  backEngraving?: string;
  /** schedule state shown under each side's temperature */
  notes?: Partial<Record<"left" | "right", SideNote>>;
  /** light or dark look */
  theme?: Theme;
  /** a schedule runs tonight: a small moon over the headboard */
  moon?: boolean;
  /** the sky behind the bed: time of day, weather and the moon (replaces the small moon) */
  sky?: SkyState;
  /** the weather text next to the sun / moon */
  skyLabel?: SkyLabel;
  /** tapping the Pod (the box next to the bed) */
  onHubTap?: () => void;
  /** tapping a temperature on the bed (A): the bubble state per side */
  adjust?: Partial<Record<"left" | "right" | "both", TagAdjust>>;
}

/** Rotatable 3D bed. Drag sideways to turn it; tap a side to control it. */
export default function Bed3D({
  sides,
  wholeBed,
  online,
  led,
  selected,
  onSelect,
  iconMode = false,
  cameraPosition,
  engraving,
  engravingScale,
  backEngraving,
  notes,
  theme = "dark",
  moon = false,
  sky,
  skyLabel,
  onHubTap,
  adjust,
}: Bed3DProps) {
  const left = sides.find((s) => s.side === "left");
  const right = sides.find((s) => s.side === "right");
  const lm = modeOf(left);
  const rm = wholeBed ? lm : modeOf(right);
  const controls = useRef<React.ElementRef<typeof OrbitControls>>(null);
  const [interacted, setInteracted] = useState(false);

  // Let vertical swipes scroll the page; horizontal drags rotate the bed
  useEffect(() => {
    const el = controls.current?.domElement;
    if (el) el.style.touchAction = "pan-y";
  });

  // Zones are inset from the mattress edge with a seam down the middle
  const zoneW = MATTRESS_W / 2 - 0.1;
  const half = MATTRESS_W / 2;

  return (
    <Canvas
      shadows
      dpr={[1, 2]}
      camera={{ position: cameraPosition ?? (iconMode ? [3.7, 3.9, 4.1] : [2.9, 2.6, 3.2]), fov: iconMode ? 34 : 38 }}
      gl={{ preserveDrawingBuffer: iconMode, alpha: true }}
      onPointerMissed={() => onSelect(null)}
      fallback={<div className="flex h-full items-center justify-center text-xs text-slate-400">3D isn&apos;t supported on this device.</div>}
    >
      <hemisphereLight args={theme === "light" ? ["#ffffff", "#cbd5e1", 0.9] : ["#e0e7ff", "#0f172a", 0.7]} />
      <directionalLight position={[4, 6, 3]} intensity={1.4} castShadow shadow-mapSize={[1024, 1024]} />
      <pointLight position={[-3, 2, -2]} intensity={0.6} color="#818cf8" />

      <group position={[0, 0, 0]}>
        <Frame engraving={engraving} engravingScale={engravingScale} backEngraving={backEngraving} theme={theme} />
        <Mattress theme={theme} />
        <DotMatrix leftMode={lm} rightMode={rm} wholeBed={wholeBed} still={iconMode} />
        {wholeBed ? (
          <ZoneHit x={0} width={MATTRESS_W - 0.16} mode={lm} still={iconMode} selected={selected !== null} onSelect={() => onSelect(selected ? null : "left")} />
        ) : (
          <>
            <ZoneHit x={-half / 2} width={zoneW} mode={lm} still={iconMode} selected={selected === "left"} onSelect={() => onSelect(selected === "left" ? null : "left")} />
            <ZoneHit x={half / 2} width={zoneW} mode={rm} still={iconMode} selected={selected === "right"} onSelect={() => onSelect(selected === "right" ? null : "right")} />
          </>
        )}
        <Pillow x={-0.5} />
        <Pillow x={0.5} />
        <Hub online={online} led={led} theme={theme} onTap={iconMode ? undefined : onHubTap} />
        {sky && !iconMode ? <SkyScene sky={sky} label={skyLabel} still={typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches} /> : moon && !iconMode && <Moon3D />}
        {!iconMode &&
          (wholeBed ? (
            <TempTag x={0} s={left} mode={lm} note={notes?.left} title={tx("Whole bed")} selected dir={-1} theme={theme} adjust={adjust?.both} />
          ) : (
            <>
              <TempTag x={-half / 2} s={left} mode={lm} note={notes?.left} selected={selected === "left"} dir={-1} theme={theme} adjust={adjust?.left} />
              <TempTag x={half / 2} s={right} mode={rm} note={notes?.right} selected={selected === "right"} dir={1} theme={theme} adjust={adjust?.right} />
            </>
          ))}

      </group>

      <ContactShadows position={[0, 0.001, 0]} opacity={0.45} scale={8} blur={2.4} far={2} />
      <OrbitControls
        ref={controls}
        enablePan={false}
        enableZoom={false}
        minPolarAngle={0.85}
        maxPolarAngle={1.2}
        target={[0, 0.45, 0]}
        autoRotate={!interacted && !iconMode}
        autoRotateSpeed={0.6}
        onStart={() => setInteracted(true)}
      />
    </Canvas>
  );
}
