import { useQuery } from '@tanstack/react-query'
import type { CollectionDto } from '@free-wan/shared'
import { api } from './api'

export function useCollections() {
  return useQuery({
    queryKey: ['collections'],
    queryFn: () => api.get<{ data: CollectionDto[] }>('/api/collections'),
  })
}

/**
 * One collection, picked out of the list.
 *
 * There is no GET /api/collections/:id — the API exposes the list plus mutations only — so
 * this reuses the list query, which is already cached after visiting the Collections tab.
 */
export function useCollection(id: string): CollectionDto | undefined {
  const { data } = useCollections()
  return data?.data.find((c) => c.id === id)
}
