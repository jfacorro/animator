# Animator

A low-friction, frame-by-frame animation app that runs in the browser. Draw on
screen with a mouse, pen tablet or (later) an Apple Pencil, build the scene from
layers that each have their own timing, flip through it with onion skin, and
export a GIF. It aims to have the standard tools of a digital 2D animation
app, built step by step (see the roadmap).

Everything runs locally in your browser: there is no server and no account.
Your current animation is saved in the browser automatically, and you can save
it to a file from the `…` menu.

## Run it

```sh
npm install
npm run dev      # http://localhost:5173
npm test         # unit tests for the timeline/layer model
npm run build    # static site in dist/
```

## Online

Every merge to `main` publishes the app to GitHub Pages
(https://juan.facorro.com/animator/) through `.github/workflows/pages.yml`.
Once opened there, it also opens without a connection, and *Add to Home Screen*
on an iPhone or iPad gives a full-screen app. Drawings are kept in the browser
you use them in: to move an animation between devices or browsers, use
*Save to file* and *Open from file*.

## How it works

- **Layers and timing.** A scene is a stack of layers. Each layer is a list of
  cels: one drawing held for N frames. A background can be one drawing held to
  the end, while a character layer changes every 2 frames ("on twos").
- **Drawing.** Strokes are stored as points with pressure and rendered with
  [perfect-freehand](https://github.com/steveruizok/perfect-freehand). Pen
  pressure comes from the browser's Pointer Events; mouse strokes simulate it
  from speed (turn off "Pressure" for an even line). The eraser only affects
  the drawing it is used on.
- **Brushes.** Pencil, Ink, Marker, Soft, Graphite and Chalk presets set size, opacity,
  smoothing, stabilizer, pressure and edge softness; any of them can be tuned.
  Opacity applies to the whole stroke, so a stroke doesn't darken where it
  crosses itself, while overlapping strokes build up. The stabilizer makes the
  line trail the pointer (shown by an orange string) and catches up when you
  let go. The palette and your last brush are kept in the browser: **+** adds
  the current colour, right-click a swatch to remove it. The rainbow button
  opens the **colour disc**: drag around the ring for the hue and in the
  square for how strong and bright it is, or type a hex code. Below it are
  colours that go with the current one (complementary, split complementary,
  analogous, triadic or tetradic) and the colours you picked lately.
  **Graphite** and **Chalk** are textured: paper grain shows through the
  line. **Edit…** opens the brush editor with every setting, a live preview
  and the grain (Pencil, Chalk or Canvas, and how much shows); name the brush
  and *Save as new brush* to add it next to the presets.
- **Warp and Liquify.** With a selection, **Warp** puts a grid of nine
  handles over it: drag them to bend the drawing (lines stay lines, paint
  bends as pixels). The **Liquify** tool (W) pushes lines or paint along with
  the pointer, like a finger in wet paint, for nudging a pose or squash and
  stretch; set how wide an area moves with Size.
- **Adjust colours.** *Adjust colours…* in the ⋯ menu changes the hue,
  saturation and brightness of the current drawing (or only the selected
  lines), or of every drawing in the layer, with a live preview. **Recolour**
  turns one colour of the drawing into another, keeping its shading; raise
  *Tolerance* to take nearby shades along. Both work on lines and paint.
- **QuickShape.** Draw a rough line, circle, ellipse or box with the brush and
  keep the pen still at the end for half a second: it snaps into a clean
  shape. Keep holding and drag to adjust it (a line's end follows the pen, a
  closed shape turns and grows), then lift to finish.
- **Tools.** Lines, rectangles and ellipses are stored as shapes; the fill
  bucket stores the filled pixels as runs and paints them under the lines of
  the same drawing; the lasso selects whole strokes and moves/resizes them by
  giving each stroke a transform.
- **Playback and fixed layers.** Next to the speed, choose *Loop*, *Ping-pong*
  (forwards then backwards, also used for GIF exports) or *Once*. Tick *Same on
  every frame* in a layer's settings to make it a foreground or background: its
  first drawing shows throughout and gets no onion skin.
- **Onion skin.** Previous drawings show in red, next ones in blue (up to 5
  each way). The Layers panel sets their colours, strength, and whether they
  show on the selected layer or on every unlocked layer.
- **Layer groups, blend modes, clipping.** *Group* puts the selected layer in
  a folder; drag layers into or out of it, or drag the folder to move them
  all. A group shows, hides, locks, fades and blends as one. Each layer and
  group has a blend mode (Multiply for shadows, Screen/Add for light, …), and
  *Clip to layer below* shows a layer only where the layer under it has paint
  (colour and shading inside the lines).
- **Layer masks.** *Add mask* in a layer's settings, then paint with the
  brush to hide parts of the layer without erasing them (the mask shows as a
  red tint while you paint it) and with the eraser to bring them back. Click
  *Done* to draw on the layer again. A mask covers the whole layer on every
  frame; untick *Mask* to see the layer without it, or delete it.
- **Text.** The text tool (T) types on the canvas: click, type, Enter to
  finish (Shift+Enter for a new line, Esc to cancel). Pick the font, size,
  bold and colour first. Text is a stroke like any other, so the Lasso moves
  and resizes it.
- **Gradients.** Set the fill bucket to *Linear* or *Radial gradient* and drag
  inside a closed area from where the colour starts to where it ends (a click
  fills top to bottom). It runs from the current colour to the *To* colour, or
  fades out to see-through.
- **Drawing aids.** *Symmetry* (in the brush, eraser and shape options, or Y)
  mirrors what you draw left–right, top–bottom or both across the middle of
  the canvas; the purple dashed lines show the axes. The ruler button in the
  view controls (Shift+R) shows rulers: drag down from the top ruler or right
  from the left one to add a guide, drag its marker to move it, and drag it
  back onto its ruler (or double-click the marker) to remove it. Lines and
  shapes snap to guides. Guides are saved with the animation.
- **Reference image.** *Add reference image…* (the picture button in the
  Layers panel, or the ⋯ menu) adds a picture to trace over as a see-through
  layer at the bottom. It shows on every frame but never in exports or
  playback, and can't be drawn on. Select its layer and use the Lasso tool to
  move it, or drag a corner to resize it.
- **Camera.** The camera tool (K) frames the shot: drag the blue frame to pan,
  a corner to zoom, and use the rotation slider to tilt. Each change sets a key
  on the current frame, and the camera eases between keys. Remove a key with
  Delete, or right-click its diamond in the timeline. You always draw on the
  whole canvas; the camera applies when playing and in exports.
- **Sound.** *Add sound…* in the ⋯ menu adds an MP3/WAV (stored inside the
  animation) with a waveform row in the timeline. Drag the waveform to shift
  where it starts. It plays along with playback, and with *Scrub sound* on,
  each frame step plays that frame's slice for lip-sync. The scene runs at
  least as long as the sound. GIF export has no sound.
- **Export.** Three formats, all made in the browser:
  - *GIF* with [gifenc](https://github.com/mattdesl/gifenc). Held drawings
    become a single GIF frame with a longer delay, so files stay small.
  - *MP4* video (H.264, or VP9 where H.264 isn't available) with the sound
    track (AAC, or Opus), encoded with WebCodecs and packed with
    [mp4-muxer](https://github.com/Vanilagy/mp4-muxer). Needs Chrome, Edge or
    a recent Safari.
  - *PNG* image sequence: one numbered PNG per frame (`name_0001.png`, …) in
    a zip, made with [fflate](https://github.com/101arrowz/fflate), with a
    transparent background if you like. Good for video editors.

  Sizes go from half to double the canvas size.
- **Speed.** Each drawing is rendered once to a bitmap that covers only the
  area it touches; bitmaps are kept within a memory budget and their canvases
  reused. Frames that show the same drawings as the last one (held drawings,
  animation on twos) aren't redrawn. Saving only writes the drawings that
  changed, to the browser and to a linked file.
- **Storage.** The project autosaves to IndexedDB after every change, one record per drawing. In Chrome and Edge, *Save to
  file…* (or *Open from file…*) links the animation to a file on disk, and every
  change after that also saves to that file. Elsewhere, saving downloads a copy.

## Panels

Drag the thin line on the edge of the tools, layers panel or timeline to resize it. Double-click the line, or use its arrow button, to hide that panel; click the strip left behind to bring it back. Sizes are remembered in this browser. The tool settings bar under the top bar hides the same way, and Tab hides or shows everything at once.

On a phone or small window the app starts with the layers panel hidden and a short timeline, and the bars scroll sideways instead of wrapping.

## Paint layers

Layers come in two kinds. **Line layers** (the + button) keep every stroke
editable: select, move and resize lines with the Lasso, and the file stays
small. **Paint layers** (the brush button) work like a paint app: whatever you
draw there, brush, shapes, text and fills, becomes pixels, and the eraser
really removes paint. On a paint layer the Lasso selects an area of pixels:
drag it to move, drag a corner to resize, or Flip, Duplicate or Delete it.
Paint can't be copied to another frame yet; Duplicate repeats a paint drawing.

**Smudge** (U) drags colours into each other and **Blur** (J) softens paint
under the brush; both work on paint layers, with their own size and strength.

**Alpha lock** (in the layer settings) keeps new paint to where the layer
already has paint, for shading and recolouring without going over the edges.
The eraser still erases. It works on line layers too: new lines only show
where the drawing already has lines or fills. There they stay separate strokes,
clipped to whatever is under them, so select both when you move them.

## iPad and Apple Pencil

Open the app in Safari, then *Share → Add to Home Screen* to run it full screen
like an app.

- **Pencil draws, fingers move.** Until a pencil is used, a finger draws. Once
  it has been, one finger pans, two fingers pinch to zoom and rotate, and a hand
  resting on the screen while the pencil draws is ignored. Change it with
  *Fingers* in the ⋯ menu.
- **Two-finger tap** undoes, **three-finger tap** redoes.
- **Press and hold** does what a right-click does: the frame menu on the
  timeline, removing a camera key or a palette colour.
- The brush outline follows the pencil while it hovers (iPad Pro with
  Apple Pencil 2 or Pro).
- Exports have a *Share…* button for saving to Photos or Files, or sending to
  another app.

## Shortcuts

These are the starting keys. *Keyboard shortcuts…* in the ⋯ menu (or ?) lists
them all and lets you change them; your keys are kept in this browser.

| Key | Action |
| --- | --- |
| Space | Tap to play / pause, hold and drag to pan the canvas |
| Tab | Hide or show the tools, layers and timeline panels |
| ← / → or , / . | Previous / next frame |
| Home / End | First / last frame |
| B / E | Brush / eraser |
| L / R / C | Line / rectangle / ellipse (hold Shift for 45°, square, circle) |
| G | Fill bucket (solid or gradient) |
| T | Text |
| I | Eyedropper (or Alt+click with a drawing tool) |
| S | Lasso select: drag to move, corners to resize, Delete to remove, Esc to deselect |
| K | Camera (Delete removes the key on this frame) |
| [ / ] | Smaller / bigger size for the current tool (brush, eraser, shapes, Liquify, Smudge, Blur, text) |
| Y | Symmetry: off → left–right → top–bottom → both |
| Shift+R | Rulers and guides on / off |
| N | New drawing after the current one |
| D | Duplicate the current drawing |
| O | Onion skin on / off |
| Ctrl+C / Ctrl+X / Ctrl+V | Copy / cut / paste the selection, or the whole drawing when nothing is selected |
| Ctrl+Z / Ctrl+Shift+Z | Undo / redo |
| + / − or mouse wheel | Zoom in / out (the wheel zooms around the pointer) |
| 0 / 1 | Fit to screen / actual size |
| 4 / 6 / 5 | Rotate the view left / right / straighten it |
| M | Mirror the view (the drawing isn't changed) |
| Middle mouse drag | Pan the canvas |

On a touch screen, pinch with two fingers to zoom, pan and rotate.

In the timeline, click the selected drawing again (or right-click any drawing) for a menu to copy or paste a drawing, insert one to the left or right, duplicate, clear or delete it. Drag a drawing along its layer to move it. Double-click a layer's name (in the timeline or the Layers panel) to rename it, and drag layers up or down in either place to change their order.

## Layout

```
src/
  model/project.ts     data model + pure timeline/layer operations (tested)
  model/history.ts     undo/redo over immutable snapshots
  model/view.ts        canvas zoom / pan / rotation / mirror maths (tested)
  render/render.ts     stroke rendering, bitmap cache, frame compositing, onion skin
  export/gif.ts        GIF export
  storage.ts           IndexedDB autosave, project files
  components/          Stage (canvas + pointer input), Timeline, LayersPanel, ExportDialog
```

## Roadmap

Computer first: the standard tools of a digital 2D animation app.

1. ~~Canvas navigation and copy/paste: zoom, pan, rotate, mirror, fit~~ (done)
2. ~~Brushes: opacity, stabilizer, presets (pencil, ink, marker, soft) and a saved palette~~ (done)
3. ~~Timing: audio track for lip-sync, camera moves, more onion skin controls~~ (done)
4. ~~Layers: groups, blend modes, clipping masks~~ (done)
5. ~~Extras: symmetry, rulers and guides, a reference image layer, text, gradients, custom shortcuts~~ (done)

Next, in this order:

1. ~~More export formats: MP4 video with sound, PNG image sequences~~ (done)
2. ~~Faster with long animations and many layers~~ (done)
3. ~~Ready for iPad and Apple Pencil~~ (done)
4. ~~Published online, so it works without a local copy~~ (done)
5. **Paint layers: pixel layers for painting and real erasing, next to the line layers** (this version)

Importing photos of paper drawings is parked.
