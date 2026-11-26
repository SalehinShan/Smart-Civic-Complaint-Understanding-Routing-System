import { FormEvent, useEffect, useRef, useState } from 'react';
import { Check, Search } from 'lucide-react';
import { copy, Lang } from '../data/i18n';
import { ComplaintRecord } from '../types/complaint';
import { CategoryChip } from '../components/CategoryBadge';
import { bindModalLightDismiss } from '../utils/formAriaSync';

interface TrackStatusPageProps {
  lang: Lang;
  complaints: ComplaintRecord[];
  initialTrackingCode?: string;
  onEscalate: (complaintId: string, reason: string) => void;
  onToast: (msg: string) => void;
}

export function TrackStatusPage({
  lang,
  complaints,
  initialTrackingCode,
  onEscalate,
  onToast,
}: TrackStatusPageProps) {
  const t = copy[lang];
  const [query, setQuery] = useState(initialTrackingCode || 'SC-2026-04812');
  const [selectedCode, setSelectedCode] = useState(initialTrackingCode || 'SC-2026-04812');
  const [escalationReason, setEscalationReason] = useState(
    'No field update after 7 days; requesting ward councillor review.',
  );
  const escalateDialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (initialTrackingCode) {
      setQuery(initialTrackingCode);
      setSelectedCode(initialTrackingCode);
    }
  }, [initialTrackingCode]);

  useEffect(() => {
    return bindModalLightDismiss(escalateDialogRef.current);
  }, []);

  const normalized = selectedCode.trim().toUpperCase();
  const matched = complaints.find(
    (c) =>
      c.trackingCode.toUpperCase() === normalized || c.shortId.toUpperCase() === normalized,
  );

  const handleSearch = (e: FormEvent) => {
    e.preventDefault();
    setSelectedCode(query.trim());
  };

  const handleEscalateSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!matched) return;
    onEscalate(matched.id, escalationReason);
    escalateDialogRef.current?.close();
    onToast(`Complaint ${matched.trackingCode} escalated to the ward councillor's office.`);
  };

  return (
    <main className="page-container" style={{ paddingBlock: '2rem 3.5rem' }}>
      {/* Search Card */}
      <section className="card" style={{ padding: '1.35rem 1.5rem', marginBottom: '1.5rem' }}>
        <search>
          <form
            onSubmit={handleSearch}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '1.25rem',
              flexWrap: 'wrap',
            }}
          >
            <div>
              <h1 style={{ margin: '0 0 0.25rem', fontSize: '1.35rem', fontWeight: 700 }}>
                {t.trackTitle}
              </h1>
              <p style={{ margin: 0, fontSize: '0.86rem', color: 'var(--text-secondary)' }}>
                {t.trackSubtitle}
              </p>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flex: '1 1 320px', maxWidth: 460 }}>
              <label htmlFor="tracking-search-input" className="visually-hidden">
                Tracking ID
              </label>
              <input
                id="tracking-search-input"
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="SC-2026-04812"
                autoCorrect="off"
                autoCapitalize="none"
                spellCheck={false}
                style={{
                  flex: 1,
                  minHeight: 44,
                  padding: '0.55rem 0.9rem',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border-strong)',
                  fontWeight: 600,
                }}
              />
              <button type="submit" className="btn btn-primary">
                <Search size={16} aria-hidden="true" />
                {t.searchBtn}
              </button>
            </div>
          </form>
        </search>

        {/* Quick-try sample tracking IDs */}
        <div
          style={{
            marginTop: '0.85rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            flexWrap: 'wrap',
            fontSize: '0.78rem',
            color: 'var(--text-muted)',
          }}
        >
          <span>Sample IDs:</span>
          {complaints.slice(0, 4).map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => {
                setQuery(c.trackingCode);
                setSelectedCode(c.trackingCode);
              }}
              style={{
                border: '1px solid var(--border-subtle)',
                background:
                  matched?.trackingCode === c.trackingCode ? 'var(--bg-plum-pill)' : 'var(--bg-subtle)',
                color: matched?.trackingCode === c.trackingCode ? 'var(--plum)' : 'var(--text-secondary)',
                borderRadius: 'var(--radius-pill)',
                padding: '0.2rem 0.65rem',
                fontSize: '0.76rem',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {c.trackingCode}
            </button>
          ))}
        </div>
      </section>

      {!matched ? (
        <div className="card" style={{ padding: '2rem', textAlign: 'center' }}>
          <h2 style={{ margin: '0 0 0.4rem', fontSize: '1.1rem' }}>Tracking ID not found</h2>
          <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
            No complaint matched <strong>{selectedCode}</strong>. Check the code or pick one of the
            sample IDs above.
          </p>
        </div>
      ) : (
        <div className="confirmation-grid" style={{ alignItems: 'start' }}>
          {/* Progress Timeline Card */}
          <section className="card" style={{ padding: '1.45rem 1.6rem' }} aria-label="Complaint progress">
            <h2 style={{ fontSize: '1.05rem', fontWeight: 700, margin: '0 0 1.25rem' }}>
              {t.progressTitle}
            </h2>

            <ol
              style={{
                listStyle: 'none',
                margin: '0 0 1.35rem',
                padding: 0,
                display: 'flex',
                flexDirection: 'column',
              }}
            >
              {matched.timeline.map((step, idx) => {
                const isLast = idx === matched.timeline.length - 1;
                return (
                  <li
                    key={step.id}
                    style={{
                      display: 'flex',
                      gap: '1rem',
                      position: 'relative',
                      paddingBottom: isLast ? 0 : '1.4rem',
                    }}
                  >
                    {!isLast && (
                      <span
                        aria-hidden="true"
                        style={{
                          position: 'absolute',
                          left: 13,
                          top: 28,
                          bottom: 0,
                          width: 2,
                          background: step.completed ? 'var(--plum)' : '#e7d9de',
                        }}
                      />
                    )}
                    <span
                      aria-hidden="true"
                      style={{
                        width: 28,
                        height: 28,
                        borderRadius: '50%',
                        flexShrink: 0,
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        background: step.completed ? 'var(--plum)' : '#fff',
                        color: step.completed ? '#fff' : 'var(--plum)',
                        border: step.completed
                          ? '2px solid var(--plum)'
                          : step.current
                          ? '2px solid var(--plum)'
                          : '2px solid #dfd0d6',
                      }}
                    >
                      {step.completed ? <Check size={14} /> : null}
                    </span>

                    <div style={{ paddingTop: 1 }}>
                      <div
                        style={{
                          fontWeight: 700,
                          fontSize: '0.94rem',
                          color: step.current ? 'var(--plum)' : 'var(--text-primary)',
                        }}
                      >
                        {lang === 'bn' ? step.titleBn : step.titleEn}
                      </div>
                      <div style={{ fontSize: '0.84rem', color: 'var(--text-secondary)' }}>
                        {step.detail}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>

            {matched.departmentNote && (
              <div
                style={{
                  background: 'var(--bg-peach)',
                  border: '1px solid #f2cfc0',
                  borderRadius: 'var(--radius-md)',
                  padding: '0.85rem 1.05rem',
                  fontSize: '0.88rem',
                  color: '#5a2f22',
                }}
              >
                {matched.departmentNote}
              </div>
            )}
          </section>

          {/* Right Summary + Escalate */}
          <aside style={{ display: 'flex', flexDirection: 'column', gap: '1.1rem' }}>
            <div className="card" style={{ padding: '1.3rem 1.4rem' }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '0.5rem',
                  marginBottom: '0.75rem',
                }}
              >
                <strong style={{ fontSize: '0.95rem' }}>{matched.trackingCode}</strong>
                <CategoryChip category={matched.category} />
              </div>
              <p style={{ margin: '0 0 0.65rem', fontSize: '0.9rem', color: 'var(--text-primary)' }}>
                {matched.finalText}
              </p>
              <div
                style={{
                  fontSize: '0.8rem',
                  color: 'var(--text-muted)',
                  paddingBottom: '0.85rem',
                  borderBottom: '1px solid var(--border-subtle)',
                  marginBottom: '0.85rem',
                }}
              >
                {matched.areaText}
              </div>
              <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                Handled by: <strong style={{ color: 'var(--text-primary)' }}>{matched.departmentEn}</strong>
              </div>
            </div>

            <div className="card" style={{ padding: '1.3rem 1.4rem' }}>
              <h2 style={{ fontSize: '0.95rem', fontWeight: 700, margin: '0 0 0.45rem' }}>
                {t.ifUnresolvedTitle}
              </h2>
              <p style={{ margin: '0 0 1rem', fontSize: '0.84rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                {t.ifUnresolvedBody}
              </p>
              <button
                type="button"
                className="btn btn-outline"
                style={{ width: '100%', color: 'var(--plum)', borderColor: 'var(--border-strong)' }}
                onClick={() => escalateDialogRef.current?.showModal()}
                disabled={matched.status === 'escalated'}
              >
                {matched.status === 'escalated' ? 'Escalated to Ward Councillor' : t.escalateBtn}
              </button>
            </div>
          </aside>
        </div>
      )}

      {/* Escalation Modal */}
      <dialog ref={escalateDialogRef} aria-labelledby="escalate-dialog-title">
        <form onSubmit={handleEscalateSubmit} style={{ padding: '1.5rem' }}>
          <h1 id="escalate-dialog-title" style={{ fontSize: '1.15rem', fontWeight: 700, margin: '0 0 0.45rem' }}>
            Escalate complaint {matched?.trackingCode}
          </h1>
          <p style={{ margin: '0 0 1rem', fontSize: '0.88rem', color: 'var(--text-secondary)' }}>
            This forwards your complaint to the Ward Councillor&apos;s office for SLA review.
          </p>
          <label
            htmlFor="escalation-reason"
            style={{ display: 'block', fontWeight: 600, fontSize: '0.85rem', marginBottom: '0.35rem' }}
          >
            Reason for escalation
          </label>
          <textarea
            id="escalation-reason"
            rows={3}
            required
            autoFocus
            value={escalationReason}
            onChange={(e) => setEscalationReason(e.target.value)}
            style={{
              width: '100%',
              padding: '0.65rem 0.85rem',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border-strong)',
              marginBottom: '1.1rem',
            }}
          />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.65rem' }}>
            <button
              type="button"
              className="btn btn-outline"
              onClick={() => escalateDialogRef.current?.close()}
            >
              Cancel
            </button>
            <button type="submit" className="btn btn-primary">
              Confirm escalation
            </button>
          </div>
        </form>
      </dialog>
    </main>
  );
}
