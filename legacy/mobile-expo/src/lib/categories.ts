import { useQuery } from '@tanstack/react-query'
import type { CategoryNodeDto } from '@free-wan/shared'
import { api } from './api'

/** Child categories of `parent`, or the repository roots when parent is null. */
export function useCategoryChildren(parent: string | null) {
  const qs = parent ? `?parent=${encodeURIComponent(parent)}` : ''
  return useQuery({
    queryKey: ['categories', parent],
    queryFn: () => api.get<{ data: CategoryNodeDto[] }>(`/api/categories${qs}`),
  })
}
