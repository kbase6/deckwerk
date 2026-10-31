# Brush-up of DeckWerk for one person editing on the desktop

* **Author:** kbase6
* **Date:** 2026-10-29

## Overview

**What is proposed.** A pass over the DeckWerk desktop editor for one person who builds slides by hand and also through coding agents (the `slide-agent` CLI and the watched `edit/*.html` loop). The pass fixes four things: unclear wording, unpredictable behaviour, slowness, and messy code. Three areas come first: the wording in the Props and Design tabs, image cropping, and the confusion between the editor's dark mode and a deck's dark theme. The collab server changes only for security problems or problems that cross into other areas. As originally framed, the work is done when every ranked finding is implemented and landed as one or a few commits.

**What the review found.** All three named problems are real and can be traced in the code. Two of them are mostly about behaviour, not wording.

- **Cropping.** The crop drag itself is well tested. The trouble is in the paths around it, and each one behaves differently from what a user would expect:
  - pressing Escape while cropping;
  - Reset;
  - typing a width or height;
  - the "Keep aspect ratio" checkbox;
  - pictures that have not finished loading;
  - PDF figures;
  - the ffmpeg trim window.
- **Dark mode.**
  - The switch for the editor's own colours sits only behind the "DeckWerk" wordmark.
  - The Design tab has two more Light/Dark switches. One is labelled "Default", and both restyle every slide at once.
  - Light mode leaves several screens dark.
- **Props and Design wording.**
  - Panel headings show internal type names.
  - Many labels are abbreviations.
  - Crop is called "Mask".
  - "Style" means four different things.
  - Two text-fitting checkboxes can both be on, and then one of them does nothing.

**How the review was done.** Six read-only reviewers looked at the code through six lenses (listed in the legend below). They returned about 110 raw findings, which this brief merges into 66 ranked items. Nobody ran the app.

- "Confirmed" means a reviewer traced the path in code.
- "Speculative" means the reviewer could not confirm it.
- The synthesizer re-read nine of the most important claims against the source. They are marked **(re-checked)**.

**The main challenge to the concept.** "Implement every finding in one or a few commits" does not fit the repository's own rules:

- every bug fix must land with a test that fails first;
- every new gesture or control needs a fuzz operation.

All six lenses, working separately, recommended at least 6 to 9 commits. They also recommended that "done" mean "Tier 1 landed with its tests, and an explicit keep-or-drop decision on each Tier 2 and Tier 3 item", not "all 66 items".

**A correction to the brief.** The desktop app has no application menu of its own. Nothing in `src/main` calls Electron's `Menu` or `setApplicationMenu` **(re-checked)**, so the app runs on Electron's default menu. That matters for dark mode (there is no menu entry to put it in) and for data safety (see item 30).

## Analysis

### Where the lenses agree

1. **Cropping feels unstable because of the paths around the crop drag, not the drag itself.** Five test suites cover the drag. None of them reaches these paths:
   - Escape during crop;
   - Reset;
   - a picture whose pixel size is not yet known;
   - the slide-rail lookup;
   - PDFs;
   - the trim relink;
   - typed sizes.

   Each of these is a small defect with its own failing test. Renaming "Mask" to "Crop" fixes none of them on its own.
2. **There are three Light/Dark switches, and the one for the editor is hidden.** Every lens independently pointed out that:
   - the Design tab's "Default" row and the theme chooser's copy are the same control twice;
   - both rewrite every slide;
   - the editor's own switch is reachable only from the wordmark.

   The fix is mostly wording, deleting the duplicate, and one pointer from each switch to the other.
3. **Light mode is treated as second best.** It patches six selectors on top of more than 200 hard-coded colours. A user on the default "System" setting with macOS in light mode may already be looking at:
   - a dark welcome screen;
   - agent error text that is close to invisible;
   - a Light/Dark selector that shows no outline on the chosen option.
4. **Much of the "flakiness" has nothing to do with wording.**
   - The Props panel rebuilds itself completely on any change and puts focus back by matching label text.
   - An agent save that lands while the speaker-notes box has focus gets tied into the notes' undo entry.
   - Crop mode survives Escape.
   - The editor's internal consistency checks are switched off in the shipped app, so problems leave no trace.

### Where the lenses disagree (decisions for the user)

- **Application menu.**
  - For (design and implementation-readiness lenses): build a small real menu. Electron's default menu includes Reload (Cmd+R). Reload throws away the undo history and up to 800 ms of unsaved edits, and the editor has no `beforeunload` guard **(re-checked)**. A menu also gives "Editor appearance" a place people expect to find it.
  - Against (zoom-out lens): do not build a menu. Replacing the default menu drops its built-in Edit commands, which risks breaking copy, paste and undo in text fields.
- **The hidden CodeMirror editor.** The design lens wants to replace it with a 30-line text holder and drop three dependencies. The implementation-readiness lens wants to keep it, because the save paths rely on its flush and focus behaviour (`src/renderer/editor/main.ts:587-689`).
- **Tab names.**
  - The zoom-out lens wants to rename "Props" to "Format".
  - The comprehension lens says tooltips give most of the benefit.
  - The implementation-readiness lens counts the cost: about 20 test files, the collab client, and the agent guides.
- **The Props "Advanced" section** (ffmpeg and paint tools). The zoom-out lens would delete it, because the right-click menu already has both tools. The comprehension lens would only rename it.
- **Shift while resizing a picture.** The code comment at `src/renderer/editor/canvas.ts:3094-3100` says the current behaviour is deliberate. Two lenses want it reversed (item 4).
- **Performance findings.** The design lens flagged several whole-deck passes. None of them was measured. Every lens that mentioned them said to time a theme change and an `edit/` compile on the largest deck in `decks/` before treating them as fixes for slowness.

### What the user may not be seeing

- **The collab browser client shares these modules.** It uses the Props, Design, `shellWiring.ts` and `render.ts` code, so "collab untouched" cannot be literally true. Collab browser tests assert tab labels (`test/collabBrowserSmoke.test.ts:117`).
- **Agents read the UI words too**, through three channels:
  - `slide-agent capabilities` (for example "Props → Shadow", `src/cli/capabilities.ts:282-284`);
  - `AGENTS.md`;
  - the `AGENTS.md` written into every deck folder (`src/main/agentGuide.ts`).

  A deck folder whose `AGENTS.md` has had its marker removed never updates (`src/main/agentGuide.ts:92`).
- **Clicking a theme or a Light/Dark button restyles every slide immediately, on purpose.** Tests pin this: `test/themePanel.test.ts:50-51` says "nothing to tick, nothing to press". Better words help, but one click still rewrites every slide. Changing this to "preview, then Apply" would reverse a deliberate decision, and the agent-facing text describes the current behaviour.
- **An Agent or Collaborate session puts the deck on the local network** (item 35).
- **The Props panel finds the control to refocus by its visible label** (`src/renderer/editor/inspector.ts:374-380`). A wording pass that duplicates or changes labels can change where focus lands after an edit, unless controls first get stable keys (item 50).

### What this review did not cover

The brief asked to "review every area". This pass did not reach that goal. These areas got little or no direct review:

- presenting: `src/renderer/player/` beyond the crop render paths, `src/renderer/present/` and `src/renderer/presenter/`;
- the Build (timeline) panel;
- the slide rail;
- comments;
- the font and colour pickers;
- the Keynote and PPTX importers, beyond how they write `fit` and report warnings.

There are two ways to close this gap: run a second, narrower pass on those areas, or drop them from scope. The zoom-out lens recommends dropping them, because the user reported no pain there.

### Ranked change list

**Legend.** These letters show which lens raised each item. The other columns are:

- **Size:** S = hours, M = a day or two, L = more.
- **Risk:** the chance of a regression.

