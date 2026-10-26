// Drawn test pictures for the media library: rooms, floor plans and community
// scenes. Used only for the demo, until real photos are uploaded. Each picture
// is consistent for the same seed, so a home's kitchen always looks the same.

import { HomeArt } from "@/components/home-art";

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const FINISHES = [
  { wall: "#F3F0EA", cabinet: "#FFFFFF", cabinetShade: "#E9E6E0", floor: "#C9A57B", floorLine: "#B8946B", accent: "#2F3A4A", counter: "#E7E4DF", fabric: "#8C9A8B" },
  { wall: "#EEF0F0", cabinet: "#2E3D52", cabinetShade: "#24324A", floor: "#B9B2A8", floorLine: "#A8A196", accent: "#C79A4B", counter: "#F4F2EE", fabric: "#C9B79C" },
  { wall: "#F1EDE4", cabinet: "#97A68F", cabinetShade: "#86957E", floor: "#A57E57", floorLine: "#93704C", accent: "#3A3A38", counter: "#EFEBE3", fabric: "#D8CFC1" },
  { wall: "#F5F3EF", cabinet: "#B88A5E", cabinetShade: "#A47A51", floor: "#D2C5B3", floorLine: "#C2B5A2", accent: "#1F2A33", counter: "#2B2B2B", fabric: "#5B6E7F" },
];

type Room = "kitchen" | "living" | "primary_bedroom" | "bedroom" | "primary_bath" | "bath" | "dining" | "backyard";

export function RoomArt({ room, seed, className }: { room: Room; seed: string; className?: string }) {
  const f = FINISHES[hash(seed) % FINISHES.length];
  const id = `r${hash(seed + room).toString(36)}`;
  return (
    <svg viewBox="0 0 480 320" preserveAspectRatio="xMidYMid slice" className={className} role="img" aria-label={`Illustration of the ${room.replace("_", " ")}`}>
      <defs>
        <linearGradient id={`${id}-light`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.35" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <linearGradient id={`${id}-sky`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#A9CDEB" />
          <stop offset="1" stopColor="#E6F1F9" />
        </linearGradient>
      </defs>
      {room === "backyard" ? (
        <Backyard f={f} id={id} />
      ) : (
        <>
          <rect width="480" height="320" fill={f.wall} />
          <rect y="236" width="480" height="84" fill={f.floor} />
          {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
            <line key={i} x1={i * 70 - 40} y1="320" x2={i * 60 + 10} y2="236" stroke={f.floorLine} strokeWidth="1.5" />
          ))}
          <rect y="232" width="480" height="5" fill="#fff" opacity="0.7" />
          {room === "kitchen" && <Kitchen f={f} id={id} />}
          {room === "living" && <Living f={f} id={id} />}
          {room === "dining" && <Living f={f} id={id} dining />}
          {(room === "primary_bedroom" || room === "bedroom") && <Bedroom f={f} id={id} primary={room === "primary_bedroom"} />}
          {(room === "primary_bath" || room === "bath") && <Bath f={f} id={id} primary={room === "primary_bath"} />}
          <rect width="480" height="320" fill={`url(#${id}-light)`} />
        </>
      )}
    </svg>
  );
}

type F = (typeof FINISHES)[number];

function Window({ x, y, w, h, id }: { x: number; y: number; w: number; h: number; id: string }) {
  return (
    <g>
      <rect x={x - 4} y={y - 4} width={w + 8} height={h + 8} fill="#fff" />
      <rect x={x} y={y} width={w} height={h} fill={`url(#${id}-sky)`} />
      <path d={`M${x} ${y + h * 0.75} Q ${x + w * 0.3} ${y + h * 0.55} ${x + w * 0.55} ${y + h * 0.72} T ${x + w} ${y + h * 0.66} V ${y + h} H ${x} Z`} fill="#8FB07A" opacity="0.9" />
      <line x1={x + w / 2} y1={y} x2={x + w / 2} y2={y + h} stroke="#fff" strokeWidth="3" />
      <line x1={x} y1={y + h / 2} x2={x + w} y2={y + h / 2} stroke="#fff" strokeWidth="3" />
    </g>
  );
}

