import { useId } from 'react';
import type { ReactNode } from 'react';

export interface SceneSvgProps {
  /** The accessible name. Each drawing says only what its caller says it means. */
  title: string;
  /** Hides the drawing from assistive technology when an adjacent label already says it. */
  decorative?: boolean;
  className?: string;
}

interface FrameProps extends SceneSvgProps {
  viewBox: string;
  children: (id: string) => ReactNode;
}

function Frame({ title, decorative = false, className, viewBox, children }: FrameProps) {
  const id = useId();
  const titleId = `${id}-title`;
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={viewBox}
      className={className}
      role={decorative ? undefined : 'img'}
      aria-hidden={decorative ? 'true' : undefined}
      aria-labelledby={decorative ? undefined : titleId}
      focusable="false"
    >
      {!decorative && <title id={titleId}>{title}</title>}
      {children(id)}
    </svg>
  );
}

export function MarkerBlockedSvg(props: SceneSvgProps) {
  return (
    <Frame {...props} viewBox="0 0 24 24">
      {() => (
        <>
          <path d="m8 3 8 0 5 5v8l-5 5H8l-5-5V8Z" fill="#4a2536" stroke="#ff9bae" strokeWidth="1.8" />
          <path d="M7 12h10" stroke="#fff0f4" strokeWidth="2.5" strokeLinecap="round" />
        </>
      )}
    </Frame>
  );
}

export function MarkerEvidenceSvg(props: SceneSvgProps) {
  return (
    <Frame {...props} viewBox="0 0 24 24">
      {() => (
        <>
          <path d="M5 3h10l4 4v13H5Z" fill="#273a46" stroke="#88dde6" strokeWidth="1.8" strokeLinejoin="round" />
          <path d="M15 3v5h4M8 11h6M8 15h4" fill="none" stroke="#edfaff" strokeWidth="1.6" strokeLinecap="round" />
          <circle cx="16.5" cy="16.5" r="3" fill="#211a33" stroke="#ffd080" strokeWidth="1.5" />
          <path d="m18.7 18.7 2 2" stroke="#ffd080" strokeWidth="1.5" strokeLinecap="round" />
        </>
      )}
    </Frame>
  );
}

export function MarkerCoverageUnknownSvg(props: SceneSvgProps) {
  return (
    <Frame {...props} viewBox="0 0 24 24">
      {() => (
        <>
          <path d="M4 16a10 10 0 0 1 16 0" fill="none" stroke="#c5bdd6" strokeWidth="2" strokeLinecap="round" strokeDasharray="5 3" />
          <path d="M7.5 18.5a6 6 0 0 1 9 0" fill="none" stroke="#c5bdd6" strokeWidth="2" strokeLinecap="round" strokeDasharray="3 3" />
          <circle cx="12" cy="20" r="1.5" fill="#c5bdd6" />
          <path d="m5 5 14 14" stroke="#ff9bae" strokeWidth="1.5" strokeLinecap="round" />
        </>
      )}
    </Frame>
  );
}

export function MarkerOutcomeAcceptedSvg(props: SceneSvgProps) {
  return (
    <Frame {...props} viewBox="0 0 24 24">
      {() => (
        <>
          <path d="m12 2 7 3 3 7-3 7-7 3-7-3-3-7 3-7Z" fill="#234036" stroke="#92dfb8" strokeWidth="1.8" />
          <path d="m7.5 12.5 3 3 6-7" fill="none" stroke="#effff7" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        </>
      )}
    </Frame>
  );
}

export function MarkerAssistanceSvg(props: SceneSvgProps) {
  return (
    <Frame {...props} viewBox="0 0 24 24">
      {() => (
        <>
          <circle cx="7" cy="12" r="4" fill="#2b3a4b" stroke="#88dde6" strokeWidth="1.8" />
          <circle cx="17" cy="12" r="4" fill="#3b3151" stroke="#b49aff" strokeWidth="1.8" />
          <path d="M10 10.5h4m-4 3h4" stroke="#f7f3ff" strokeWidth="1.6" strokeLinecap="round" />
        </>
      )}
    </Frame>
  );
}

export function MilestoneStandingSvg(props: SceneSvgProps) {
  return (
    <Frame {...props} viewBox="0 0 120 140">
      {(id) => (
        <>
          <defs>
            <linearGradient id={`${id}-stone`} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#8d79a8" />
              <stop offset="1" stopColor="#3d2d50" />
            </linearGradient>
            <radialGradient id={`${id}-core`}>
              <stop offset="0" stopColor="#fff1b8" />
              <stop offset="1" stopColor="#ed9558" />
            </radialGradient>
          </defs>
          <ellipse cx="60" cy="125" rx="38" ry="10" fill="#130d1b" opacity=".4" />
          <path d="M37 119 44 48h32l7 71-11 10H48Z" fill={`url(#${id}-stone)`} stroke="#5b466d" strokeWidth="4" strokeLinejoin="round" />
          <path d="m38 51 7-21h30l7 21-12 7H50Z" fill="#655078" stroke="#806591" strokeWidth="3" strokeLinejoin="round" />
          <path d="M49 84h22v35H49Z" fill="#2a1d38" stroke="#756087" strokeWidth="3" />
          <path d="M60 93c8 0 13 7 9 14-2 4-5 7-9 11-4-4-7-7-9-11-4-7 1-14 9-14Z" fill={`url(#${id}-core)`} />
          <path d="M29 119h62l-9 13H38Z" fill="#4b385c" stroke="#604a72" strokeWidth="3" strokeLinejoin="round" />
        </>
      )}
    </Frame>
  );
}

