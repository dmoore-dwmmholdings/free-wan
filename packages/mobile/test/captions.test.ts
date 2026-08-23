import { describe, expect, it } from 'vitest'
import { cueAt, parseTimestamp, parseVtt } from '@/lib/captions'

const SIMPLE = `WEBVTT

00:00:01.000 --> 00:00:04.000
Hello there.

00:00:05.500 --> 00:00:08.250
General Kenobi.
`

describe('parsing WebVTT timestamps', () => {
  it('reads the long form ffmpeg emits', () => {
    expect(parseTimestamp('01:02:03.400')).toBeCloseTo(3723.4)
  })

  it('reads the short form, which is also legal', () => {
    expect(parseTimestamp('02:03.400')).toBeCloseTo(123.4)
  })

  it('treats a short fraction as a fraction, not milliseconds', () => {
    // ".5" is half a second. Parsing it as 5ms would drift subtitles by most of a second.
    expect(parseTimestamp('00:00:10.5')).toBeCloseTo(10.5)
    expect(parseTimestamp('00:00:10.05')).toBeCloseTo(10.05)
  })

  it('accepts the comma some files use for the decimal mark', () => {
    expect(parseTimestamp('00:00:10,500')).toBeCloseTo(10.5)
  })

  it('rejects text that is not a timestamp', () => {
    expect(parseTimestamp('Hello there.')).toBeNull()
    expect(parseTimestamp('')).toBeNull()
  })
})

describe('parsing a WebVTT file', () => {
  it('reads cues with their times and text', () => {
    expect(parseVtt(SIMPLE)).toEqual([
      { start: 1, end: 4, text: 'Hello there.' },
      { start: 5.5, end: 8.25, text: 'General Kenobi.' },
    ])
  })

  it('handles CRLF and a byte-order mark', () => {
    const windows = '﻿' + SIMPLE.replace(/\n/g, '\r\n')
    expect(parseVtt(windows)).toHaveLength(2)
  })

  it('keeps a cue that has an identifier line before its timing', () => {
    const withIds = `WEBVTT

cue-1
00:00:01.000 --> 00:00:02.000
Line.
`
    expect(parseVtt(withIds)).toEqual([{ start: 1, end: 2, text: 'Line.' }])
  })

  it('ignores NOTE, STYLE and REGION blocks', () => {
    const noisy = `WEBVTT

NOTE this is a comment
that runs on

STYLE
::cue { color: white }

00:00:01.000 --> 00:00:02.000
Real line.
`
    expect(parseVtt(noisy)).toEqual([{ start: 1, end: 2, text: 'Real line.' }])
  })

  it('joins a multi-line cue and strips inline markup', () => {
    const styled = `WEBVTT

00:00:01.000 --> 00:00:03.000
<v Speaker>First line</v>
<i>second line</i>
`
    expect(parseVtt(styled)[0]!.text).toBe('First line\nsecond line')
  })

  it('decodes the entities WebVTT requires to be escaped', () => {
    const escaped = `WEBVTT

00:00:01.000 --> 00:00:02.000
5 &lt; 6 &amp; 7 &gt; 6
`
    expect(parseVtt(escaped)[0]!.text).toBe('5 < 6 & 7 > 6')
  })

  it('ignores cue settings that follow the end time', () => {
    const positioned = `WEBVTT

00:00:01.000 --> 00:00:02.000 align:start position:10%
Line.
`
    expect(parseVtt(positioned)).toEqual([{ start: 1, end: 2, text: 'Line.' }])
  })

  it('drops a malformed block without losing the rest of the file', () => {
    // One bad block should cost that block, not the whole track — these files come from
    // someone's media folder, not from a validator.
    const broken = `WEBVTT

00:00:01.000 --> 00:00:02.000
Good one.

not a timestamp at all
Orphan text.

00:00:09.000 --> 00:00:04.000
Ends before it starts.

00:00:10.000 --> 00:00:11.000
Good two.
`
    expect(parseVtt(broken).map((c) => c.text)).toEqual(['Good one.', 'Good two.'])
  })

  it('returns nothing for an empty or header-only file', () => {
    expect(parseVtt('')).toEqual([])
    expect(parseVtt('WEBVTT\n')).toEqual([])
  })

  it('sorts cues by start time even when the file does not', () => {
    const unsorted = `WEBVTT

00:00:10.000 --> 00:00:11.000
Second.

00:00:01.000 --> 00:00:02.000
First.
`
    expect(parseVtt(unsorted).map((c) => c.text)).toEqual(['First.', 'Second.'])
  })
})

describe('choosing the cue for a moment', () => {
  const cues = parseVtt(SIMPLE)

  it('shows nothing before the first cue or in a gap', () => {
    expect(cueAt(cues, 0)).toBeNull()
    expect(cueAt(cues, 4.5)).toBeNull()
    expect(cueAt(cues, 99)).toBeNull()
  })

  it('shows the cue covering the moment', () => {
    expect(cueAt(cues, 1)?.text).toBe('Hello there.')
    expect(cueAt(cues, 3.9)?.text).toBe('Hello there.')
    expect(cueAt(cues, 6)?.text).toBe('General Kenobi.')
  })

  it('treats the end time as exclusive', () => {
    // Checked against a cue with nothing after it: with two adjacent cues the latest-wins
    // rule gives the right answer either way, so that arrangement proves nothing here.
    const single = parseVtt(`WEBVTT

00:00:01.000 --> 00:00:02.000
First.
`)
    expect(cueAt(single, 1.999)?.text).toBe('First.')
    expect(cueAt(single, 2)).toBeNull()
  })

  it('hands over cleanly between two adjacent cues', () => {
    const adjacent = parseVtt(`WEBVTT

00:00:01.000 --> 00:00:02.000
First.

00:00:02.000 --> 00:00:03.000
Second.
`)
    expect(cueAt(adjacent, 1.9)?.text).toBe('First.')
    expect(cueAt(adjacent, 2)?.text).toBe('Second.')
  })

  it('prefers the latest cue to have started when cues overlap', () => {
    // A speaker label often overlaps the line that follows it. Showing the label for the
    // whole exchange would be wrong.
    const overlapping = parseVtt(`WEBVTT

00:00:01.000 --> 00:00:10.000
Label.

00:00:02.000 --> 00:00:04.000
The actual line.
`)
    expect(cueAt(overlapping, 3)?.text).toBe('The actual line.')
    expect(cueAt(overlapping, 5)?.text).toBe('Label.')
  })
})
