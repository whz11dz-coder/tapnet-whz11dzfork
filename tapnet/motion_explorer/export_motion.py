# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#    http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
# ==============================================================================

"""Exports a video as a Motion Explorer clip.

Pipeline:
  1. Track a semi-dense grid of points with TAPNext++ (online, per frame).
     Grids are queried on several evenly spaced frames, so regions that enter
     the view later are covered too.
  2. Estimate camera motion as per-frame homographies with
     `viz_utils.get_homographies_wrt_frame` (the method behind the TAPIR
     rainbow demo) and split tracks into background and foreground.
  3. Write JPEG frames and a compact `motion.json` that the static page in
     `web/` renders.

Example:
  python3 -m tapnet.motion_explorer.export_motion \
      --video horsejump-high.mp4 \
      --checkpoint checkpoints/tapnextpp_ckpt.pt \
      --out_dir tapnet/motion_explorer/web/data/horsejump \
      --title "Horse jump"
"""

import argparse
import base64
import contextlib
import io
import json
import pathlib
import time

import cv2
import numpy as np
from tapnet.tapnextpp.votsp2026 import model as tapnextpp_model
from tapnet.tapnextpp.votsp2026 import utils as tapnextpp_utils
from tapnet.utils import viz_utils
import torch

MODEL_SIZE = tapnextpp_model.TAPNextPP.MODEL_SIZE
FORMAT_VERSION = 1


def read_frames(path, max_frames, max_width):
  """Reads a video as a list of BGR uint8 frames, downscaled to max_width."""
  cap = cv2.VideoCapture(str(path))
  if not cap.isOpened():
    raise FileNotFoundError(f'Cannot open video: {path}')
  fps = cap.get(cv2.CAP_PROP_FPS) or 10.0
  frames = []
  while max_frames <= 0 or len(frames) < max_frames:
    ok, frame = cap.read()
    if not ok:
      break
    h, w = frame.shape[:2]
    if w > max_width:
      new_h = int(round(h * max_width / w / 2)) * 2
      frame = cv2.resize(
          frame, (max_width, new_h), interpolation=cv2.INTER_AREA
      )
    frames.append(frame)
  cap.release()
  if len(frames) < 2:
    raise ValueError(f'Video has fewer than 2 frames: {path}')
  return frames, fps


def grid_queries(query_frames, height, width, stride):
  """Returns [Q, 3] queries in (t, x, y) display coordinates."""
  ys = np.arange(stride / 2, height, stride)
  xs = np.arange(stride / 2, width, stride)
  gx, gy = np.meshgrid(xs, ys)
  grid = np.stack([gx.ravel(), gy.ravel()], axis=-1)
  queries = [
      np.concatenate([np.full((len(grid), 1), t), grid], axis=-1)
      for t in query_frames
  ]
  return np.concatenate(queries, axis=0).astype(np.float32)


@torch.no_grad()
def track(net, frames, queries, device):
  """Tracks queries online with TAPNext++.

  Args:
    net: The inner `TAPNext` module.
    frames: List of [H, W, 3] uint8 BGR frames.
    queries: [Q, 3] float32 (t, x, y) queries in display pixels.
    device: Torch device.

  Returns:
    tracks: [Q, T, 2] float32 (x, y) positions in display pixels.
    visible: [Q, T] bool.
  """
  h, w = frames[0].shape[:2]
  model_xy = tapnextpp_utils.display_to_model(queries[:, 1:], h, w, MODEL_SIZE)
  q = np.stack([queries[:, 0], model_xy[:, 1], model_xy[:, 0]], axis=-1)
  q = torch.from_numpy(q).to(device).unsqueeze(0)  # [1, Q, 3] in (t, y, x)

  ctx = (
      torch.amp.autocast('cuda', dtype=torch.float16)
      if device.type == 'cuda'
      else contextlib.nullcontext()
  )
  tracks, visible = [], []
  state = None
  start = time.time()
  for t, frame in enumerate(frames):
    video = tapnextpp_utils.preprocess_frame(frame, device, MODEL_SIZE)
    with ctx:
      pos, _, vis_logits, state = net(
          video=video, query_points=q if state is None else None, state=state
      )
    pos_xy = pos[0, 0].float().cpu().numpy()[:, ::-1]
    tracks.append(tapnextpp_utils.model_to_display(pos_xy, h, w, MODEL_SIZE))
    visible.append((vis_logits[0, 0, :, 0] > 0).cpu().numpy())
    if (t + 1) % 10 == 0 or t + 1 == len(frames):
      elapsed = time.time() - start
      eta = elapsed / (t + 1) * (len(frames) - t - 1)
      print(
          f'  frame {t + 1}/{len(frames)}  {elapsed:.0f}s elapsed,'
          f' ~{eta:.0f}s left',
          flush=True,
      )
  tracks = np.stack(tracks, axis=1)
  visible = np.stack(visible, axis=1)
  # A query has no meaningful position before the frame it was placed on.
  visible &= np.arange(len(frames))[None, :] >= queries[:, :1].astype(int)
  return tracks, visible