export function MilestoneClearedSvg(props: SceneSvgProps) {
  return (
    <Frame {...props} viewBox="0 0 120 140">
      {(id) => (
        <>
          <defs>
            <linearGradient id={`${id}-stone`} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#746783" />
              <stop offset="1" stopColor="#342b3e" />
            </linearGradient>
          </defs>
          <ellipse cx="60" cy="125" rx="38" ry="10" fill="#130d1b" opacity=".4" />
          <path d="M37 119 44 48h13l6 8 8-8h5l7 71-11 10H48Z" fill={`url(#${id}-stone)`} stroke="#51465b" strokeWidth="4" strokeLinejoin="round" />
          <path d="m38 51 7-21h12l5 9 8-9h5l7 21-12 7H50Z" fill="#524a5c" stroke="#696071" strokeWidth="3" strokeLinejoin="round" />
          <path d="M49 84h22v35H49Z" fill="#28232d" stroke="#5b5263" strokeWidth="3" />
          <path d="m54 98 6-5 7 8-4 12-8-4Z" fill="#806b78" opacity=".65" />
          <path d="M29 119h62l-9 13H38Z" fill="#403849" stroke="#554b5e" strokeWidth="3" strokeLinejoin="round" />
          <path d="m82 114 12-5 6 8-14 6Z" fill="#51465b" stroke="#66596e" strokeWidth="2" />
        </>
      )}
    </Frame>
  );
}

export function EnemyTaskSvg(props: SceneSvgProps) {
  return (
    <Frame {...props} viewBox="0 0 96 96">
      {(id) => (
        <>
          <defs>
            <linearGradient id={`${id}-shell`} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#554064" />
              <stop offset="1" stopColor="#21172d" />
            </linearGradient>
            <radialGradient id={`${id}-core`}>
              <stop offset="0" stopColor="#fff2b8" />
              <stop offset="1" stopColor="#e78b4f" />
            </radialGradient>
          </defs>
          <ellipse cx="48" cy="78" rx="30" ry="8" fill="#120c19" opacity=".4" />
          <path d="m25 68-12 8m16-19-15-3m57 14 12 8M67 57l15-3M34 72l-9 11m37-11 9 11" fill="none" stroke="#2b1e36" strokeWidth="7" strokeLinecap="round" />
          <path d="M22 58c0-21 12-35 26-35s26 14 26 35c0 13-10 22-26 22S22 71 22 58Z" fill={`url(#${id}-shell)`} stroke="#6c5175" strokeWidth="4" />
          <path d="m31 31-8-14 16 9m26 5 8-14-16 9" fill="#3b2948" stroke="#6c5175" strokeWidth="3" strokeLinejoin="round" />
          <path d="M48 43c9 0 15 8 10 16-2 4-6 8-10 12-4-4-8-8-10-12-5-8 1-16 10-16Z" fill={`url(#${id}-core)`} />
          <circle cx="37" cy="39" r="3" fill="#d8cced" />
          <circle cx="59" cy="39" r="3" fill="#d8cced" />
        </>
      )}
    </Frame>
  );
}

export function EnemyObjectiveSvg(props: SceneSvgProps) {
  return (
    <Frame {...props} viewBox="0 0 160 140">
      {(id) => (
        <>
          <defs>
            <linearGradient id={`${id}-shell`} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#684c72" />
              <stop offset="1" stopColor="#25182f" />
            </linearGradient>
            <radialGradient id={`${id}-core`}>
              <stop offset="0" stopColor="#fff1a8" />
              <stop offset=".65" stopColor="#e7884f" />
              <stop offset="1" stopColor="#893c45" />
            </radialGradient>
          </defs>
          <ellipse cx="80" cy="120" rx="58" ry="13" fill="#120b18" opacity=".45" />
          <path d="m39 98-17 22m42-14-8 22m65-30 17 22m-42-14 8 22" fill="none" stroke="#281a31" strokeWidth="13" strokeLinecap="round" />
          <path d="M28 80c0-31 21-52 52-52s52 21 52 52c0 26-21 39-52 39S28 106 28 80Z" fill={`url(#${id}-shell)`} stroke="#76577d" strokeWidth="5" />
          <path d="m45 44-14-28 30 18 19-25 19 25 30-18-14 28-35 10Z" fill="#3b2947" stroke="#76577d" strokeWidth="4" strokeLinejoin="round" />
          <path d="M49 62 80 45l31 17-8 36H57Z" fill="#31203c" stroke="#7f5a78" strokeWidth="4" strokeLinejoin="round" />
          <path d="m80 62 15 15-15 27-15-27Z" fill={`url(#${id}-core)`} />
          <path d="m36 75-20-10 12 24m96-14 20-10-12 24" fill="#4a3457" stroke="#76577d" strokeWidth="4" strokeLinejoin="round" />
          <circle cx="55" cy="57" r="4" fill="#d9cbed" />
          <circle cx="105" cy="57" r="4" fill="#d9cbed" />
        </>
      )}
    </Frame>
  );
}
