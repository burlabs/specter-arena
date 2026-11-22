export type ArenaSelection = { kind: 'specter'; bindingId: string } | { kind: 'work'; workId: string };

export const selectionId = (selection: ArenaSelection): string => (selection.kind === 'specter' ? selection.bindingId : selection.workId);

export const isSelected = (selection: ArenaSelection | null, kind: ArenaSelection['kind'], id: string): boolean =>
  selection !== null && selection.kind === kind && selectionId(selection) === id;
