import { useState } from 'react';
import { useStatus } from '../useStatus.js';
import { StudentIdForm } from '../components/StudentIdForm.js';
import { OutcomeCard } from '../components/Outcome.js';
import type { GenericStatusResponse } from '../types.js';

// Generic entry point (§7): verify.monashcoding.com/. For a member checking
// their status any time, not tied to one event. Lists active events with buttons
// instead of redirecting — each event's outcome rendered independently.
export function GenericVerify() {
  const { state, setData, login } = useStatus();
  const [skipped, setSkipped] = useState(false);

  if (state.phase === 'loading') return <Centered>Loading…</Centered>;
  if (state.phase === 'error') return <Centered>Something went wrong. Please refresh.</Centered>;
  if (state.phase === 'unauthenticated') {
    return (
      <Centered>
        <h1>MAC member verification</h1>
        <p>Sign in to check your member pricing across MAC events.</p>
        <button className="primary" onClick={() => login()}>Sign in</button>
      </Centered>
    );
  }

  const data = state.data as GenericStatusResponse;
  const { link, events } = data;
  const showForm = !link.linked && link.canEnterStudentId && !skipped;

  return (
    <div className="page">
      <h1>MAC member verification</h1>

      {showForm && (
        <StudentIdForm
          attemptsRemaining={link.attemptsRemaining}
          onResolved={(r) => r.ok && setData(r.status)}
          onSkip={() => setSkipped(true)}
        />
      )}

      {link.contactUs && (
        <p className="muted">Think this is wrong? Contact us and we’ll sort it out.</p>
      )}

      <h2>Active events</h2>
      {events.length === 0 && <p className="muted">No active events right now.</p>}
      <div className="events-grid">
        {events.map((e) => (
          <OutcomeCard key={e.slug} event={e} />
        ))}
      </div>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="page centered">{children}</div>;
}
