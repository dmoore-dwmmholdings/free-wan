/**
 * Best-effort SVG sanitizer (security §6 / branding §5): strips active content so an
 * uploaded logo/favicon can be served inline without script execution. Removes
 * `<script>`/`<foreignObject>` elements, inline `on*` event handlers, and
 * `javascript:`/`data:text/html` URLs. Not a full XML parser — pair with a strict
 * `Content-Security-Policy` and serve assets from same-origin only.
 */
export function sanitizeSvg(input: string): string {
  let s = input
  // Drop script and foreignObject blocks entirely.
  s = s.replace(/<script[\s\S]*?<\/script\s*>/gi, '')
  s = s.replace(/<script[^>]*\/\s*>/gi, '')
  s = s.replace(/<foreignObject[\s\S]*?<\/foreignObject\s*>/gi, '')
  // Remove inline event handlers: on...="..." / on...='...' / on...=value
  s = s.replace(/\son[a-z]+\s*=\s*"(?:[^"]*)"/gi, '')
  s = s.replace(/\son[a-z]+\s*=\s*'(?:[^']*)'/gi, '')
  s = s.replace(/\son[a-z]+\s*=\s*[^\s>]+/gi, '')
  // Neutralize dangerous URLs in href/xlink:href/src.
  s = s.replace(/(href|xlink:href|src)\s*=\s*"(?:\s*javascript:|\s*data:text\/html)[^"]*"/gi, '$1="#"')
  s = s.replace(/(href|xlink:href|src)\s*=\s*'(?:\s*javascript:|\s*data:text\/html)[^']*'/gi, "$1='#'")
  return s
}
