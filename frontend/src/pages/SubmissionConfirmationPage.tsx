import { useEffect, useRef, useState } from 'react';
import { Check, Copy, MessageSquare } from 'lucide-react';
import { CATEGORIES, CATEGORY_MAP } from '../data/seed';
import { copy, Lang } from '../data/i18n';
import { CategoryCode, ComplaintRecord } from '../types/complaint';
import { CategoryIcon } from '../components/CategoryBadge';
import { bindModalLightDismiss } from '../utils/formAriaSync';

interface SubmissionConfirmationPageProps {
  lang: Lang;
  complaint: ComplaintRecord;
  onCorrectCategory: (complaintId: string, newCategory: CategoryCode) => void;
  onViewStatus: (trackingCode: string) => void;
  onFileAnother: () => void;
  onToast: (msg: string) => void;
}

export function SubmissionConfirmationPage({
  lang,
  complaint,
  onCorrectCategory,
  onViewStatus,
  onFileAnother,
  onToast,
}: SubmissionConfirmationPageProps) {
  const t = copy[lang];
  const smsDialogRef = useRef<HTMLDialogElement>(null);
  const [copied, setCopied] = useState(false);
  const [smsPhone, setSmsPhone] = useState(complaint.phone || '');

  const meta = CATEGORY_MAP[complaint.category];
  const modelsAgree =
    complaint.loraPred !== null &&
    complaint.qwenPred !== null &&
    complaint.loraPred === complaint.qwenPred;
  const modelComparisonSummary =
    complaint.loraPred === null || complaint.qwenPred === null
      ? 'One or more comparison models are unavailable; the result uses available classifiers.'
      : modelsAgree
        ? '✓ LoRA mDeBERTa and Qwen agree'
        : `Flagged for review (LoRA: ${complaint.loraPred}, Qwen: ${complaint.qwenPred})`;

  useEffect(() => {
    return bindModalLightDismiss(smsDialogRef.current);
  }, []);

  const handleCopyId = async () => {
    try {
      await navigator.clipboard.writeText(complaint.trackingCode);
    } catch {
      // Clipboard fallback ignored if blocked
    }
    setCopied(true);
    onToast(`Tracking ID ${complaint.trackingCode} copied`);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSendSms = (e: React.FormEvent) => {
    e.preventDefault();
    smsDialogRef.current?.close();
    onToast(`Tracking SMS queued for ${smsPhone || 'your number'}`);
  };

  return (
    <main className="page-container" style={{ paddingBlock: '2rem 3.5rem' }}>
      {/* Submitted Banner */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.9rem', marginBottom: '1.5rem' }}>
        <div
          aria-hidden="true"
          style={{
            width: 38,
            height: 38,
            borderRadius: '50%',
            background: 'var(--plum)',
            color: '#fff',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <Check size={20} />
        </div>
        <div>
          <h1 style={{ margin: 0, fontSize: '1.45rem', fontWeight: 700 }}>
            {t.submittedTitle}
          </h1>
          <p style={{ margin: '0.15rem 0 0', fontSize: '0.86rem', color: 'var(--text-secondary)' }}>
            Submitted {complaint.createdAt} · auto-routed to the right department
          </p>
        </div>
      </div>

      {/* Main 2-column grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1.75fr) minmax(260px, 0.9fr)',
          gap: '1.35rem',
          alignItems: 'start',
        }}
        className="confirmation-grid"
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
          {/* Prediction Result Card */}
          <section className="card" style={{ padding: '1.4rem 1.5rem' }} aria-label="Detected category">
            <div
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                justifyContent: 'space-between',
                gap: '1rem',
                flexWrap: 'wrap',
                marginBottom: '1.1rem',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.95rem' }}>
                <div
                  style={{
                    width: 52,
                    height: 52,
                    borderRadius: 'var(--radius-md)',
                    background: meta.chipBg,
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <CategoryIcon category={complaint.category} size={24} />
                </div>
                <div>
                  <div
                    style={{
                      fontSize: '0.72rem',
                      fontWeight: 700,
                      letterSpacing: '0.06em',
                      color: 'var(--text-muted)',
                    }}
                  >
                    {t.categoryUpper}
                  </div>
                  <div
                    style={{
                      fontSize: '1.35rem',
                      fontWeight: 800,
                      color: meta.chipFg,
                      lineHeight: 1.2,
                    }}
                  >
                    {complaint.category}
                  </div>
                  <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                    {meta.departmentBn}
                  </div>
                </div>
              </div>

              <div style={{ minWidth: 195 }}>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    fontSize: '0.82rem',
                    marginBottom: '0.35rem',
                  }}
                >
                  <span style={{ color: 'var(--text-secondary)' }}>{t.confidenceLabel}</span>
                  <strong style={{ color: 'var(--text-primary)' }}>
                    {complaint.confidence >= 0.8 ? 'High' : 'Moderate'} · {complaint.confidence.toFixed(2)}
                  </strong>
                </div>
                <div
                  style={{
                    height: 6,
                    borderRadius: 999,
                    background: '#efe3e7',
                    overflow: 'hidden',
                    marginBottom: '0.35rem',
                  }}
                >
                  <div
                    style={{
                      width: `${Math.round(complaint.confidence * 100)}%`,
                      height: '100%',
                      background: 'var(--plum)',
                      borderRadius: 999,
                    }}
                  />
                </div>
                <div style={{ fontSize: '0.77rem', color: 'var(--text-secondary)' }}>
                  {modelComparisonSummary}
                </div>
              </div>
            </div>

            {/* Why this category */}
            <div
              style={{
                background: 'var(--bg-peach-soft)',
                border: '1px solid #f4dfd4',
                borderRadius: 'var(--radius-md)',
                padding: '0.85rem 1rem',
                marginBottom: '1.1rem',
              }}
            >
              <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>
                {t.whyCategory}
              </div>
              <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--text-primary)' }}>
                {complaint.reason}
              </p>
            </div>

            <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: '0.95rem' }}>
              <div style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '0.35rem' }}>
                {t.yourComplaint}
              </div>
              <p style={{ margin: '0 0 0.35rem', fontSize: '0.95rem', color: 'var(--text-primary)' }}>
                {complaint.finalText}
              </p>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                {complaint.areaText}
              </div>
            </div>
          </section>

          {/* Citizen Correction Card */}
          <section className="card" style={{ padding: '1.25rem 1.5rem' }} aria-label="Category feedback">
            <h2 style={{ fontSize: '0.95rem', fontWeight: 700, margin: '0 0 0.85rem' }}>
              {t.wrongCatTitle}
            </h2>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.75rem' }}>
              {CATEGORIES.map((cat) => {
                const isSelected = complaint.category === cat.code;
                return (
                  <button
                    key={cat.code}
                    type="button"
                    aria-pressed={isSelected}
                    onClick={() => {
                      onCorrectCategory(complaint.id, cat.code);
                      onToast(`Category updated to ${cat.code} — saved for model retraining.`);
                    }}
                    style={{
                      padding: '0.45rem 0.95rem',
                      borderRadius: 'var(--radius-pill)',
                      fontSize: '0.84rem',
                      fontWeight: isSelected ? 700 : 500,
                      border: isSelected ? `2px solid ${cat.chipFg}` : '1px solid var(--border-strong)',
                      background: isSelected ? cat.chipBg : '#fff',
                      color: isSelected ? cat.chipFg : 'var(--text-primary)',
                      cursor: 'pointer',
                    }}
                  >
                    {cat.nameEn}
                  </button>
                );
              })}
            </div>
            <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              {complaint.citizenCorrected
                ? '✓ Correction recorded! Thank you — this sample is queued for LoRA mDeBERTa retraining.'
                : t.correctionSaved}
            </p>
          </section>
        </div>

        {/* Right Sidebar */}
        <aside style={{ display: 'flex', flexDirection: 'column', gap: '1.1rem' }}>
          <div
            className="card"
            style={{
              background: 'var(--bg-plum-deep)',
              color: '#fff',
              padding: '1.35rem 1.4rem',
              borderColor: 'var(--bg-plum-deep)',
            }}
          >
            <div style={{ fontSize: '0.76rem', opacity: 0.78, marginBottom: '0.35rem' }}>
              {t.trackingIdTitle}
            </div>
            <div
              style={{
                fontSize: '1.65rem',
                fontWeight: 800,
                letterSpacing: '0.02em',
                marginBottom: '1rem',
              }}
            >
              {complaint.trackingCode}
            </div>
            <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={handleCopyId}
                style={{
                  background: 'rgba(255,255,255,0.14)',
                  color: '#fff',
                  border: '1px solid rgba(255,255,255,0.2)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '0.45rem 0.85rem',
                  fontSize: '0.82rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.35rem',
                }}
              >
                <Copy size={14} aria-hidden="true" />
                {copied ? t.copied : t.copyId}
              </button>
              <button
                type="button"
                onClick={() => smsDialogRef.current?.showModal()}
                style={{
                  background: 'rgba(255,255,255,0.14)',
                  color: '#fff',
                  border: '1px solid rgba(255,255,255,0.2)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '0.45rem 0.85rem',
                  fontSize: '0.82rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.35rem',
                }}
              >
                <MessageSquare size={14} aria-hidden="true" />
                {t.sendSms}
              </button>
            </div>
          </div>

          <div className="card" style={{ padding: '1.35rem 1.4rem' }}>
            <h2 style={{ fontSize: '0.96rem', fontWeight: 700, margin: '0 0 0.55rem' }}>
              {t.nextStepsTitle}
            </h2>
            <p style={{ margin: '0 0 1.15rem', fontSize: '0.86rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              The {complaint.category} department sees your complaint in its queue now. You can
              check progress any time with your tracking ID.
            </p>
            <button
              type="button"
              className="btn btn-primary"
              style={{ width: '100%', marginBottom: '0.75rem' }}
              onClick={() => onViewStatus(complaint.trackingCode)}
            >
              {t.seeStatusBtn}
            </button>
            <div style={{ textAlign: 'center' }}>
              <button
                type="button"
                onClick={onFileAnother}
                style={{
                  background: 'none',
                  border: 0,
                  color: 'var(--plum)',
                  fontWeight: 600,
                  fontSize: '0.84rem',
                  textDecoration: 'underline',
                  cursor: 'pointer',
                }}
              >
                {t.fileAnother}
              </button>
            </div>
          </div>
        </aside>
      </div>

      {/* Native Modal Dialog for SMS confirmation */}
      <dialog ref={smsDialogRef} aria-labelledby="sms-dialog-title">
        <form onSubmit={handleSendSms} style={{ padding: '1.5rem' }}>
          <h1 id="sms-dialog-title" style={{ fontSize: '1.15rem', fontWeight: 700, margin: '0 0 0.45rem' }}>
            Send tracking ID via SMS
          </h1>
          <p style={{ margin: '0 0 1rem', fontSize: '0.88rem', color: 'var(--text-secondary)' }}>
            We will send <strong>{complaint.trackingCode}</strong> and department status updates to
            your phone.
          </p>
          <label
            htmlFor="sms-phone"
            style={{ display: 'block', fontWeight: 600, fontSize: '0.85rem', marginBottom: '0.35rem' }}
          >
            Mobile number
          </label>
          <input
            id="sms-phone"
            type="tel"
            inputMode="numeric"
            required
            autoFocus
            value={smsPhone}
            onChange={(e) => setSmsPhone(e.target.value)}
            placeholder="017XXXXXXXX"
            style={{
              width: '100%',
              minHeight: 44,
              padding: '0.5rem 0.8rem',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border-strong)',
              marginBottom: '1.15rem',
            }}
          />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.65rem' }}>
            <button
              type="button"
              className="btn btn-outline"
              onClick={() => smsDialogRef.current?.close()}
            >
              Cancel
            </button>
            <button type="submit" className="btn btn-primary">
              Send SMS
            </button>
          </div>
        </form>
      </dialog>
    </main>
  );
}
