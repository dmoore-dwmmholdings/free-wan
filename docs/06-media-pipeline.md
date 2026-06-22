# 06 — Media Pipeline

Covers scanning, metadata, thumbnails, subtitles, transcoding, and folder-based
auto-categorization. All media tooling is `ffmpeg`/`ffprobe` invoked with
`child_process.spawn(cmd, argvArray)` — **never** a shell string, and **not**
`fluent-ffmpeg` (archived May 2025). Implements FR-06–FR-15, FR-24, FR-29, FR-30.

## 1. Supported inputs

- **Video** (index any, transcode if needed): `.mp4 .m4v .mkv .webm .mov .avi .wmv .flv
  .ts .m2ts .mpg .mpeg .ogv`.
- **Image**: `.jpg .jpeg .png .gif .webp .avif .heic .bmp .tiff`.
- **Subtitle sidecars**: `.srt .vtt .ass .ssa .sub`.
- A configurable ignore list (`config/free-wan.yaml > scan.ignore`) skips hidden files,
  `@eaDir`, `.DS_Store`, partial downloads (`.part`, `.crdownload`), sample files, etc.
- Extension lists are config so the owner can extend them.

## 2. Scan algorithm (FR-06, FR-12, FR-13)

A `scan` job per repository:

1. **Mark phase.** Tentatively flag the repo's existing items as "seen=false".
2. **Walk** the tree breadth-first, skipping ignored paths. For each candidate file:
   - Compute a cheap signature `(rel_path, size, mtime)`.
   - If a `media_items` row exists with the same signature → mark seen, skip (incremental).
   - Else enqueue **probe** for that file (new or changed).
3. **Probe phase** (per file): run `ffprobe`, extract metadata, upsert the `media_items`
   row, derive categories (§4), detect sidecar subtitles (§6), enqueue a **thumbnail** job.
4. **Sweep phase.** Items still "seen=false":
   - If the repository root is reachable but the file is gone → `status = missing`.
   - If the whole repository root is unreachable (drive offline) → set repo `status =
     offline` and mark its items `offline` (do **not** delete — FR-03).
5. **Prune** categories whose `item_count` reached 0; refresh counts and FTS.

Progress (`found`, `indexed`, `failed`) streams over WebSocket `scan:{repoId}` (FR-14).
A per-file probe failure is logged to the job and skipped — never fatal (NFR-05).

**Change detection without a full walk (FR-13):** a `chokidar` watcher per enabled,
online repository debounces filesystem events (add/change/unlink/rename) into incremental
probe/remove operations. A scheduled full rescan (configurable, e.g. nightly) is the
backstop for missed events and offline→online transitions.

## 3. Metadata extraction (FR-07, FR-08)

Single `ffprobe` call per file, JSON out:

```
ffprobe -v error -print_format json -show_format -show_streams -show_chapters <file>
```

Map from the JSON:

- **duration** ← `format.duration` (fallback to video stream duration).
- **container** ← `format.format_name`.
- **video stream**: `codec_name` → `video_codec`, `width`, `height`,
  `avg_frame_rate` → `frame_rate`, `bit_rate`.
- **audio**: count `codec_type=audio` streams → `audio_tracks`; first → `audio_codec`.
- **embedded subtitles**: each `codec_type=subtitle` stream → a `subtitle_tracks` row
  with `kind=embedded`, `stream_index`, `language` (from `tags.language`), `format`
  (`codec_name`); set `has_embedded_subs`.
- **creation time** ← `format.tags.creation_time` when present.

Images use `ffprobe` for `width`/`height`; EXIF capture date and orientation via an EXIF
reader (e.g. `exifr`) → `captured_at`, `orientation` (HEIC/AVIF supported by the bundled
ffmpeg build).

## 4. Auto-categorization from folders (FR-10, FR-11, FR-20)

For an item at `rel_path = "Movies/Action/2021/film.mp4"` in repository `R`:

1. Take directory segments: `["Movies","Action","2021"]` (the filename is excluded).
2. Walk segments left→right, upserting `categories` rows keyed by
   `(repository_id, path)` where `path` is the cumulative join (`Movies`,
   `Movies/Action`, `Movies/Action/2021`), setting `parent_id` and `depth`.
3. Link the item to **every** node in the chain via `media_categories`; mark the deepest
   as `is_leaf=1`.
4. Increment each node's `item_count`.

Effects: filtering by a parent category (`?category=Movies`) includes everything nested
(the item is linked to ancestors, so a single join works); breadcrumb/folder navigation
(FR-20) reads children of a node via `parent_id`; moving a file on disk re-derives the
chain on the next probe and the sweep prunes now-empty nodes (FR-11). Category names feed
the `categories` column of `media_fts` so folder terms are searchable (FR-17).

> Edge cases: collapse consecutive separators; trim whitespace; treat case-insensitively
> for matching but preserve display case from the first occurrence; cap depth (config,
> e.g. 12) to bound pathological trees.

## 5. Thumbnails & scrub sprites (FR-09)

A `thumbnail` job per item, output under `data/thumbs/<id>/`:

- **Video poster** — a frame ~10% into the duration (avoid black intros):
  ```
  ffmpeg -ss <0.1*duration> -i <file> -frames:v 1 -vf "scale=480:-2" -q:v 4 poster.jpg
  ```
- **Scrub sprite** — a tiled sheet of small frames at a fixed interval for seek previews
  (FR-28); store the sheet plus geometry JSON (cols, rows, interval, tile w/h) served by
  `/sprite?meta`:
  ```
  ffmpeg -i <file> -vf "fps=1/<interval>,scale=160:-2,tile=10x10" -q:v 5 sprite.jpg
  ```
- **Image thumbnail** — downscaled, orientation-corrected copy:
  ```
  ffmpeg -i <file> -vf "scale=480:-2" -q:v 4 poster.jpg
  ```
