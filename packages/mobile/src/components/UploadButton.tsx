import { useRef, useState } from 'react'
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import * as ImagePicker from 'expo-image-picker'
import { useQueryClient } from '@tanstack/react-query'
import Ionicons from '@expo/vector-icons/Ionicons'
import {
  batchSummary,
  fileNameFor,
  MAX_FILES_PER_BATCH,
  uploadFile,
  uploadBlocker,
  useUploadTargets,
  type Cancellable,
  type UploadOutcome,
  type UploadTarget,
} from '@/lib/uploads'
import { theme } from '@/theme'

interface Picked {
  uri: string
  name: string
  mimeType?: string | null
}

/** What the picker returned, named. See `fileNameFor` for why the name needs deriving. */
function toPicked(asset: ImagePicker.ImagePickerAsset, i: number): Picked {
  return { uri: asset.uri, name: fileNameFor(asset, i), mimeType: asset.mimeType }
}

/** Floating action button that puts photos and videos from this phone into the library. */
export function UploadButton() {
  const qc = useQueryClient()
  const targets = useUploadTargets()
  const [choosing, setChoosing] = useState<Picked[] | null>(null)
  const [progress, setProgress] = useState<{ done: number; total: number; fraction: number } | null>(
    null,
  )
  // The transfer running now, so Stop has something to act on, and whether Stop was pressed, so
  // the files queued behind it are abandoned too. Refs rather than state: the loop below reads
  // them between files, and would otherwise be looking at the values it closed over.
  const task = useRef<Cancellable | null>(null)
  const stopped = useRef(false)

  const available = targets.data?.data ?? []

  function stop(): void {
    stopped.current = true
    void task.current?.cancelAsync().catch(() => {
      // Already finished, or the platform refused. Either way the loop stops after this file.
    })
  }

  async function send(target: UploadTarget, files: Picked[]): Promise<void> {
    setChoosing(null)
    setProgress({ done: 0, total: files.length, fraction: 0 })
    stopped.current = false

    const results: UploadOutcome[] = []
    for (const [i, file] of files.entries()) {
      if (stopped.current) break
      setProgress({ done: i, total: files.length, fraction: 0 })
      try {
        results.push(
          await uploadFile(
            target.id,
            file,
            (fraction) => setProgress({ done: i, total: files.length, fraction }),
            (running) => {
              task.current = running
            },
          ),
        )
      } catch (err) {
        // The file in flight when Stop was pressed comes back as a failure, because the
        // transfer really did not finish — but it is not one to report. Everything else is:
        // one file failing must not abandon the rest, since losing a whole camera roll to a
        // single unsupported clip would be worse than skipping it.
        if (stopped.current) break
        results.push({
          name: file.name,
          ok: false,
          reason: err instanceof Error ? err.message : 'Upload failed',
        })
      } finally {
        task.current = null
      }
    }

    const wasStopped = stopped.current
    setProgress(null)
    // The server queues a scan, so how soon they appear depends on how fast that runs;
    // refetching is still the only way new items show up without a restart. Worth doing after a
    // stop too: whatever finished before it is in the library.
    void qc.invalidateQueries({ queryKey: ['media'], exact: false })
    void qc.invalidateQueries({ queryKey: ['categories'], exact: false })
    const summary = batchSummary(results, wasStopped)
    Alert.alert(summary.title, summary.body)
  }

  async function pick(): Promise<void> {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (!permission.granted) {
      Alert.alert(
        'Photo access needed',
        'Allow access to your photos in Settings to upload them to your library.',
      )
      return
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images', 'videos'],
      allowsMultipleSelection: true,
      selectionLimit: MAX_FILES_PER_BATCH,
      // The originals are the point. Re-encoding a phone video to put it on your own server
      // would lose quality for no reason.
      quality: 1,
      exif: false,
    })
    if (result.canceled || result.assets.length === 0) return

    const picked = result.assets.map(toPicked)
    if (available.length === 1) {
      await send(available[0]!, picked)
    } else {
      setChoosing(picked)
    }
  }

  function start(): void {
    const blocked = uploadBlocker({ loading: targets.isLoading, targets: targets.data?.data ?? null })
    if (blocked === 'loading') return
    if (blocked === 'unreachable') {
      Alert.alert(
        'Cannot reach your server',
        'Check that it is running and that this phone is on the same network or tailnet.',
      )
      return
    }
    if (blocked === 'no-targets') {
      Alert.alert(
        'Nowhere to upload',
        'No library on your server accepts uploads. A library has to be writable and hold images or video.',
      )
      return
    }
    void pick()
  }

  const busy = progress !== null
  const pct = progress ? Math.round(progress.fraction * 100) : 0

  return (
    // Fills the screen so the button anchors to its bottom-right rather than to whatever
    // height this component happens to occupy in the layout; box-none lets taps anywhere
    // else reach the grid underneath.
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <Pressable
        onPress={start}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel={busy ? 'Uploading' : 'Upload photos or videos'}
        style={({ pressed }) => ({
          position: 'absolute',
          right: theme.space(4),
          bottom: theme.space(4),
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.space(2),
          backgroundColor: theme.color.primary,
          borderRadius: theme.radius.full,
          paddingVertical: theme.space(3.5),
          paddingHorizontal: theme.space(busy ? 5 : 4),
          // Without a shadow the button dissolves into a bright photo behind it.
          shadowColor: '#000',
          shadowOpacity: 0.35,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: 4 },
          elevation: 6,
          opacity: pressed ? 0.85 : 1,
        })}
      >
        {busy ? (
          <>
            <ActivityIndicator size="small" color="#fff" />
            <Text style={{ color: '#fff', fontWeight: '700', fontSize: 14 }}>
              {progress.total > 1 ? `${progress.done + 1} of ${progress.total} · ${pct}%` : `${pct}%`}
            </Text>
          </>
        ) : (
          <Ionicons name="add" size={24} color="#fff" />
        )}
      </Pressable>

      {busy ? (
        <Pressable
          onPress={stop}
          accessibilityRole="button"
          accessibilityLabel="Stop uploading"
          // Its own control rather than a second tap on the button above, which is busy showing
          // the progress and has to stay unpressable: stopping a transfer by accident while
          // trying to read how far along it is would be its own small disaster.
          hitSlop={12}
          style={({ pressed }) => ({
            position: 'absolute',
            right: theme.space(4),
            bottom: theme.space(15),
            flexDirection: 'row',
            alignItems: 'center',
            gap: theme.space(2),
            backgroundColor: theme.color.surface,
            borderColor: theme.color.border,
            borderWidth: 1,
            borderRadius: theme.radius.full,
            paddingVertical: theme.space(2.5),
            paddingHorizontal: theme.space(4),
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <Ionicons name="close" size={16} color={theme.color.muted} />
          <Text style={{ color: theme.color.muted, fontWeight: '700', fontSize: 13 }}>Stop</Text>
        </Pressable>
      ) : null}

      <Modal
        visible={choosing !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setChoosing(null)}
      >
        <Pressable
          onPress={() => setChoosing(null)}
          // Not an accessibility element itself. `Pressable` sets `accessible` to true
          // unless told otherwise, and a container that is an element hides its children —
          // which would leave a screen reader with one unlabelled blob where the sheet is,
          // and no way to reach the options inside it. Tapping to dismiss still works.
          accessible={false}
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' }}
        >
          {/* Swallow taps on the sheet itself, or choosing a library would dismiss it. */}
          <Pressable
            onPress={() => {}}
            // Same reason as the backdrop: an element here would swallow the rows below it.
            accessible={false}
            style={{
              backgroundColor: theme.color.surface,
              borderTopLeftRadius: theme.radius.md,
              borderTopRightRadius: theme.radius.md,
              paddingVertical: theme.space(5),
              paddingHorizontal: theme.space(4),
              gap: theme.space(2),
            }}
          >
            <Text style={{ color: theme.color.text, fontSize: 17, fontWeight: '800' }}>
              Upload to which library?
            </Text>
            <ScrollView style={{ maxHeight: 320 }}>
              {available.map((t) => (
                <Pressable
                  key={t.id}
                  onPress={() => void send(t, choosing ?? [])}
                  accessibilityRole="button"
                  accessibilityLabel={`Upload to ${t.name}`}
                  style={({ pressed }) => ({
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: theme.space(3),
                    paddingVertical: theme.space(3.5),
                    opacity: pressed ? 0.7 : 1,
                  })}
                >
                  <Ionicons
                    name={
                      t.type === 'image'
                        ? 'image-outline'
                        : t.type === 'video'
                          ? 'film-outline'
                          : 'albums-outline'
                    }
                    size={20}
                    color={theme.color.muted}
                  />
                  <Text style={{ color: theme.color.text, fontSize: 15, fontWeight: '600' }}>
                    {t.name}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  )
}