def drop_duplicate_queries(queries, tracks, visible, radius):
  """Drops later queries that land on a point already tracked at that frame."""
  keep = np.ones(len(queries), dtype=bool)
  query_frames = np.unique(queries[:, 0]).astype(int)
  for t in query_frames[1:]:
    late = np.flatnonzero(queries[:, 0] == t)
    earlier = np.flatnonzero((queries[:, 0] < t) & keep & visible[:, t])
    if not len(earlier):
      continue
    d = np.linalg.norm(
        queries[late, None, 1:] - tracks[None, earlier, t], axis=-1
    )
    keep[late[d.min(axis=1) < radius]] = False
  return keep


def b64(array):
  return base64.b64encode(np.ascontiguousarray(array).tobytes()).decode('ascii')


def main():
  parser = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
  parser.add_argument('--video', required=True)
  parser.add_argument('--checkpoint', required=True, help='tapnextpp_ckpt.pt')
  parser.add_argument('--out_dir', required=True)
  parser.add_argument('--title', default=None)
  parser.add_argument('--max_frames', type=int, default=0, help='0 = all')
  parser.add_argument('--max_width', type=int, default=854)
  parser.add_argument(
      '--stride', type=int, default=20, help='Grid spacing in pixels.'
  )
  parser.add_argument(
      '--num_query_frames',
      type=int,
      default=3,
      help='Number of evenly spaced frames that receive a query grid.',
  )
  parser.add_argument('--min_track_len', type=int, default=4)
  parser.add_argument('--jpeg_quality', type=int, default=82)
  parser.add_argument('--device', default='auto')
  # Defaults below follow colabs/tapir_rainbow_demo.ipynb.
  parser.add_argument('--ransac_inlier_threshold', type=float, default=0.07)
  parser.add_argument('--ransac_track_inlier_frac', type=float, default=0.95)
  parser.add_argument('--num_refinement_passes', type=int, default=2)
  parser.add_argument('--foreground_inlier_threshold', type=float, default=0.07)
  parser.add_argument('--foreground_frac', type=float, default=0.6)
  args = parser.parse_args()

  out_dir = pathlib.Path(args.out_dir)
  clip_id = out_dir.name
  if args.device == 'auto':
    device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
  else:
    device = torch.device(args.device)

  frames, fps = read_frames(args.video, args.max_frames, args.max_width)
  num_frames = len(frames)
  h, w = frames[0].shape[:2]
  print(f'{num_frames} frames, {w}x{h}, {fps:g} fps, device: {device}')

  net = tapnextpp_model.TAPNextPP.from_checkpoint(
      args.checkpoint, device=device
  )._model
  query_frames = np.unique(
      np.linspace(0, num_frames, args.num_query_frames, endpoint=False).astype(
          int
      )
  )
  queries = grid_queries(query_frames, h, w, args.stride)
  print(
      f'Tracking {len(queries)} points queried on frames'
      f' {query_frames.tolist()}'
  )
  tracks, visible = track(net, frames, queries, device)

  keep = drop_duplicate_queries(queries, tracks, visible, args.stride / 2)
  keep &= visible.sum(axis=1) >= args.min_track_len
  queries, tracks, visible = queries[keep], tracks[keep], visible[keep]
  print(f'Kept {len(queries)} tracks')

  print('Estimating camera motion...')
  occluded = 1.0 - visible.astype(np.float32)
  with contextlib.redirect_stdout(io.StringIO()):
    homogs, err, canonical = viz_utils.get_homographies_wrt_frame(
        tracks,
        occluded,
        [w, h],
        thresh=args.ransac_inlier_threshold,
        outlier_point_threshold=args.ransac_track_inlier_frac,
        num_refinement_passes=args.num_refinement_passes,
    )
  homogs, err, canonical = map(np.asarray, (homogs, err, canonical))
  inliers = (err < np.square(args.foreground_inlier_threshold)) & visible
  bg_ratio = inliers.sum(axis=1) / np.maximum(1, visible.sum(axis=1))
  num_fg = int((bg_ratio <= args.foreground_frac).sum())
  print(f'{num_fg} of {len(queries)} tracks move on their own (foreground)')

  frames_dir = out_dir / 'frames'
  frames_dir.mkdir(parents=True, exist_ok=True)
  for old in frames_dir.glob('*.jpg'):
    old.unlink()
  for t, frame in enumerate(frames):
    cv2.imwrite(
        str(frames_dir / f'{t:05d}.jpg'),
        frame,
        [cv2.IMWRITE_JPEG_QUALITY, args.jpeg_quality],
    )

  homogs = homogs / homogs[:, 2:3, 2:3]
  version = time.strftime('%Y%m%d%H%M%S')
  motion = {
      'format': FORMAT_VERSION,
      'version': version,
      'title': args.title or clip_id,
      'source': pathlib.Path(args.video).name,
      'width': w,
      'height': h,
      'fps': fps,
      'numFrames': num_frames,
      'numTracks': len(queries),
      'framePattern': 'frames/{t:05d}.jpg',
      # [Q, T, 2] int16, (x, y) in quarter pixels.
      'tracks': b64(np.clip(np.round(tracks * 4), -32768, 32767).astype('<i2')),
      # [Q, T] uint8, 1 = visible.
      'visible': b64(visible.astype(np.uint8)),
      # [Q] uint16, frame the point was queried on.
      'queryFrame': b64(queries[:, 0].astype('<u2')),
      # [Q] uint8, fraction of visible frames that follow the camera, * 255.
      'backgroundRatio': b64(np.round(bg_ratio * 255).astype(np.uint8)),
      # [Q, 2] float32, position in the canonical frame, normalized to [0, 1].
      'canonical': b64(canonical.astype('<f4')),
      # [T][9] row-major; inv(H[i]) @ H[j] maps background from frame j to i.
      'homographies': np.round(homogs.reshape(num_frames, 9), 9).tolist(),
      'params': {
          'model': 'TAPNext++',
          'stride': args.stride,
          'queryFrames': query_frames.tolist(),
          'ransacInlierThreshold': args.ransac_inlier_threshold,
          'ransacTrackInlierFrac': args.ransac_track_inlier_frac,
          'foregroundInlierThreshold': args.foreground_inlier_threshold,
          'foregroundFrac': args.foreground_frac,
      },
  }
  (out_dir / 'motion.json').write_text(
      json.dumps(motion, separators=(',', ':'))
  )

  manifest_path = out_dir.parent / 'manifest.json'
  manifest = {'clips': []}
  if manifest_path.exists():
    manifest = json.loads(manifest_path.read_text())
  manifest['clips'] = [c for c in manifest['clips'] if c['id'] != clip_id]
  manifest['clips'].append({
      'id': clip_id,
      'title': motion['title'],
      'path': f'{clip_id}/',
      'version': version,
  })
  manifest_path.write_text(
      json.dumps(manifest, indent=2, ensure_ascii=False) + '\n'
  )
  print(f'Wrote {out_dir} (version {version})')


if __name__ == '__main__':
  main()
