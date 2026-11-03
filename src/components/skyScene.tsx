"use client";

import React, { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import { AdditiveBlending, NormalBlending, CanvasTexture, Color, DoubleSide, type Group, type LineSegments, type Mesh, type MeshBasicMaterial, type Points, type PointsMaterial, SRGBColorSpace } from "three";
import { type SkyState } from "~/lib/sky";

// The sky behind the 3D bed: sun or moon (with its real phase), stars, clouds, rain, snow, fog and thunder.
// Everything sits on a backdrop that turns with the camera, so it is always behind the bed whichever way you spin it.

const BACK_Z = -3.2;

const makeTexture = (draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void, w = 128, h = 128) => {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  draw(c.getContext("2d")!, w, h);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
};

const glowTexture = (inner: string, outer: string) =>
  makeTexture((ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    g.addColorStop(0, inner);
    g.addColorStop(0.28, inner);
    g.addColorStop(0.32, outer);
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  });

/** The moon as it looks tonight: the lit part is bright, the rest is a faint dark disc. f: 0 new … 0.5 full … 1 new. */
function moonTexture(f: number) {
  return makeTexture((ctx, w, h) => {
    const cx = w / 2;
    const cy = h / 2;
    const r = w * 0.36;
    // soft glow
    const g = ctx.createRadialGradient(cx, cy, r * 0.8, cx, cy, w / 2);
    g.addColorStop(0, "rgba(253,246,200,.28)");
    g.addColorStop(1, "rgba(253,246,200,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    // the whole disc, dim
    ctx.fillStyle = "rgba(60,70,95,.55)";
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    // the lit part: a half disc plus (or minus) an ellipse for the terminator
    const waxing = f < 0.5;
    const k = Math.cos(2 * Math.PI * f); // 1 new … -1 full
    ctx.fillStyle = "#fdf3c4";
    ctx.beginPath();
    ctx.arc(cx, cy, r, -Math.PI / 2, Math.PI / 2, !waxing); // right half when waxing, left when waning
    // terminator back from bottom to top: bulges toward the lit side when less than half is lit
    const rx = Math.abs(k) * r;
    const towardLit = k > 0 ? (waxing ? 1 : -1) : waxing ? -1 : 1;
    ctx.ellipse(cx, cy, Math.max(rx, 0.01), r, 0, Math.PI / 2, -Math.PI / 2, towardLit === 1 ? true : false);
    ctx.closePath();
    ctx.fill();
  });
}

/** A puffy cloud, bright on top and shaded underneath (tinted by the material colour). */
const cloudTexture = () =>
  makeTexture(
    (ctx, w, h) => {
      const puff = (x: number, y: number, r: number) => {
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, "rgba(255,255,255,.98)");
        g.addColorStop(0.6, "rgba(255,255,255,.8)");
        g.addColorStop(1, "rgba(255,255,255,0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      };
      puff(w * 0.22, h * 0.62, h * 0.3);
      puff(w * 0.38, h * 0.45, h * 0.38);
      puff(w * 0.58, h * 0.4, h * 0.42);
      puff(w * 0.78, h * 0.58, h * 0.32);
      puff(w * 0.5, h * 0.68, h * 0.3);
      // shade the belly: darker towards the bottom, keeping the soft edges
      ctx.globalCompositeOperation = "source-atop";
      const shade = ctx.createLinearGradient(0, h * 0.2, 0, h * 0.85);
      shade.addColorStop(0, "rgba(255,255,255,1)");
      shade.addColorStop(0.55, "rgba(190,196,210,1)");
      shade.addColorStop(1, "rgba(110,118,136,1)");
      ctx.fillStyle = shade;
      ctx.fillRect(0, 0, w, h);
    },
    256,
    128,
  );

/** Rays around the sun (turned slowly). */
const raysTexture = () =>
  makeTexture((ctx, w, h) => {
    ctx.translate(w / 2, h / 2);
    for (let i = 0; i < 16; i++) {
      ctx.rotate((Math.PI * 2) / 16);
      const g = ctx.createLinearGradient(0, 0, 0, -w / 2);
      g.addColorStop(0, "rgba(255,236,160,.55)");
      g.addColorStop(1, "rgba(255,236,160,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(-3, 0);
      ctx.lineTo(0, -w / 2);
      ctx.lineTo(3, 0);
      ctx.fill();
    }
  }, 256, 256);

/** A jagged bolt with a glow, drawn fresh for every flash. */
function drawBolt(ctx: CanvasRenderingContext2D, w: number, h: number, seed: number) {
  ctx.clearRect(0, 0, w, h);
  const r = rand(seed);
  const pts: [number, number][] = [[w * (0.4 + r() * 0.2), 0]];
  while (pts[pts.length - 1]![1] < h * 0.95) {
    const [x, y] = pts[pts.length - 1]!;
    pts.push([Math.min(w * 0.9, Math.max(w * 0.1, x + (r() - 0.5) * w * 0.28)), y + h * (0.07 + r() * 0.08)]);
  }
  const stroke = (width: number, color: string, blur: number) => {
    ctx.shadowColor = "#9db8ff";
    ctx.shadowBlur = blur;
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineJoin = "round";
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.stroke();
  };
  stroke(9, "rgba(157,184,255,.45)", 24);
  stroke(3.5, "#ffffff", 10);
}

// deterministic pseudo-random so the sky doesn't jump on every render
const rand = (seed: number) => {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
};

const CLOUD_COLOR = { partly: "#f4f7fb", cloudy: "#c9d1dc", rain: "#8d98a8", thunder: "#59626f", snow: "#dbe1ea", clear: "#ffffff", fog: "#ffffff" } as const;

function Clouds({ sky, still }: { sky: SkyState; still: boolean }) {
  const tex = useMemo(cloudTexture, []);
  const n = sky.condition === "partly" ? 3 : sky.condition === "cloudy" || sky.condition === "snow" ? 8 : sky.condition === "rain" || sky.condition === "thunder" ? 9 : 0;
  // two depths: far ones are higher, paler and slower; near ones are bigger, darker and a bit faster
  const items = useMemo(() => {
    const r = rand(7);
    return Array.from({ length: n }, (_, i) => {
      const far = i % 2 === 0;
      return {
        x: -3.8 + (i / Math.max(1, n - 1)) * 7.6 + (r() - 0.5) * 0.8,
        y: far ? 1.2 + r() * 0.5 : 0.7 + r() * 0.6,
        s: far ? 0.9 + r() * 0.6 : 1.3 + r() * 0.9,
        speed: far ? 0.03 + r() * 0.03 : 0.07 + r() * 0.07,
        z: far ? BACK_Z - 0.15 : BACK_Z + 0.15,
        shade: far ? 1 : 0.82,
      };
    });
  }, [n]);
  const refs = useRef<(Mesh | null)[]>([]);
  // dim by night, warm at dawn / dusk
  const tint = useMemo(() => {
    const c = new Color(CLOUD_COLOR[sky.condition]);
    if (sky.phase === "night") c.multiplyScalar(0.3);
    else if (sky.phase === "dawn" || sky.phase === "dusk") c.lerp(new Color("#f0a58a"), 0.35);
    return c;
  }, [sky.condition, sky.phase]);
  useFrame((_, dt) => {
    if (still) return;
    items.forEach((it, i) => {
      const m = refs.current[i];
      if (!m) return;
      m.position.x += it.speed * dt;
      if (m.position.x > 4.4) m.position.x = -4.4;
    });
  });
  return (
    <>
      {items.map((it, i) => (
        <mesh
          key={i}
          ref={(m) => {
            refs.current[i] = m;
          }}
          position={[it.x, it.y, it.z]}
          scale={[it.s * 2, it.s, 1]}
        >
          <planeGeometry args={[1, 0.5]} />
          <meshBasicMaterial map={tex} color={tint.clone().multiplyScalar(it.shade)} transparent opacity={sky.condition === "partly" ? 0.92 : 0.88} depthWrite={false} toneMapped={false} />
        </mesh>
      ))}
    </>
  );
}

function Stars({ sky, still }: { sky: SkyState; still: boolean }) {
  const groups = useMemo(() => {
    const r = rand(11);
    return [0, 1].map(() => {
      const a = new Float32Array(40 * 3);
      for (let i = 0; i < 40; i++) {
        a[i * 3] = (r() - 0.5) * 8;
        a[i * 3 + 1] = 0.45 + r() * 1.25;
        a[i * 3 + 2] = BACK_Z - 0.2;
      }
      return a;
    });
  }, []);
  const mats = useRef<(PointsMaterial | null)[]>([]);
  const cloudy = sky.condition === "cloudy" || sky.condition === "rain" || sky.condition === "thunder" || sky.condition === "snow" || sky.condition === "fog";
  const base = (sky.phase === "night" ? 0.9 : sky.phase === "day" ? 0 : 0.25) * (cloudy ? 0.25 : 1);
  // the two groups twinkle out of step
  useFrame(({ clock }) => {
    mats.current.forEach((m, i) => {
      if (m) m.opacity = base * (still ? 0.85 : 0.65 + 0.35 * Math.sin(clock.elapsedTime * (1.3 + i * 0.7) + i * 2));
    });
  });
  if (base <= 0) return null;
  return (
    <>
      {groups.map((pts, i) => (
        <points key={i}>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[pts, 3]} />
          </bufferGeometry>
          <pointsMaterial ref={(m) => { mats.current[i] = m; }} color="#ffffff" size={0.05} transparent opacity={base} depthWrite={false} />
        </points>
      ))}
      {sky.phase === "night" && !cloudy && !still && <ShootingStar />}
    </>
  );
}

/** A streak across the night sky every so often. */
function ShootingStar() {
  const mesh = useRef<Mesh>(null);
  const mat = useRef<MeshBasicMaterial>(null);
  const st = useRef({ start: -100, next: 6, x: 0, y: 0 });
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    const f = st.current;
    if (t >= f.next) {
      f.start = t;
      f.next = t + 11 + ((Math.floor(t * 1000) % 9000) / 1000);
      f.x = -2 + ((Math.floor(t * 131) % 100) / 100) * 3;
      f.y = 1.3 + ((Math.floor(t * 71) % 100) / 100) * 0.4;
    }
    const d = (t - f.start) / 0.9;
    if (!mesh.current || !mat.current) return;
    if (d < 0 || d > 1) {
      mat.current.opacity = 0;
      return;
    }
    mesh.current.position.set(f.x + d * 1.6, f.y - d * 0.6, BACK_Z - 0.15);
    mat.current.opacity = Math.sin(d * Math.PI) * 0.9;
  });
  return (
    <mesh ref={mesh} rotation={[0, 0, -0.36]}>
      <planeGeometry args={[0.55, 0.012]} />
      <meshBasicMaterial ref={mat} color="#ffffff" transparent opacity={0} depthWrite={false} blending={AdditiveBlending} toneMapped={false} />
    </mesh>
  );
}

/** Falling drops (rain / thunder) or flakes (snow, and a few specks when it is very cold). */
function Falling({ kind, count, still, length = 0.16, speed: fall = 4.2, opacity = 0.55 }: { kind: "rain" | "snow"; count: number; still: boolean; length?: number; speed?: number; opacity?: number }) {
  const ref = useRef<LineSegments | Points>(null);
  const base = useMemo(() => {
    const r = rand(kind === "rain" ? 3 + count : 5);
    return Array.from({ length: count }, () => ({ x: (r() - 0.5) * 7, y: r() * 3.3 - 1.5, z: -3 + r() * 4.4, v: 0.7 + r() * 0.6, p: r() * 6 }));
  }, [count, kind]);
  const positions = useMemo(() => new Float32Array(count * (kind === "rain" ? 6 : 3)), [count, kind]);
  const write = (t: number) => {
    base.forEach((d, i) => {
      const speed = kind === "rain" ? fall : 0.55;
      const y = ((((d.y + 1.5) - t * speed * d.v) % 3.3) + 3.3) % 3.3 - 1.5;
      const x = d.x + (kind === "rain" ? -y * 0.12 : Math.sin(t * 0.7 + d.p) * 0.15);
      if (kind === "rain") {
        positions.set([x, y, d.z, x - length * 0.16, y + length, d.z], i * 6);
      } else {
        positions.set([x, y, d.z], i * 3);
      }
    });
  };
  useEffect(() => {
    write(0);
    const g = ref.current?.geometry;
    if (g) g.attributes.position!.needsUpdate = true;
  });
  useFrame(({ clock }) => {
    if (still || !ref.current) return;
    write(clock.elapsedTime);
    ref.current.geometry.attributes.position!.needsUpdate = true;
  });
  const geo = (
    <bufferGeometry>
      <bufferAttribute attach="attributes-position" args={[positions, 3]} />
    </bufferGeometry>
  );
  return kind === "rain" ? (
    <lineSegments ref={ref as React.Ref<LineSegments>}>
      {geo}
      <lineBasicMaterial color="#b4cdff" transparent opacity={opacity} depthWrite={false} />
    </lineSegments>
  ) : (
    <points ref={ref as React.Ref<Points>}>
      {geo}
      <pointsMaterial color="#ffffff" size={0.07} transparent opacity={0.9} depthWrite={false} />
    </points>
  );
}

/** A bolt and a double flash of the whole sky now and then. */
function Lightning({ still }: { still: boolean }) {
  const sky = useRef<MeshBasicMaterial>(null);
  const bolt = useRef<MeshBasicMaterial>(null);
  const boltMesh = useRef<Mesh>(null);
  const flash = useRef({ start: -10, next: 3, n: 0 });
  const boltTex = useMemo(() => makeTexture((ctx, w, h) => drawBolt(ctx, w, h, 1), 128, 256), []);
  useFrame(({ clock }) => {
    const m = sky.current;
    const b = bolt.current;
    if (!m || !b) return;
    const t = clock.elapsedTime;
    const f = flash.current;
    if (still) {
      m.opacity = 0;
      b.opacity = 0;
      return;
    }
    if (t >= f.next) {
      f.start = t;
      f.n += 1;
      f.next = t + 5 + ((Math.floor(t * 1000) % 5000) / 1000);
      const c = boltTex.image as HTMLCanvasElement;
      drawBolt(c.getContext("2d")!, c.width, c.height, f.n * 97);
      boltTex.needsUpdate = true;
      if (boltMesh.current) boltMesh.current.position.x = -1.6 + ((f.n * 0.9) % 3.2);
    }
    const d = t - f.start;
    const on = d < 0.1 || (d > 0.16 && d < 0.26);
    m.opacity = on ? 0.4 : 0;
    b.opacity = on ? 1 : 0;
  });
  return (
    <>
      <mesh position={[0, 1.6, BACK_Z - 0.3]}>
        <planeGeometry args={[14, 8]} />
        <meshBasicMaterial ref={sky} color="#dfe8ff" transparent opacity={0} depthWrite={false} blending={AdditiveBlending} toneMapped={false} />
      </mesh>
      <mesh ref={boltMesh} position={[0, 0.9, BACK_Z + 0.05]}>
        <planeGeometry args={[1.1, 2.2]} />
        <meshBasicMaterial ref={bolt} map={boltTex} transparent opacity={0} depthWrite={false} blending={AdditiveBlending} toneMapped={false} />
      </mesh>
    </>
  );
}

function Fog({ sky, still, soft = false }: { sky: SkyState; still: boolean; soft?: boolean }) {
  const refs = useRef<(Mesh | null)[]>([]);
  useFrame(({ clock }) => {
    if (still) return;
    refs.current.forEach((m, i) => m && (m.position.x = Math.sin(clock.elapsedTime * 0.08 + i) * 0.5));
  });
  const color = sky.phase === "night" ? "#6b7585" : "#e5e9ef";
  return (
    <>
      {[0.4, 0.8, 1.2, 1.6].map((y, i) => (
        <mesh key={y} ref={(m) => {
            refs.current[i] = m;
          }} position={[0, y, BACK_Z + 0.4 + i * 0.5]}>
          <planeGeometry args={[11, 0.7]} />
          <meshBasicMaterial color={color} transparent opacity={soft ? 0.1 : 0.22} depthWrite={false} side={DoubleSide} toneMapped={false} />
        </mesh>
      ))}
    </>
  );
}

/** The sun (with slowly turning rays) or the moon on its way across. */
function Body({ sky, still, label }: { sky: SkyState; still: boolean; label?: SkyLabel }) {
  const sunTex = useMemo(() => {
    const warm = sky.phase === "dawn" || sky.phase === "dusk";
    return sky.extreme === "hot" ? glowTexture("#ffb347", "rgba(255,120,30,.45)") : warm ? glowTexture("#ffb37a", "rgba(255,140,70,.4)") : glowTexture("#ffe27a", "rgba(255,226,122,.35)");
  }, [sky.phase, sky.extreme]);
  const rays = useMemo(raysTexture, []);
  const moonTex = useMemo(() => moonTexture(Math.round(sky.moon * 48) / 48), [sky.moon]);
  const raysRef = useRef<Mesh>(null);
  useFrame((_, dt) => {
    if (!still && raysRef.current) raysRef.current.rotation.z += dt * 0.06;
  });
  // In the top-right corner of the sky, clear of the bed's readouts. Only the height changes: a little lower at dawn and dusk.
  const x = 1.45;
  const y = sky.phase === "dawn" || sky.phase === "dusk" ? 0.95 : 1.2;
  const cover = sky.condition === "cloudy" || sky.condition === "rain" || sky.condition === "thunder" || sky.condition === "snow" ? 0.45 : sky.condition === "fog" ? 0.6 : 1;
  const size = sky.body === "sun" ? (sky.extreme === "hot" ? 2.2 : 1.6) : 1.0;
  return (
    <>
      {sky.body === "sun" && (
        <mesh ref={raysRef} position={[x, y, BACK_Z - 0.05]} scale={[size * 2.3, size * 2.3, 1]}>
          <planeGeometry args={[1, 1]} />
          <meshBasicMaterial map={rays} transparent opacity={cover * (sky.extreme === "hot" ? 0.9 : 0.6)} depthWrite={false} blending={AdditiveBlending} toneMapped={false} />
        </mesh>
      )}
      {label && (
        // the weather to the right of the sun / moon: it moves with the sky when the bed is turned
        <Html position={[x + 0.75, y, BACK_Z]} center distanceFactor={3.2} zIndexRange={[10, 0]}>
          <button
            type="button"
            onClick={label.onTap}
            aria-label={label.aria}
            className="whitespace-nowrap font-hud text-[18px] font-bold leading-none tracking-wider text-white active:opacity-70"
            style={{ textShadow: "0 1px 3px rgba(0,0,0,.9)", padding: "10px 6px" }}
          >
            {label.text}
          </button>
        </Html>
      )}
      <mesh position={[x, y, BACK_Z]} scale={[size, size, 1]}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial map={sky.body === "sun" ? sunTex : moonTex} transparent opacity={cover} depthWrite={false} blending={sky.body === "sun" ? AdditiveBlending : NormalBlending} toneMapped={false} />
      </mesh>
    </>
  );
}

/** The weather text shown next to the sun / moon, and what tapping it does. */
export interface SkyLabel {
  text: string;
  aria: string;
  onTap: () => void;
}

export function SkyScene({ sky, still = false, label }: { sky: SkyState; still?: boolean; label?: SkyLabel }) {
  const g = useRef<Group>(null);
  const rainy = sky.condition === "rain" || sky.condition === "thunder";
  // The backdrop stays behind the bed, but drifts a little against the turn (like far-away clouds),
  // so the sky feels distant instead of stuck to the screen. The drift is capped at about 26°.
  useFrame(({ camera }) => {
    if (!g.current) return;
    const az = Math.atan2(camera.position.x, camera.position.z);
    g.current.rotation.y = az - 0.45 * Math.sin(az);
  });
  return (
    <group ref={g}>
      <Stars sky={sky} still={still} />
      <Body sky={sky} still={still} label={label} />
      <Clouds sky={sky} still={still} />
      {sky.condition === "fog" && <Fog sky={sky} still={still} />}
      {rainy && (
        <>
          <Falling kind="rain" count={110} still={still} length={0.1} speed={3.0} opacity={0.3} />
          <Falling kind="rain" count={90} still={still} length={0.26} speed={5.6} opacity={0.6} />
          <Fog sky={sky} still={still} soft />
        </>
      )}
      {sky.condition === "thunder" && <Lightning still={still} />}
      {sky.condition === "snow" && <Falling kind="snow" count={130} still={still} />}
      {sky.extreme === "cold" && sky.condition !== "snow" && <Falling kind="snow" count={40} still={still} />}
    </group>
  );
}
