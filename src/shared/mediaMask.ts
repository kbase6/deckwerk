import type { SlideElement } from './deck.js';
import type { TrimResult } from './ipc.js';
import { cssMediaRadius } from './nativeCss.js';

type MediaElement = Extract<SlideElement, { type: 'image' | 'video' }>;

export interface Size { w: number; h: number }
export interface MaskRect { x: number; y: number; w: number; h: number }

/**
 * The offset `object-position` gives a picture of `drawn` size inside `box`.
 *
 * A percentage distributes the difference between the two — which is negative
 * for `cover`, and is why `50%` centres and `0%` shows the left edge — while a
 * length is that offset outright. Anything unparseable falls back to centred,
 * which is the CSS initial value.
 */
export function objectPositionOffset(
  value: string | undefined,
  box: Size,
  drawn: Size,
): { x: number; y: number } {
  const KEYWORDS: Record<string, string> = {
    left: '0%', top: '0%', center: '50%', right: '100%', bottom: '100%',
  };
  const parts = (value ?? '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  // A computed value is always horizontal-then-vertical, but a keyword names
  // its axis: `top left`, `top center` and `center left` are swapped, and a
  // lone `top` or `bottom` is vertical, centring the horizontal.
  const swap = parts.length <= 2
    && (['top', 'bottom'].includes(parts[0]) || ['left', 'right'].includes(parts[1]));
  const ordered = swap ? [parts[1], parts[0]] : parts;
  const axis = (spec: string | undefined, boxSize: number, drawnSize: number): number => {
    const resolved = KEYWORDS[spec ?? ''] ?? spec ?? '50%';
    const percent = /^([+-]?[\d.]+)%$/.exec(resolved);
    if (percent) return (boxSize - drawnSize) * (Number(percent[1]) / 100);
    const length = /^([+-]?[\d.]+)px$/.exec(resolved);
    if (length) return Number(length[1]);
    return (boxSize - drawnSize) / 2;
  };
  return {
    x: axis(ordered[0], box.w, drawn.w),
    y: axis(ordered[1] ?? (ordered.length === 1 ? '50%' : undefined), box.h, drawn.h),
  };
}

/**
 * Where the picture is actually painted inside the element box, in box
 * coordinates.
 *
 * Uncropped media is placed by `object-fit`, so its painted rect is smaller
 * than the box for `contain` and larger for `cover`, and by `object-position`,
 * which is how an imported page says "this bird's head, not the middle of the
 * photograph". Cropped media already carries that rect as `sourceBox`.
 *
 * Null when that depends on a size nobody knows yet (a picture still loading,
 * a video before its metadata): guessing the whole box would lock a stretched
 * picture into any crop or circle made from it.
 */
export function paintedMediaBox(el: MediaElement, natural: Size | null): MaskRect | null {
  if (el.sourceBox) return { ...el.sourceBox };
  if (el.fit === 'fill') return { x: 0, y: 0, w: el.w, h: el.h };
  if (!natural || natural.w <= 0 || natural.h <= 0) return null;
  const scale = el.fit === 'cover'
    ? Math.max(el.w / natural.w, el.h / natural.h)
    : Math.min(el.w / natural.w, el.h / natural.h);
  const w = natural.w * scale;
  const h = natural.h * scale;
  const offset = objectPositionOffset(el.style['object-position'], el, { w, h });
  return { x: offset.x, y: offset.y, w, h };
}

/** Whether media is drawn through a circular mask, set natively or by CSS. */
export function editableCircularMask(element: MediaElement): boolean {
  if (element.maskShape !== undefined) return element.maskShape === 'circle';
  const radius = cssMediaRadius(element.style['border-radius']);
  return Boolean(radius && 'maskShape' in radius && radius.maskShape === 'circle');
}

/**
 * Whether the frame paints anything of its own -- a border, a backdrop, round
 * corners, a shadow -- so that refitting it to the picture would change how
 * the slide looks.
 */
function paintsFrame(el: MediaElement): boolean {
  return (el.borderWidth ?? 0) > 0 || (el.borderRadius ?? 0) > 0
    || Object.keys(el.style).some((property) => /^(background|border|box-shadow|outline|--curl-)/.test(property));
}

/**
 * The frame an uncropped `contain` image should have: exactly the picture it
 * paints, so its outline sits on the picture's edge and the first crop starts
 * from the picture rather than the empty frame around it. Null when the frame
 * already fits to the pixel, when a crop or circular mask owns the frame, or
 * when the frame paints something the fit would move. The painted picture
 * stays where it was on the slide, rotated or not, to the pixel.
 */
export function fittedImageBox(
  el: MediaElement,
  natural: Size | null,
): { x: number; y: number; w: number; h: number; style: Record<string, string> } | null {
  if (el.fit !== 'contain' || el.sourceBox || editableCircularMask(el) || !natural || paintsFrame(el)) return null;
  const painted = paintedMediaBox(el, natural);
  if (!painted || (Math.abs(painted.w - el.w) < 1 && Math.abs(painted.h - el.h) < 1)) return null;
  // The rotation centre moves with the frame; turn its shift back into slide
  // space so the picture does not.
  const dx = painted.x + (painted.w - el.w) / 2;
  const dy = painted.y + (painted.h - el.h) / 2;
  const radians = el.rot * Math.PI / 180;
  const w = Math.max(1, Math.round(painted.w));
  const h = Math.max(1, Math.round(painted.h));
  const style = { ...el.style };
  delete style['object-position'];
  return {
    x: Math.round(el.x + (el.w - w) / 2 + dx * Math.cos(radians) - dy * Math.sin(radians)),
    y: Math.round(el.y + (el.h - h) / 2 + dx * Math.sin(radians) + dy * Math.cos(radians)),
    w,
    h,
    style,
  };
}

/**
 * Give media a `w`x`h` box the way dragging a handle does: a crop scales with
 * its window, so the same part of the picture stays in view rather than the
 * window showing more or less of it. `from` is the box and crop to scale; a
 * drag passes where it began, so rounding never builds up over its moves.
 */
export function resizeMediaBox(
  el: MediaElement,
  w: number,
  h: number,
  from: { w: number; h: number; sourceBox?: MaskRect | null } = el,
): void {
  const crop = from.sourceBox;
  if (crop) {
    const fx = w / from.w;
    const fy = h / from.h;
    el.sourceBox = {
      x: Math.round(crop.x * fx),
      y: Math.round(crop.y * fy),
      w: Math.max(1, Math.round(crop.w * fx)),
      h: Math.max(1, Math.round(crop.h * fy)),
    };
  }
  el.w = w;
  el.h = h;
}

/**
 * The element box and `sourceBox` for a crop window dragged to `rect`.
 *
 * `origin` is the element box and `base` the painted picture (box-relative)
 * when the drag began; `rect` is the dragged window in the same unrotated
 * frame as `origin`. The window never grows past the picture, or past where
 * it already was when the frame is larger than the picture (a letterboxed
 * `contain`), so an edge the drag leaves alone never moves. `lockAspect`
 * (Shift, a circular mask) keeps `rect`'s proportions at the picture's edge.
 * The picture stays fixed on the slide: for a rotated element the box moves
 * so that its new rotation centre does not swing the picture around.
 */
export function cropWindow(
  rect: MaskRect,
  origin: MaskRect,
  base: MaskRect,
  rot: number,
  lockAspect = false,
): { x: number; y: number; w: number; h: number; sourceBox: MaskRect } {
  // Whole pixels, rounded inward so the window never shows past the picture.
  const minX = Math.ceil(origin.x + Math.min(0, base.x) - 1e-6);
  const minY = Math.ceil(origin.y + Math.min(0, base.y) - 1e-6);
  const maxX = Math.floor(origin.x + Math.max(origin.w, base.x + base.w) + 1e-6);
  const maxY = Math.floor(origin.y + Math.max(origin.h, base.y + base.h) + 1e-6);
  let { x, y, w, h } = rect;
  if (lockAspect && w > 0 && h > 0) {
    // Clamping each edge on its own would change the proportions, so shrink
    // the whole window towards the corner it is anchored at.
    const anchorLeft = Math.abs(x - origin.x) <= Math.abs(x + w - origin.x - origin.w);
    const anchorTop = Math.abs(y - origin.y) <= Math.abs(y + h - origin.y - origin.h);
    const scale = Math.min(
      1,
      (anchorLeft ? maxX - x : x + w - minX) / w,
      (anchorTop ? maxY - y : y + h - minY) / h,
    );
    const right = x + w;
    const bottom = y + h;
    w = Math.floor(w * scale + 1e-6);
    h = Math.floor(h * scale + 1e-6);
    if (!anchorLeft) x = right - w;
    if (!anchorTop) y = bottom - h;
  }
  const minW = Math.min(8, maxX - minX);
  const minH = Math.min(8, maxY - minY);
  const left = Math.max(minX, Math.min(Math.round(x), maxX - minW));
  const top = Math.max(minY, Math.min(Math.round(y), maxY - minH));
  const right = Math.min(maxX, Math.max(left + minW, Math.round(x + w)));
  const bottom = Math.min(maxY, Math.max(top + minH, Math.round(y + h)));
  const dx = left - origin.x;
  const dy = top - origin.y;
  const width = right - left;
  const height = bottom - top;
  const radians = rot * Math.PI / 180;
  const cx = dx + (width - origin.w) / 2;
  const cy = dy + (height - origin.h) / 2;
  return {
    x: Math.round(origin.x + (origin.w - width) / 2 + cx * Math.cos(radians) - cy * Math.sin(radians)),
    y: Math.round(origin.y + (origin.h - height) / 2 + cx * Math.sin(radians) + cy * Math.cos(radians)),
    w: width,
    h: height,
    sourceBox: { w: base.w, h: base.h, x: Math.round(base.x - dx), y: Math.round(base.y - dy) },
  };
}

/**
 * Undo a crop: the frame becomes the whole picture again, exactly where the
 * crop painted it, so no `fit` has to squeeze, stretch or re-cover it into
 * the cropped window. A circle has no corners to fill, so dropping its crop
 * would leave slide showing through; the picture is re-centred in the circle
 * instead -- that is what "the whole frame" means there.
 */
export function resetCrop(el: MediaElement, natural: Size | null): boolean {
  const crop = el.sourceBox;
  el.sourceBox = null;
  if (editableCircularMask(el)) {
    if (setCircularMask(el, true, natural)) return true;
    el.sourceBox = crop;
    return false;
  }
  if (!crop) return true;
  // As in `cropWindow`: the rotation centre moves with the frame, so turn its
  // shift back into slide space and the picture stays put.
  const w = Math.max(1, Math.round(crop.w));
  const h = Math.max(1, Math.round(crop.h));
  const cx = crop.x + (crop.w - el.w) / 2;
  const cy = crop.y + (crop.h - el.h) / 2;
  const radians = el.rot * Math.PI / 180;
  el.x = Math.round(el.x + (el.w - w) / 2 + cx * Math.cos(radians) - cy * Math.sin(radians));
  el.y = Math.round(el.y + (el.h - h) / 2 + cx * Math.sin(radians) + cy * Math.cos(radians));
  el.w = w;
  el.h = h;
  // The crop already placed the picture; a stale offset would now shift it.
  const style = { ...el.style };
  delete style['object-position'];
  el.style = style;
  return true;
}

/**
 * `sourceBox` for a crop panned by (`dx`, `dy`) from `base`: a picture that
 * covers its window keeps covering it, and one smaller than its window stays
 * inside it. A pan never starts by jumping, wherever the picture began.
 */
export function pannedSourceBox(base: MaskRect, window: Size, dx: number, dy: number): MaskRect {
  const axis = (start: number, delta: number, room: number) => Math.min(
    Math.max(Math.round(start + delta), Math.ceil(Math.min(0, room, start))),
    Math.floor(Math.max(0, room, start)),
  );
  return {
    w: base.w,
    h: base.h,
    x: axis(base.x, dx, window.w - base.w),
    y: axis(base.y, dy, window.h - base.h),
  };
}

/**
 * The box and crop that turn a media element into a *circular* mask.
 *
 * A circular mask is drawn as `border-radius: 50%`, which only gives a true
 * circle on a square box — on a 16:9 photo it produced an ellipse. So the
 * window shrinks to the centred square of the shorter side, and the picture
 * moves into `sourceBox` at its own aspect ratio: the crop becomes circular,
 * the picture is never squashed. It keeps the scale it already had unless the
 * circle would show past its edge, in which case it grows just enough to fill.
 * Null when the picture's size is not known yet (see `paintedMediaBox`).
 */
export function circularMaskLayout(
  el: MediaElement,
  natural: Size | null,
): { x: number; y: number; w: number; h: number; sourceBox: MaskRect } | null {
  const painted = paintedMediaBox(el, natural);
  if (!painted) return null;
  const side = Math.max(8, Math.round(Math.min(el.w, el.h)));
  const dx = (el.w - side) / 2;
  const dy = (el.h - side) / 2;
  const aspect = natural && natural.w > 0 && natural.h > 0
    ? natural.w / natural.h
    : (painted.w > 0 && painted.h > 0 ? painted.w / painted.h : 1);

  // Undistort first: a `fill` element was painted stretched, so take the larger
  // of the two dimensions as the honest scale rather than averaging them.
  let w = Math.max(painted.w, painted.h * aspect);
  let h = w / aspect;
  const grow = Math.max(side / w, side / h, 1);
  w *= grow;
  h *= grow;

  // Keep the same part of the picture in view: the visible centre stays put.
  const cx = painted.x + painted.w / 2 - dx;
  const cy = painted.y + painted.h / 2 - dy;
  return {
    x: Math.round(el.x + dx),
    y: Math.round(el.y + dy),
    w: side,
    h: side,
    sourceBox: {
      x: Math.round(cx - w / 2),
      y: Math.round(cy - h / 2),
      w: Math.max(1, Math.round(w)),
      h: Math.max(1, Math.round(h)),
    },
  };
}

/**
 * Turn the circular mask on or off, moving the geometry with it.
 *
 * Turning it on squares the window and hands the picture to `sourceBox` so the
 * crop is a circle rather than an ellipse. Turning it off leaves that crop
 * alone: the picture itself was never altered, so there is nothing to undo.
 * Returns false, changing nothing, when the circle needs a picture size that
 * is not known yet.
 */
export function setCircularMask(
  el: MediaElement,
  circular: boolean,
  natural: Size | null,
): boolean {
  const layout = circular ? circularMaskLayout(el, natural) : null;
  if (circular && !layout) return false;
  const style = { ...el.style };
  delete style['border-radius'];
  el.style = style;
  // `rect` is deliberately explicit: it prevents an old CSS 50% radius from
  // reappearing after the mask is turned off.
  el.maskShape = circular ? 'circle' : 'rect';
  if (!layout) return true;
  el.x = layout.x;
  el.y = layout.y;
  el.w = layout.w;
  el.h = layout.h;
  el.sourceBox = layout.sourceBox;
  return true;
}

/**
 * Point a video at the file the trim window wrote for it. The trim is baked
 * into that file, so the in/out points reset, or they would clip the clip.
 *
 * A trim alone keeps the frame, so the box, the crop and the mask still
 * describe it and stay as they are. An ffmpeg crop makes a new frame: the old
 * crop described the old one and goes, the box takes the new proportions, and
 * a circular mask is laid out again over the new frame so it stays round.
 */
export function relinkTrimmedVideo(
  el: Extract<SlideElement, { type: 'video' }>,
  result: TrimResult,
): void {
  el.src = result.src;
  el.start = 0;
  el.end = null;
  if (!result.cropped) return;
  el.sourceBox = null;
  if (!result.width || !result.height) return;
  if (editableCircularMask(el)) {
    setCircularMask(el, true, { w: result.width, h: result.height });
  } else {
    el.h = Math.round((el.w * result.height) / result.width);
  }
}
