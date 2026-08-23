/* Classic (non-module) boot check. Loaded before the app bundle so it runs even on browsers
 * that ignore <script type="module">. Turns an otherwise-blank page into a readable reason.
 * Served from /public so it satisfies the strict CSP (script-src 'self'); no inline script. */
(function () {
  function show(title, msg) {
    var root = document.getElementById('root')
    if (!root) return
    root.innerHTML =
      '<div style="font-family:system-ui,-apple-system,sans-serif;max-width:34rem;margin:14vh auto;' +
      'padding:1.5rem;color:#e9e9ee;background:#16161d;border:1px solid rgba(255,255,255,0.11);border-radius:16px;line-height:1.55">' +
      '<h1 style="font-size:1.15rem;margin:0 0 .5rem">' + title + '</h1>' +
      '<p style="margin:0;color:#8e8e9c">' + msg + '</p></div>'
  }

  // Browsers without ES module support ignore the app script entirely.
  if (!('noModule' in HTMLScriptElement.prototype)) {
    show(
      'This browser can’t run Free-WAN',
      'It does not support modern JavaScript (ES modules). Open the site in an up-to-date ' +
        'Safari, Chrome, Firefox, or Edge — not an in-app/embedded browser — or update your browser.',
    )
    return
  }

  // If the app still hasn’t mounted after a few seconds, the bundle was blocked or failed.
  setTimeout(function () {
    var root = document.getElementById('root')
    if (root && root.childElementCount === 0) {
      show(
        'Free-WAN didn’t finish loading',
        'The app code did not run. Common causes: an in-app/embedded browser, a content or ad ' +
          'blocker, JavaScript turned off, or iOS Lockdown Mode. Try opening this URL directly in ' +
          'Safari or Chrome and disabling blockers for this site.',
      )
    }
  }, 6000)
})()
