// A drawn picture of a new-construction home, used until real listing photos
// exist. Each home gets its own consistent look (siding, time of day, one or
// two stories) worked out from its ID, so the same home always looks the same.

type Palette = { wall: string; wallShade: string; trim: string; roof: string; door: string };

const PALETTES: Palette[] = [
  { wall: "#F1EEE8", wallShade: "#E2DDD4", trim: "#FFFFFF", roof: "#4B5058", door: "#2F3A4A" }, // white farmhouse
  { wall: "#E6DCCB", wallShade: "#D6CAB5", trim: "#F8F4EC", roof: "#5B5047", door: "#6B4B35" }, // Texas limestone
  { wall: "#A65A43", wallShade: "#8F4B37", trim: "#F3EEE6", roof: "#3A3533", door: "#2B2B2B" }, // red brick
  { wall: "#7E93A7", wallShade: "#6C8196", trim: "#F5F6F7", roof: "#2F353D", door: "#E9E3D6" }, // slate blue
  { wall: "#A8B49B", wallShade: "#96A389", trim: "#F6F5EF", roof: "#3E433A", door: "#40362E" }, // sage
  { wall: "#D8D4CE", wallShade: "#C6C1B9", trim: "#FFFFFF", roof: "#26292D", door: "#3452C7" }, // modern gray
];

