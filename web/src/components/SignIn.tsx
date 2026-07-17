import { useState } from 'react';
import { login, type Provider } from '../auth.js';

/** Social sign-in (§5). Sends the user through mac-auth's provider flow. */
export function SignIn({ prompt }: { prompt?: string }) {
  const [busy, setBusy] = useState<Provider | null>(null);

  async function go(provider: Provider) {
    setBusy(provider);
    try {
      await login(provider);
    } catch {
      setBusy(null);
    }
  }

  return (
    <div className="signin">
      {prompt && <p>{prompt}</p>}
      <div className="row">
        <button className="primary" disabled={!!busy} onClick={() => go('google')}>
          {busy === 'google' ? 'Redirecting…' : 'Continue with Google'}
        </button>
        <button className="secondary" disabled={!!busy} onClick={() => go('microsoft')}>
          {busy === 'microsoft' ? 'Redirecting…' : 'Continue with Microsoft'}
        </button>
      </div>
      <p className="muted small">
        Use the account tied to your MAC membership. You can switch accounts afterwards if it
        picks the wrong one.
      </p>
    </div>
  );
}