| Code | Reviewer | Lens |
| --- | --- | --- |
| UX | `egm-comprehension` | UX and wording |
| CB | `egm-codebase-details` | grounding and reuse |
| DES | `egm-design` | architecture, performance, security |
| ZO | `egm-zoom-out` | simplicity and scope |
| IR | `egm-implementation-readiness` | compatibility and tests |
| ST | `egm-structural` | maintainability |

Every path is relative to `/Users/koumatsuda/Projects/deckwerk`. Inside `src/renderer/editor/`, the short file name is used.

#### Tier 1: the user's named pain points, plus confirmed misbehaviour

**1A. Image cropping: behaviour**

1. **Crop mode stays on after Escape or Select All.**
   - Effect: after Escape, the picture is deselected but crop mode stays on, and the Props button that would end it is gone. The next drag on that picture moves the picture inside its crop instead of moving the object. On a letterboxed picture, dragging in the empty bars moves the whole object while crop mode stays on.
   - Evidence:
     - Escape only clears the selection: `shellWiring.ts:459-461` and `store.ts:786-795`.
     - Crop mode ends only when the element leaves the slide: `canvas.ts:1140-1145`.
     - The ghost box is drawn regardless of selection: `canvas.ts:2262-2273`.
     - The click-away test and the pan test use different areas: `canvas.ts:2650-2657` versus `canvas.ts:2806-2811`.
     - No consistency check covers crop mode: `selectionInvariants.ts:61-67`.
   - Change:
     - Add one `endCropMode()`, called from `render()` when the element is no longer the selection, and from Escape.
     - Make the click-away test use the same fitted frame as the pan test.
     - Add the check "crop mode means that element is the selection", so the existing Escape and Cmd+A fuzz operations turn red.
   - S. Risk Low–Med. Lenses: ST, CB.
2. **The picture's pixel size is read from the slide-rail thumbnail, not the canvas.**
   - Effect: "Circular mask", Reset on a circle, and the right-click mask item can lay out the circle from the frame's proportions instead of the picture's. Videos come out squashed.
   - Evidence:
     - The lookup searches the whole page by default: `mediaNatural.ts:11-17`.
     - The rail comes before the canvas: `index.html:14-15`.
     - Rail thumbnails carry the same element ids (`src/renderer/player/render.ts:280`), and their videos have no source yet (`slideRail.ts:535`).
     - The callers are `inspector.ts:653`, `inspector.ts:2972` and `shellWiring.ts:541`.
     - The canvas's own lookup is already scoped correctly: `canvas.ts:2768`.
   - Change: make the default lookup root the canvas slide layer. That one line fixes all three callers. Test: a jsdom case with an unloaded rail copy placed before the canvas.
   - S. Risk Low. Lenses: IR, UX, CB, DES.
3. **Cropping before the picture's size is known stretches it.**
   - Effect: cropping or circling a picture that is still loading, or a video before its metadata arrives, locks in a distorted picture.
   - Evidence:
     - When the size is unknown, the code assumes the picture fills its box: `src/shared/mediaMask.ts:55-59`. `test/mediaMask.test.ts:128` pins that fallback.
     - Crop drags take that box as their starting point: `canvas.ts:2767-2769` and `canvas.ts:2815`.
     - Cropped media always renders stretched to fill (`object-fit: fill`): `render.ts:170`, `:783`, `:1237`.
   - Change:
     - Return "unknown" when the size is not known, unless `fit` is `fill` or a crop already exists.
     - Crop, pan and circle then refuse and show "Picture still loading" in the status bar.
     - Flip the pinned test, and add a browser test with a stalled asset.
   - S. Risk Med: callers must handle "unknown". Lenses: ZO, IR, CB, DES.
4. **Shift means opposite things when cropping and when resizing, and a Shift-resize stretches the picture for good.**
   - Effect: in crop mode, Shift keeps proportions. On a normal picture resize, Shift frees them, saves the picture as stretched, and leaves "Keep aspect ratio" unticked for every later drag.
   - Evidence:
     - The rule: `canvas.ts:3101-3105` **(re-checked)**.
     - The stretched setting is written on resize: `canvas.ts:3189-3194` **(re-checked)**.
     - The checkbox then reads unticked: `inspector.ts:696-702`.
     - The comment at `canvas.ts:3094-3100` calls the current behaviour deliberate.
   - Change: Shift locks proportions in both modes, and a modifier key never writes a stored setting. To stretch a picture, use the Fit control (item 5). Update `test/mediaCropAspectBrowser.test.ts`. This is a user decision.
   - S–M. Risk Med: it changes a gesture. Lenses: ZO, UX.
5. **"Keep aspect ratio" is a lossy on/off switch over a three-value setting, and it does nothing on a cropped picture.**
   - Effect:
     - Turning it off and on again turns a picture that filled its frame into a letterboxed one.
     - On a cropped picture it changes nothing.
     - Imported pictures show it unticked, so dragging a handle squashes them.
   - Evidence:
     - The checkbox writes only two values: `inspector.ts:692-703` **(re-checked 696-701)** and `inspector.ts:1705-1713`.
     - Cropped media ignores `fit`: `render.ts:166-175` and `render.ts:773-787`.
     - The schema has three values: `src/shared/deck.ts:217`.
     - The importers write `fill`: `importers/pptx/import_pptx.py:2431` and `importers/keynote/import_keynote.py:2257`.
   - Change:
     - Replace the checkbox with the existing segmented control (`inspector.ts:3469`): "Fit inside | Fill frame | Stretch". Place it outside the crop section, and disable it with a tooltip while the picture is cropped.
     - In a separate commit, importers write `contain` when the box and picture proportions match within 1%, for new imports only.
     - Never rewrite `fit` in existing decks.
     - Add a fuzz operation "set fit".
   - S–M. Risk Med. Lenses: ZO, UX, IR, CB.
6. **Reset crop squeezes or stretches the whole picture into the cropped window.**
   - Effect: Reset leaves the box at the crop size. The picture is then letterboxed, stretched, or re-covered from the centre, instead of being restored.
   - Evidence: `inspector.ts:646-655` only clears `sourceBox` **(re-checked)**.
   - Change:
     - Add `resetCrop(el)` to `src/shared/mediaMask.ts`. It sets the box to the picture's own rectangle, using the same rotation-centre maths as `mediaMask.ts:171-177`.
     - Circles keep today's behaviour.
     - Test in `test/mediaMask.test.ts` at 0° and 30°, and add a "reset crop" fuzz operation.
   - S. Risk Low. Lenses: IR, CB.
7. **One picture, two boxes: a typed size re-crops, a dragged handle scales.**
   - Effect:
     - Typing a width on a cropped picture shows a different part of it, while dragging a handle scales the whole crop.
     - Typing W on a circle makes an ellipse.
     - On a letterboxed picture, the outline is smaller than the W/H shown in Props, and snap guides line up with edges you cannot see.
   - Evidence:
     - Props writes only `w`/`h`: `inspector.ts:888-900`.
     - A handle drag scales the crop: `canvas.ts:3176-3188`.
     - The fitted frame is computed for images only: `canvas.ts:7017-7021`.
     - The outline is drawn at `canvas.ts:2173`; snap targets come from `canvas.ts:3114-3116`.
   - Change:
     - Move the fitted-frame helper into `src/shared/mediaMask.ts` and include video.
     - Add one `resizeMediaBox(el, w, h)` used by both Props and the drag.
     - Show the Props readouts and use snap targets from that same frame.
     - Add a fuzz operation "geometry from sidebar".
   - M. Risk Med: geometry readouts are asserted in many suites. Lenses: IR, ZO.
8. **Cropping a PDF figure works only while dragging.**
   - Effect: during the drag, the PDF spills outside its window. After any rebuild, and in Present, PDF and web export, the crop is ignored and the whole page is squeezed into the window.
   - Evidence:
     - The PDF `<embed>` is returned before the crop branch: `render.ts:759-767` versus `:773`.
     - The fit styles match `embed` (`render.ts:144`, `:166-175`), and the editor's patch path calls them (`canvas.ts:1721`).
     - Elements do not clip: `src/renderer/player/player.css:35-43`.
   - Change: send PDFs through the same clipping wrapper as `<img>`. Test in `test/renderInvariants.test.ts`.
   - S. Risk Low. Lens: CB. (Open question: does the user use PDF figures?)
