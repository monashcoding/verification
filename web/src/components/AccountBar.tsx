import { useState } from 'react';
import { decodeClaims, signOut } from '../auth.js';

/**
 * Shows which account is signed in and offers to switch (§5). Making the account
 * visible + switchable is the app-side mitigation for the "wrong cached account
 * used silently" problem, since we can't force prompt=select_account upstream.
 */
export function AccountBar() {
  const claims = decodeClaims();
  const [busy, setBusy] = useState(false);
  if (!claims?.email) return null;

  async function switchAccount() {
    setBusy(true);
    // Drop the shared session, then reload so the user is re-prompted to sign in
    // and can pick the right account.
    await signOut();
    window.location.reload();
  }

  return (
    <div className="account-bar">
      <span className="muted small">Signed in as {claims.email}</span>
      <button className="link-button" onClick={switchAccount} disabled={busy}>
        {busy ? 'Signing out…' : 'Not you? Switch account'}
      </button>
    </div>
  );
}
