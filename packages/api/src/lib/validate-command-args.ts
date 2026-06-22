import type { CommandParamInput } from '@free-wan/shared'
import type { ArgValue } from './argv-builder'

/**
 * Resolves a repo_path value to an absolute path that stays within the named repository,
 * or throws (security §4). Injected so validation is testable without a live FS.
 */
export type RepoPathResolver = (
  repoId: string | undefined,
  value: string,
  mustBeDir: boolean,
) => string

export interface ValidateResult {
  ok: boolean
  values: Record<string, ArgValue>
  errors: Record<string, string>
}

/**
 * Re-validate submitted args against the parameter schema server-side (never trust the
 * client). Coerces by type, enforces constraints, and resolves repo_path values through the
 * path resolver. Returns typed values for the argv builder (repo_path → absolute path).
 */
export function validateCommandArgs(
  params: CommandParamInput[],
  submitted: Record<string, unknown>,
  resolveRepoPath: RepoPathResolver,
): ValidateResult {
  const values: Record<string, ArgValue> = {}
  const errors: Record<string, string> = {}

  for (const p of params) {
    let raw: unknown = submitted[p.name]
    if (raw === undefined || raw === '') {
      if (p.default != null && p.default !== '') raw = p.default
    }
    if (raw === undefined || raw === '') {
      if (p.required) errors[p.name] = 'required'
      continue
    }
    const c = p.constraints ?? {}
    switch (p.type) {
      case 'string': {
        const s = String(raw)
        if (c.pattern && !new RegExp(c.pattern).test(s)) errors[p.name] = 'pattern'
        else values[p.name] = s
        break
      }
      case 'number': {
        const n = Number(raw)
        if (!Number.isFinite(n)) errors[p.name] = 'number'
        else if (c.min != null && n < c.min) errors[p.name] = 'min'
        else if (c.max != null && n > c.max) errors[p.name] = 'max'
        else values[p.name] = n
        break
      }
      case 'boolean': {
        values[p.name] = raw === true || raw === 'true'
        break
      }
      case 'enum': {
        const s = String(raw)
        if (!c.options || !c.options.includes(s)) errors[p.name] = 'enum'
        else values[p.name] = s
        break
      }
      case 'repo_path': {
        try {
          values[p.name] = resolveRepoPath(c.repoId, String(raw), c.mustBeDir ?? false)
        } catch {
          errors[p.name] = 'path'
        }
        break
      }
    }
  }

  return { ok: Object.keys(errors).length === 0, values, errors }
}
