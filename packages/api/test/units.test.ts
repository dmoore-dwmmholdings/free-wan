import { describe, it, expect } from 'vitest'
import { deriveCategoryChain } from '../src/lib/categories'
import { classify, isIgnored, isSubtitle, titleFromFilename } from '../src/lib/media-types'
import { decidePlaybackMode } from '../src/lib/playback'
import { mapProbe } from '../src/services/ffprobe'

describe('deriveCategoryChain', () => {
  it('builds a cumulative chain from directory segments', () => {
    expect(deriveCategoryChain('Movies/Action/2021/film.mp4')).toEqual([
      { name: 'Movies', path: 'Movies', depth: 0 },
      { name: 'Action', path: 'Movies/Action', depth: 1 },
      { name: '2021', path: 'Movies/Action/2021', depth: 2 },
    ])
  })

  it('returns no categories for a file at the repo root', () => {
    expect(deriveCategoryChain('film.mp4')).toEqual([])
  })

  it('collapses separators, trims, and normalizes backslashes', () => {
    expect(deriveCategoryChain('A\\\\ B //C/x.mp4').map((n) => n.path)).toEqual(['A', 'A/B', 'A/B/C'])
  })

  it('caps depth', () => {
    const deep = Array.from({ length: 20 }, (_, i) => `d${i}`).join('/') + '/x.mp4'
    expect(deriveCategoryChain(deep, 3)).toHaveLength(3)
  })
})

describe('classification & ignore rules', () => {
  it('classifies by extension', () => {
    expect(classify('a.mp4')).toBe('video')
    expect(classify('b.JPG')).toBe('image')
    expect(classify('c.txt')).toBe(null)
    expect(classify('d.srt')).toBe(null)
  })
  it('detects subtitles and ignored files', () => {
    expect(isSubtitle('film.en.srt')).toBe(true)
    expect(isIgnored('.hidden.mp4')).toBe(true)
    expect(isIgnored('movie.part')).toBe(true)
    expect(isIgnored('movie.mp4')).toBe(false)
  })
  it('derives a readable title', () => {
    expect(titleFromFilename('The.Big.Sky_2021.mp4')).toBe('The Big Sky 2021')
  })
})

describe('decidePlaybackMode', () => {
  it('direct-plays a browser-friendly mp4/h264/aac', () => {
    expect(decidePlaybackMode({ ext: 'mp4', videoCodec: 'h264', audioCodec: 'aac' })).toBe('direct')
  })
  it('transcodes an mkv even with h264/aac (browsers can not direct-play mkv)', () => {
    expect(decidePlaybackMode({ ext: 'mkv', videoCodec: 'h264', audioCodec: 'aac' })).toBe('hls')
  })
  it('transcodes hevc with non-browser audio', () => {
    expect(decidePlaybackMode({ ext: 'mp4', videoCodec: 'hevc', audioCodec: 'dts' })).toBe('hls')
  })
  it('transcodes an avi container', () => {
    expect(decidePlaybackMode({ ext: 'avi', videoCodec: 'h264', audioCodec: 'aac' })).toBe('hls')
  })
})

describe('mapProbe', () => {
  it('maps ffprobe JSON to metadata + subtitle streams', () => {
    const r = mapProbe({
      format: { duration: '412.3', bit_rate: '4500000', format_name: 'mov,mp4,m4a', tags: { creation_time: '2021-05-01T10:00:00.000000Z' } },
      streams: [
        { codec_type: 'video', codec_name: 'h264', width: 1920, height: 1080, avg_frame_rate: '30000/1001' },
        { codec_type: 'audio', codec_name: 'aac' },
        { codec_type: 'audio', codec_name: 'ac3' },
        { codec_type: 'subtitle', codec_name: 'subrip', index: 3, tags: { language: 'eng' } },
      ],
    })
    expect(r.durationS).toBeCloseTo(412.3)
    expect(r.width).toBe(1920)
    expect(r.height).toBe(1080)
    expect(r.frameRate).toBeCloseTo(29.97, 1)
    expect(r.videoCodec).toBe('h264')
    expect(r.audioCodec).toBe('aac')
    expect(r.audioTracks).toBe(2)
    expect(r.embeddedSubs).toEqual([{ streamIndex: 3, language: 'eng', format: 'subrip' }])
    expect(r.capturedAt).toBe(Date.parse('2021-05-01T10:00:00.000000Z'))
  })
})
