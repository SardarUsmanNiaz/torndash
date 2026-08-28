/* =========================================================================
   TornDash — supabase-client.js
   Shared bootstrap used by BOTH the public site (app.js) and the admin panel
   (admin.js). Loaded AFTER the Supabase CDN script and config.js.

   Exposes on window:
     • window.SB            -> a Supabase client, or null if not configured
     • window.SB_CONFIGURED -> boolean
     • window.sha256Hex(s)  -> Promise<hex string>  (used to hash keys)
   ========================================================================= */
(function () {
  'use strict';

  const cfg = window.APP_CONFIG || {};

  // Treat the file as "configured" only when the placeholders were replaced.
  const configured =
    typeof cfg.SUPABASE_URL === 'string' &&
    typeof cfg.SUPABASE_ANON_KEY === 'string' &&
    cfg.SUPABASE_URL.startsWith('https://') &&
    !cfg.SUPABASE_URL.includes('YOUR-') &&
    !cfg.SUPABASE_ANON_KEY.includes('YOUR-') &&
    cfg.SUPABASE_ANON_KEY.length > 20;

  // The CDN UMD build exposes a global named `supabase` with createClient().
  const lib = window.supabase;

  window.SB_CONFIGURED = !!configured;
  window.SB = configured && lib && typeof lib.createClient === 'function'
    ? lib.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY)
    : null;

  if (configured && !window.SB) {
    console.warn('[TornDash] Supabase is configured but the client library failed to load.');
  }

  /**
   * SHA-256 → lowercase hex, using the browser's native Web Crypto.
   * NOTE: crypto.subtle requires a secure context — this works on https:// and
   * on http://localhost, but NOT when opening the file directly via file://.
   * Host the site (or run a local server) once you enable Supabase.
   */
  window.sha256Hex = async function sha256Hex(message) {
    if (!(window.crypto && window.crypto.subtle)) {
      throw new Error('secure-context-required');
    }
    const bytes = new TextEncoder().encode(String(message));
    const digest = await window.crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  };
})();
