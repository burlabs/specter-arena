/** User Timing marks the performance run reads. They cost nothing when nobody observes them. */
export const MARKS = {
  dataReady: 'arena:data-ready',
  firstRender: 'arena:first-render',
  updateStart: 'arena:update-start',
  updateEnd: 'arena:update-end',
} as const;

export function mark(name: (typeof MARKS)[keyof typeof MARKS]): void {
  if (typeof performance !== 'undefined' && typeof performance.mark === 'function') performance.mark(name);
}