function Kitchen({ f, id }: { f: F; id: string }) {
  return (
    <g>
      {/* upper cabinets */}
      {[30, 92, 336, 398].map((x) => (
        <g key={x}>
          <rect x={x} y="40" width="56" height="70" rx="2" fill={f.cabinet} stroke={f.cabinetShade} strokeWidth="2" />
          <rect x={x + 44} y="70" width="3" height="16" rx="1" fill={f.accent} />
        </g>
      ))}
      <Window x={170} y={50} w={140} h={84} id={id} />
      {/* hood */}
      <polygon points="400,110 452,110 444,140 408,140" fill={f.cabinetShade} />
      {/* backsplash */}
      <rect x="24" y="116" width="432" height="44" fill="#fff" opacity="0.65" />
      {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((i) => (
        <line key={i} x1={24 + i * 36} y1="116" x2={24 + i * 36} y2="160" stroke={f.counter} strokeWidth="1" />
      ))}
      {/* base cabinets + counter */}
      <rect x="24" y="160" width="432" height="10" fill={f.counter} />
      <rect x="24" y="170" width="432" height="64" fill={f.cabinet} />
      {[24, 96, 168, 240, 312, 384].map((x) => (
        <g key={x}>
          <rect x={x + 4} y="176" width="64" height="52" fill="none" stroke={f.cabinetShade} strokeWidth="2" />
          <rect x={x + 30} y="182" width="12" height="3" rx="1" fill={f.accent} />
        </g>
      ))}
      <rect x="404" y="172" width="44" height="36" rx="2" fill="#2A2A2A" />
      {/* island */}
      <rect x="110" y="214" width="260" height="12" fill={f.counter} />
      <rect x="118" y="226" width="244" height="58" fill={f.cabinetShade} />
      {[150, 210, 270, 330].map((x) => (
        <g key={x}>
          <rect x={x - 12} y="246" width="24" height="6" rx="2" fill={f.accent} />
          <line x1={x - 8} y1="252" x2={x - 10} y2="296" stroke={f.accent} strokeWidth="3" />
          <line x1={x + 8} y1="252" x2={x + 10} y2="296" stroke={f.accent} strokeWidth="3" />
        </g>
      ))}
      {/* pendants */}
      {[170, 240, 310].map((x) => (
        <g key={x}>
          <line x1={x} y1="0" x2={x} y2="168" stroke={f.accent} strokeWidth="1.5" />
          <path d={`M${x - 14} 184 Q ${x} 160 ${x + 14} 184 Z`} fill={f.accent} />
          <ellipse cx={x} cy="186" rx="10" ry="3" fill="#FFE7A8" />
        </g>
      ))}
      {/* fruit bowl */}
      <ellipse cx="200" cy="212" rx="16" ry="5" fill="#fff" />
      <circle cx="194" cy="207" r="5" fill="#E9A23B" />
      <circle cx="204" cy="206" r="5" fill="#9FBF5A" />
    </g>
  );
}

