import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

/**
 * `tls-cert` subcommand: fetch a Tailscale-issued TLS certificate for this node and print the
 * env needed to enable native HTTPS. Bundled into the API entrypoint so it ships with the
 * code-only update package (unlike a repo `scripts/` file). Invoke as:
 *   node packages/api/dist/index.js tls-cert [<node>.<tailnet>.ts.net]
 */
export function runTailscaleCert(args: string[]): void {
  const TS = process.env.TAILSCALE_BIN || 'tailscale'
  const run = (a: string[]) => execFileSync(TS, a, { encoding: 'utf8' })

  const detectDomain = (): string | null => {
    try {
      const status = JSON.parse(run(['status', '--json'])) as { Self?: { DNSName?: string } }
      const name = status?.Self?.DNSName
      if (name) return name.replace(/\.$/, '')
    } catch {
      /* fall through to the explicit-argument error */
    }
    return null
  }

  const domain = args[0] || detectDomain()
  if (!domain) {
    console.error('Could not determine the tailnet domain. Pass it explicitly:')
    console.error('  node packages/api/dist/index.js tls-cert <node>.<tailnet>.ts.net')
    console.error('(Is the `tailscale` CLI on PATH and logged in? Set TAILSCALE_BIN to override.)')
    process.exit(1)
  }

  const outDir = join(resolve(process.env.DATA_DIR || './data'), 'tls')
  mkdirSync(outDir, { recursive: true })
  const certFile = join(outDir, `${domain}.crt`)
  const keyFile = join(outDir, `${domain}.key`)

  try {
    run(['cert', '--cert-file', certFile, '--key-file', keyFile, domain])
  } catch (e) {
    console.error(`\n"tailscale cert" failed: ${(e as Error).message}`)
    console.error('Checks: tailscale is installed and on PATH, you are logged in, and HTTPS')
    console.error('certificates are enabled for your tailnet (Admin console → DNS → HTTPS Certificates).')
    process.exit(1)
  }

  const port = process.env.PORT || '8080'
  // Print env values with forward slashes — they survive any shell/escaping (Windows backslashes
  // get eaten by some env setters), and Node accepts them on every platform.
  const envCert = certFile.replace(/\\/g, '/')
  const envKey = keyFile.replace(/\\/g, '/')
  console.log(`\nCertificate written:\n  cert: ${certFile}\n  key:  ${keyFile}`)
  console.log(`\nSet these in your env and restart:\n  TLS_CERT_FILE=${envCert}\n  TLS_KEY_FILE=${envKey}`)
  console.log(`\nThen browse to:  https://${domain}:${port}`)
  console.log('\nTailscale certs are short-lived — re-run this before expiry (e.g. on a schedule).')
}
