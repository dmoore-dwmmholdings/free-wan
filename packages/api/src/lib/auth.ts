import { randomBytes } from 'node:crypto'
import { argon2id, argon2Verify } from 'hash-wasm'
import type { CookieSerializeOptions } from '@fastify/cookie'

export const SESSION_COOKIE = 'fw_session'
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30 days, absolute

// Argon2id parameters — OWASP baseline (m=19 MiB, t=2, p=1). Pure-WASM (hash-wasm)
// so there is no native build step on any platform. See ADR 0002.
const ARGON2 = { parallelism: 1, iterations: 2, memorySize: 19456, hashLength: 32 } as const

export async function hashPassword(password: string): Promise<string> {
  return argon2id({
    password,
    salt: randomBytes(16),
    ...ARGON2,
    outputType: 'encoded', // PHC string: $argon2id$v=19$m=...,t=...,p=...$salt$hash
  })
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  try {
    return await argon2Verify({ password, hash })
  } catch {
    return false
  }
}

/** Opaque, high-entropy session token; stored as sessions.id and in the cookie. */
export function newSessionToken(): string {
  return randomBytes(32).toString('base64url')
}

/**
 * Cookie attributes for the session. `secure` must track the *actual request scheme*, not the
 * environment: Free-WAN is commonly reached over plain HTTP on the tailnet, and browsers silently
 * drop a `Secure` cookie that was set over HTTP — which breaks login (the session is never stored,
 * so the next request is unauthenticated). Pass `req.protocol === 'https'` so the flag is set only
 * when TLS is really in play (e.g. behind Tailscale Serve, which forwards `x-forwarded-proto`).
 */
export function sessionCookieOptions(secure: boolean): CookieSerializeOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    signed: true,
    path: '/',
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  }
}
