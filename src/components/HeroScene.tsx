import { useEffect, useRef } from 'react';

/**
 * Engineered hero scene: a perspective city logistics grid with hospital nodes, aerial corridors
 * and blood-flow particles travelling along them, under a medical delivery drone.
 * Canvas for the particles (paused when off-screen / reduced motion), SVG for crisp structure.
 */
const NODES = [
  [0.18, 0.62],
  [0.32, 0.5],
  [0.47, 0.66],
  [0.6, 0.52],
  [0.74, 0.64],
  [0.86, 0.5],
  [0.4, 0.8],
  [0.68, 0.82],
] as const;
const LINKS = [
  [0, 1],
  [1, 3],
  [3, 5],
  [1, 2],
  [2, 4],
  [3, 4],
  [2, 6],
  [4, 7],
  [6, 7],
  [0, 6],
  [5, 4],
] as const;

export function HeroScene() {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = canvas.current!;
    const ctx = c.getContext('2d')!;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let raf = 0;
    let visible = true;
    const parts = Array.from({ length: 70 }, (_, i) => ({ link: i % LINKS.length, f: Math.random(), v: 0.0012 + Math.random() * 0.0022, red: Math.random() < 0.35 }));
    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      c.width = c.clientWidth * dpr;
      c.height = c.clientHeight * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);
    const io = new IntersectionObserver(([e]) => (visible = e.isIntersecting));
    io.observe(c);
    const draw = () => {
      const w = c.clientWidth;
      const h = c.clientHeight;
      ctx.clearRect(0, 0, w, h);
      for (const p of parts) {
        if (!reduce) p.f += p.v;
        if (p.f > 1) p.f -= 1;
        const [a, b] = LINKS[p.link];
        const ax = NODES[a][0] * w;
        const ay = NODES[a][1] * h;
        const bx = NODES[b][0] * w;
        const by = NODES[b][1] * h;
        const mx = (ax + bx) / 2;
        const my = Math.min(ay, by) - h * 0.08;
        const t = p.f;
        const x = (1 - t) * (1 - t) * ax + 2 * (1 - t) * t * mx + t * t * bx;
        const y = (1 - t) * (1 - t) * ay + 2 * (1 - t) * t * my + t * t * by;
        const g = ctx.createRadialGradient(x, y, 0, x, y, p.red ? 5 : 4);
        g.addColorStop(0, p.red ? 'rgba(255,107,117,.95)' : 'rgba(34,211,238,.9)');
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, p.red ? 5 : 4, 0, Math.PI * 2);
        ctx.fill();
      }
      if (visible && !reduce) raf = requestAnimationFrame(draw);
      else if (!reduce) setTimeout(() => (raf = requestAnimationFrame(draw)), 300);
    };
    draw();
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      io.disconnect();
    };
  }, []);

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      <svg className="absolute inset-0 h-full w-full" viewBox="0 0 1000 600" preserveAspectRatio="xMidYMid slice">
        <defs>
          <linearGradient id="hz" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#030712" stopOpacity="0" />
            <stop offset="1" stopColor="#0b2a44" stopOpacity="0.55" />
          </linearGradient>
          <radialGradient id="glow" cx="0.5" cy="0.3" r="0.5">
            <stop offset="0" stopColor="#22d3ee" stopOpacity="0.18" />
            <stop offset="1" stopColor="#22d3ee" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="corr" x1="0" x2="1">
            <stop offset="0" stopColor="#3b82f6" stopOpacity="0.1" />
            <stop offset="0.5" stopColor="#22d3ee" stopOpacity="0.7" />
            <stop offset="1" stopColor="#3b82f6" stopOpacity="0.1" />
          </linearGradient>
        </defs>
        <rect width="1000" height="600" fill="url(#hz)" />
        <ellipse cx="560" cy="170" rx="420" ry="220" fill="url(#glow)" />
        {/* perspective street grid */}
        <g stroke="#22d3ee" strokeOpacity="0.07">
          {Array.from({ length: 22 }, (_, i) => (
            <line key={`v${i}`} x1={500 + (i - 11) * 18} y1="250" x2={500 + (i - 11) * 120} y2="620" />
          ))}
          {Array.from({ length: 12 }, (_, i) => {
            const y = 260 + Math.pow(i / 11, 1.7) * 360;
            return <line key={`h${i}`} x1="0" y1={y} x2="1000" y2={y} />;
          })}
        </g>
        {/* skyline blocks */}
        <g fill="#0b1626" stroke="#1e3a5f" strokeOpacity="0.6">
          {[60, 110, 150, 205, 250, 300, 345, 640, 690, 735, 780, 830, 880, 930].map((x, i) => {
            const h = 30 + ((i * 37) % 70);
            return <rect key={x} x={x} y={262 - h} width={34 + ((i * 13) % 18)} height={h} />;
          })}
        </g>
        {/* aerial corridors */}
        {LINKS.map(([a, b], i) => {
          const ax = NODES[a][0] * 1000;
          const ay = NODES[a][1] * 600;
          const bx = NODES[b][0] * 1000;
          const by = NODES[b][1] * 600;
          const mx = (ax + bx) / 2;
          const my = Math.min(ay, by) - 48;
          return <path key={i} d={`M${ax},${ay} Q${mx},${my} ${bx},${by}`} stroke="url(#corr)" strokeWidth="1.2" fill="none" />;
        })}
        {NODES.map(([x, y], i) => (
          <g key={i} transform={`translate(${x * 1000},${y * 600})`}>
            <circle r="14" fill="#22d3ee" opacity="0.06" />
            {i % 3 === 0 ? (
              <path d="M0,-7 L6,-3.5 L6,3.5 L0,7 L-6,3.5 L-6,-3.5Z" fill="#07111f" stroke="#22d3ee" strokeWidth="1.4" />
            ) : (
              <rect x="-5.5" y="-5.5" width="11" height="11" rx="2.5" fill="#07111f" stroke="#3b82f6" strokeWidth="1.4" />
            )}
            {i === 4 && <circle r="10" fill="none" stroke="#e63946" strokeWidth="1.2" className="hero-ping" />}
          </g>
        ))}
      </svg>
      <canvas ref={canvas} className="absolute inset-0 h-full w-full" />
      {/* drone */}
      <svg className="hero-drone absolute left-1/2 top-[14%] w-[min(380px,60vw)] -translate-x-1/2" viewBox="0 0 400 200">
        <defs>
          <linearGradient id="body" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#1e293b" />
            <stop offset="1" stopColor="#0b1626" />
          </linearGradient>
        </defs>
        <ellipse cx="200" cy="188" rx="120" ry="7" fill="#22d3ee" opacity="0.08" />
        <g stroke="#94a3b8" strokeWidth="5" strokeLinecap="round">
          <line x1="150" y1="82" x2="62" y2="60" />
          <line x1="250" y1="82" x2="338" y2="60" />
          <line x1="160" y1="96" x2="90" y2="118" />
          <line x1="240" y1="96" x2="310" y2="118" />
        </g>
        {[
          [62, 56],
          [338, 56],
          [90, 114],
          [310, 114],
        ].map(([x, y], i) => (
          <g key={i}>
            <rect x={x - 6} y={y - 4} width="12" height="12" rx="3" fill="#334155" />
            <ellipse cx={x} cy={y - 6} rx="46" ry="5" fill="#22d3ee" opacity="0.16" className="rotor" />
            <ellipse cx={x} cy={y - 6} rx="46" ry="1.4" fill="#e2e8f0" opacity="0.5" className="rotor" />
          </g>
        ))}
        <path d="M140 74 Q200 52 260 74 L268 100 Q200 116 132 100Z" fill="url(#body)" stroke="#22d3ee" strokeOpacity="0.5" />
        <rect x="186" y="66" width="28" height="5" rx="2.5" fill="#22d3ee" opacity="0.9" />
        {/* cargo pod with cross */}
        <line x1="200" y1="108" x2="200" y2="126" stroke="#64748b" strokeWidth="2" />
        <rect x="174" y="124" width="52" height="34" rx="7" fill="#f8fafc" />
        <path d="M200 130v22M189 141h22" stroke="#e63946" strokeWidth="6" strokeLinecap="round" />
        <circle cx="134" cy="88" r="3" fill="#e63946" className="nav-blink" />
        <circle cx="266" cy="88" r="3" fill="#22d3ee" />
      </svg>
      <style>{`
        .rotor { transform-box: fill-box; transform-origin: center; animation: rotor .09s linear infinite; }
        @keyframes rotor { 50% { transform: scaleX(.35); } }
        .hero-drone { animation: hover 5s ease-in-out infinite; }
        @keyframes hover { 50% { transform: translate(-50%, -10px); } }
        .nav-blink { animation: pulse-dot 1.2s infinite; }
        .hero-ping { transform-box: fill-box; transform-origin: center; animation: ping 1.8s ease-out infinite; }
      `}</style>
    </div>
  );
}