9. **The ffmpeg trim window reshapes a cropped or circular video.**
   - Effect: after a trim only, a square-cropped video comes back in the video's own proportions with the old crop stretched over it, and a circle becomes an oval. History says "Edit slide".
   - Evidence: `src/renderer/editor/main.ts:1263-1284` **(re-checked)** always recomputes `h`, leaves `sourceBox` and `maskShape` alone, and passes no label.
   - Change:
     - Extract a pure relink function.
     - Keep the geometry when the frame size did not change.
     - When it did change, clear the crop (or recompute the circle).
     - Label the step "Trim video".
   - S. Risk Low. Lenses: IR, CB.
10. **The right-click menu and Props disagree on whether a picture is circular.**
    - Effect: a picture made round with CSS `border-radius: 50%` shows "Circular mask" ticked in Props, while the right-click menu offers to make it circular, which squares it again.
    - Evidence:
      - The menu and canvas test `maskShape` only: `shellWiring.ts:535` and `canvas.ts:7669`.
      - Props uses `editableCircularMask`: `inspector.ts:684` and `src/shared/mediaMask.ts:70-74`.
      - The undo labels differ too: "Mask shape" (`shellWiring.ts:544`).
    - Change: use one test everywhere, and one pair of labels.
    - S. Risk Low. Lenses: IR, CB.
11. **A crop-handle drag that changes nothing still records a crop.**
    - Effect: dragging an edge outward past the picture moves nothing, yet "Crop image" appears in History and the Reset button appears.
    - Evidence: `canvas.ts:6994-7009` lacks the "unchanged, so restore the original" rule that the pan has (`canvas.ts:2996-3004`).
    - Change: copy the pan's rule.
    - S. Risk Low. Lens: CB.
12. **`object-position: top` is read as left-aligned.**
    - Effect: a picture framed with a single `top` or `bottom` keyword (from an agent edit) jumps on its first crop or pan.
    - Evidence: `src/shared/mediaMask.ts:25-43`, and a copy in `htmlMeasure.ts:1195-1207`. The copy cannot import the shared function because it is serialised with `toString` (`htmlMeasure.ts:1805-1806`).
    - Change: fix both copies, and add one table test that feeds both parsers the same values.
    - S. Risk Low. Lens: CB. How often this reaches a deck is Speculative.
13. **The crop preview does not show what is cut away, and is misplaced on rotated media.**
    - Effect: in crop mode you see a dashed, tinted box but not the hidden part of the picture. On rotated media the box sits at the wrong angle.
    - Evidence:
      - The ghost box is drawn without rotation: `canvas.ts:2260-2273`.
      - It is a tint only: `editor.css:1177-1182`.
      - The comment at `canvas.ts:1037-1040` claims a reduced-opacity frame that the code does not draw.
    - Change: build the ghost from the painted box, rotate it about the element's centre, and add a faint copy of the image behind it.
    - M. Risk Low. Lens: CB.
14. **Crop drag state lives in two places (enabler for items 1–13).**
    - Effect: crop drags can behave inconsistently, and each crop fix has to reason about hidden state. Panning back to the start can switch the media's page structure mid-gesture, which may show as flicker (Speculative).
    - Evidence:
      - A class field `maskOrigin` is set, read and cleared in several places: `canvas.ts:1044-1045`, `2767`, `2815`, `2975`, `6999`, `3397`.
      - "Is this a crop?" is re-decided on every pointer move: `canvas.ts:3061`.
      - The element is found by slide position: `canvas.ts:2998` and `canvas.ts:3003`.
      - The pan restores the original on every move: `canvas.ts:3002-3004`.
      - The structure check is duplicated: `canvas.ts:7393-7397` and `canvas.ts:7415-7421`.
    - Change:
      - Capture the crop base and a crop flag at pointer-down, in the drag state.
      - Delete `maskOrigin`.
      - Find the element by id across the deck.
      - Decide "no-op pan" at pointer-up.
      - Do not move crop mode out of `canvas.ts` now.
    - S. Risk Low–Med. Lenses: ST, UX, CB.
15. **Crop has almost no fuzz coverage.**
    - Effect: crop bugs come back without any test noticing.
    - Evidence:
      - The only crop fuzz operation is "crop edge drag": `test/crossContextFuzzBrowser.test.ts:155-161` and `:1123-1140`.
      - Pointer-cancel commits a partial drag: `canvas.ts:2544-2547`.
      - Abandoned gestures are listed as an unfuzzed class in `docs/confirmed-bugs.md:409-414`.
    - Change:
      - Add fuzz operations for crop pan, crop toggle from the panel, Escape during crop, reset crop, set fit, and circle toggle.
      - Add one "begin a gesture, then abandon it" family (pointer-cancel, Escape, blur) for drag, resize, crop and marquee.
    - M. Risk Low: tests only. Lenses: ST, ZO, IR, CB.

**1B. Crop, Props and Design wording**

16. **Crop is called "Mask".**
    - Effect: a user looking for "Crop" finds nothing in Props.
    - Evidence:
      - Props: `inspector.ts:634` ("Edit mask" / "Done editing mask"), `:645` ("Reset mask"), `:667` (section "Mask", caption "non-destructive") **(re-checked)**, `:684` ("Circular mask").
      - Right-click menu: "Edit mask (crop)" at `shellWiring.ts:529`.
      - History: "Crop image" / "Move image in mask" at `canvas.ts:2762` and `canvas.ts:2816`.
    - Change:
      - Section "Crop & corners".
      - Buttons "Crop…", "Done cropping", and a text button "Reset crop".
      - "Crop to circle"; menu item "Crop"; History "Reposition image in crop".
      - Keep code names (`maskingId`) and agent-facing ids (`src/cli/capabilities.ts:158`, `:178`; `data-crop` and `data-mask-shape` in `htmlSlides.ts:1717`, `:1735`, `:1896`).
      - About 13 test files match these labels. Tests also call `window.canvas.maskingElement()` inside unchecked strings (`test/crossContextFuzzBrowser.test.ts:329`, `:1134`), so rename identifiers only in a separate commit, if at all.
    - S. Risk Low. Lenses: UX, ZO, ST, IR, CB.
17. **Crop mode is hard to see, and double-click enters it on images but plays videos.**
    - Effect: after an accidental double-click, dragging moves the picture inside its frame, and nothing on screen says why.
    - Evidence: the double-click handling is at `canvas.ts:3385-3390`. The only sign of crop mode is a green outline (`editor.css:1184`, `:2071`).
    - Change: show a banner, reusing `.design-slide-preview-banner`: "Cropping. Drag edges to crop, drag the picture to reposition, click outside or press Esc to finish." Making videos behave the same is optional.
    - S for the banner (Risk Low); M for the gesture change (Risk Med). Lens: UX.
18. **The Props heading shows internal type names.**
    - Effect: the heading reads "HTML", "WEB", "UNSUPPORTED", "2 ELEMENTS", "TEXT" for a table, or "SHAPE" for an arrow.
    - Evidence: `inspector.ts:457`, `:465`, `:472`, `:510-513`, uppercased by `editor.css:2039-2044`. Display names already exist in `elementLabel.ts:109-131`.
    - Change: use those names ("Table", "Arrow", "Web page", "HTML block", "Unconverted object", "This slide", "2 objects"). Update `test/videoEditing.test.ts:161`, `test/mediaEffects.test.ts:159`, `test/canvasEditing.test.ts:1220` and `test/slideLayouts.test.ts:80`, `:117`.
    - S. Risk Low. Lenses: UX, ZO, ST, IR.
