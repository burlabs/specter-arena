import type { CSSProperties, ReactNode } from 'react';

/** `<i className="sa-fx-…">` for each suffix, so the effect trees below read as the lists they are. */
const Bits = ({ root, names }: { root: string; names: readonly string[] }) => (
  <>
    {names.map((name) => (
      <i key={name} className={`sa-fx-${root}__${name}`} />
    ))}
  </>
);

const Layer = ({ name, children }: { name: string; children: ReactNode }) => (
  <span className={`sa-fx-${name} sa-fx-directional`} aria-hidden="true">
    {children}
  </span>
);

const Cast = ({ name, children }: { name: string; children: ReactNode }) => (
  <span className={`sa-fx-${name}`} aria-hidden="true">
    {children}
  </span>
);

const Arc = ({ box, paths }: { box: string; paths: readonly (readonly [string, string])[] }) => (
  <svg viewBox={box}>
    {paths.map(([cls, d]) => (
      <path key={cls} className={cls} d={d} />
    ))}
  </svg>
);

const spore = (index: number) => ({ '--sa-spore-index': index }) as CSSProperties;

/** Attack layers from the Figma Make export (`components/AnimatedSpecter.tsx`), same drawings and class structure. Decorative only. */
export function AttackEffect({ heroId }: { heroId: string }) {
  switch (heroId) {
    case 'reeve':
      return (
        <Layer name="reeve-slash">
          <Arc box="0 0 72 52" paths={[['sa-fx-reeve-slash__trail', 'M9 43 Q34 4 65 13'], ['sa-fx-reeve-slash__edge', 'M16 45 Q39 10 66 17']]} />
        </Layer>
      );
    case 'vell':
      return (
        <Layer name="vell-wave">
          <Arc box="0 0 76 54" paths={[['sa-fx-vell-wave__trail', 'M8 44 Q30 5 69 17 Q44 23 25 49'], ['sa-fx-vell-wave__edge', 'M13 45 Q34 11 67 19']]} />
        </Layer>
      );
    case 'stitch':
      return (
        <Layer name="stitch-shockwave">
          <Arc box="0 0 78 42" paths={[['sa-fx-stitch-shockwave__arc', 'M7 34 Q39 4 71 34'], ['sa-fx-stitch-shockwave__marks', 'M25 24l-3-5M39 18v-6M53 24l3-5']]} />
        </Layer>
      );
    case 'poly':
      return (
        <Layer name="poly-beam">
          <Bits root="poly-beam" names={['glow', 'core']} />
        </Layer>
      );
    case 'rattle':
      return (
        <Layer name="rattle-impact">
          <i className="sa-fx-rattle-impact__burst" />
          {['one', 'two', 'three'].map((n) => (
            <i key={n} className={`sa-fx-rattle-impact__bone sa-fx-rattle-impact__bone--${n}`} />
          ))}
        </Layer>
      );
    case 'ember':
      return (
        <Layer name="ember-bolt">
          <Bits root="ember-bolt" names={['trail', 'orb']} />
        </Layer>
      );
    case 'shard':
      return (
        <Layer name="shard-volley">
          {['one', 'two', 'three'].map((n) => (
            <i key={n} className={`sa-fx-shard-volley__projectile sa-fx-shard-volley__projectile--${n}`} />
          ))}
        </Layer>
      );
    case 'tide':
      return (
        <Layer name="tide-lash">
          <Arc box="0 0 76 48" paths={[['sa-fx-tide-lash__trail', 'M8 38 Q35 3 69 18 Q47 19 22 43'], ['sa-fx-tide-lash__edge', 'M12 39 Q38 9 68 20']]} />
          {['one', 'two', 'three'].map((n) => (
            <i key={n} className={`sa-fx-tide-lash__drop sa-fx-tide-lash__drop--${n}`} />
          ))}
        </Layer>
      );
    case 'lume':
      return (
        <Layer name="lume-burst">
          <Bits root="lume-burst" names={['cone', 'core']} />
        </Layer>
      );
    case 'moss':
      return (
        <Layer name="moss-puff">
          {Array.from({ length: 5 }, (_, index) => (
            <i key={index} style={spore(index)} />
          ))}
        </Layer>
      );
    case 'bur':
      return (
        <Layer name="bur-frost-impact">
          <i className="sa-fx-bur-frost-impact__crescent" />
          {['one', 'two', 'three', 'four'].map((n) => (
            <i key={n} className={`sa-fx-bur-frost-impact__chunk sa-fx-bur-frost-impact__chunk--${n}`} />
          ))}
        </Layer>
      );
    default:
      return null;
  }
}

