import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { LikeResponse, MediaDetail } from '@free-wan/shared'
import { api } from './api'

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
      // The grid shows like state too, so let it refetch in the background.
      void qc.invalidateQueries({ queryKey: ['media'], exact: false })
    },
  })
}
