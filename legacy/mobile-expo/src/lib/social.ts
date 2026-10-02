import { useMutation, useQueryClient, type InfiniteData } from '@tanstack/react-query'
import type { LikeResponse, MediaDetail, MediaListResponse } from '@free-wan/shared'
import { api } from './api'

/**
 * Write a like straight into every cached page of the library.
 *
 * The alternative is invalidating `['media']`, which is what this used to do — but the
 * library is an infinite query, and invalidating one refetches *every page that has been
 * loaded*. Someone who has scrolled a while and then likes three things in a row pays for a
 * dozen list requests over whatever link their server is on, to learn what the mutation
 * already told us. The response carries the authoritative count, so it is cheaper and no less
 * correct to put it where it belongs.
 */
export function patchCachedLists(
  qc: ReturnType<typeof useQueryClient>,
  id: string,
  liked: boolean,
  likeCount: number,
): void {
  qc.setQueriesData<InfiniteData<MediaListResponse>>(
    { queryKey: ['media'], exact: false },
    (old) => {
      // `['media']` also matches the detail query, which is not paged. Leave it be.
      if (!old || !('pages' in old)) return old
      return {
        ...old,
        pages: old.pages.map((page) => ({
          ...page,
          data: page.data.map((m) => (m.id === id ? { ...m, liked, likeCount } : m)),
        })),
      }
    },
  )
}

/** Toggle a like, updating the cached detail immediately so the tap feels instant. */
export function useToggleLike(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (liked: boolean) =>
      liked
        ? api.del<LikeResponse>(`/api/media/${id}/like`)
        : api.put<LikeResponse>(`/api/media/${id}/like`),
    onMutate: async (liked) => {
      await qc.cancelQueries({ queryKey: ['media', id] })
      const previous = qc.getQueryData<MediaDetail>(['media', id])
      if (previous) {
        qc.setQueryData<MediaDetail>(['media', id], {
          ...previous,
          liked: !liked,
          likeCount: previous.likeCount + (liked ? -1 : 1),
        })
      }
      return { previous }
    },
    onError: (_e, _liked, ctx) => {
      if (ctx?.previous) qc.setQueryData(['media', id], ctx.previous)
    },
    onSuccess: (res) => {
      qc.setQueryData<MediaDetail>(['media', id], (old) =>
        old ? { ...old, liked: res.liked, likeCount: res.likeCount } : old,
      )
      // The grid shows like state too, and so does the liked-only filter.
      patchCachedLists(qc, id, res.liked, res.likeCount)
      // Marked stale but deliberately not refetched now. Unliking something while the
      // liked-only filter is on leaves it on screen with an empty heart rather than snatching
      // it away mid-tap, which is what makes a mistap undoable; the list puts itself right
      // the next time it is opened.
      void qc.invalidateQueries({ queryKey: ['media'], exact: false, refetchType: 'none' })
    },
  })
}