const numbered = (root: string, part: string, names: readonly string[]) =>
  names.map((n) => <i key={`${part}-${n}`} className={`sa-fx-${root}__${part} sa-fx-${root}__${part}--${n}`} />);

/** Cast layers (a milestone was seen). Same source as the attack layers. Decorative only. */
export function CastEffect({ heroId }: { heroId: string }) {
  switch (heroId) {
    case 'reeve':
      return (
        <Cast name="reeve-aura">
          {numbered('reeve-aura', 'ring', ['outer', 'inner'])}
          {numbered('reeve-aura', 'mote', ['one', 'two', 'three'])}
        </Cast>
      );
    case 'vell':
      return (
        <Cast name="vell-ward">
          <i className="sa-fx-vell-ward__clasp" />
          {numbered('vell-ward', 'ring', ['outer', 'inner'])}
        </Cast>
      );
    case 'stitch':
      return (
        <Cast name="stitch-rewire">
          {numbered('stitch-rewire', 'arc', ['left', 'right'])}
          {numbered('stitch-rewire', 'particle', ['one', 'two', 'three'])}
          <i className="sa-fx-stitch-rewire__ring" />
        </Cast>
      );
    case 'poly':
      return (
        <Cast name="poly-scan">
          <i className="sa-fx-poly-scan__eye" />
          {numbered('poly-scan', 'ring', ['one', 'two'])}
          {numbered('poly-scan', 'ray', ['one', 'two', 'three'])}
        </Cast>
      );
    case 'rattle':
      return (
        <Cast name="rattle-resonance">
          {numbered('rattle-resonance', 'rib', ['left', 'right'])}
          {numbered('rattle-resonance', 'ring', ['one', 'two'])}
          {numbered('rattle-resonance', 'mote', ['one', 'two', 'three'])}
        </Cast>
      );
    case 'ember':
      return (
        <Cast name="ember-flare">
          <i className="sa-fx-ember-flare__aura" />
          {numbered('ember-flare', 'mote', ['one', 'two', 'three'])}
        </Cast>
      );
    case 'shard':
      return (
        <Cast name="shard-prism">
          {numbered('shard-prism', 'glint', ['one', 'two'])}
          <i className="sa-fx-shard-prism__ring" />
          {numbered('shard-prism', 'ray', ['one', 'two', 'three', 'four'])}
        </Cast>
      );
    case 'tide':
      return (
        <Cast name="tide-undertow">
          <Bits root="tide-undertow" names={['ripple', 'wave']} />
          {numbered('tide-undertow', 'bubble', ['one', 'two', 'three', 'four'])}
        </Cast>
      );
    case 'lume':
      return (
        <Cast name="lume-beacon">
          <Bits root="lume-beacon" names={['halo', 'ring']} />
          {numbered('lume-beacon', 'mote', ['one', 'two', 'three', 'four'])}
        </Cast>
      );
    case 'moss':
      return (
        <Cast name="moss-bloom">
          <i className="sa-fx-moss-bloom__ring" />
          {numbered('moss-bloom', 'tendril', ['one', 'two'])}
          {Array.from({ length: 5 }, (_, index) => (
            <i key={index} className="sa-fx-moss-bloom__spore" style={{ '--sa-spore-index': index, '--sa-spore-left': `${20 + index * 14}%`, '--sa-spore-top': `${index % 2 ? 73 : 55}%` } as CSSProperties} />
          ))}
        </Cast>
      );
    case 'bur':
      return (
        <Cast name="bur-avalanche">
          <Bits root="bur-avalanche" names={['mist', 'wave', 'sparkle']} />
          {numbered('bur-avalanche', 'flake', ['one', 'two', 'three', 'four'])}
        </Cast>
      );
    default:
      return null;
  }
}
