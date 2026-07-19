import { useCallback, useEffect, useRef, useState } from 'react';
import {
  fetchRosterSummary,
  uploadRoster,
  ForbiddenError,
  UnauthorizedError,
  type ImportOutcome,
} from '../api.js';
import type { RosterSummary } from '../types.js';
import { SignIn } from '../components/SignIn.js';
import { AccountBar } from '../components/AccountBar.js';
import { Brand } from '../components/Brand.js';
import { EventsAdmin } from '../components/EventsAdmin.js';

// Admin panel (§11). Currently: roster upload + visibility. Events CRUD and the
// review queue can be added here the same way (they're already API routes).
export function Admin() {
  const [phase, setPhase] = useState<'loading' | 'unauth' | 'forbidden' | 'ready'>('loading');
  const [summary, setSummary] = useState<RosterSummary | null>(null);

  const loadSummary = useCallback(async () => {
    try {
      setSummary(await fetchRosterSummary());
      setPhase('ready');
    } catch (err) {
      if (err instanceof UnauthorizedError) setPhase('unauth');
      else if (err instanceof ForbiddenError) setPhase('forbidden');
      else setPhase('ready'); // network blip — still show the panel
    }
  }, []);

  useEffect(() => {
    void loadSummary();
  }, [loadSummary]);

  if (phase === 'loading') return <div className="page centered">Loading…</div>;
  if (phase === 'unauth') {
    return (
      <div className="page centered">
        <Brand />
        <h1>Admin</h1>
        <SignIn prompt="Sign in with your committee account to manage the roster." />
      </div>
    );
  }
  if (phase === 'forbidden') {
    return (
      <div className="page centered">
        <Brand />
        <h1>Admin</h1>
        <p>This account isn’t exec/committee, so it can’t manage the roster.</p>
        <AccountBar />
      </div>
    );
  }

  return (
    <div className="page">
      <AccountBar />
      <Brand />
      <h1>Roster admin</h1>
      <RosterSummaryCard summary={summary} />
      <RosterUpload onImported={loadSummary} />
      <EventsAdmin />
    </div>
  );
}

function RosterSummaryCard({ summary }: { summary: RosterSummary | null }) {
  if (!summary || !summary.hasRoster) {
    return (
      <div className="card">
        <h3>Current roster</h3>
        <p className="muted">No roster imported yet — upload the MSA export below to get started.</p>
      </div>
    );
  }
  return (
    <div className="card">
      <h3>Current roster</h3>
      <div className="stats">
        <Stat label="Enrolled" value={summary.enrolled} highlight />
        <Stat label="Inactive" value={summary.inactive} />
        <Stat label="Total rows" value={summary.total} />
      </div>
      {summary.importedAt && (
        <p className="muted small">Last imported {new Date(summary.importedAt).toLocaleString()}</p>
      )}
    </div>
  );
}

function Stat({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <div className="stat">
      <div className={`stat-value${highlight ? ' ok' : ''}`}>{value.toLocaleString()}</div>
      <div className="muted small">{label}</div>
    </div>
  );
}

function RosterUpload({ onImported }: { onImported: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<ImportOutcome | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function doUpload(override: boolean) {
    if (!file || busy) return;
    setBusy(true);
    setOutcome(null);
    try {
      const result = await uploadRoster(file, override);
      setOutcome(result);
      if (result.kind === 'ok') {
        onImported();
        setFile(null);
        if (inputRef.current) inputRef.current.value = '';
      }
    } catch {
      setOutcome({ kind: 'error', message: 'Upload failed — check your connection and try again.' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h3>Import roster</h3>
      <p className="muted">
        Upload the MSA Clubs &amp; Societies export (<code>Members_*.xlsx</code>). This replaces the
        current roster snapshot; prior imports are kept for history.
      </p>

      <input
        ref={inputRef}
        type="file"
        accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        onChange={(e) => {
          setFile(e.target.files?.[0] ?? null);
          setOutcome(null);
        }}
        disabled={busy}
      />

      <div className="row">
        <button className="primary" onClick={() => doUpload(false)} disabled={!file || busy}>
          {busy ? 'Uploading…' : 'Upload roster'}
        </button>
        {file && <span className="muted small">{file.name}</span>}
      </div>

      {outcome && <UploadOutcome outcome={outcome} onOverride={() => doUpload(true)} busy={busy} />}
    </div>
  );
}

function UploadOutcome({
  outcome,
  onOverride,
  busy,
}: {
  outcome: ImportOutcome;
  onOverride: () => void;
  busy: boolean;
}) {
  switch (outcome.kind) {
    case 'ok':
      return (
        <p className="badge verified" style={{ marginTop: '0.75rem' }}>
          Imported {outcome.result.enrolledRows} enrolled of {outcome.result.totalRows} rows.
        </p>
      );
    case 'safety_gate':
      return (
        <div className="safety" style={{ marginTop: '0.75rem' }}>
          <p className="error">{outcome.message}</p>
          <p className="muted small">
            Incoming enrolled: {outcome.incomingEnrolled} · current: {outcome.currentEnrolled}. If this
            file is correct (e.g. membership genuinely dropped), override the safety gate.
          </p>
          <button className="secondary" onClick={onOverride} disabled={busy}>
            {busy ? 'Uploading…' : 'Import anyway (override)'}
          </button>
        </div>
      );
    case 'parse_error':
      return <p className="error" style={{ marginTop: '0.75rem' }}>Couldn’t read the file: {outcome.message}</p>;
    case 'forbidden':
      return <p className="error" style={{ marginTop: '0.75rem' }}>This account can’t import the roster (exec/committee only).</p>;
    case 'error':
      return <p className="error" style={{ marginTop: '0.75rem' }}>{outcome.message}</p>;
  }
}