19. **The tabs "Props", "Design" and "Build" have no tooltips, and the tab list is copied in two places.**
    - Evidence: `src/renderer/editor/main.ts:985-1003` and `src/renderer/collab/main.ts:1067-1072`. The current names appear in `AGENTS.md:367` and `docs/deck-brief.md:24`.
    - Change:
      - At least add tooltips: "Settings for the selected object or slide", "Theme and layouts for the whole deck", "Build animations on this slide".
      - Renaming is a user decision.
      - Move the tab list into one shared module.
    - S. Risk Low–Med. Lenses: UX, ZO, ST, IR.
20. **"Size box to text" and "Auto-fit text to box" can both be on, and auto-fit then does nothing.**
    - Effect: you tick "Auto-fit text to box" and the text still overflows.
    - Evidence:
      - Turning on auto-size clears auto-fit (`inspector.ts:2925-2932`), but turning on auto-fit does not clear auto-size (`inspector.ts:1846-1855`).
      - Rendering skips fitting whenever auto-size is set: `render.ts:452`.
      - The rule exists only as a comment: `src/shared/deck.ts:145-151`.
      - Related wording in the same section: "Paragraph" (`inspector.ts:1833`), "Disable automatic line breaks" (`:1856`), and raw values "shrink/condense" (`:1865`).
    - Change:
      - First, a red test, then turning on auto-fit clears auto-size.
      - Then one control: "Text fit: Off | Grow box to fit text | Shrink text to fit box", plus "Keep on one line" and "If too long: Shrink text | Narrow letters".
      - A new control needs a fuzz operation.
    - S–M. Risk Low–Med. Lenses: ZO, UX, IR.
21. **Four different things are called "Style".**
    - Evidence: "Text style" (`inspector.ts:2044`), the B/I/U row (`:1983`), the shape section (`:2428`) with "Kind" (`:2442`), and the shadow type (`:1243`). A curved shadow's checkbox still says "Drop shadow" (`:1273`).
    - Change: "Format", "Fill & outline", "Shape", "Shadow type", and "Shadow".
    - S. Risk Low. Lens: UX.
22. **Shorthand labels, and one idea with two names.**
    - Evidence:
      - Abbreviations: "ROT" and "Z" (`inspector.ts:911`, `:918`), "HEAD SIZE" (`:1035`).
      - Mixed case: "WIDTH" (`:2472`) next to "Width" (`:1732`).
      - Video toggles "auto / loop / mute / ctrl" (`:117-122`), and raw option values (`:1611`, `:3366-3370`).
      - "Preset" for slide layouts (`:533`), the word the theme system uses for themes.
      - Two spellings: "Color" (`:1178`, `:1288`, `:1720`, `:2214`, `:2662`) and "Colour" (`:1576`, `:1591`, `:2261`).
      - "Border" (`:1325`, `:1718`, `:2669`) versus "Stroke" (`:1393`, `:2464`).
      - "elements" (`:472`, `shellWiring.ts:185`) versus "objects" (`store.ts:880`).
      - Two layout label tables with different strings: `slideLayouts.ts:23-27` and `layoutPreview.ts:15-19`.
    - Change: one word per idea, sentence case, full words ("Rotation", "Arrowhead size", "Autoplay / Loop / Muted / Player bar", "Layout"), one layout label table, and display labels in the select field. Update `test/inspectorVideoResize.test.ts` and `test/shapeShadowInspectorBrowser.test.ts`.
    - S. Risk Low. Lenses: UX, ZO, IR.
23. **The theme editor uses jargon, and the preview note says the opposite of what a click does.**
    - Evidence:
      - Jargon labels: "Typefaces", "Type scale", "Semantic colours", "Palette swatches", "Muted text" (`themePanel.ts:605`, `:615`, `:641-653`).
      - The preview says "Theme choices preview here without changing slide content" (`designWorkspace.ts:48-52`), but a click restyles every slide.
      - A stale comment: `themeGallery.ts:107-108`.
    - Change: "Fonts", "Text sizes", "Main colours" (Background, Text, Secondary text, Accent), and "Extra colours for shapes". The note becomes: "Clicking a theme applies it to every slide; Cmd+Z undoes it." Fix the comment.
    - S. Risk Low. Lenses: UX, IR, ZO.
24. **Settings for the whole deck sit in per-slide places.**
    - Evidence:
      - "Show slide numbers" sits in the slide's Layout section (`inspector.ts:573-581`).
      - Morph "Motion curve" applies to the whole deck (`morphPanel.ts:111`, `:127`).
      - Morph "Enabled" on slide N actually changes slide N+1 (`morphPanel.ts:151`, `:155`).
      - "Enable and Auto-Pair" (`:161`) versus "Enable Morph & Auto-Pair" (`:215`).
    - Change: move slide numbers to the Design tab (or label it "(all slides)"). Use "Motion curve (all Morphs)", "Morph into next slide", and one wording for the button.
    - S. Risk Low. Lenses: UX, ZO.
25. **Five ways into the layout editor.**
    - Evidence: `inspector.ts:548-559` (an "Edit layouts…" option inside the layout select), `themePanel.ts:398`, `themePanel.ts:527`, `designWorkspace.ts:54`, `designWorkspace.ts:174`.
    - Change: delete the select option and the Design-tab button, and keep the tiles.
    - S. Risk Low. Lens: ZO.
26. **Pointers to screens that do not exist.**
    - Evidence: a tooltip sends the user to "Theme › Edit theme" (`inspector.ts:3689`; repeated in `AGENTS.md:888`, `docs/collab.md:395`, `desktop-web-parity.md:77`, and a comment at `src/renderer/editor/main.ts:949`). The real tab is "Design" and the button is "Edit…".
    - Change: point to the real names, built from the shared tab list (item 19).
    - S. Risk Low. Lenses: UX, ST, IR.
27. **Theme edits are thrown away without warning, and a tab switch can leave the preview overlay on screen.**
    - Evidence:
      - Pressing "Edit…" a second time silently cancels the draft: `themePanel.ts:506`.
      - Clicking a slide in the rail or pressing Escape also discards it: `src/renderer/editor/main.ts:966-975` and `themePanel.ts:696-703`.
      - Switching tabs only hides the stylesheet (`main.ts:1018`), not the overlay (`designWorkspace.ts:75-80`, `:187-210`).
    - Change:
      - Rename the button "Edit theme…" and disable it while editing.
      - Ask "Discard theme changes?" through `confirmDialog` on rail click, Escape and tab switch.
      - Clear the overlay on tab switch.
      - Red test first.
    - M. Risk Med. Lens: UX. The discard is Confirmed; the leftover overlay is Speculative.

**1C. Editor dark mode versus the slides' dark theme**

28. **Make the Design tab's Light/Dark one clearly named control.**
    - Effect:
      - The row is labelled "Default", but clicking it restyles every slide.
      - A second, identical switch appears directly above it when the theme chooser is open.
      - Its screen-reader name, "Deck default appearance", uses the same word as the editor's own switch.
    - Evidence:
      - The row: `themePanel.ts:484-508`.
      - The second switch: `themeGallery.ts:129-145`.
      - Both reach the restyle path: `themeGallery.ts:204-212` → `themePanel.ts:444-452` → `themePanel.ts:247-261`.
      - Both are visible at once: `themePanel.ts:520`.
      - Tests pin restyle-on-click (`test/themePanel.test.ts:50-51`, `:195-219`) and the gallery switch (`test/themeVariants.test.ts:140-200`).
    - Change:
      - One control, "Slide colours: Light | Dark", with the tooltip "Switches every slide to the light or dark version of <theme>. Cmd+Z undoes it. The editor window's own light or dark look is under DeckWerk menu › Editor appearance."
      - Delete the gallery copy.
      - Keep apply-on-click.
      - Add a fuzz operation "slide colours light/dark" next to "theme pick" (`test/crossContextFuzzBrowser.test.ts:1073`).
    - S. Risk Low–Med. Lenses: ZO, UX, ST, IR, DES, CB.
