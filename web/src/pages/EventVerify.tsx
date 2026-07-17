import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useStatus } from '../useStatus.js';
import { StudentIdForm } from '../components/StudentIdForm.js';
import type { EventStatusResponse } from '../types.js';

// Event-specific entry point (§7): verify.monashcoding.com/e/{slug}. What
// marketing links to. Resolves membership then redirects to that one event —
// but always with a visible interstitial + a manual "Continue" button, never a
// silent bounce (§7 "Event-specific entry UX").
export function EventVerify() {
  const { slug } = useParams<{ slug: string }>();
  const { state, setData, login } = useStatus(slug);
  const [skipped, setSkipped] = useState(false);

  if (state.phase === 'loading') return <Centered>Checking your membership…</Centered>;
  if (state.phase === 'error') return <Centered>Something went wrong. Please refresh.</Centered>;
  if (state.phase === 'unauthenticated') {
    return (
      <Centered>
        <p>Sign in to check your MAC member pricing for this event.</p>
        <button className="primary" onClick={() => login()}>Sign in</button>
      </Centered>
    );
  }

  const data = state.data as EventStatusResponse;
  const { link, event } = data;

  // Verified with a code, or not a member — either way we send them onward with
  // a confirmation screen so they understand where they're going.
  if (link.linked && event.outcome.state === 'code_ready') {
    return <RedirectInterstitial url={event.outcome.autoApplyUrl} member />;
  }
  if (!link.linked && !link.canEnterStudentId) {
    // Skipped-through / attempts exhausted → plain ticket link.
    const url = event.outcome.state === 'not_member' ? event.outcome.ticketUrl : '#';
    return <RedirectInterstitial url={url} member={false} contactUs={link.contactUs} />;
  }
  if (skipped && event.outcome.state === 'not_member') {
    return <RedirectInterstitial url={event.outcome.ticketUrl} member={false} />;
  }
  if (link.linked && event.outcome.state === 'pending') {
    return (
      <Centered>
        <p className="badge pending">Verified</p>
        <p>You’re verified — your code for this event is being set up. Check back soon.</p>
      </Centered>
    );
  }

  // Not linked yet → the student-ID step (primary path).
  return (
    <div className="page">
      <h1>{event.name}</h1>
      <StudentIdForm
        slug={slug}
        attemptsRemaining={link.attemptsRemaining}
        onResolved={(r) => r.ok && setData(r.status)}
        onSkip={() => setSkipped(true)}
      />
    </div>
  );
}

function RedirectInterstitial({
  url,
  member,
  contactUs,
}: {
  url: string;
  member: boolean;
  contactUs?: boolean;
}) {
  useEffect(() => {
    if (url === '#') return;
    const t = setTimeout(() => window.location.assign(url), 1500);
    return () => clearTimeout(t);
  }, [url]);

  return (
    <Centered>
      {member ? (
        <>
          <p className="badge verified">You’re verified!</p>
          <p>Redirecting you to tickets with your member discount applied…</p>
        </>
      ) : (
        <p>Redirecting you to tickets…</p>
      )}
      {url !== '#' && (
        <a className="primary as-button" href={url}>Continue to tickets</a>
      )}
      {contactUs && (
        <p className="muted small">Think this is wrong? Contact us and we’ll sort it out.</p>
      )}
    </Centered>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="page centered">{children}</div>;
}
