import { useQuery } from '@tanstack/react-query'
import type { TagWithCount } from '@free-wan/shared'
import { api } from './api'

/** All tags with their item counts, for the filter row. */
export function useTags() {
  return useQuery({
    queryKey: ['tags'],
    queryFn: () => api.get<{ data: TagWithCount[] }>('/api/tags'),
  })
}
