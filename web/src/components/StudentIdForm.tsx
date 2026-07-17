import { useState } from 'react';
import { submitStudentId, type SubmitResult } from '../api.js';

interface Props {
  slug?: string;
  attemptsRemaining?: number;
  onResolved: (result: SubmitResult) => void;
  onSkip: () => void;
}

/**
 * Student-ID entry (§7). This is the PRIMARY path, not a fallback — ~90% of
 * members won't email-match. Framed as a normal step. Skipping writes nothing.
 * Failure copy is generic — we never reveal which part of the check failed.
 */
export function StudentIdForm({ slug, attemptsRemaining, onResolved, onSkip }: Props) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!value.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await submitStudentId(value.trim(), slug);
      if (result.ok) {
        onResolved(result);
      } else {
        setError(result.retry.message);
        onResolved(result); // let parent refresh attemptsRemaining / lock state
      }
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card" onSubmit={handleSubmit}>
      <label className="field-label" htmlFor="studentId">
        Enter your student ID to link your membership
      </label>
      <p className="muted">
        Most members sign in with a personal account, so we just need your student ID once to
        confirm your MAC membership. You won’t have to do this again.
      </p>
      <input
        id="studentId"
        inputMode="numeric"
        autoComplete="off"
        placeholder="e.g. 31234567"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        disabled={busy}
      />
      {error && <p className="error" role="alert">{error}</p>}
      {typeof attemptsRemaining === 'number' && attemptsRemaining < 5 && attemptsRemaining > 0 && (
        <p className="muted small">{attemptsRemaining} attempt{attemptsRemaining === 1 ? '' : 's'} remaining.</p>
      )}
      <div className="row">
        <button type="submit" className="primary" disabled={busy || !value.trim()}>
          {busy ? 'Checking…' : 'Link my membership'}
        </button>
        <button type="button" className="link-button" onClick={onSkip} disabled={busy}>
          Skip — I’m not a member
        </button>
      </div>
    </form>
  );
}
