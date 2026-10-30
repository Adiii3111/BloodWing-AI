/** BLOODWING mark: a blood drop carried on two swept wings. */
export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <defs>
        <linearGradient id="bw-drop" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ff6b75" />
          <stop offset="1" stopColor="#c42c39" />
        </linearGradient>
      </defs>
      <path d="M4 30 L24 26 L22 33 Z" fill="#22d3ee" opacity="0.9" />
      <path d="M60 30 L40 26 L42 33 Z" fill="#22d3ee" opacity="0.9" />
      <path d="M32 10c6.5 9.5 12 16 12 23.5a12 12 0 0 1-24 0C20 26 25.5 19.5 32 10z" fill="url(#bw-drop)" />
      <path d="M27 35a5 5 0 0 0 5 5" stroke="#fff" strokeOpacity="0.6" strokeWidth="2" fill="none" strokeLinecap="round" />
    </svg>
  );
}
