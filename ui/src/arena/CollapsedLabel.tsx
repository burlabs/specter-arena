/** What a collapsed pane's toggle shows: a glyph in the narrow side strip, the words when the panes are stacked full width. The button's own label names it. */
export function CollapsedLabel({ glyph, text }: { glyph: string; text: string }) {
  return (
    <>
      <span className="sa-arena-pane__glyph" aria-hidden="true">
        {glyph}
      </span>
      <span className="sa-arena-pane__text" aria-hidden="true">
        {text}
      </span>
    </>
  );
}