29. **Rename the editor's own appearance switch and point to it.**
    - Effect: the user cannot find where to change dark mode.
    - Evidence: the only switch sits behind the "DeckWerk" wordmark, whose tooltip is just "DeckWerk" (`aboutDialog.ts:11-20`). It holds an "Appearance" section with System / Light / Dark (`src/renderer/uiTheme.ts:64-77`). The default follows the OS (`uiTheme.ts:5-6`).
    - Change:
      - Rename the section "Editor appearance", with the options "Match system | Light | Dark" and the line "Slide colours are in the Design tab".
      - Give the wordmark the tooltip "DeckWerk menu: About, editor appearance".
      - Use the word "Appearance" only for the editor.
    - S. Risk Low. Lenses: UX, ZO, DES, CB.
30. **There is no application menu, so Cmd+R can reload the editor and lose work.**
    - Effect:
      - Electron's default View menu (documented Electron behaviour) offers Reload and Force Reload.
      - A reload drops the undo history, up to 800 ms of unsaved edits, and any open text edit.
      - DevTools is reachable in the shipped app.
      - There is no menu-bar home for "Editor appearance".
    - Evidence:
      - No `Menu` usage in `src/` **(re-checked)**.
      - No `beforeunload` handler in the desktop editor **(re-checked; only the collab client has one)**.
      - Autosave waits 800 ms: `src/renderer/editor/main.ts:1080-1087`.
      - `test/osInputSmokeBrowser.test.ts:28-29` relies on the default menu owning Cmd+Z.
    - Change: a small explicit menu with App, Edit, View › Editor appearance, and Window.
      - Declare every Edit role again: undo, redo, cut, copy, paste, paste and match style, select all.
      - Leave out Reload and DevTools in packaged builds.
      - Smaller fallback if the user declines a menu: a `beforeunload` handler that flushes the save.
    - M. Risk Med–High: copy, paste and undo in text fields depend on the Edit roles, and the serial clipboard suites would catch a mistake. Lenses: DES, IR, UX. ZO is against a new menu.
31. **Native window parts ignore the editor's light/dark choice.**
    - Effect: with Light chosen while macOS is dark, native dialogs and window backgrounds stay dark. Windows may flash dark when they open (Speculative).
    - Evidence:
      - No `nativeTheme` call anywhere in `src/` **(re-checked)**.
      - Every window gets a fixed `APP_BACKGROUND = '#16161e'`: `src/main/windows.ts:15`, used at `:148`, `:264`, `:327`, `:354`.
      - The preference lives in each window's localStorage: `uiTheme.ts:11`, `:39-61`.
    - Change:
      - The window sends the preference to the main process, which sets `nativeTheme.themeSource` and picks the window background from it.
      - Keep the `deckwerk.uiTheme` key as the only stored setting.
      - Caveat: this also changes `prefers-color-scheme` inside web-element pages, which today follow the OS.
    - S–M. Risk Med. Lenses: DES, CB, IR.
32. **Light mode leaves dark and invisible pieces behind.**
    - Effect:
      - The welcome screen stays near-black.
      - Pressing a button flashes near-black.
      - Agent error text is pale pink on near-white.
      - The selected Light/Dark option has no outline, because its border colour is never defined.
    - Evidence:
      - Welcome screen: `editor.css:547-549` **(re-checked)** and `:595-603`.
      - Pressed buttons: `editor.css:1337`.
      - Agent error text: `editor.css:3303` and `:3312`.
      - `var(--border)` is used at `editor.css:1512`, `:2536`, `:2552` and declared nowhere **(re-checked)**.
      - `lightTheme.css:19-30` patches only six selectors **(re-checked)**, while `editor.css` has more than 200 colour literals.
      - The comment at `editor.css:9-11` says the palette comes from `appChrome.css` alone.
      - `test/appChrome.test.ts:41-60` checks only that palette tokens are not re-declared.
    - Change:
      - Add two checks to `test/appChrome.test.ts`: every `var(--x)` without a fallback must be declared, and colour literals are allowed only from a short list.
      - Convert the rules the checks flag to tokens.
      - Replace `--border` with `--line`.
    - S–M. Risk Low–Med. Lenses: ST, DES.
33. **A deck's `theme.css` can recolour the editor, but only when the editor is dark.**
    - Effect:
      - If a deck's `theme.css` defines common names such as `--accent`, `--text` or `--bg`, the editor's own panels change colour in Dark mode only. This looks like the two modes are tangled.
      - Text with no theme font shows on the canvas in the editor's monospace font and colour, but differently in Present.
    - Evidence:
      - `theme.css` is injected without scoping: `cssEditor.ts:27-29`.
      - The editor uses generic token names: `src/renderer/appChrome.css:11-27`.
      - The light overrides are more specific (`lightTheme.css:3`), which is why only Dark mode is affected.
      - `.slide` sets no colour or font (`player.css:16-26`), so it inherits the editor body's monospace font (`editor.css:1923-1927`) and its dark colour scheme (`appChrome.css:12`).
    - Change:
      - Rename the editor tokens to `--dw-*`. This touches about 660 uses in 10 CSS files; it is mechanical and goes in its own commit.
      - Give `.stage` a neutral starting colour, font and colour scheme.
      - Add a test that `player.css` and `type.css` never use editor tokens.
      - Reproduce the problem first.
    - M. Risk Low–Med. Lens: DES. The mechanism is Confirmed; how often decks hit it is Speculative.

**1D. Other confirmed misbehaviour**

34. **An agent save while you type speaker notes gets tied into the notes' undo.**
    - Effect:
      - Undoing "Edit speaker notes" also reverts the slides the agent just wrote.
      - While you keep typing, a watched `edit/*.html` save can fail with "the deck kept changing while it compiled — save it again".
    - Evidence:
      - The notes drawer keeps a transaction open while it has focus: `speakerNotesDrawer.ts:200-211`.
      - `replaceWithHistory` ignores the open transaction: `store.ts:275-284` **(re-checked)**.
      - `applyRemote` already handles the same case by rebasing: `store.ts:303-316` **(re-checked)**.
      - The compile is thrown away on any deck change: `src/renderer/editor/main.ts:344-353`, `:400`.
    - Change:
      - `replaceWithHistory` rebases the open transaction the way `applyRemote` does.
      - The compile retries only if a slide in the file's own range changed.
      - Add a red test, a fuzz operation "agent save while notes focused", and a case in `test/agentCollaboration.test.ts`.
    - S–M. Risk Med: undo behaviour. Lens: DES. Confirmed in code, not reproduced.
35. **Agent and Collaborate sessions listen on every network interface with no access control** (security; server change allowed).
    - Effect: while an Agent session runs on café or conference Wi-Fi, anyone on that network can open, read and edit the deck, including the speaker notes.
    - Evidence:
      - The server binds to all interfaces by default: `src/server/collabServer.ts:357` **(re-checked)**.
      - The desktop app passes no host: `src/main/index.ts:1379-1393` **(re-checked)**.
      - With no access control, the deck is open to anyone who can reach the port: `collabServer.ts:314-321`.
      - Agent mode only ever uses the loopback address: `src/main/index.ts:120-126`, `:1452`.
    - Change: bind Agent mode to `127.0.0.1`. When Collaborate starts, state plainly that the deck is open to the local network.
    - S. Risk Low. Lens: DES.
36. **Web export blurs pictures set to `cover`.**
    - Effect: below original quality, pictures whose box proportions differ from the image come out soft.
    - Evidence: `src/main/exportDeck.ts:457-468` sizes the image by the box, but `cover` paints larger than the box (`src/shared/mediaMask.ts:60-66`). The image is resized to the smaller size at `exportDeck.ts:410` and `:430-445`.
    - Change: compute the painted size from the probed pixel size. Test: a 3000×1000 image in a 600×600 `cover` box must export at least 1800 px wide.
    - S. Risk Low. Lenses: IR, CB.
