# Animator

A low-friction, frame-by-frame animation app that runs in the browser. Draw on
screen with a mouse, pen tablet or (later) an Apple Pencil, build the scene from
layers that each have their own timing, flip through it with onion skin, and
export a GIF. Photos of paper drawings come next (see the roadmap).

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
- **Onion skin.** Previous drawings show in red, next ones in blue, on the
  selected layer.
- **Export.** GIFs are encoded in the browser with
  [gifenc](https://github.com/mattdesl/gifenc). Held drawings become a single
  GIF frame with a longer delay, so files stay small.
- **Storage.** The project autosaves to IndexedDB.

## Shortcuts

| Key | Action |
| --- | --- |
| Space | Play / pause |
| ← / → or , / . | Previous / next frame |
| Home / End | First / last frame |
| B / E | Brush / eraser |
| [ / ] | Smaller / bigger brush |
| N | New drawing after the current one |
| D | Duplicate the current drawing |
| O | Onion skin on / off |
| Ctrl+Z / Ctrl+Shift+Z | Undo / redo |

## Layout

```
src/
  model/project.ts     data model + pure timeline/layer operations (tested)
  model/history.ts     undo/redo over immutable snapshots
  render/render.ts     stroke rendering, bitmap cache, frame compositing, onion skin
  export/gif.ts        GIF export
  storage.ts           IndexedDB autosave, project files
  components/          Stage (canvas + pointer input), Timeline, LayersPanel, ExportDialog
```

## Roadmap

1. **Draw on screen with layers** (this version)
2. Photos of paper drawings as layers: page detection, flattening, cleanup to line art
3. Alignment with registration marks, MP4 export
4. Live camera capture with onion skin, installable app for iPad
