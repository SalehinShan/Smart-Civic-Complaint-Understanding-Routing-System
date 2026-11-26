import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  BarChart3,
  ChevronDown,
  FlaskConical,
  Pause,
  Play,
  Settings,
} from 'lucide-react';
import { CATEGORIES, CATEGORY_MAP, DEFAULT_DEPARTMENT_COUNTS } from '../data/seed';
import { CategoryCode, ComplaintRecord, ComplaintStatus } from '../types/complaint';
import { AppPortal } from '../components/CitizenHeader';
import { bindModalLightDismiss } from '../utils/formAriaSync';
import { CategoryChip } from '../components/CategoryBadge';

interface AdminDashboardPageProps {
  complaints: ComplaintRecord[];
  onConfirmAndRoute: (complaintId: string, finalCategory: CategoryCode) => void;
  onAddNote: (complaintId: string, note: string, isPublic: boolean) => void;
  onNavigatePortal: (portal: AppPortal) => void;
  onToast: (msg: string) => void;
}

type AdminSection = 'all' | 'needs_review' | CategoryCode | 'analytics' | 'settings';

const STATUS_LABELS: Record<ComplaintStatus, string> = {
  submitted: 'Submitted',
  needs_review: 'Needs review',
  assigned: 'Assigned',
  in_progress: 'In progress',
  resolved: 'Resolved',
  rejected: 'Rejected',
  escalated: 'Escalated',
};

