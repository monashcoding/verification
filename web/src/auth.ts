// mac-auth login from the SPA. The one non-negotiable here (§5, CLAUDE.md): this
// app MUST force the Google/Microsoft account chooser on login, because silently
// reusing a cached session is the biggest source of false "not a member" states.
// We always send prompt=select_account on the redirect.

const LOGIN_URL = import.meta.env.VITE_MAC_AUTH_LOGIN_URL ?? 'https://auth.monashcoding.com/login';
const TOKEN_KEY = 'mac_token';

/** Capture a token handed back in the URL hash (#token=... or #access_token=...). */
export function captureTokenFromRedirect(): void {
  if (!window.location.hash) return;
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const token = params.get('token') ?? params.get('access_token');
  if (token) {
    localStorage.setItem(TOKEN_KEY, token);
    // Strip the token from the address bar so it isn't bookmarked/shared.
    history.replaceState(null, '', window.location.pathname + window.location.search);
  }
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

/**
 * Send the user to mac-auth to log in, forcing the account chooser. `returnTo`
 * defaults to the current page so we come back exactly where we were.
 */
export function login(returnTo: string = window.location.href): void {
  const url = new URL(LOGIN_URL);
  url.searchParams.set('prompt', 'select_account'); // ← the non-negotiable (§5)
  url.searchParams.set('redirect_uri', returnTo);
  window.location.assign(url.toString());
}
