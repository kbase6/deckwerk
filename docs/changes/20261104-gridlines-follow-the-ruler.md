# Gridlines follow the ruler

## What changed

- The gridline dots are now spaced by the ruler's own tick marks: the finest
  ticks (minor, mid or major) that stay at least 16 screen pixels apart. Every
  dot sits on a ruler tick at every zoom, and every labelled tick on a dot.
- With gridlines on, a dashed cross marks the slide's centre.
- The Gridlines toggle is now an icon beside the rulers icon in the zoom bar,
  styled and pressed like it, and Cmd/Ctrl+' shows and hides the gridlines
  (Shift is ignored, so a JIS keyboard, which types ' with Shift, reaches it).

## Why

The dots were on a fixed 40-pixel grid that doubled as you zoomed out, while
the ruler counts in 1-2-5 steps. The two only agreed at about 40-55% zoom: at
100% the ruler's 100 and 300 fell between dots. No row of dots passed through
the slide's vertical middle either (540 is not a multiple of 40). The toggle
was a text button at the far end of the zoom bar, unlike the icon toggles
next to it, and had no shortcut.

## Options considered

- Spacing the dots from the ruler's ticks, or keeping a fixed slide-based grid
  (for example 60 pixels, which divides both centre lines) and leaving the
  ruler alone. A fixed grid still disagrees with the ruler's numbers.
- For the centre: drawing it with the gridlines; a separate "centre cross"
  toggle; or PowerPoint-style guides that can be dragged out of the ruler and
  are saved with the deck.
- Snapping objects to the grid. Left out: dragging already snaps to the slide's
  edges and centre and to other objects.

## Decision and trade-offs

The dots follow the ruler, and the centre cross is drawn with the gridlines,
with no new toggle. The grid code moved from the canvas into the rulers module,
since it is now drawn from the rulers' spacing. Dots are a little sparser than
before at the fitted zoom (every 100 slide pixels rather than 40), in exchange
for every dot standing on a round number. Draggable guides and snap-to-grid
wait until authors ask for margins or columns.