function Living({ f, id, dining }: { f: F; id: string; dining?: boolean }) {
  if (dining) {
    return (
      <g>
        <Window x={60} y={46} w={120} h={150} id={id} />
        <Window x={300} y={46} w={120} h={150} id={id} />
        <line x1="240" y1="0" x2="240" y2="96" stroke={f.accent} strokeWidth="2" />
        <circle cx="240" cy="110" r="22" fill="none" stroke={f.accent} strokeWidth="3" />
        <circle cx="240" cy="110" r="6" fill="#FFE7A8" />
        <rect x="120" y="200" width="240" height="12" rx="3" fill={f.cabinetShade === "#E9E6E0" ? "#8A6A4A" : f.cabinetShade} />
        <rect x="140" y="212" width="8" height="64" fill={f.accent} />
        <rect x="332" y="212" width="8" height="64" fill={f.accent} />
        {[100, 170, 290, 360].map((x) => (
          <g key={x}>
            <rect x={x} y="176" width="30" height="60" rx="6" fill={f.fabric} />
            <rect x={x + 2} y="232" width="4" height="48" fill={f.accent} />
            <rect x={x + 24} y="232" width="4" height="48" fill={f.accent} />
          </g>
        ))}
      </g>
    );
  }
  return (
    <g>
      <Window x={250} y={40} w={180} h={150} id={id} />
      {/* art */}
      <rect x="70" y="70" width="110" height="74" fill="#fff" stroke={f.accent} strokeWidth="4" />
      <path d="M80 130 Q 110 90 130 120 T 170 105 V 136 H 80 Z" fill={f.fabric} opacity="0.8" />
      <circle cx="152" cy="92" r="9" fill="#E9B872" />
      {/* rug */}
      <ellipse cx="220" cy="282" rx="190" ry="26" fill="#fff" opacity="0.55" />
      {/* sofa */}
      <rect x="40" y="176" width="260" height="56" rx="14" fill={f.fabric} />
      <rect x="52" y="200" width="236" height="42" rx="8" fill={f.fabric} />
      <rect x="30" y="196" width="28" height="56" rx="10" fill={f.fabric} />
      <rect x="282" y="196" width="28" height="56" rx="10" fill={f.fabric} />
      <rect x="70" y="186" width="44" height="30" rx="8" fill="#fff" opacity="0.6" />
      <rect x="226" y="186" width="44" height="30" rx="8" fill={f.accent} opacity="0.6" />
      <rect x="60" y="252" width="6" height="16" fill={f.accent} />
      <rect x="276" y="252" width="6" height="16" fill={f.accent} />
      {/* coffee table */}
      <ellipse cx="200" cy="276" rx="66" ry="12" fill={f.accent} />
      <rect x="196" y="276" width="8" height="22" fill={f.accent} />
      {/* plant */}
      <rect x="400" y="236" width="36" height="40" rx="4" fill="#fff" />
      <path d="M418 236 C 400 200 380 196 392 170 M418 236 C 420 196 430 180 446 168 M418 236 C 410 200 418 170 414 150" stroke="#5E8A4E" strokeWidth="6" fill="none" strokeLinecap="round" />
    </g>
  );
}

function Bedroom({ f, id, primary }: { f: F; id: string; primary: boolean }) {
  const w = primary ? 240 : 180;
  const x = 240 - w / 2;
  return (
    <g>
      <Window x={primary ? 360 : 340} y={60} w={90} h={120} id={id} />
      {primary && <path d="M40 0 V 30 Q 240 60 440 30 V 0 Z" fill="#fff" opacity="0.5" />}
      {/* headboard */}
      <rect x={x} y="120" width={w} height="90" rx="10" fill={f.fabric} />
      {/* bed */}
      <rect x={x - 6} y="196" width={w + 12} height="62" rx="8" fill="#fff" />
      <rect x={x - 6} y="226" width={w + 12} height="32" rx="6" fill={f.cabinet === "#FFFFFF" ? "#D9CFC1" : f.cabinet} />
      <rect x={x + 16} y="176" width={w / 2 - 28} height="28" rx="10" fill="#F7F5F1" />
      <rect x={x + w / 2 + 12} y="176" width={w / 2 - 28} height="28" rx="10" fill="#F7F5F1" />
      <rect x={x - 6} y="258" width="10" height="20" fill={f.accent} />
      <rect x={x + w - 4} y="258" width="10" height="20" fill={f.accent} />
      {/* nightstands + lamps */}
      {[x - 66, x + w + 16].map((nx) => (
        <g key={nx}>
          <rect x={nx} y="208" width="50" height="50" rx="3" fill={f.cabinetShade} />
          <rect x={nx + 22} y="178" width="6" height="30" fill={f.accent} />
          <path d={`M${nx + 8} 182 L ${nx + 14} 156 H ${nx + 36} L ${nx + 42} 182 Z`} fill="#FFF4D6" />
        </g>
      ))}
    </g>
  );
}

