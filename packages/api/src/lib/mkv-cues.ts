import { open, type FileHandle } from 'node:fs/promises'

// Reads a Matroska file's keyframe index (its Cues) without reading the media: a few small
// reads near the start for the layout, then the Cues element itself, usually at the end.

const ID = {
  segment: 0x18538067,
  seekHead: 0x114d9b74,
  seek: 0x4dbb,
  seekId: 0x53ab,
  seekPosition: 0x53ac,
  info: 0x1549a966,
  timecodeScale: 0x2ad7b1,
  tracks: 0x1654ae6b,
  trackEntry: 0xae,
  trackNumber: 0xd7,
  trackType: 0x83,
  cues: 0x1c53bb6b,
  cuePoint: 0xbb,
  cueTime: 0xb3,
  cueTrackPositions: 0xb7,
  cueTrack: 0xf7,
} as const

/** Past this the Cues are not worth reading at play time. */
const MAX_CUES_BYTES = 32 * 1024 * 1024

interface Element {
  id: number
  /** Where the element's data starts and its length; size is null when unknown. */
  dataStart: number
  size: number | null
}

/** Reads an element header at `pos` within `buf`; null when it runs past the buffer. */
function header(buf: Buffer, pos: number, base: number): Element | null {
  const first = buf[pos]
  if (first === undefined || first === 0) return null
  const idLen = Math.clz32(first) - 23
  if (idLen > 4 || pos + idLen > buf.length) return null
  let id = 0
  for (let i = 0; i < idLen; i++) id = id * 256 + buf[pos + i]!
  const sizeFirst = buf[pos + idLen]
  if (sizeFirst === undefined || sizeFirst === 0) return null
  const sizeLen = Math.clz32(sizeFirst) - 23
  if (pos + idLen + sizeLen > buf.length) return null
  let size = sizeFirst & (0xff >> sizeLen)
  let allOnes = size === 0xff >> sizeLen
  for (let i = 1; i < sizeLen; i++) {
    const b = buf[pos + idLen + i]!
    size = size * 256 + b
    allOnes &&= b === 0xff
  }
  return { id, dataStart: base + pos + idLen + sizeLen, size: allOnes ? null : size }
}

/** The direct children of the element data in `buf` (offsets in `buf` start at `base`). */
function children(buf: Buffer, base: number): Element[] {
  const out: Element[] = []
  let pos = 0
  while (pos < buf.length) {
    const el = header(buf, pos, base)
    if (!el || el.size === null) break
    out.push(el)
    pos = el.dataStart - base + el.size
  }
  return out
}

function uint(buf: Buffer, el: Element, base: number): number {
  let v = 0
  for (let i = 0; i < (el.size ?? 0); i++) v = v * 256 + buf[el.dataStart - base + i]!
  return v
}

async function read(file: FileHandle, position: number, length: number): Promise<Buffer> {
  const buf = Buffer.alloc(length)
  const { bytesRead } = await file.read(buf, 0, length, position)
  return buf.subarray(0, bytesRead)
}

/** Reads a whole element whose header starts at `position`. */
async function readElement(file: FileHandle, position: number, expectId: number): Promise<{ el: Element; data: Buffer } | null> {
  const head = header(await read(file, position, 12), 0, position)
  if (!head || head.id !== expectId || head.size === null || head.size > MAX_CUES_BYTES) return null
  return { el: head, data: await read(file, head.dataStart, head.size) }
}

/**
 * The video keyframe times listed in a Matroska file's Cues, in seconds and ascending, or null
 * when the file has no usable index.
 */
export async function mkvKeyframes(absPath: string): Promise<number[] | null> {
  const file = await open(absPath, 'r')
  try {
    const start = await read(file, 0, 64 * 1024)
    // EBML header, then the Segment, whose child positions are relative to its data start.
    const ebml = header(start, 0, 0)
    if (!ebml || ebml.id !== 0x1a45dfa3 || ebml.size === null) return null
    const segment = header(start, ebml.dataStart + ebml.size, 0)
    if (!segment || segment.id !== ID.segment) return null
    const segmentStart = segment.dataStart

    // The SeekHead says where the other top-level elements are.
    const positions = new Map<number, number>()
    const firstChild = header(start, segmentStart, 0)
    if (!firstChild || firstChild.id !== ID.seekHead || firstChild.size === null) return null
    const seekHead = start.subarray(firstChild.dataStart, firstChild.dataStart + firstChild.size)
    for (const seek of children(seekHead, firstChild.dataStart)) {
      if (seek.id !== ID.seek || seek.size === null) continue
      const body = start.subarray(seek.dataStart, seek.dataStart + seek.size)
      let target = 0
      let at = -1
      for (const f of children(body, seek.dataStart)) {
        if (f.id === ID.seekId) target = uint(start, f, 0)
        if (f.id === ID.seekPosition) at = uint(start, f, 0)
      }
      if (target && at >= 0) positions.set(target, segmentStart + at)
    }

    const cuesAt = positions.get(ID.cues)
    const tracksAt = positions.get(ID.tracks)
    if (cuesAt === undefined || tracksAt === undefined) return null

    let scale = 1_000_000 // TimecodeScale default: milliseconds
    const infoAt = positions.get(ID.info)
    if (infoAt !== undefined) {
      const info = await readElement(file, infoAt, ID.info)
      for (const f of info ? children(info.data, info.el.dataStart) : []) {
        if (f.id === ID.timecodeScale) scale = uint(info!.data, f, info!.el.dataStart)
      }
    }

    const tracks = await readElement(file, tracksAt, ID.tracks)
    if (!tracks) return null
    let videoTrack: number | undefined
    for (const entry of children(tracks.data, tracks.el.dataStart)) {
      if (entry.id !== ID.trackEntry || entry.size === null) continue
      const body = tracks.data.subarray(entry.dataStart - tracks.el.dataStart, entry.dataStart - tracks.el.dataStart + entry.size)
      let number: number | undefined
      let type: number | undefined
      for (const f of children(body, entry.dataStart)) {
        if (f.id === ID.trackNumber) number = uint(tracks.data, f, tracks.el.dataStart)
        if (f.id === ID.trackType) type = uint(tracks.data, f, tracks.el.dataStart)
      }
      if (type === 1 && number !== undefined) {
        videoTrack = number
        break
      }
    }
    if (videoTrack === undefined) return null

    const cues = await readElement(file, cuesAt, ID.cues)
    if (!cues) return null
    const base = cues.el.dataStart
    const times: number[] = []
    for (const point of children(cues.data, base)) {
      if (point.id !== ID.cuePoint || point.size === null) continue
      const body = cues.data.subarray(point.dataStart - base, point.dataStart - base + point.size)
      let time: number | undefined
      let video = false
      for (const f of children(body, point.dataStart)) {
        if (f.id === ID.cueTime) time = uint(cues.data, f, base)
        if (f.id === ID.cueTrackPositions && f.size !== null) {
          const pos = cues.data.subarray(f.dataStart - base, f.dataStart - base + f.size)
          for (const g of children(pos, f.dataStart)) {
            if (g.id === ID.cueTrack && uint(cues.data, g, base) === videoTrack) video = true
          }
        }
      }
      if (video && time !== undefined) times.push((time * scale) / 1e9)
    }
    times.sort((a, b) => a - b)
    return times.length > 0 ? times : null
  } catch {
    return null
  } finally {
    await file.close()
  }
}