37. **Agent HTML exports show PDF figures as broken images.**
    - Effect: an exported page opened in a browser shows broken images where the PDFs are, and an agent may try to "fix" them.
    - Evidence: `htmlSlides.ts:1724-1727` writes `<img src="….pdf">`, because PDF counts as an image type (`media.ts:13`).
    - Change: export PDFs in the existing `<div data-element="image" data-src>` form (`htmlSlides.ts:1714-1722`) with an inner `<embed>`. Add a case to `test/agentCollaboration.test.ts`: the export contains no PDF `<img>`, and an untouched re-save is no change.
    - M. Risk Med. Lens: CB.
38. **Agent saves can be ignored with no message.**
    - Effect: an agent saves a file in `edit/` and nothing happens, with no explanation.
    - Evidence:
      - All watchers are set up inside one `try` (`src/main/index.ts:434-548`) and one `push` (`:504-544`), and the `catch` at `:545` is silent.
      - A file starting with `<html` but without `</html>` is dropped silently: `:530`.
      - An invalid `deck.json` is swallowed: `:466`.
    - Change: create and store each watcher in its own `try`, and show a status message when a watcher fails or a file is ignored as unfinished.
    - S. Risk Low. Lens: ST.

#### Tier 2: other user-visible clarity and consistency fixes

39. **History shows "Edit slide" for most Props changes, and one row per arrow-key nudge.**
    - Evidence:
      - The default label is "Edit slide": `store.ts:491`, `:506`.
      - Nudges pass no label: `shellWiring.ts:462-479`.
      - `inspector.ts` has 97 `updateSelected` calls but only 49 labels.
      - Internal names leak into History: "Add gaussianNoise effect" (`inspector.ts:2729`, `:2763`, `:2798`), "Mask shape" (`shellWiring.ts:544`), "Edit layout masters" (`designWorkspace.ts:321`).
    - Change: make `label` a required option so the compiler lists every caller. Group nudges under one "Nudge" label. Map effect ids to display names. Test in `test/historyPanel.test.ts`.
    - S–M. Risk Low. Lenses: UX, IR, CB.
40. **Tools are named after how they work, and Props duplicates the right-click menu.**
    - Evidence: "Edit w/ ffmpeg…" and "Rasterize & paint…" (`inspector.ts:1798-1808`, `:1817-1826`) repeat `shellWiring.ts:553` and `:563`. The ffmpeg window is titled "Trim & Crop" (`src/main/windows.ts:328`), which makes it a second crop tool that writes a new file.
    - Change: "Trim or crop into a new file…" and "Paint on picture…", with "original kept" tooltips. Whether to delete the Props "Advanced" copies is a user decision.
    - S. Risk Low. Lenses: UX, ZO.
41. **Jargon on rarer objects.**
    - Evidence:
      - "Document (deck-relative .html)" and "Poster (deck-relative image, optional)": `inspector.ts:2380-2400`.
      - A "Markup" section containing a "Markup" field: `:2414-2416`.
      - An unconverted object says "Geometry was preserved…" without saying what to do: `:2546`.
      - "Gaussian Noise" and "Frequency cutoff": `:2707`, `:2732-2752`.
    - Change: "Page file (in the deck folder)" and "Still image shown before the page loads"; "HTML source"; "Couldn't convert this object. Its size and position were kept. Rebuild it with Text, Shape or a picture, or ask your agent (`slide-agent validate` lists these)."; "Film grain" and "Grain size".
    - S. Risk Low. Lenses: UX, ZO.
42. **Collaboration and duplicate controls a solo user always sees.**
    - Evidence:
      - A "Collaborate" toolbar button (`src/renderer/editor/main.ts:541-548`, `:687-696`), although the same action is in the More menu (`:549-552`).
      - A "Z" field (`inspector.ts:918`) that duplicates the Arrange buttons (`:941-963`).
    - Change: drop the toolbar button and keep the menu entry. Drop the Z field, or rename it "Layer".
    - S. Risk Low. Lenses: ZO, UX.
43. **Export is hidden under "Save As… › Lossy export", and there is no button to add a picture.**
    - Evidence: `src/renderer/editor/main.ts:488-503`, against the narrow-window wording "Export PDF…" / "Export Web…" at `:504-521`. The insert buttons are only Text, Shape and Table (`:534-536`).
    - Change: one "Export" picker with the same labels at every window width, and a plain "Save As…". Add a "Picture or video…" insert button through the existing asset import, with delayed progress feedback.
    - S–M. Risk Low–Med. Lenses: ZO, UX.
44. **The Agent panel explains almost nothing.**
    - Evidence: `agentPanel.ts:293-311` shows only a folder path and "Copy". The status bar says "Deck folder ready for a filesystem agent." (`src/renderer/editor/main.ts:666`).
    - Change: "Start your coding agent in this folder; it reads AGENTS.md there. HTML it saves in edit/ appears here as one undoable change." Rename the button "Copy folder path".
    - S. Risk Low. Lens: UX.
45. **The agent guides contradict each other.**
    - Evidence:
      - `context --around` is listed in help and implemented (`src/cli/agentCli.ts:96`, `:347`), but `AGENTS.md:103` says `context` "takes no flags".
      - Help promises "~200ms" (`agentCli.ts:108-109`); `AGENTS.md:97` and `:393` say several seconds.
      - `docs/deck-brief.md:33` sends drafts to `drafts/`, not `edit/`, which conflicts with `AGENTS.md:84-99`.
      - `docs/deck-brief.md:46-47` recommends `clip-path`; `AGENTS.md:272` says it imports as an inert region.
      - `docs/deck-brief.md` is written into every deck's `AGENTS.md`.
    - Change: make all four agree.
    - S. Risk Low. Lenses: UX, IR.
46. **CLI messages and help are inconsistent.**
    - Evidence: "No such slide" errors at `agentCli.ts:394`, `:866`, `:1085` omit the slide count that `:347` and `:946` include. Help says `--after <slideId>` (`:133`) and `--slide <id>` (`:200`), while most commands accept an id or a number.
    - Change: one helper for the slide error, and corrected help text.
    - S. Risk Low. Lens: UX.
47. **Theme ids differ from theme names in the CLI.**
    - Evidence: `basic` is Research, `hacker` is Mercury, `swiss` is Grid, and so on (`src/shared/themes.ts:107-150`). An unknown theme lists ids only (`agentCli.ts:2240-2245`). `theme list` reports `modified` as true after any Design-tab pick (`agentCli.ts:1935`).
    - Change: accept names case-insensitively, list "id (Name)" in errors, and add an `edited` field while keeping `modified`. Never rename ids. Test in `test/agentThemeCli.test.ts`.
    - S. Risk Low. Lens: IR.
48. **Import hides failed slides and warnings.**
    - Evidence: `src/renderer/editor/main.ts:936-943` shows only a placeholder count. A failed slide is counted as an object placeholder (`importers/pptx/import_pptx.py:3121-3130`). Up to 200 warnings are dropped (`import_pptx.py:179-198`).
    - Change: a pure `importSummary(report)` that names failed slides, and a "Show import notes" dialog in the shared dialog chrome.
    - S. Risk Low. Lens: IR.
49. **PDF export has a fixed 30-second wait and a single progress phase.**
    - Evidence: `src/main/index.ts:1271`, `:1273-1277`. Slide capture already scales its timeout with slide count (`renderSlides.ts:192-203`).
    - Change: scale the wait by page count, and report "page n of N".
    - S. Risk Low. Lens: IR. The effect on users is Speculative.