- **Gallery display variants** — generate (or generate on first request and cache) a
  larger web-sized variant for `/raw?w=` (FR-38).

Thumbnails are regenerable assets (NFR-11); a "rebuild thumbnails" admin action re-enqueues
them. Generation is bounded by worker concurrency so a large scan doesn't saturate CPU.

## 6. Subtitles (FR-15, FR-26)

- **Sidecars**: during probe, look for files sharing the video's basename with subtitle
  extensions (e.g. `film.en.srt`, `film.srt`); create `subtitle_tracks` rows with
  `kind=sidecar`, inferring `language` from a `.<lang>.` segment when present.
- **Serving as WebVTT** (`GET /api/media/:id/captions/:trackId.vtt`):
  - `.vtt` sidecar → served directly.
  - `.srt`/`.ass` sidecar or embedded text subtitle → convert to WebVTT on demand and
    cache:
    ```
    ffmpeg -i <file> -map 0:s:<n> -f webvtt -          # embedded stream n
    ffmpeg -i film.srt -f webvtt -                      # sidecar
    ```
  - Image-based subtitle streams (PGS/VOBSUB) are out of scope for v1 (note in UI as
    unavailable rather than failing).

## 7. Playback decisioning (FR-24)

For each video, compute `playback_mode` from a capability matrix and cache it on the row.

| Property | Direct-play OK if | Else |
|----------|-------------------|------|
| Container | `mp4`/`m4v`, `webm`, or `mov` (fragmented) | transcode/remux |
| Video codec | `h264` (≤ High profile), `vp9`, `av1`*, `hevc`* | transcode to `h264` |
| Audio codec | `aac`, `opus`, `mp3` | transcode to `aac` |

\* `av1`/`hevc` direct-play is device-dependent; the client sends capability hints
(`MediaSource.isTypeSupported`) on the playback request so the server can prefer
remux/transcode when the requesting device can't decode. When only the container is wrong
but codecs are fine, prefer a fast **remux** (`-c copy` into fMP4/HLS) over a full
transcode.

## 8. On-the-fly HLS transcode (FR-24, FR-29, FR-30)

When `mode = hls`, the player loads `master.m3u8`; the server ensures a transcode for the
requested item/variant exists and streams segments from `data/hls/<id>/`.

- **Approach**: ffmpeg produces fMP4/HLS with short segments; prioritize the first few
  segments so playback starts within a few seconds (NFR-02). Software baseline:
  ```
  ffmpeg -ss <seek> -i <file> \
    -map 0:v:0 -map 0:a:<track> \
    -c:v libx264 -preset veryfast -crf 20 -maxrate 6M -bufsize 12M \
    -c:a aac -ac 2 -b:a 160k \
    -f hls -hls_time 4 -hls_playlist_type event \
    -hls_segment_type fmp4 -hls_flags independent_segments \
    -hls_segment_filename data/hls/<id>/seg_%05d.m4s data/hls/<id>/index.m3u8
  ```
- **Seeking** while transcoding: support time offset (`-ss`) so the player can start mid-
  file without transcoding everything; the master playlist and segment addressing must
  account for the chosen strategy (single growing rendition for v1; multi-bitrate ladder
  is a later enhancement).
- **Hardware acceleration (FR-29)**: if the host exposes a GPU and the image is built with
  the matching ffmpeg support, select an encoder by config — NVIDIA `h264_nvenc`, Intel
  QSV `h264_qsv`, VAAPI `h264_vaapi` — and fall back to `libx264` on any failure. Config
  key `transcode.hwaccel: auto|nvenc|qsv|vaapi|none`.
- **One job per (item, variant)**; concurrent requests for the same transcode attach to
  the running job rather than starting a second (a small in-memory registry keyed by
  cache path).
- **Caching & eviction (FR-30, NFR-12)**: segments persist under `data/hls/`. A bounded
  LRU (config `transcode.cacheMaxGB`) evicts least-recently-served transcodes; an idle
  transcode process is killed after `transcode.idleTimeoutS`.

## 9. Job types (worker)

| Type | Trigger | Work |
|------|---------|------|
| `scan` | admin / watcher / schedule | walk + enqueue probes + sweep + prune |
| `probe` | scan | ffprobe + upsert + categorize + subtitle detect |
| `thumbnail` | probe / rebuild | poster + sprite + image variants |
| `transcode` | playback request | HLS generation (or remux) |
| `clip_export` | clip export | cut/encode a clip to mp4/gif (FR-43) |

The worker reads from the `jobs` table by priority, runs up to configured concurrency
(separate caps for CPU-heavy `transcode` vs. light jobs), retries transient failures with
backoff, and records `error` on give-up. Playback transcode requests get high priority so
interactive playback isn't blocked behind a big scan.

## 10. Clip export (FR-43)

```
# MP4 (re-encode for frame-accurate trim of arbitrary sources)
ffmpeg -ss <start> -to <end> -i <source> -c:v libx264 -crf 20 -preset veryfast \
  -c:a aac -movflags +faststart data/exports/<clip>.mp4
# GIF (short ranges) via palette for quality
ffmpeg -ss <start> -to <end> -i <source> \
  -vf "fps=15,scale=480:-1:flags=lanczos,palettegen" data/exports/<clip>.png
ffmpeg -ss <start> -to <end> -i <source> -i data/exports/<clip>.png \
  -lavfi "fps=15,scale=480:-1:flags=lanczos[x];[x][1:v]paletteuse" data/exports/<clip>.gif
```

Export is a background job with progress over `job:{id}`; output lands in `data/exports/`
and is offered as a download when ready. Clip *preview* (FR-41) needs no export — it loops
the source over the in/out range using ranged playback in the player.
