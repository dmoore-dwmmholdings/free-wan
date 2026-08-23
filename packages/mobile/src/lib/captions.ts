import { useEffect, useState } from 'react'
import { apiUrl, authHeaders } from './api'

export interface Cue {
  /** Seconds from the start of the media. */
  start: number
  end: number
  text: string
}

/**
 * Parse a WebVTT timestamp. Both `MM:SS.mmm` and `HH:MM:SS.mmm` are legal, and ffmpeg emits
 * the long form, but files that came with the media can use either. Returns null for anything
 * that is not a timestamp, which is how the caller tells a cue header from ordinary text.
 */
export function parseTimestamp(value: string): number | null {
  const m = /^(?:(\d+):)?([0-5]?\d):([0-5]?\d)[.,](\d{1,3})$/.exec(value.trim())
  if (!m) return null
  const [, h, min, s, ms] = m
  return (
    Number(h ?? 0) * 3600 +
    Number(min) * 60 +
    Number(s) +
    // ".5" means half a second, not 5ms, so pad rather than parse as an integer.
    Number(ms!.padEnd(3, '0')) / 1000
  )
}

/** Strip the inline markup WebVTT allows, so the overlay renders words rather than tags. */
function stripTags(line: string): string {
  return line
    .replace(/<[^>]*>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
}

/**
 * Parse WebVTT into cues, sorted by start time.
 *
 * Deliberately forgiving: these files come from someone's media folder or from ffmpeg, not
 * from a validator, and one malformed block should cost that block rather than the whole
 * track. Anything unrecognised is skipped.
 */
export function parseVtt(input: string): Cue[] {
  // Strip a BOM, and accept CRLF — a file authored on Windows is not unusual.
  const text = input.replace(/^﻿/, '').replace(/\r\n?/g, '\n')
  const cues: Cue[] = []

  for (const block of text.split(/\n{2,}/)) {
    const lines = block.split('\n').filter((l) => l.trim() !== '')
    if (lines.length === 0) continue
    // NOTE blocks and the WEBVTT header carry no cues. STYLE and REGION likewise.
    const head = lines[0]!.trim()
    if (/^(WEBVTT|NOTE|STYLE|REGION)\b/.test(head)) continue

    // A cue may open with an identifier line before its timing line.
    const timingIndex = lines.findIndex((l) => l.includes('-->'))
    if (timingIndex === -1) continue

    const [rawStart, rest] = lines[timingIndex]!.split('-->')
    if (rest === undefined) continue
    // Cue settings (align, line, position) follow the end time on the same line.
    const rawEnd = rest.trim().split(/\s+/)[0]
    const start = parseTimestamp(rawStart!)
    const end = rawEnd ? parseTimestamp(rawEnd) : null
    if (start === null || end === null) continue
    // A cue that ends before it starts would either never show or never hide.
    if (end <= start) continue

    const body = lines
      .slice(timingIndex + 1)
      .map(stripTags)
      .join('\n')
      .trim()
    if (body === '') continue

    cues.push({ start, end, text: body })
  }

  return cues.sort((a, b) => a.start - b.start)
}

/**
 * The cue to show at `time`, or null. Cues can overlap, so the latest one to have started
 * wins — that is what makes a speaker label followed by their line read correctly rather than
 * showing the label for the whole exchange.
 */
export function cueAt(cues: Cue[], time: number): Cue | null {
  let found: Cue | null = null
  for (const cue of cues) {
    // Sorted by start, so once a cue starts after `time` nothing later can match.
    if (cue.start > time) break
    if (time < cue.end) found = cue
  }
  return found
}

/** Fetch and parse a caption track. Returns [] until it loads, and on failure. */
export function useCaptionCues(path: string | null): Cue[] {
  const [cues, setCues] = useState<Cue[]>([])

  useEffect(() => {
    let cancelled = false
    if (!path) {
      setCues([])
      return
    }
    void (async () => {
      try {
        const [url, headers] = await Promise.all([apiUrl(path), authHeaders()])
        const res = await fetch(url, { headers })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const parsed = parseVtt(await res.text())
        if (!cancelled) setCues(parsed)
      } catch {
        // Captions failing is not a reason to interrupt playback; the video plays without
        // them and the button simply shows nothing.
        if (!cancelled) setCues([])
      }
    })()
    return () => {
      cancelled = true
    }
  }, [path])

  return cues
}