function Bath({ f, id, primary }: { f: F; id: string; primary: boolean }) {
  return (
    <g>
      {/* tile wall */}
      <rect x="0" y="0" width="480" height="236" fill="#fff" opacity="0.5" />
      {Array.from({ length: 12 }).map((_, i) => (
        <line key={`v${i}`} x1={i * 40} y1="0" x2={i * 40} y2="236" stroke={f.counter} strokeWidth="1" />
      ))}
      {Array.from({ length: 6 }).map((_, i) => (
        <line key={`h${i}`} x1="0" y1={i * 40} x2="480" y2={i * 40} stroke={f.counter} strokeWidth="1" />
      ))}
      <Window x={primary ? 330 : 360} y={40} w={primary ? 110 : 70} h={70} id={id} />
      {/* vanity */}
      <rect x="30" y="164" width={primary ? 250 : 170} height="10" fill={f.counter === "#2B2B2B" ? "#EDEBE6" : f.counter} />
      <rect x="36" y="174" width={primary ? 238 : 158} height="62" fill={f.cabinet} stroke={f.cabinetShade} strokeWidth="2" />
      {(primary ? [70, 200] : [110]).map((cx) => (
        <g key={cx}>
          <ellipse cx={cx} cy="166" rx="28" ry="5" fill="#fff" />
          <rect x={cx - 3} y="146" width="6" height="16" fill={f.accent} />
          <rect x={cx - 34} y="56" width="68" height="84" rx="34" fill="#E4EEF4" stroke={f.accent} strokeWidth="3" />
        </g>
      ))}
      {/* tub */}
      {primary ? (
        <g>
          <path d="M300 200 H 460 Q 456 262 410 266 H 350 Q 304 262 300 200 Z" fill="#fff" stroke="#DDD8D0" strokeWidth="2" />
          <rect x="430" y="170" width="5" height="32" fill={f.accent} />
          <path d="M430 172 Q 418 168 414 180" stroke={f.accent} strokeWidth="4" fill="none" />
        </g>
      ) : (
        <g>
          <rect x="250" y="40" width="200" height="196" fill="#E4EEF4" opacity="0.6" stroke="#fff" strokeWidth="4" />
          <rect x="250" y="200" width="200" height="40" fill="#fff" />
        </g>
      )}
      {/* towel */}
      <rect x="12" y="98" width="14" height="60" rx="4" fill={f.fabric} />
    </g>
  );
}

function Backyard({ f, id }: { f: F; id: string }) {
  return (
    <g>
      <rect width="480" height="320" fill={`url(#${id}-sky)`} />
      <rect y="150" width="480" height="40" fill="#8E7B66" />
      {Array.from({ length: 30 }).map((_, i) => (
        <rect key={i} x={i * 16} y="150" width="14" height="40" fill="#A08A72" />
      ))}
      <rect y="186" width="480" height="134" fill="#86AA5E" />
      {/* covered patio */}
      <polygon points="0,60 260,60 280,96 0,96" fill="#4B5058" />
      <rect x="0" y="96" width="270" height="124" fill={f.wall} opacity="0.5" />
      <rect x="0" y="210" width="290" height="30" fill="#D9D3C7" />
      <rect x="250" y="96" width="10" height="120" fill="#fff" />
      <rect x="120" y="96" width="10" height="120" fill="#fff" />
      {/* furniture */}
      <rect x="30" y="176" width="80" height="30" rx="6" fill={f.fabric} />
      <rect x="150" y="190" width="50" height="10" rx="2" fill={f.accent} />
      {/* grill */}
      <rect x="320" y="200" width="44" height="24" rx="6" fill="#2D2D2D" />
      <rect x="324" y="224" width="4" height="22" fill="#2D2D2D" />
      <rect x="356" y="224" width="4" height="22" fill="#2D2D2D" />
      {/* young tree */}
      <rect x="420" y="170" width="5" height="70" fill="#6B5444" />
      <circle cx="422" cy="160" r="22" fill="#6E9450" />
      <rect width="480" height="320" fill={`url(#${id}-light)`} />
    </g>
  );
}

