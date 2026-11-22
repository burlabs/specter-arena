import type { SpecterV2 } from '../contracts/types';

/**
 * The Specter fields the Arena reads. Both `specter.v2` and `specter.v3` records satisfy it, so the Arena does not name a wire
 * version. It is presentation input only.
 */
export type ArenaSpecter = Omit<SpecterV2, 'contractVersion'>;

/** The shape `SpecterPortrait` still asks for. It reads art fields only and never the wire version. */
export const asPortraitRecord = (specter: ArenaSpecter): SpecterV2 => ({ contractVersion: 2, ...specter });
