# Motion Explorer

An interactive, static web page for exploring point tracks in a video. It
combines two things from this repository:

* **Dense point tracking** with the TAPNext++ checkpoint
  (`tapnet/tapnextpp`), run online, frame by frame.
* **Camera motion removal** from the TAPIR rainbow demo
  (`colabs/tapir_rainbow_demo.ipynb`): per-frame homographies estimated with
  `viz_utils.get_homographies_wrt_frame`, which also split tracks into
  background (moves with the camera) and foreground (moves on its own).

The page has two views:

* **On screen**: raw tracks with fading trails, as the camera saw them.
* **In space**: trails are re-projected through the homographies, so earlier
  positions stay where they were in the scene. The background collapses to
  still dots and only the object's own motion is left.

Drag across the video to select points and see their whole path, including
where they go next. Sliders control trail length, the object/background split
and the brush size. The interface is in Polish and English.

## 1. Export a clip

Tracking runs offline. A GPU is optional: on a 4-core CPU TAPNext++ needs about
2.4 s per frame for 300 points and about 8 s per frame for the default ~3,100
queries, so the 50-frame sample clip takes about 7 minutes. Lower the cost with
a larger `--stride` or fewer `--num_query_frames`.

```bash
pip install . torch torchvision
wget -P checkpoints https://storage.googleapis.com/dm-tapnet/tapnextpp/tapnextpp_ckpt.pt
wget https://storage.googleapis.com/dm-tapnet/horsejump-high.mp4

python3 -m tapnet.motion_explorer.export_motion \
    --video horsejump-high.mp4 \
    --checkpoint checkpoints/tapnextpp_ckpt.pt \
    --out_dir tapnet/motion_explorer/web/data/horsejump \
    --title "Horse jump" \
    --credit "horsejump-high, DAVIS (davischallenge.org)"
```

This writes `web/data/horsejump/frames/*.jpg`, `web/data/horsejump/motion.json`
and adds the clip to `web/data/manifest.json`. Run it again with another
`--out_dir` to add more clips; the page shows a clip picker when there is more
than one.

Useful flags:

| Flag | Default | Meaning |
| :--- | :---: | :--- |
| `--max_frames` | all | Trim long videos. Keep clips short (≤ 150 frames) for the web. |
| `--max_width` | 854 | Output frame width in pixels. |
| `--stride` | 20 | Grid spacing in pixels. |
| `--num_query_frames` | 3 | Frames that receive a query grid, so new regions are covered. |
| `--foreground_frac` | 0.6 | Default object/background split (also adjustable on the page). |

Camera motion is modelled as a homography, so the "In space" view assumes the
camera rotates or zooms without moving much, or that the background is roughly
planar. A handheld walk through a deep scene will leave residual drift.

## 2. View it

`fetch()` does not work on `file://` URLs, so serve the folder:

```bash
cd tapnet/motion_explorer/web
python3 -m http.server 8000
# open http://localhost:8000
```

To put it on a website, upload the whole `web/` folder (the page plus `data/`).

### Embedding in another site

The viewer is a self-contained component: `motion-explorer.css` (every rule is
scoped to `.motion-explorer`, every class, id and custom property starts with
`me-`) and `motion-explorer.js`. To place it in an existing page:

1. Copy the `<div class="motion-explorer">…</div>` block from `index.html`.
2. Set `data-root` to the URL of the folder with `manifest.json`, and
   optionally `data-lang="pl"` or `data-lang="en"` to fix the language.
3. Load `motion-explorer.css` and `motion-explorer.js` with a `?v=` version.
4. Define the `--me-*` colour tokens on `.motion-explorer`, for example by
   mapping them onto the site's own variables. Leave the `--me-f-*` font
   tokens undefined to inherit the site's fonts.
The page has no build step and makes no third-party requests: its fonts
(Bricolage Grotesque, Instrument Sans, JetBrains Mono; SIL OFL 1.1, see
`web/fonts/OFL.txt`) are served from `web/fonts/`. `--credit` adds a footage
credit to the page footer; use your own footage, or check the licence of the
clip you export, before publishing.

## Caching

* Data files are requested with `?v=<version>`, where the version is the
  export timestamp stored in `manifest.json`. Re-exporting a clip therefore
  invalidates cached frames and tracks automatically.
* `manifest.json` itself is requested with `cache: 'no-cache'` and
  `?v=APP_VERSION`.
* Font files are requested without a version; give them a new file name if
  they ever change.
* After any change to the component, bump `APP_VERSION` near the top of
  `motion-explorer.js` and the `?v=` of the tags that load
  `motion-explorer.css` and `motion-explorer.js`. The version is also shown in
  the component's credits, so you can tell which one a browser has loaded.

## `motion.json` format

| Field | Type | Meaning |
| :--- | :--- | :--- |
| `width`, `height`, `fps`, `numFrames`, `numTracks` | number | Clip metadata. |
| `framePattern` | string | Frame file name, `{t:05d}` is the frame index. |
| `tracks` | base64 int16 `[Q, T, 2]` | (x, y) in quarter pixels. |
| `visible` | base64 uint8 `[Q, T]` | 1 when the point is visible. |
| `queryFrame` | base64 uint16 `[Q]` | Frame the point was queried on. |
| `backgroundRatio` | base64 uint8 `[Q]` | Share of visible frames that follow the camera, × 255. |
| `canonical` | base64 float32 `[Q, 2]` | Position in the canonical frame, used for colours. |
| `homographies` | `[T][9]` | `inv(H[i]) @ H[j]` maps background from frame j to frame i. |
| `params` | object | Settings used for the export. |