50. **The Props panel rebuilds on any background change.**
    - Effect: an open dropdown closes, a colour popover detaches, or a half-typed value is lost when an agent save, an auto-fit measurement or a `notes.md` change arrives. Focus is restored by matching label text, so renaming labels can move focus.
    - Evidence:
      - The rebuild: `inspector.ts:272-328`, `:446-454`.
      - Focus matched by label: `:374-380`.
      - A rule held only by a comment: `:757-760`.
      - Measurement commits still notify subscribers: `store.ts:481-483`.
    - Change:
      - S, before the wording pass: give controls stable `data-control` keys, and have the focus restore prefer them.
      - M: skip the rebuild for measurement and remote commits while a control has focus.
      - Defer the full in-place update.
    - S + M. Risk Med. Lenses: ST, DES. The mechanism is Confirmed; how often users hit it is Speculative.
51. **Web-element pages can read the deck folder and reach the network** (security).
    - Evidence: the frame allows scripts (`render.ts:903-904`), every `deck://` response allows any origin (`src/main/assetProtocol.ts:121-130`), and only paths outside the folder are blocked (`src/main/deckStore.ts:384-392`). There is no content-security policy for these pages.
    - Change: send a content-security-policy header with no network access on web-element pages, and refuse requests with no origin for anything outside `assets/`.
    - S–M. Risk Med: pages that fetch their own data files need a `deck:` allowance. Lens: DES. Exploitation was not tested.

#### Tier 3: code cleanup and performance

52. **Pin theme colours with a test before touching themes.** Variant colours are regenerated at run time (`src/shared/themes.ts:391-410`), and "· Modified" compares the stored colours against the regenerated ones (`themes.ts:350-355`, `themeGallery.ts:166`). Any change to how colours are derived makes existing decks read "Modified". Change: a fixed-value test for every preset and both variants. S. Risk Low. Lens: IR.
53. **One shared set of controls instead of three.**
    - Evidence:
      - Unused exports in `ui.ts` (`:7-28`, `:85-193`); only tests use them.
      - Three button factories (`ui.ts:7`, `inspector.ts:3712`, `shellWiring.ts:608-614`).
      - `themePanel.ts:27` imports `numberField` from the 3,700-line `inspector.ts`.
      - A section builder copied with a "deliberately identical" comment (`themePanel.ts:403-408` and `inspector.ts:3311-3332`).
      - The Light/Dark toggle built twice (`themePanel.ts:494`, `themeGallery.ts:134`).
    - Change: delete the unused exports, move the field widgets into one module as a pure move, and reuse one section builder and one toggle.
    - M. Risk Low for the move. Lenses: ZO, ST, CB.
54. **Merge the single- and multi-selection media sections in Props.**
    - Evidence: the copies are `inspector.ts:665-706` versus `:1680-1714`, `:2667-2691` versus `:1716-1740`, and `:1778-1787` versus `:1668-1676`. The multi-selection copy has no undo labels and no crop button.
    - Change: build each section once from a list of media, passing `[el]` for a single selection. Shapes already do this (`:2537`).
    - M. Risk Med: `test/mediaEffects.test.ts:164` asserts section order. Lenses: ST, ZO.
55. **Small duplicates in render and geometry code.** The crop wrapper markup is copied three times (`render.ts:166-176`, `:773-790`, `:1228-1244`). The structure check is duplicated (`canvas.ts:7393-7397`, `:7419-7421`). `mediaMask.ts:6-7` re-declares types from `geometry.ts:3-13`, and `inspector.ts:3005` repeats `clamp` (`geometry.ts:47`). S. Risk Low. Lenses: ST, CB.
56. **Prune `editor.css` for the selectors Tier 1 touches.** The file stacks four design layers (banners at `:1312-1315`, `:1917-1921`, `:3634`, `:4169-4174`). `button` is styled at `:133`, `:1327`, `:1946` and in `appChrome.css:38`. Change: delete overridden declarations only for the Props sections, crop, the theme toggle and buttons. Check computed styles in both appearances before and after, and land it in its own commit. M. Risk Med. Lenses: ST, DES.
57. **Crop drags and notes typing copy the whole deck on every pointer move or keystroke.** The crop paths call the generic commit (`canvas.ts:2997-3005`, `:7002-7008`), which copies and compares the whole deck (`store.ts:445-460`). Move and resize already copy only the changed element (`store.ts:843-867`). Notes do the same per keystroke (`speakerNotesDrawer.ts:218-221`). Change: route both through the same per-element update path. S. Risk Low. Lens: DES. The size of the lag is Speculative.
58. **An agent sync replaces every slide object.** `store.ts:267` and `:278` parse the deck without keeping unchanged slides, unlike the normal commit (`store.ts:459`, `:1075-1100`). Later steps then compare every slide as text (`src/shared/deckDiff.ts:40`, `:58`, `:193`; `slideRail.ts:385-401`; `inspector.ts:317-325`). Change: reuse unchanged slide objects (`reshareDeck`). S. Risk Low. Lens: DES.
59. **Whole-deck work after every pause in editing.** About 140 ms after each change, the agent bridge serialises and hashes the whole deck even when no agent is running (`agentBridge.ts:67-78`, `:186-235`, `:243-258`). Autosave sends the whole deck to the main process, which parses and pretty-prints it (`src/main/index.ts:724-734`, `src/main/deckStore.ts:124-131`). Change: cache the serialised form per slide, with a test that the CLI computes the same hash. Measure first. M. Risk Med. Lens: DES.
60. **Long work blocks the editor, so the 500 ms progress indicator cannot appear.** Theme restyle and its overflow measurement run synchronously (`themePanel.ts:247-261`, `:347-377`), and so does the HTML compile (`htmlCompile.ts:50-56`, `:96`). The image and font waits have no timeout (`htmlCompile.ts:93-94`, `:108-116`), and saves run one at a time (`src/renderer/editor/main.ts:417-418`), so one hung save would block every later save (Speculative). Change: wrap restyle in `DelayedOperationProgress`, measure in chunks, and add timeouts to the waits. The timeouts are S and worth doing without measuring. M. Risk Med. Lenses: DES, UX.
61. **A hidden CodeMirror editor holds the `theme.css` text.** Evidence: `index.html:23`, `cssEditor.ts:1-3`, `:31-45`, and `package.json:63-66` (three dependencies). It is contested: the save paths rely on its flush and focus behaviour (`src/renderer/editor/main.ts:587-689`). Decide, then either replace it with a small text holder or leave it. S. Risk Low–Med. Lenses: DES (replace), IR (leave).
62. **The Electron shell has no sandbox and no navigation guard.** Every window that has a preload sets `sandbox:false` (`src/main/windows.ts:160`, `:236`, `:273`, `:314`, `:339`, `:366`). There is no app-wide navigation hook, and the new-window handler is set only on the editor and present windows (`windows.ts:163`, `:242`). Change: build the preload as CommonJS, turn on the sandbox, and add one app-wide `web-contents-created` hook. M. Risk Med. Lens: DES.
63. **Four CLI writes bypass the locked writer.** `src/cli/agentCli.ts:1635`, `:1639`, `:2067`, `:2176` (also in the drift report). Change: route them through the locked writer. Do not split `agentCli.ts`. S. Risk Med. Lens: ST.
64. **The consistency checks are off in the shipped app.** `src/renderer/editor/main.ts:130-131` runs them only in development. Change: a localStorage flag that turns them on and shows the first problem in the status bar, so bug reports can quote it. S. Risk Low. Lens: CB.
65. **Repository hygiene.**
    - Evidence:
      - The 33 MB `task-demo-95s-1080p [1225466741].mp4` is referenced nowhere.
      - 26 untracked per-folder READMEs add about 2,300 lines; the drift report found about 150 mismatches between them and the code.
      - Dead code: `src/main/windows.ts:175` (`createCollabHostWindow`) has no callers, and `windowHandoff.ts` is used only by a test.
    - Change: `git rm` the video and ignore root media files, decide what happens to the READMEs, and delete the dead main-process code. Leave the server's unreachable handlers (`collabServer.ts:1589-1594`) alone under the server rule.
    - S. Risk Low. Lenses: ZO, DES.
