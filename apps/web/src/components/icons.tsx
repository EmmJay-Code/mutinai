/** Small line icons for discovery paths (model intents and hardware goals). Decorative; the label always carries meaning. */
const PATHS: Record<string, React.ReactNode> = {
  coding: <><polyline points="5.5 4 1.5 8 5.5 12" /><polyline points="10.5 4 14.5 8 10.5 12" /></>,
  local: <><rect x="2.5" y="3" width="11" height="7.5" rx="1" /><path d="M1 13h14" /></>,
  reasoning: <><circle cx="3.5" cy="12.5" r="1.6" /><circle cx="12.5" cy="3.5" r="1.6" /><path d="M5.1 12.5h3.4a2 2 0 0 0 2-2V5.1" /></>,
  vision: <><path d="M1 8s2.5-4.5 7-4.5S15 8 15 8s-2.5 4.5-7 4.5S1 8 1 8z" /><circle cx="8" cy="8" r="2" /></>,
  agents: <><circle cx="3.5" cy="4" r="1.6" /><circle cx="12.5" cy="4" r="1.6" /><circle cx="8" cy="12.5" r="1.6" /><path d="M5.1 4h5.8M4.3 5.4l2.9 5.6M11.7 5.4l-2.9 5.6" /></>,
  fast: <path d="M9 1.5 3.5 9H8l-1 5.5L12.5 7H8z" />,
  small: <><rect x="1.5" y="1.5" width="13" height="13" rx="1.5" strokeDasharray="2 2" /><rect x="5" y="5" width="6" height="6" rx="1" /></>,
  open: <><rect x="3" y="7" width="10" height="7.5" rx="1" /><path d="M5.5 7V4.8a2.5 2.5 0 0 1 4.9-.7" /></>,
  first: <><path d="M2 7.5 8 2.5l6 5" /><path d="M3.5 6.5v7h9v-7" /></>,
  upgrade: <><rect x="1.5" y="4.5" width="13" height="7.5" rx="1" /><circle cx="10.5" cy="8.25" r="2" /><path d="M4 7.5h2.5M4 9.5h2.5M3 12v1.5" /></>,
  apple: <><rect x="3" y="3" width="10" height="10" rx="2" /><rect x="6" y="6" width="4" height="4" rx="0.5" /><path d="M6 1v2M10 1v2M6 13v2M10 13v2M1 6h2M1 10h2M13 6h2M13 10h2" /></>,
  workstation: <><rect x="4" y="1.5" width="8" height="13" rx="1" /><path d="M6 4.5h4M6 6.5h4" /><circle cx="8" cy="11" r="1" /></>,
  server: <><rect x="1.5" y="2" width="13" height="5" rx="1" /><rect x="1.5" y="9" width="13" height="5" rx="1" /><path d="M4 4.5h1M4 11.5h1" /></>,
  learn: <><path d="M8 4.6S6.4 3 3 3v9c3.4 0 5 1.6 5 1.6S9.6 12 13 12V3c-3.4 0-5 1.6-5 1.6z" /><path d="M8 4.6v9" /></>,
  minipc: <><rect x="1.5" y="5" width="13" height="6.5" rx="1.5" /><circle cx="4.5" cy="8.25" r="0.9" /><path d="M8 8.25h4" /></>,
};

/** Hardware-class placeholder icons reuse the goal drawings. */
PATHS.gpu = PATHS.upgrade;
PATHS.chip = PATHS.apple;
PATHS.laptop = PATHS.local;
PATHS.desktop = PATHS.workstation;

export function PathIcon({ name, size = 16 }: { name: string; size?: number }) {
  return (
    <svg className="path-icon" width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {PATHS[name]}
    </svg>
  );
}
