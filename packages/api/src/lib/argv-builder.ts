import type { ArgToken } from '@free-wan/shared'

export type ArgValue = string | number | boolean | undefined

/**
 * Build a flat argv array from an arg_template and resolved parameter values (security §5,
 * commands §4). Each token becomes one or more **standalone** argv entries, so shell
 * metacharacters inside a value are inert data — there is no shell and no string
 * concatenation into a command line. `prefix`/`suffix` are joined onto the *single* entry.
 */
export function buildArgv(template: ArgToken[], values: Record<string, ArgValue>): string[] {
  const argv: string[] = []
  for (const token of template) {
    if (typeof token === 'string') {
      argv.push(token)
      continue
    }
    const v = values[token.param]
    if (token.whenTrue) {
      if (v === true || v === 'true') argv.push(...token.whenTrue)
      continue
    }
    if (v === undefined || v === null || v === '') continue // missing optional → omit
    argv.push(`${token.prefix ?? ''}${String(v)}${token.suffix ?? ''}`)
  }
  return argv
}