const SKIES = {
  day: { top: "#9CC8EE", bottom: "#E8F2FA", lawn: "#7FA35B", lawnFar: "#9DB97A", glass: "#B9D3E6", lit: false, orb: "#FFF6D8" },
  golden: { top: "#F2B98A", bottom: "#FCE6CC", lawn: "#8A9C55", lawnFar: "#A9B36E", glass: "#F3D5B0", lit: false, orb: "#FFF1D2" },
  twilight: { top: "#28335E", bottom: "#E9A88A", lawn: "#4E6141", lawnFar: "#62744E", glass: "#FFCF7A", lit: true, orb: "#FDF1DC" },
} as const;

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function HomeArt({
  seed,
  stories = 1,
  className,
  scene: sceneOverride,
}: {
  seed: string;
  stories?: number | null;
  className?: string;
  scene?: keyof typeof SKIES;
}) {
  const h = hash(seed);
  const p = PALETTES[h % PALETTES.length];
  const sceneKey = sceneOverride ?? (["day", "golden", "twilight", "day"] as const)[(h >>> 4) % 4];
  const sky = SKIES[sceneKey];
  const two = (stories ?? 1) >= 2;
  const id = `ha${h.toString(36)}${sceneKey[0]}`;
  const flip = ((h >>> 8) & 1) === 1; // garage on the left or right

  // Main body top edge and roof apex depend on stories.
  const bodyTop = two ? 108 : 150;
  const apex = two ? 58 : 98;
  const windowFill = sky.lit ? `url(#${id}-glow)` : sky.glass;

  const house = (
    <g>
      {/* main body */}
      <rect x="70" y={bodyTop} width="200" height={236 - bodyTop} fill={p.wall} />
      <rect x="70" y={bodyTop} width="14" height={236 - bodyTop} fill={p.wallShade} />
      {/* main roof */}
      <polygon points={`56,${bodyTop + 2} 170,${apex} 284,${bodyTop + 2}`} fill={p.roof} />
      <polygon points={`170,${apex} 284,${bodyTop + 2} 270,${bodyTop + 2}`} fill="#000" opacity="0.12" />
      {/* gable vent */}
      <rect x="160" y={apex + 22} width="20" height="10" rx="1" fill={p.trim} opacity="0.9" />

      {/* upper windows */}
      {two && (
        <g>
          {[96, 150, 214].map((x) => (
            <g key={x}>
              <rect x={x - 2} y="124" width="34" height="38" fill={p.trim} />
              <rect x={x} y="126" width="30" height="34" fill={windowFill} />
              <line x1={x + 15} y1="126" x2={x + 15} y2="160" stroke={p.trim} strokeWidth="2" />
            </g>
          ))}
        </g>
      )}

      {/* porch roof */}
      <polygon points="150,186 238,186 232,176 156,176" fill={p.roof} />
      <rect x="156" y="186" width="4" height="50" fill={p.trim} />
      <rect x="228" y="186" width="4" height="50" fill={p.trim} />

      {/* front door */}
      <rect x="182" y="194" width="26" height="42" fill={p.trim} />
      <rect x="185" y="197" width="20" height="39" fill={p.door} />
      <circle cx="201" cy="217" r="1.4" fill="#E8D7A8" />
      {sky.lit && <circle cx="174" cy="200" r="2.5" fill="#FFE3A3" />}

      {/* lower windows */}
      {[92, 124].map((x) => (
        <g key={x}>
          <rect x={x - 2} y="188" width="28" height="36" fill={p.trim} />
          <rect x={x} y="190" width="24" height="32" fill={windowFill} />
          <line x1={x} y1="206" x2={x + 24} y2="206" stroke={p.trim} strokeWidth="2" />
        </g>
      ))}
      <rect x="236" y="190" width="26" height="30" fill={p.trim} />
      <rect x="238" y="192" width="22" height="26" fill={windowFill} />

      {/* garage wing */}
      <rect x="270" y="168" width="132" height="68" fill={p.wallShade} />
      <polygon points="262,170 336,128 410,170" fill={p.roof} />
      <polygon points="336,128 410,170 398,170" fill="#000" opacity="0.12" />
      <rect x="286" y="188" width="100" height="48" fill={p.trim} />
      <rect x="290" y="192" width="92" height="44" fill="#ECEAE6" />
      {[203, 214, 225].map((y) => (
        <line key={y} x1="290" y1={y} x2="382" y2={y} stroke="#D4D0C9" strokeWidth="1.5" />
      ))}
      {[0, 1, 2, 3].map((i) => (
        <rect key={i} x={296 + i * 22} y="195" width="14" height="5" rx="1" fill={sky.glass} opacity="0.8" />
      ))}
      {sky.lit && <rect x="290" y="192" width="92" height="44" fill="#FFD27A" opacity="0.08" />}
    </g>
  );

  return (
    <svg
      viewBox="0 0 480 320"
      preserveAspectRatio="xMidYMid slice"
      className={className}
      role="img"
      aria-label="Illustration of the home"
    >
      <defs>
        <linearGradient id={`${id}-sky`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={sky.top} />
          <stop offset="1" stopColor={sky.bottom} />
        </linearGradient>
        <radialGradient id={`${id}-glow`} cx="0.5" cy="0.5" r="0.7">
          <stop offset="0" stopColor="#FFE7A8" />
          <stop offset="1" stopColor="#F5B54F" />
        </radialGradient>
      </defs>

      <rect width="480" height="320" fill={`url(#${id}-sky)`} />
      <circle cx={sceneKey === "twilight" ? 392 : 396} cy={sceneKey === "golden" ? 196 : 58} r={sceneKey === "twilight" ? 11 : 20} fill={sky.orb} opacity={sceneKey === "twilight" ? 0.95 : 0.85} />
      {sceneKey === "twilight" &&
        [[60, 40], [130, 24], [250, 34], [330, 18], [440, 44]].map(([x, y]) => (
          <circle key={x} cx={x} cy={y} r="1.2" fill="#fff" opacity="0.7" />
        ))}

      {/* distant tree line */}
      <path
        d="M0 214 Q20 196 40 210 Q62 190 84 208 Q110 194 132 210 Q160 198 190 212 Q230 200 260 212 Q300 196 330 210 Q360 198 390 210 Q420 194 450 208 Q468 200 480 206 L480 240 L0 240 Z"
        fill={sky.lawnFar}
        opacity="0.75"
      />
      <rect y="232" width="480" height="88" fill={sky.lawn} />

      <g transform={flip ? "translate(480 0) scale(-1 1)" : undefined}>
        {/* driveway and walk */}
        <polygon points="290,236 382,236 420,320 262,320" fill="#D9D6D0" />
        <polygon points="190,236 202,236 206,262 186,262" fill="#D9D6D0" />
        <rect x="0" y="262" width="480" height="10" fill="#CFCBC4" />
        {house}
        {/* young street tree and shrubs */}
        <rect x="438" y="214" width="4" height="48" fill="#6B5444" />
        <circle cx="440" cy="206" r="16" fill={sky.lawn} />
        <circle cx="448" cy="214" r="11" fill={sky.lawnFar} />
        {[86, 112, 138, 244].map((x) => (
          <ellipse key={x} cx={x} cy="236" rx="13" ry="7" fill={sky.lawn} />
        ))}
        {/* mature tree */}
        <rect x="30" y="178" width="7" height="86" fill="#5E4A3C" />
        <circle cx="33" cy="160" r="32" fill={sky.lawn} />
        <circle cx="16" cy="178" r="20" fill={sky.lawnFar} />
        <circle cx="52" cy="174" r="22" fill={sky.lawn} opacity="0.9" />
      </g>
    </svg>
  );
}
