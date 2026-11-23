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

## How it works

- **Layers and timing.** A scene is a stack of layers. Each layer is a list of
  cels: one drawing held for N frames. A background can be one drawing held to
  the end, while a character layer changes every 2 frames ("on twos").
- **Drawing.** Strokes are stored as points with pressure and rendered with
  [perfect-freehand](https://github.com/steveruizok/perfect-freehand). Pen
  pressure comes from the browser's Pointer Events; mouse strokes simulate it
  from speed (turn off "Pressure" for an even line). The eraser only affects
  the drawing it is used on.
- **Brushes.** Pencil, Ink, Marker and Soft presets set size, opacity,
  smoothing, stabilizer, pressure and edge softness; any of them can be tuned.
  Opacity applies to the whole stroke, so a stroke doesn't darken where it
  crosses itself, while overlapping strokes build up. The stabilizer makes the
  line trail the pointer (shown by an orange string) and catches up when you
  let go. The palette and your last brush are kept in the browser: **+** adds
  the current colour, right-click a swatch to remove it.
- **Tools.** Lines, rectangles and ellipses are stored as shapes; the fill
  bucket stores the filled pixels as runs and paints them under the lines of
  the same drawing; the lasso selects whole strokes and moves/resizes them by
  giving each stroke a transform.
- **Onion skin.** Previous drawings show in red, next ones in blue (up to 5
  each way). The Layers panel sets their colours, strength, and whether they
  show on the selected layer or on every unlocked layer.
- **Layer groups, blend modes, clipping.** *Group* puts the selected layer in
  a folder; drag layers into or out of it, or drag the folder to move them
  all. A group shows, hides, locks, fades and blends as one. Each layer and
  group has a blend mode (Multiply for shadows, Screen/Add for light, …), and
  *Clip to layer below* shows a layer only where the layer under it has paint
  (colour and shading inside the lines).
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
- **Export.** GIFs are encoded in the browser with
  [gifenc](https://github.com/mattdesl/gifenc). Held drawings become a single
  GIF frame with a longer delay, so files stay small.
- **Storage.** The project autosaves to IndexedDB after every change. In Chrome and Edge, *Save to
  file…* (or *Open from file…*) links the animation to a file on disk, and every
  change after that also saves to that file. Elsewhere, saving downloads a copy.

## Panels

Drag the thin line on the edge of the tools, layers panel or timeline to resize it. Double-click the line, or use its arrow button, to hide that panel; click the strip left behind to bring it back. Sizes are remembered in this browser.

## Shortcuts

| Key | Action |
| --- | --- |
| Space | Tap to play / pause, hold and drag to pan the canvas |
| Tab | Hide or show the tools, layers and timeline panels |
| ← / → or , / . | Previous / next frame |
| Home / End | First / last frame |
| B / E | Brush / eraser |
| L / R / C | Line / rectangle / ellipse (hold Shift for 45°, square, circle) |
| G | Fill bucket |
| I | Eyedropper (or Alt+click with a drawing tool) |
| S | Lasso select: drag to move, corners to resize, Delete to remove, Esc to deselect |
| K | Camera (Delete removes the key on this frame) |
| [ / ] | Smaller / bigger brush |
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
4. **Layers: groups, blend modes, clipping masks** (this version)
5. Extras: text, gradients, symmetry, rulers and guides, a reference image layer, custom shortcuts

Later: MP4 export and an installable app for iPad. Importing photos of paper drawings is parked.
