import { ChangeEvent, FormEvent, useRef, useState } from 'react';
import { Camera, CheckCircle2, MapPin, Mic, Square, Volume2 } from 'lucide-react';
import { CATEGORIES, VOICE_SAMPLE_PRESETS } from '../data/seed';
import { copy, Lang } from '../data/i18n';
import { detectScriptAndDialect } from '../services/api';
import { useAccessibleFormValidation } from '../utils/formAriaSync';
import { CategoryChip } from '../components/CategoryBadge';

interface SubmitComplaintPageProps {
  lang: Lang;
  onSubmitComplaint: (payload: {
    text: string;
    inputMode: 'text' | 'voice';
    areaText: string;
    phone?: string;
    photoName?: string;
    audioDurationSec?: number;
    audioUrl?: string;
  }) => Promise<void>;
  onGoTrack: () => void;
}

export function SubmitComplaintPage({
  lang,
  onSubmitComplaint,
  onGoTrack,
}: SubmitComplaintPageProps) {
  const t = copy[lang];
  const formRef = useRef<HTMLFormElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordStartRef = useRef<number>(0);

  const [text, setText] = useState(
    'তিন দিন ধরি ট্যাংক পুরা শুকনা, মোটর চালাইলে খালি বাতাসের আওয়াজ আইয়ে।',
  );
  const [areaText, setAreaText] = useState('হালিশহর, ওয়ার্ড ২৬, চট্টগ্রাম');
  const [phone, setPhone] = useState('');
  const [photoName, setPhotoName] = useState<string | undefined>(undefined);
  const [geoCoords, setGeoCoords] = useState<string | undefined>(undefined);
  const [inputMode, setInputMode] = useState<'text' | 'voice'>('text');
  const [isRecording, setIsRecording] = useState(false);
  const [audioDurationSec, setAudioDurationSec] = useState<number | undefined>(undefined);
  const [audioUrl, setAudioUrl] = useState<string | undefined>(undefined);
  const [submitting, setSubmitting] = useState(false);
  const [voiceFeedback, setVoiceFeedback] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useAccessibleFormValidation(formRef, [lang]);

  const detection = detectScriptAndDialect(text);

  const toggleRecording = async () => {
    if (isRecording) {
      recorderRef.current?.stop();
      setIsRecording(false);
      return;
    }

    setVoiceFeedback(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      // Fallback to dialect voice sample if microphone API unavailable
      const sample = VOICE_SAMPLE_PRESETS[0];
      setText(sample.text);
      setInputMode('voice');
      setAudioDurationSec(11);
      setVoiceFeedback('Microphone unavailable in this context — loaded Chittagong voice sample.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      audioChunksRef.current = [];
      recordStartRef.current = Date.now();

      recorder.ondataavailable = (ev) => {
        if (ev.data.size > 0) audioChunksRef.current.push(ev.data);
      };

      recorder.onstop = () => {
        const elapsed = Math.max(2, Math.round((Date.now() - recordStartRef.current) / 1000));
        const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        const url = URL.createObjectURL(blob);
        setAudioUrl(url);
        setAudioDurationSec(elapsed);
        setInputMode('voice');
        stream.getTracks().forEach((track) => track.stop());

        // Populate ASR preview text if user hasn't typed custom text
        if (!text.trim()) {
          setText(VOICE_SAMPLE_PRESETS[0].regionalAsr);
        }
        setVoiceFeedback(
          `Voice clip captured (${elapsed}s). Regional ASR ready for classification.`,
        );
      };

      recorderRef.current = recorder;
      recorder.start();
      setIsRecording(true);
    } catch {
      const sample = VOICE_SAMPLE_PRESETS[0];
      setText(sample.text);
      setInputMode('voice');
      setAudioDurationSec(11);
      setVoiceFeedback('Mic permission declined — loaded sample dialect voice transcript.');
    }
  };

  const applySampleVoice = () => {
    const sample = VOICE_SAMPLE_PRESETS[1];
    setText(sample.text);
    setInputMode('voice');
    setAudioDurationSec(9);
    setVoiceFeedback(`Loaded sample regional voice (${sample.label}).`);
  };

  const handlePhotoSelect = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) setPhotoName(file.name);
  };

  const handleLocation = () => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const coords = `${pos.coords.latitude.toFixed(4)}, ${pos.coords.longitude.toFixed(4)}`;
          setGeoCoords(coords);
        },
        () => {
          setGeoCoords('22.3375, 91.7832 (Halishahar, Ward 26)');
        },
        { timeout: 3500 },
      );
    } else {
      setGeoCoords('22.3375, 91.7832 (Halishahar, Ward 26)');
    }
  };

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;

    if (!form.checkValidity()) {
      const firstInvalid = form.querySelector<HTMLElement>(':invalid');
      firstInvalid?.focus();
      return;
    }

    setSubmitting(true);
    setSubmitError(null);
    try {
      await onSubmitComplaint({
        text: text.trim(),
        inputMode,
        areaText: areaText.trim(),
        phone: phone.trim() || undefined,
        photoName,
        audioDurationSec,
        audioUrl,
      });
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'Complaint submission failed.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <section className="hero-banner" aria-labelledby="submit-hero-heading">
        <div className="page-container">
          <h1 id="submit-hero-heading">{t.heroTitle}</h1>
          <p>{t.heroSubtitle}</p>
        </div>
      </section>

      <main className="page-container">
        <div className="submit-grid">
          <div className="card" style={{ padding: '1.5rem 1.75rem' }}>
            {/* Voice input box */}
            <div
              style={{
                background: 'var(--bg-peach)',
                border: '1px solid #f5d8ca',
                borderRadius: 'var(--radius-md)',
                padding: '0.9rem 1.1rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '1rem',
                flexWrap: 'wrap',
                marginBottom: '1.35rem',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.9rem' }}>
                <button
                  type="button"
                  onClick={toggleRecording}
                  aria-pressed={isRecording}
                  aria-label={isRecording ? 'Stop voice recording' : 'Start voice recording'}
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: '50%',
                    border: 0,
                    background: isRecording ? 'var(--danger)' : 'var(--plum)',
                    color: '#fff',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    flexShrink: 0,
                  }}
                >
                  {isRecording ? <Square size={18} /> : <Mic size={20} />}
                </button>
                <div>
                  <div style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--text-primary)' }}>
                    {isRecording ? t.voiceRecording : t.voiceTitle}
                  </div>
                  <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                    {voiceFeedback || t.voiceSubtitle}
                  </div>
                </div>
              </div>

              <button
                type="button"
                className="btn btn-outline"
                onClick={applySampleVoice}
                style={{ minHeight: 36, padding: '0.35rem 0.75rem', fontSize: '0.8rem' }}
              >
                <Volume2 size={14} aria-hidden="true" />
                {t.voiceSampleBtn}
              </button>
            </div>

            {audioUrl && (
              <div style={{ marginBottom: '1rem' }}>
                <audio controls src={audioUrl} style={{ width: '100%', height: 36 }} />
              </div>
            )}

            <form ref={formRef} onSubmit={handleSubmit} noValidate aria-labelledby="submit-hero-heading">
              {submitError && (
                <p role="alert" className="error-msg" style={{ display: 'block', marginBottom: '1rem' }}>
                  {submitError}
                </p>
              )}
              {/* Complaint Text */}
              <div style={{ marginBottom: '1.15rem' }}>
                <label
                  htmlFor="complaint-text"
                  style={{ display: 'block', fontWeight: 600, fontSize: '0.9rem', marginBottom: '0.4rem' }}
                >
                  {t.complaintLabel} <span aria-hidden="true" style={{ color: 'var(--danger)' }}>*</span>
                </label>
                <textarea
                  ref={textareaRef}
                  id="complaint-text"
                  name="complaint_text"
                  rows={4}
                  maxLength={500}
                  required
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.nativeEvent.isComposing) {
                      formRef.current?.requestSubmit();
                    }
                  }}
                  placeholder={t.complaintPlaceholder}
                  data-error="complaint-text-error"
                  style={{
                    width: '100%',
                    padding: '0.85rem 1rem',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--border-strong)',
                    resize: 'vertical',
                    lineHeight: 1.55,
                    background: '#fff',
                  }}
                />
                <div id="complaint-text-error" className="error-msg">
                  <span role="img" aria-label="Error">⚠️</span>
                  {t.complaintError}
                </div>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginTop: '0.4rem',
                    fontSize: '0.8rem',
                    color: 'var(--text-muted)',
                    gap: '0.75rem',
                    flexWrap: 'wrap',
                  }}
                >
                  <span>{detection.label}</span>
                  <span>{text.length} / 500</span>
                </div>
              </div>

              {/* Area & Phone */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                  gap: '1rem',
                  marginBottom: '1.1rem',
                }}
              >
                <div>
                  <label
                    htmlFor="area-ward"
                    style={{ display: 'block', fontWeight: 600, fontSize: '0.88rem', marginBottom: '0.35rem' }}
                  >
                    {t.areaLabel}
                  </label>
                  <input
                    id="area-ward"
                    name="area_ward"
                    type="text"
                    autoComplete="street-address"
                    value={areaText}
                    onChange={(e) => setAreaText(e.target.value)}
                    placeholder={t.areaPlaceholder}
                    style={{
                      width: '100%',
                      minHeight: 44,
                      padding: '0.55rem 0.85rem',
                      borderRadius: 'var(--radius-sm)',
                      border: '1px solid var(--border-strong)',
                      background: '#fff',
                    }}
                  />
                </div>

                <div>
                  <label
                    htmlFor="citizen-phone"
                    style={{ display: 'block', fontWeight: 600, fontSize: '0.88rem', marginBottom: '0.35rem' }}
                  >
                    {t.phoneLabel}
                  </label>
                  <input
                    id="citizen-phone"
                    name="phone"
                    type="tel"
                    inputMode="numeric"
                    autoComplete="tel-national"
                    pattern="01[3-9][0-9]{8}"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="01XXXXXXXXX"
                    data-error="phone-error"
                    style={{
                      width: '100%',
                      minHeight: 44,
                      padding: '0.55rem 0.85rem',
                      borderRadius: 'var(--radius-sm)',
                      border: '1px solid var(--border-strong)',
                      background: '#fff',
                    }}
                  />
                  <div id="phone-error" className="error-msg">
                    <span role="img" aria-label="Error">⚠️</span>
                    {t.phoneError}
                  </div>
                </div>
              </div>

              {/* Photo & Geolocation buttons */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.75rem',
                  flexWrap: 'wrap',
                  paddingBottom: '1.25rem',
                  borderBottom: '1px solid var(--border-subtle)',
                  marginBottom: '1.25rem',
                }}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="visually-hidden"
                  onChange={handlePhotoSelect}
                  aria-label={t.addPhoto}
                />
                <button
                  type="button"
                  className="btn btn-outline"
                  onClick={() => fileInputRef.current?.click()}
                  style={{ borderStyle: 'dashed', minHeight: 40, fontSize: '0.86rem' }}
                >
                  <Camera size={16} aria-hidden="true" />
                  {photoName ? photoName : t.addPhoto}
                </button>

                <button
                  type="button"
                  className="btn btn-outline"
                  onClick={handleLocation}
                  style={{ borderStyle: 'dashed', minHeight: 40, fontSize: '0.86rem' }}
                >
                  <MapPin size={16} aria-hidden="true" />
                  {geoCoords ? geoCoords : t.addLocation}
                </button>

                {(photoName || geoCoords) && (
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.3rem',
                      fontSize: '0.8rem',
                      color: 'var(--success)',
                      fontWeight: 600,
                    }}
                  >
                    <CheckCircle2 size={14} aria-hidden="true" /> Attached
                  </span>
                )}
              </div>

              {/* Submit Row */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                <button type="submit" className="btn btn-primary" disabled={submitting}>
                  {submitting ? t.submittingBtn : t.submitBtn}
                </button>
                <span style={{ fontSize: '0.84rem', color: 'var(--text-muted)' }}>
                  {t.submitHint}
                </span>
              </div>
            </form>
          </div>

          {/* Right Info Sidebar */}
          <aside style={{ display: 'flex', flexDirection: 'column', gap: '1.15rem' }}>
            <div className="card" style={{ padding: '1.25rem 1.35rem' }}>
              <h2 style={{ fontSize: '1rem', fontWeight: 700, margin: '0 0 1rem' }}>
                {t.howTitle}
              </h2>
              <ol
                style={{
                  listStyle: 'none',
                  margin: 0,
                  padding: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.85rem',
                }}
              >
                {[t.howStep1, t.howStep2, t.howStep3].map((stepText, index) => (
                  <li
                    key={index}
                    style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem', fontSize: '0.88rem' }}
                  >
                    <span
                      aria-hidden="true"
                      style={{
                        width: 24,
                        height: 24,
                        borderRadius: '50%',
                        background: 'var(--bg-plum-pill)',
                        color: 'var(--plum)',
                        fontWeight: 700,
                        fontSize: '0.8rem',
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                      }}
                    >
                      {index + 1}
                    </span>
                    <span style={{ color: 'var(--text-secondary)', paddingTop: 2 }}>{stepText}</span>
                  </li>
                ))}
              </ol>
            </div>

            <div className="card" style={{ padding: '1.25rem 1.35rem' }}>
              <h2 style={{ fontSize: '1rem', fontWeight: 700, margin: '0 0 0.9rem' }}>
                {t.catsTitle}
              </h2>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '1rem' }}>
                {CATEGORIES.map((cat) => (
                  <CategoryChip key={cat.code} category={cat.code} />
                ))}
              </div>
              <button
                type="button"
                onClick={onGoTrack}
                style={{
                  background: 'none',
                  border: 0,
                  padding: 0,
                  color: 'var(--plum)',
                  fontWeight: 600,
                  fontSize: '0.86rem',
                  textDecoration: 'underline',
                  cursor: 'pointer',
                }}
              >
                {t.alreadyFiled}
              </button>
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
}
