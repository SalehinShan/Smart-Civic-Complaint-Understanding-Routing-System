import { ArrowRight, BrainCircuit, Mic, Route } from 'lucide-react';
import { CATEGORIES } from '../data/seed';
import { CategoryChip } from '../components/CategoryBadge';

export function HowItWorksPage({
  onStartComplaint,
  onOpenModelLab,
}: {
  onStartComplaint: () => void;
  onOpenModelLab: () => void;
}) {
  return (
    <main className="page-container" style={{ paddingBlock: '2.25rem 3.5rem' }}>
      <div className="card" style={{ padding: '2rem', marginBottom: '1.5rem' }}>
        <div
          style={{
            fontSize: '0.75rem',
            fontWeight: 700,
            letterSpacing: '0.07em',
            color: 'var(--plum)',
            marginBottom: '0.35rem',
          }}
        >
          CSE299 · ARCHITECTURE OVERVIEW
        </div>
        <h1 style={{ margin: '0 0 0.6rem', fontSize: '1.75rem', fontWeight: 800 }}>
          How Nagorik Sheba understands dialects & routes complaints
        </h1>
        <p style={{ margin: 0, color: 'var(--text-secondary)', maxWidth: 740 }}>
          Citizens can speak or write in Chittagong, Sylhet, Barishal, Noakhali, Standard Bangla,
          Banglish, or English. Two complementary models run in parallel so ambiguous cases are
          caught before routing.
        </p>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
          gap: '1.25rem',
          marginBottom: '1.5rem',
        }}
      >
        <div className="card" style={{ padding: '1.4rem' }}>
          <Mic size={22} color="var(--plum)" aria-hidden="true" />
          <h2 style={{ fontSize: '1.05rem', margin: '0.75rem 0 0.4rem' }}>
            1. Dialect-preserving ASR
          </h2>
          <p style={{ margin: 0, fontSize: '0.88rem', color: 'var(--text-secondary)' }}>
            Voice inputs are transcribed with Regional Whisper (`tugstugi/whisper-medium`) to
            preserve dialect cues alongside `whisper-large-v3` on Groq.
          </p>
        </div>

        <div className="card" style={{ padding: '1.4rem' }}>
          <BrainCircuit size={22} color="var(--plum)" aria-hidden="true" />
          <h2 style={{ fontSize: '1.05rem', margin: '0.75rem 0 0.4rem' }}>
            2. LoRA mDeBERTa + Qwen Verification
          </h2>
          <p style={{ margin: 0, fontSize: '0.88rem', color: 'var(--text-secondary)' }}>
            Our LoRA-adapted mDeBERTa classifies fast locally (~120 ms), while Qwen via Groq
            provides a semantic sanity check and a plain-language explanation.
          </p>
        </div>

        <div className="card" style={{ padding: '1.4rem' }}>
          <Route size={22} color="var(--plum)" aria-hidden="true" />
          <h2 style={{ fontSize: '1.05rem', margin: '0.75rem 0 0.4rem' }}>
            3. Confidence & Disagreement Triage
          </h2>
          <p style={{ margin: 0, fontSize: '0.88rem', color: 'var(--text-secondary)' }}>
            When both models agree with high confidence, the ticket routes straight to WASA, Power,
            Waste, Transport, Health, or Food Safety. Disagreements land in the Admin Review Queue.
          </p>
        </div>
      </div>

      <div className="card" style={{ padding: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ fontSize: '1rem', margin: '0 0 0.65rem' }}>Supported civic departments</h2>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
            {CATEGORIES.map((c) => (
              <CategoryChip key={c.code} category={c.code} showDot />
            ))}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-outline" onClick={onOpenModelLab}>
            Open Model Lab
          </button>
          <button type="button" className="btn btn-primary" onClick={onStartComplaint}>
            Submit a complaint <ArrowRight size={16} aria-hidden="true" />
          </button>
        </div>
      </div>
    </main>
  );
}