// ---------------------------------------------------------------------------
// Floor plan
// ---------------------------------------------------------------------------
export function FloorPlanArt({ plan, beds, baths, sqft, className }: { plan: string; beds: number; baths: string; sqft: number | null; className?: string }) {
  const h = hash(plan);
  const ink = "#2A3442";
  const wall = { stroke: ink, strokeWidth: 4, fill: "none" } as const;
  const kitchenRight = h % 2 === 0;
  const rooms: { x: number; y: number; w: number; h: number; label: string }[] = [
    { x: 40, y: 40, w: 150, h: 110, label: "Primary bedroom" },
    { x: 40, y: 150, w: 90, h: 80, label: "Primary bath" },
    { x: 130, y: 150, w: 60, h: 80, label: "Closet" },
    { x: 190, y: 40, w: 150, h: 130, label: "Family room" },
    { x: kitchenRight ? 340 : 190, y: kitchenRight ? 40 : 170, w: kitchenRight ? 100 : 150, h: kitchenRight ? 130 : 110, label: "Kitchen" },
    { x: kitchenRight ? 190 : 340, y: kitchenRight ? 170 : 40, w: kitchenRight ? 150 : 100, h: kitchenRight ? 110 : 130, label: "Dining" },
    { x: 340, y: 170, w: 100, h: 110, label: beds >= 4 ? "Bedroom 3" : "Bedroom 2" },
    { x: 40, y: 230, w: 150, h: 50, label: "Garage" },
  ];
  return (
    <svg viewBox="0 0 480 320" preserveAspectRatio="xMidYMid meet" className={className} role="img" aria-label={`${plan} floor plan`}>
      <rect width="480" height="320" fill="#FBFBF9" />
      {Array.from({ length: 25 }).map((_, i) => (
        <line key={`g${i}`} x1={i * 20} y1="0" x2={i * 20} y2="320" stroke="#EEF0F3" />
      ))}
      {Array.from({ length: 17 }).map((_, i) => (
        <line key={`h${i}`} x1="0" y1={i * 20} x2="480" y2={i * 20} stroke="#EEF0F3" />
      ))}
      <rect x="40" y="40" width="400" height="240" {...wall} strokeWidth={6} />
      {rooms.map((r) => (
        <g key={r.label}>
          <rect x={r.x} y={r.y} width={r.w} height={r.h} {...wall} />
          <text x={r.x + r.w / 2} y={r.y + r.h / 2 + 4} textAnchor="middle" fontSize="11" fontFamily="system-ui, sans-serif" fill={ink}>
            {r.label}
          </text>
        </g>
      ))}
      {/* door swings */}
      <path d="M190 120 A 20 20 0 0 1 210 140" stroke={ink} strokeWidth="1.5" fill="none" />
      <path d="M340 220 A 20 20 0 0 0 360 240" stroke={ink} strokeWidth="1.5" fill="none" />
      <text x="40" y="26" fontSize="15" fontWeight="700" fontFamily="system-ui, sans-serif" fill={ink}>The {plan}</text>
      <text x="440" y="26" textAnchor="end" fontSize="12" fontFamily="system-ui, sans-serif" fill="#6A6F76">
        {beds} bed, {baths} bath{sqft ? `, ${sqft.toLocaleString("en-US")} sq ft` : ""}
      </text>
      <text x="40" y="304" fontSize="10" fontFamily="system-ui, sans-serif" fill="#9AA0A6">Demo floor plan. Not to scale.</text>
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Community scenes
// ---------------------------------------------------------------------------
export function CommunityArt({ kind, name, seed, className }: { kind: "entrance" | "amenity" | "aerial" | "site_map" | "model_home"; name: string; seed: string; className?: string }) {
  if (kind === "model_home") return <HomeArt seed={seed} stories={2} scene="golden" className={className} />;
  const id = `c${hash(seed + kind).toString(36)}`;
  return (
    <svg viewBox="0 0 480 320" preserveAspectRatio="xMidYMid slice" className={className} role="img" aria-label={`${name} ${kind.replace("_", " ")}`}>
      <defs>
        <linearGradient id={`${id}-sky`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#9CC8EE" />
          <stop offset="1" stopColor="#EAF3FA" />
        </linearGradient>
        <linearGradient id={`${id}-water`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#5EC3E0" />
          <stop offset="1" stopColor="#2F8FBF" />
        </linearGradient>
      </defs>
      {kind === "entrance" && (
        <g>
          <rect width="480" height="320" fill={`url(#${id}-sky)`} />
          <rect y="210" width="480" height="110" fill="#86AA5E" />
          <path d="M0 230 Q 240 200 480 230 V 320 H 0 Z" fill="#7C9F55" />
          <rect x="100" y="120" width="280" height="110" fill="#E3D6C2" />
          {Array.from({ length: 6 }).map((_, i) => (
            <line key={i} x1="100" y1={130 + i * 18} x2="380" y2={130 + i * 18} stroke="#D4C4AC" strokeWidth="2" />
          ))}
          <rect x="88" y="110" width="304" height="14" fill="#C9B79C" />
          <text x="240" y="186" textAnchor="middle" fontSize="28" fontWeight="700" fontFamily="Georgia, serif" fill="#3B3A36">{name}</text>
          <text x="240" y="208" textAnchor="middle" fontSize="11" letterSpacing="3" fontFamily="system-ui, sans-serif" fill="#5B5A55">A NEW HOME COMMUNITY</text>
          {[70, 410].map((x) => (
            <g key={x}>
              <rect x={x - 3} y="150" width="6" height="80" fill="#6B5444" />
              <circle cx={x} cy="140" r="30" fill="#6E9450" />
            </g>
          ))}
          {[120, 170, 310, 360].map((x) => <ellipse key={x} cx={x} cy="232" rx="24" ry="10" fill="#C77DA0" opacity="0.85" />)}
        </g>
      )}
      {kind === "amenity" && (
        <g>
          <rect width="480" height="320" fill={`url(#${id}-sky)`} />
          <rect y="140" width="480" height="180" fill="#E8E1D5" />
          <rect x="60" y="170" width="300" height="120" rx="8" fill={`url(#${id}-water)`} />
          {[190, 215, 240, 265].map((y) => (
            <path key={y} d={`M80 ${y} q 20 -6 40 0 t 40 0 t 40 0 t 40 0 t 40 0 t 40 0`} stroke="#fff" strokeOpacity="0.45" strokeWidth="2" fill="none" />
          ))}
          <polygon points="370,90 470,90 470,110 370,110" fill="#3B4C5E" />
          <rect x="378" y="110" width="84" height="80" fill="#F4EFE6" />
          <rect x="378" y="110" width="84" height="12" fill="#3B4C5E" opacity="0.2" />
          {[90, 150, 210].map((x) => (
            <g key={x}>
              <rect x={x} y="146" width="40" height="10" rx="3" fill="#fff" />
              <circle cx={x + 34} cy="130" r="16" fill="#F2C14E" opacity="0.9" />
              <rect x={x + 33} y="130" width="2" height="18" fill="#6B5444" />
            </g>
          ))}
          <text x="24" y="40" fontSize="15" fontWeight="700" fontFamily="system-ui, sans-serif" fill="#1E2125">{name} resort-style pool</text>
        </g>
      )}
      {(kind === "aerial" || kind === "site_map") && (
        <g>
          <rect width="480" height="320" fill={kind === "aerial" ? "#9DB57A" : "#FBFBF9"} />
          {[90, 190, 290].map((y) => (
            <rect key={y} x="0" y={y} width="480" height="18" fill={kind === "aerial" ? "#BDB8AE" : "#E3E6EA"} />
          ))}
          <rect x="230" y="0" width="18" height="320" fill={kind === "aerial" ? "#BDB8AE" : "#E3E6EA"} />
          {[20, 108, 208].map((y, row) =>
            Array.from({ length: 10 }).map((_, i) => {
              const x = (i < 5 ? 10 : 30) + i * 44;
              const n = row * 10 + i + 1;
              const sold = hash(seed + n) % 3 === 0;
              return (
                <g key={`${y}-${i}`}>
                  <rect x={x} y={y} width="38" height="62" fill={kind === "aerial" ? (sold ? "#C9C3B6" : "#A9C08A") : sold ? "#DADDE2" : "#EEF1FD"} stroke={kind === "aerial" ? "#8DA46B" : "#3452C7"} strokeWidth="1" />
                  {kind === "aerial" && sold && <rect x={x + 8} y={y + 14} width="22" height="26" fill="#6E6A63" />}
                  {kind === "site_map" && (
                    <text x={x + 19} y={y + 36} textAnchor="middle" fontSize="10" fontFamily="system-ui, sans-serif" fill="#1E2125">{n}</text>
                  )}
                </g>
              );
            }),
          )}
          {kind === "site_map" && (
            <g>
              <rect x="14" y="290" width="12" height="12" fill="#EEF1FD" stroke="#3452C7" />
              <text x="32" y="300" fontSize="10" fontFamily="system-ui, sans-serif" fill="#1E2125">Available</text>
              <rect x="100" y="290" width="12" height="12" fill="#DADDE2" stroke="#3452C7" />
              <text x="118" y="300" fontSize="10" fontFamily="system-ui, sans-serif" fill="#1E2125">Sold</text>
              <text x="466" y="302" textAnchor="end" fontSize="12" fontWeight="700" fontFamily="system-ui, sans-serif" fill="#1E2125">{name} site plan</text>
            </g>
          )}
        </g>
      )}
    </svg>
  );
}
