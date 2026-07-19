import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useStatus } from '../useStatus.js';
import { StudentIdForm } from '../components/StudentIdForm.js';
import { OutcomeCard } from '../components/Outcome.js';
import { SignIn } from '../components/SignIn.js';
import { AccountBar } from '../components/AccountBar.js';
import type { EventStatusResponse } from '../types.js';

// Event-specific entry point (§7): verify.monashcoding.com/e/{slug}. What
// marketing links to. Shows the event as a preview card (consistent with the
// generic page) with a manual action — never a silent bounce (§7).
export function EventVerify() {
  const { slug } = useParams<{ slug: string }>();
  const { state, setData } = useStatus(slug);
  const [skipped, setSkipped] = useState(false);

  if (state.phase === 'loading') return <Centered>Checking your membership…</Centered>;
  if (state.phase === 'error') return <Centered>Something went wrong. Please refresh.</Centered>;
  if (state.phase === 'unauthenticated') {
    return (
      <Centered>
        <SignIn prompt="Sign in to check your MAC member pricing for this event." />
      </Centered>
    );
  }

  const data = state.data as EventStatusResponse;
  const { link, event } = data;
  // Not linked yet and still able to try → the student-ID step (primary path).
  const showForm = !link.linked && link.canEnterStudentId && !skipped;

  return (
    <div className="page">
      <AccountBar />
      <h1>{event.name}</h1>
      {/* When the student-ID form is showing, the card is a pure preview and the
          form carries the action; otherwise the card's own CTA sends them on. */}
      <OutcomeCard event={event} previewOnly={showForm} />

      {showForm && (
        <StudentIdForm
          slug={slug}
          attemptsRemaining={link.attemptsRemaining}
          onResolved={(r) => r.ok && setData(r.status)}
          onSkip={() => setSkipped(true)}
        />
      )}

      {link.contactUs && (
        <p className="muted small">Think this is wrong? Contact us and we’ll sort it out.</p>
      )}
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="page centered">{children}</div>;
}