export function AdminDashboardPage({
  complaints,
  onConfirmAndRoute,
  onAddNote,
  onNavigatePortal,
  onToast,
}: AdminDashboardPageProps) {
  const [section, setSection] = useState<AdminSection>('all');
  const [selectedId, setSelectedId] = useState<string>('cmp-4807');
  const [categoryFilter, setCategoryFilter] = useState<string>('All');
  const [dialectFilter, setDialectFilter] = useState<string>('All');
  const [statusFilter, setStatusFilter] = useState<string>('All');
  const [dateRange, setDateRange] = useState<string>('7d');

  // Inspector state
  const [finalCategory, setFinalCategory] = useState<CategoryCode>('Electricity');
  const [showQwenReason, setShowQwenReason] = useState(true);
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);
  const [audioProgress, setAudioProgress] = useState(0.33);

  // Add note modal state
  const noteDialogRef = useRef<HTMLDialogElement>(null);
  const [noteBody, setNoteBody] = useState('');
  const [noteIsPublic, setNoteIsPublic] = useState(true);

  // Settings state (ML registry)
  const [primaryClassifier, setPrimaryClassifier] = useState<'lora' | 'qwen'>('lora');
  const [primaryAsr, setPrimaryAsr] = useState<'regional_whisper' | 'groq_whisper'>(
    'regional_whisper',
  );
  const [autoRouteThreshold, setAutoRouteThreshold] = useState(0.75);

  useEffect(() => {
    return bindModalLightDismiss(noteDialogRef.current);
  }, []);

  // Audio playback simulation or real <audio>
  const audioRef = useRef<HTMLAudioElement | null>(null);
  useEffect(() => {
    if (!isPlayingAudio) return;
    const timer = setInterval(() => {
      setAudioProgress((prev) => {
        if (prev >= 1) {
          setIsPlayingAudio(false);
          return 0;
        }
        return prev + 0.04;
      });
    }, 350);
    return () => clearInterval(timer);
  }, [isPlayingAudio]);

  const filteredComplaints = useMemo(() => {
    return complaints.filter((c) => {
      if (section === 'needs_review' && !c.needsReview) return false;
      if (
        section !== 'all' &&
        section !== 'needs_review' &&
        section !== 'analytics' &&
        section !== 'settings' &&
        c.category !== section
      ) {
        return false;
      }
      if (categoryFilter !== 'All' && c.category !== categoryFilter) return false;
      if (dialectFilter !== 'All' && c.detectedDialect !== dialectFilter) return false;
      if (statusFilter === 'Open' && (c.status === 'resolved' || c.status === 'rejected'))
        return false;
      if (statusFilter !== 'All' && statusFilter !== 'Open' && c.status !== statusFilter)
        return false;
      return true;
    });
  }, [complaints, section, categoryFilter, dialectFilter, statusFilter]);

  const selectedComplaint =
    complaints.find((c) => c.id === selectedId) || filteredComplaints[0] || complaints[0];

  useEffect(() => {
    if (selectedComplaint) {
      setFinalCategory(selectedComplaint.category);
      setIsPlayingAudio(false);
      setAudioProgress(selectedComplaint.id === 'cmp-4807' ? 0.33 : 0);
    }
  }, [selectedComplaint?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Department counts combining baseline Chattogram dataset counts + live changes
  const deptCounts = useMemo(() => {
    const counts = { ...DEFAULT_DEPARTMENT_COUNTS };
    const extraComplaints = complaints.filter((c) => !c.id.startsWith('cmp-4'));
    extraComplaints.forEach((c) => {
      counts[c.category] = (counts[c.category] || 0) + 1;
    });
    return counts;
  }, [complaints]);

  const totalOpenCount = useMemo(
    () => Object.values(deptCounts).reduce((a, b) => a + b, 0),
    [deptCounts],
  );

  const liveNeedsReviewCount = useMemo(() => {
    const baseDelta = complaints.filter((c) => c.needsReview).length - 2;
    return Math.max(0, 23 + baseDelta);
  }, [complaints]);

  const liveNewToday = 38 + complaints.filter((c) => !c.id.startsWith('cmp-4')).length;
  const liveCorrectionCount = complaints.filter((c) => c.citizenCorrected).length;
  const correctionPct = (4.1 + liveCorrectionCount * 0.2).toFixed(1);

  const togglePlayAudio = () => {
    if (selectedComplaint?.audioUrl) {
      if (!audioRef.current) {
        audioRef.current = new Audio(selectedComplaint.audioUrl);
        audioRef.current.onended = () => setIsPlayingAudio(false);
      }
      if (isPlayingAudio) {
        audioRef.current.pause();
        setIsPlayingAudio(false);
      } else {
        audioRef.current.play().catch(() => {});
        setIsPlayingAudio(true);
      }
      return;
    }
    setIsPlayingAudio((p) => !p);
  };

  const handleSaveNote = (e: FormEvent) => {
    e.preventDefault();
    if (!selectedComplaint || !noteBody.trim()) return;
    onAddNote(selectedComplaint.id, noteBody.trim(), noteIsPublic);
    setNoteBody('');
    noteDialogRef.current?.close();
    onToast(
      noteIsPublic
        ? `Public department note added to ${selectedComplaint.trackingCode}`
        : `Internal officer note saved on ${selectedComplaint.trackingCode}`,
    );
  };

  const durationSec = selectedComplaint?.audioDurationSec || 12;
  const currentSec = Math.round(audioProgress * durationSec);
  const fmtSec = (s: number) => `0:${String(s).padStart(2, '0')}`;

  const headingTitle =
    section === 'all'
      ? 'All complaints'
      : section === 'needs_review'
      ? 'Needs review'
      : section === 'analytics'
      ? 'Analytics & Dialect Telemetry'
      : section === 'settings'
      ? 'Model & Routing Settings'
      : `${section} queue`;

  return (
    <div className="admin-shell">
      {/* Left Sidebar */}
      <aside className="admin-sidebar" aria-label="Admin navigation">
        <div>
          <div className="admin-brand">Nagorik Sheba · Admin</div>

          <nav aria-label="Complaint queues">
            <button
              type="button"
              className="admin-nav-item"
              aria-current={section === 'all' ? 'page' : undefined}
              onClick={() => setSection('all')}
            >
              <span>All complaints</span>
              <span style={{ opacity: 0.78, fontSize: '0.8rem' }}>{totalOpenCount}</span>
            </button>
            <button
              type="button"
              className="admin-nav-item"
              aria-current={section === 'needs_review' ? 'page' : undefined}
              onClick={() => setSection('needs_review')}
            >
              <span>Needs review</span>
              <span style={{ opacity: 0.78, fontSize: '0.8rem' }}>{liveNeedsReviewCount}</span>
            </button>

            <div className="admin-section-label">Department queues</div>
            {CATEGORIES.map((cat) => (
              <button
                key={cat.code}
                type="button"
                className="admin-nav-item"
                aria-current={section === cat.code ? 'page' : undefined}
                onClick={() => setSection(cat.code)}
              >
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.55rem' }}>
                  <span
                    aria-hidden="true"
                    style={{
                      width: 7,
                      height: 7,
                      borderRadius: '50%',
                      background: cat.dotColor,
                      flexShrink: 0,
                    }}
                  />
                  {cat.nameEn}
                </span>
                <span style={{ opacity: 0.75, fontSize: '0.8rem' }}>{deptCounts[cat.code]}</span>
              </button>
            ))}
          </nav>
        </div>

        <div style={{ borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '0.75rem' }}>
          <button
            type="button"
            className="admin-nav-item"
            onClick={() => onNavigatePortal('model-lab')}
          >
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
              <FlaskConical size={15} aria-hidden="true" />
              Model Lab
            </span>
          </button>
          <button
            type="button"
            className="admin-nav-item"
            aria-current={section === 'analytics' ? 'page' : undefined}
            onClick={() => setSection('analytics')}
          >
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
              <BarChart3 size={15} aria-hidden="true" />
              Analytics
            </span>
          </button>
          <button
            type="button"
            className="admin-nav-item"
            aria-current={section === 'settings' ? 'page' : undefined}
            onClick={() => setSection('settings')}
          >
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
              <Settings size={15} aria-hidden="true" />
              Settings
            </span>
          </button>
          <button
            type="button"
            className="admin-nav-item"
            onClick={() => onNavigatePortal('citizen')}
            style={{ marginTop: '0.35rem', color: 'rgba(255,255,255,0.65)' }}
          >
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
              <ArrowLeft size={15} aria-hidden="true" />
              Citizen Portal
            </span>
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="admin-main">
        <div className="admin-topbar">
          <div>
            <h1 style={{ margin: 0, fontSize: '1.45rem', fontWeight: 700 }}>{headingTitle}</h1>
            <p style={{ margin: '0.15rem 0 0', fontSize: '0.82rem', color: 'var(--text-muted)' }}>
              Sample data · Chattogram City Corporation
            </p>
          </div>

          {section !== 'analytics' && section !== 'settings' && (
            <div className="filter-row" role="group" aria-label="Filter complaints">
              <select
                aria-label="Filter by category"
                className="filter-pill-select"
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
              >
                <option value="All">Category: All</option>
                {CATEGORIES.map((c) => (
                  <option key={c.code} value={c.code}>
                    Category: {c.nameEn}
                  </option>
                ))}
              </select>

              <select
                aria-label="Filter by dialect"
                className="filter-pill-select"
                value={dialectFilter}
                onChange={(e) => setDialectFilter(e.target.value)}
              >
                <option value="All">Dialect: All</option>
                <option value="chittagong">Dialect: Chittagong</option>
                <option value="standard">Dialect: Standard</option>
                <option value="barishal">Dialect: Barishal</option>
                <option value="noakhali">Dialect: Noakhali</option>
                <option value="sylhet">Dialect: Sylhet</option>
              </select>

              <select
                aria-label="Filter by status"
                className="filter-pill-select"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                <option value="All">Status: All</option>
                <option value="Open">Status: Open</option>
                <option value="needs_review">Status: Needs review</option>
                <option value="assigned">Status: Assigned</option>
                <option value="in_progress">Status: In progress</option>
                <option value="resolved">Status: Resolved</option>
              </select>

              <select
                aria-label="Date range"
                className="filter-pill-select"
                value={dateRange}
                onChange={(e) => setDateRange(e.target.value)}
              >
                <option value="7d">Last 7 days</option>
                <option value="30d">Last 30 days</option>
                <option value="all">All time</option>
              </select>
            </div>
          )}
        </div>

        {/* Analytics View */}
        {section === 'analytics' ? (
          <div style={{ display: 'grid', gap: '1.25rem' }}>
            <div className="kpi-grid">
              <div className="card kpi-card">
                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Model agreement</div>
                <div className="kpi-value">91.4%</div>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                  LoRA mDeBERTa & Qwen agree
                </div>
              </div>
              <div className="card kpi-card">
                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Voice share</div>
                <div className="kpi-value">36.8%</div>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                  transcribed via Regional ASR
                </div>
              </div>
              <div className="card kpi-card">
                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Dialect traffic</div>
                <div className="kpi-value">62%</div>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                  regional Bangla or Banglish
                </div>
              </div>
              <div className="card kpi-card">
                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Retraining queue</div>
                <div className="kpi-value">{17 + liveCorrectionCount}</div>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                  verified corrections ready
                </div>
              </div>
            </div>

            <div className="card" style={{ padding: '1.5rem' }}>
              <h2 style={{ fontSize: '1.05rem', margin: '0 0 1rem' }}>
                Department SLA & Open Volume
              </h2>
              <div style={{ display: 'grid', gap: '0.85rem' }}>
                {CATEGORIES.map((cat) => {
                  const count = deptCounts[cat.code];
                  const pct = Math.round((count / 100) * 100);
                  return (
                    <div key={cat.code}>
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          fontSize: '0.86rem',
                          marginBottom: '0.3rem',
                        }}
                      >
                        <span style={{ fontWeight: 600 }}>
                          {cat.nameEn} · {cat.departmentEn}
                        </span>
                        <span style={{ color: 'var(--text-secondary)' }}>{count} open</span>
                      </div>
                      <div
                        style={{
                          height: 9,
                          background: '#f2e8ec',
                          borderRadius: 999,
                          overflow: 'hidden',
                        }}
                      >
                        <div
                          style={{
                            width: `${Math.min(100, pct)}%`,
                            height: '100%',
                            background: cat.dotColor,
                            borderRadius: 999,
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        ) : section === 'settings' ? (
          <div className="card" style={{ padding: '1.5rem', maxWidth: 680 }}>
            <h2 style={{ fontSize: '1.05rem', margin: '0 0 0.4rem' }}>
              Active ML Pipeline Configuration
            </h2>
            <p style={{ margin: '0 0 1.25rem', fontSize: '0.86rem', color: 'var(--text-secondary)' }}>
              Matches the `ml_models` registry in `sccu.sql`. At most one primary classifier and one
              primary ASR model run for citizen-facing auto-routing.
            </p>

            <div style={{ display: 'grid', gap: '1rem' }}>
              <div>
                <label
                  htmlFor="primary-classifier-select"
                  style={{ display: 'block', fontWeight: 600, fontSize: '0.86rem', marginBottom: '0.35rem' }}
                >
                  Primary classifier
                </label>
                <select
                  id="primary-classifier-select"
                  className="brand-select"
                  value={primaryClassifier}
                  onChange={(e) => setPrimaryClassifier(e.target.value as 'lora' | 'qwen')}
                >
                  <option value="lora">LoRA mDeBERTa (local · mdeberta_lora_robust_model)</option>
                  <option value="qwen">Qwen via Groq (qwen/qwen3.8-27b)</option>
                </select>
              </div>

              <div>
                <label
                  htmlFor="primary-asr-select"
                  style={{ display: 'block', fontWeight: 600, fontSize: '0.86rem', marginBottom: '0.35rem' }}
                >
                  Primary ASR (voice complaints)
                </label>
                <select
                  id="primary-asr-select"
                  className="brand-select"
                  value={primaryAsr}
                  onChange={(e) =>
                    setPrimaryAsr(e.target.value as 'regional_whisper' | 'groq_whisper')
                  }
                >
                  <option value="regional_whisper">
                    Regional Whisper (bengaliAI/tugstugi_bengaliai-regional-asr_whisper-medium)
                  </option>
                  <option value="groq_whisper">Groq Whisper (whisper-large-v3)</option>
                </select>
              </div>

              <div>
                <label
                  htmlFor="threshold-range"
                  style={{ display: 'block', fontWeight: 600, fontSize: '0.86rem', marginBottom: '0.35rem' }}
                >
                  Review confidence threshold: {autoRouteThreshold.toFixed(2)}
                </label>
                <input
                  id="threshold-range"
                  type="range"
                  min={0.5}
                  max={0.95}
                  step={0.05}
                  value={autoRouteThreshold}
                  onChange={(e) => setAutoRouteThreshold(Number(e.target.value))}
                  style={{ width: '100%', accentColor: 'var(--plum)' }}
                />
              </div>

              <div>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => onToast('Routing thresholds saved for backend sync.')}
                >
                  Save configuration
                </button>
              </div>
            </div>
          </div>
        ) : (
          <>
            {/* 4 KPI Cards */}
            <section className="kpi-grid" aria-label="Key metrics">
              <div className="card kpi-card">
                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>New today</div>
                <div className="kpi-value">{liveNewToday}</div>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                  14 by voice
                </div>
              </div>
              <div className="card kpi-card">
                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Needs review</div>
                <div className="kpi-value">{liveNeedsReviewCount}</div>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                  models disagree or low confidence
                </div>
              </div>
              <div className="card kpi-card">
                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Avg. resolution</div>
                <div className="kpi-value">2.4 d</div>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                  open complaints
                </div>
              </div>
              <div className="card kpi-card">
                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                  Citizen corrections
                </div>
                <div className="kpi-value">{correctionPct}%</div>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                  saved for retraining
                </div>
              </div>
            </section>

            {/* Split Table + Inspector */}
            <div className="admin-workspace-grid">
              <section className="card" style={{ overflow: 'hidden' }}>
                <div
                  tabIndex={0}
                  role="region"
                  aria-labelledby="complaints-table-caption"
                  className="table-wrapper"
                >
                  <table className="complaints-table">
                    <caption id="complaints-table-caption" className="visually-hidden">
                      Civic complaints queue with LoRA mDeBERTa and Qwen predictions
                    </caption>
                    <thead>
                      <tr>
                        <th scope="col">ID</th>
                        <th scope="col">COMPLAINT</th>
                        <th scope="col">LORA</th>
                        <th scope="col">QWEN</th>
                        <th scope="col">STATUS</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredComplaints.map((c) => {
                        const disagree =
                          c.loraPred !== null &&
                          c.qwenPred !== null &&
                          c.loraPred !== c.qwenPred;
                        const isSelected = selectedComplaint?.id === c.id;
                        return (
                          <tr
                            key={c.id}
                            className={`${c.needsReview ? 'is-alert' : ''} ${
                              isSelected ? 'is-selected' : ''
                            }`}
                            onClick={() => setSelectedId(c.id)}
                          >
                            <th scope="row">{c.shortId}</th>
                            <td data-label="Complaint">
                              <div
                                style={{
                                  color: 'var(--text-primary)',
                                  fontWeight: 500,
                                  lineHeight: 1.4,
                                  marginBottom: '0.2rem',
                                }}
                              >
                                {c.finalText}
                              </div>
                              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                {c.detectedDialect === 'standard' && c.detectedScript === 'banglish'
                                  ? 'Banglish'
                                  : c.detectedDialect.charAt(0).toUpperCase() +
                                    c.detectedDialect.slice(1)}{' '}
                                · {c.inputMode} · {c.zoneLabel}
                              </div>
                            </td>
                            <td data-label="LoRA" style={{ whiteSpace: 'nowrap', fontWeight: 500 }}>
                              {c.loraPred ?? 'Unavailable'}
                            </td>
                            <td
                              data-label="Qwen"
                              style={{
                                whiteSpace: 'nowrap',
                                fontWeight: disagree ? 700 : 500,
                                color: disagree ? 'var(--warning-text)' : 'inherit',
                              }}
                            >
                              {c.qwenPred ?? 'Unavailable'}
                            </td>
                            <td data-label="Status">
                              <span className={`status-badge status-${c.status}`}>
                                {STATUS_LABELS[c.status]}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                      {filteredComplaints.length === 0 && (
                        <tr>
                          <td colSpan={5} style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
                            No complaints match the current filters.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </section>

              {/* Right Complaint Inspector Drawer */}
              {selectedComplaint && (
                <aside className="card" style={{ padding: '1.25rem 1.35rem' }} aria-label="Complaint review inspector">
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '0.5rem',
                      marginBottom: '0.65rem',
                    }}
                  >
                    <strong style={{ fontSize: '1.05rem' }}>{selectedComplaint.trackingCode}</strong>
                    {selectedComplaint.loraPred !== null &&
                    selectedComplaint.qwenPred !== null &&
                    selectedComplaint.loraPred !== selectedComplaint.qwenPred ? (
                      <span
                        style={{
                          background: 'var(--bg-peach)',
                          color: 'var(--warning-text)',
                          padding: '0.22rem 0.65rem',
                          borderRadius: 'var(--radius-pill)',
                          fontSize: '0.76rem',
                          fontWeight: 700,
                        }}
                      >
                        Models disagree
                      </span>
                    ) : (
                      <CategoryChip category={selectedComplaint.category} />
                    )}
                  </div>

                  <p style={{ margin: '0 0 1rem', fontSize: '0.92rem', lineHeight: 1.55 }}>
                    {selectedComplaint.finalText}
                  </p>

                  {/* Audio Player for Voice Complaints */}
                  {selectedComplaint.inputMode === 'voice' && (
                    <div
                      style={{
                        background: 'var(--bg-peach-soft)',
                        border: '1px solid #f3dcd0',
                        borderRadius: 'var(--radius-md)',
                        padding: '0.6rem 0.85rem',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.75rem',
                        marginBottom: '1rem',
                      }}
                    >
                      <button
                        type="button"
                        onClick={togglePlayAudio}
                        aria-label={isPlayingAudio ? 'Pause voice recording' : 'Play voice recording'}
                        style={{
                          width: 34,
                          height: 34,
                          borderRadius: '50%',
                          border: 0,
                          background: 'var(--plum)',
                          color: '#fff',
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          cursor: 'pointer',
                          flexShrink: 0,
                        }}
                      >
                        {isPlayingAudio ? <Pause size={14} /> : <Play size={14} />}
                      </button>

                      <div
                        role="progressbar"
                        aria-valuenow={Math.round(audioProgress * 100)}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        style={{
                          flex: 1,
                          height: 4,
                          background: '#e5d4d9',
                          borderRadius: 999,
                          position: 'relative',
                        }}
                      >
                        <div
                          style={{
                            width: `${Math.round(audioProgress * 100)}%`,
                            height: '100%',
                            background: 'var(--plum)',
                            borderRadius: 999,
                          }}
                        />
                      </div>

                      <span style={{ fontSize: '0.76rem', color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums' }}>
                        {fmtSec(currentSec)} / {fmtSec(durationSec)}
                      </span>
                    </div>
                  )}

                  {/* LoRA vs Qwen Comparison Boxes */}
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr 1fr',
                      gap: '0.65rem',
                      marginBottom: '0.85rem',
                    }}
                  >
                    <div
                      style={{
                        border: '1px solid var(--border-subtle)',
                        borderRadius: 'var(--radius-md)',
                        padding: '0.7rem 0.8rem',
                      }}
                    >
                      <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', marginBottom: '0.2rem' }}>
                        LoRA mDeBERTa
                      </div>
                      <div style={{ fontWeight: 700, fontSize: '0.92rem' }}>
                        {selectedComplaint.loraPred ?? 'Unavailable'}
                      </div>
                      <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                        {selectedComplaint.loraConf.toFixed(2)}
                      </div>
                    </div>

                    <div
                      style={{
                        border: '1px solid var(--border-subtle)',
                        borderRadius: 'var(--radius-md)',
                        padding: '0.7rem 0.8rem',
                      }}
                    >
                      <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', marginBottom: '0.2rem' }}>
                        Qwen
                      </div>
                      <div style={{ fontWeight: 700, fontSize: '0.92rem' }}>
                        {selectedComplaint.qwenPred ?? 'Unavailable'}
                      </div>
                      <button
                        type="button"
                        onClick={() => setShowQwenReason((v) => !v)}
                        aria-expanded={showQwenReason}
                        style={{
                          background: 'none',
                          border: 0,
                          padding: 0,
                          fontSize: '0.78rem',
                          color: 'var(--text-secondary)',
                          cursor: 'pointer',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.2rem',
                        }}
                      >
                        reason <ChevronDown size={12} aria-hidden="true" />
                      </button>
                    </div>
                  </div>

                  {showQwenReason && (
                    <p
                      style={{
                        margin: '0 0 1rem',
                        fontSize: '0.84rem',
                        color: 'var(--text-secondary)',
                        lineHeight: 1.5,
                      }}
                    >
                      Qwen: {selectedComplaint.reason}
                    </p>
                  )}

                  {/* Final Category Select */}
                  <div style={{ marginBottom: '1rem' }}>
                    <label
                      htmlFor="inspector-final-category"
                      style={{
                        display: 'block',
                        fontWeight: 700,
                        fontSize: '0.82rem',
                        marginBottom: '0.4rem',
                      }}
                    >
                      Final category
                    </label>
                    <select
                      id="inspector-final-category"
                      className="brand-select"
                      value={finalCategory}
                      onChange={(e) => setFinalCategory(e.target.value as CategoryCode)}
                    >
                      {CATEGORIES.map((c) => (
                        <option key={c.code} value={c.code}>
                          {c.nameEn}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Action Buttons */}
                  <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      className="btn btn-primary"
                      style={{ flex: 1 }}
                      onClick={() => {
                        onConfirmAndRoute(selectedComplaint.id, finalCategory);
                        onToast(
                          `${selectedComplaint.trackingCode} routed to ${CATEGORY_MAP[finalCategory].departmentEn}`,
                        );
                      }}
                    >
                      Confirm & route
                    </button>
                    <button
                      type="button"
                      className="btn btn-outline"
                      onClick={() => noteDialogRef.current?.showModal()}
                    >
                      Add note
                    </button>
                  </div>

                  {selectedComplaint.internalNotes.length > 0 && (
                    <div
                      style={{
                        marginTop: '1rem',
                        paddingTop: '0.85rem',
                        borderTop: '1px solid var(--border-subtle)',
                      }}
                    >
                      <div style={{ fontSize: '0.74rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '0.35rem' }}>
                        Officer notes
                      </div>
                      <ul style={{ margin: 0, paddingLeft: '1rem', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                        {selectedComplaint.internalNotes.map((n, i) => (
                          <li key={i}>{n}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </aside>
              )}
            </div>
          </>
        )}
      </main>

      {/* Add Note Modal Dialog */}
      <dialog ref={noteDialogRef} aria-labelledby="note-dialog-title">
        <form onSubmit={handleSaveNote} style={{ padding: '1.5rem' }}>
          <h1 id="note-dialog-title" style={{ fontSize: '1.15rem', fontWeight: 700, margin: '0 0 0.45rem' }}>
            Add note to {selectedComplaint?.trackingCode}
          </h1>
          <p style={{ margin: '0 0 0.9rem', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
            Choose whether this note is visible on the citizen Track Status page or internal only.
          </p>

          <label
            htmlFor="admin-note-body"
            style={{ display: 'block', fontWeight: 600, fontSize: '0.85rem', marginBottom: '0.35rem' }}
          >
            Note
          </label>
          <textarea
            id="admin-note-body"
            rows={3}
            required
            autoFocus
            value={noteBody}
            onChange={(e) => setNoteBody(e.target.value)}
            placeholder="e.g., Feeder transformer inspection scheduled for 15:00."
            style={{
              width: '100%',
              padding: '0.65rem 0.85rem',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border-strong)',
              marginBottom: '0.85rem',
            }}
          />

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1.2rem' }}>
            <input
              id="note-public-checkbox"
              type="checkbox"
              checked={noteIsPublic}
              onChange={(e) => setNoteIsPublic(e.target.checked)}
              style={{ width: 18, height: 18, accentColor: 'var(--plum)' }}
            />
            <label htmlFor="note-public-checkbox" style={{ fontSize: '0.86rem' }}>
              Show on citizen Track Status page as department update
            </label>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.65rem' }}>
            <button
              type="button"
              className="btn btn-outline"
              onClick={() => noteDialogRef.current?.close()}
            >
              Cancel
            </button>
            <button type="submit" className="btn btn-primary">
              Save note
            </button>
          </div>
        </form>
      </dialog>
    </div>
  );
}