66. **`docs/PRODUCT_IDEAS.md` lists features that already exist.** The presenter view (`:24`), the theme-change diff (`:25-26`) and manual Morph matching (`:13-14`) are all built. The role-audit idea (`:7-8`) would add more to Props, which conflicts with this pass. Change: delete the three built entries and mark the audit as conflicting. S. Risk Low. Lens: ZO.

**Count:** Tier 1 has 38 items (15 crop behaviour, 12 wording, 6 appearance, 5 other misbehaviour). Tier 2 has 13. Tier 3 has 15. That is 66 in total.

## Goals vs. Non-Goals

* **In-scope goals:**
  - The user can find, and tell apart, two switches: "Editor appearance" (the editor window's light/dark) and "Slide colours" (the deck theme's light or dark version). Each one points to the other.
  - Cropping behaves the same whether you drag, type a size, reset, press Escape, or crop a picture that is still loading, and it looks the same in the editor, Present and export.
  - Every label in Props and Design uses plain, full words, with one word per idea. Panel headings never show internal type names.
  - Confirmed misbehaviour (Tier 1D) is fixed, each with a test that fails first.
  - The agent guides (`AGENTS.md`, `docs/deck-brief.md`, CLI help) agree with each other and with the UI words.
  - Repository rules hold for every change: red-to-green tests, fuzz operations for new or changed gestures and controls, shared chrome, delayed progress feedback, and invariants as checks rather than comments.
  - Compatibility holds:
    - no change to the `deck.json` schema;
    - `data-crop`, `data-fit` and `data-mask-shape` keep their meaning;
    - capability ids `crop` and `mask`, theme ids, the `deckwerk.uiTheme` key and CLI JSON fields are unchanged (fields are only added);
    - existing decks' `fit` values are never rewritten;
    - an untouched export still re-saves as no change on every deck in `decks/`.
* **Out-of-scope non-goals:**
  - Changing the Design tab from "click applies to every slide" to "preview, then Apply". That is a deliberate, test-pinned decision and would need its own proposal.
  - Moving crop mode out of `canvas.ts`, splitting the text section of `inspector.ts` by object type, rebuilding the Props panel to update in place (beyond item 50), or consolidating all of `editor.css`.
  - Drawing all media with one page structure in `render.ts`, which Present and export share.
  - Scoping `theme.css` with `@scope`, moving the HTML compile into another process, or sending diffs instead of whole decks to the main process.
  - A shared module for all UI strings. This is a single-language app; shared constants for the three or four terms used across files are enough.
  - Renaming code identifiers (`maskingId`, `UiTheme`) in the same commits as behaviour fixes.
  - Rewriting git history to remove the video (a separate decision).
  - Retiring the legacy field aliases and compatibility shims.
  - Collab server changes other than item 35 and the cross-area parts of items 8 and 37.
  - Presenting, the Build panel, the slide rail, comments, the pickers and the importers, beyond the items listed. They were not reviewed (see "What this review did not cover").

## Key Decisions & Staging for Next Steps

### Decisions already implied by the review

- **"Done" means Tier 1 landed with its tests, plus an explicit keep-or-drop on each Tier 2 and Tier 3 item.** "Every finding in one or a few commits" is not workable under the repository's rules.
- Keep apply-on-click in the Design tab, and make it clear in words (item 28).
- Change visible wording only. Agent-facing names, data attributes and stored values stay as they are.
- Give Props controls stable keys before any wording change lands (item 50, S part).
- Measure before treating items 57–60 as fixes for slowness. The exception is the timeouts in item 60.

### Open questions the user must decide

1. **Shift on picture resize** (item 4): lock proportions everywhere, as in crop mode and other slide apps, or keep today's inverted rule, which the code comment calls deliberate?
2. **Application menu** (item 30): build a small real menu (closes the Cmd+R reload risk and gives "Editor appearance" a menu home, but every Edit command must be declared again), or keep Electron's default menu and add only a `beforeunload` save guard plus the wording fixes?
3. **Tab names** (item 19): rename (for example Props → Format) or add tooltips only?
4. **Removals** (items 25, 40, 42): delete the duplicate layout-editor entries, the Props "Advanced" copies of the ffmpeg and paint tools, the Z field and the toolbar Collaborate button, or only relabel them?
5. **Spelling:** "Colour" or "Color"? The UI uses both today; the repository's docs mostly use "colour".
6. **PDF figures:** do you use them? If not, items 8 and 37 drop to Tier 3.
7. **Hidden CodeMirror** (item 61): replace it or leave it?
8. **Repository files:** commit, trim or drop the 26 untracked READMEs and the drift report? Remove the 33 MB video only from the working tree, or also from history?
9. **Upstream:** does this checkout pull from `vsitzmann/deckwerk`? Wide edits to `inspector.ts` and moving helpers (item 53) will conflict on every pull.
10. **Unreviewed areas:** run a second pass on presenting, the Build panel, the slide rail and the importers, or drop them from scope?

### Strongest objections raised

1. **The commit plan conflicts with the repository's rules.** Each bug fix needs its failing test visible, and each new or changed gesture or control needs a fuzz operation. About 30 red-to-green tests across the unit and Electron tiers in one or a few commits cannot be bisected, and one regression would mean reverting everything. All six lenses said this on their own.
2. **Renames cost more than they appear to, and they reach past the desktop app.**
   - About 12–20 test files find controls by their text.
   - The collab browser client shares the modules, and collab tests assert tab labels.
   - Agents read the words through `capabilities`, `AGENTS.md` and every deck's generated `AGENTS.md`.
   - The Props panel puts focus back by matching label text.

   A wording sweep done before stable control keys exist can change behaviour, not just text.
3. **Most of the "unstable" and "flaky" feeling is behaviour that wording cannot fix**, and two of the fixes carry real regression risk:
   - the Shift-gesture change (item 4) reverses a documented, deliberate choice;
   - a real application menu (item 30) can break copy, paste and undo in text fields if any Edit role is missed.

   The counter-argument for a narrow scope: fixing the Tier 1A defects, items 28–29 and item 20 delivers most of the value for a fraction of the risk. The rest of the app has just been through a reliability review, and the user reported no pain there.

### Proposed staging (each step builds and can be reverted on its own; zero-risk steps first, riskiest last)

1. **C0. Tests and guards only.** Stable `data-control` keys (item 50, S part), the theme colour test (52), the CSS token checks (32) and the crop-mode check (1), all landing red where they expose a bug.
2. **C1. Pure moves and deletions, with no edits inside the moved code.** Items 53 and 55, and the shared tab list (19).
3. **C2. Crop correctness, one commit per fix, each red then green.** Items 14 (enabler) first, then 1, 2, 3, 6, 7, 8, 9, 10, 11 and 12, with item 15's fuzz operations.
4. **C3. Crop controls.** Items 5 and 4 (after decision 1), 13, 16 and 17. The importer `fit` change goes in its own commit.
5. **C4. Props and Design wording**, with the matching test strings, `AGENTS.md`, `docs/deck-brief.md` and `capabilities` text in the same commit. Items 18–26, 39–42 and 54.
6. **C5. Appearance.** Items 28, 29, 31 and 32, then 33 as its own mechanical rename commit, then 30 alone and last, with every Edit role restored.
7. **C6. Behaviour fixes outside crop.** Items 20, 27, 34 and 38, then 58.
8. **C7. Security.** Item 35 first (S, Low), then 51, then 62.
9. **C8. Export, import and agent docs.** Items 36, 37, 43–49.
10. **C9. Performance, after measuring.** Items 57, 59 and 60 (the item 60 timeouts can go earlier).
11. **C10. Hygiene.** Items 56 (CSS pruning, alone), 61, 63–66.

Three kinds of change never share a commit: CSS layer pruning, identifier renames, and file moves combined with edits.
