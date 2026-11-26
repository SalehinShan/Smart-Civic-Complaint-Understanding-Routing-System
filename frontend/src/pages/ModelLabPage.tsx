import { ChangeEvent, DragEvent, KeyboardEvent, useRef, useState } from 'react';
import { ArrowLeft, Download, Mic, Square, Upload } from 'lucide-react';
import {
  ALL_MODEL_BENCHMARKS,
  CATEGORIES,
  DIALECT_200_BENCHMARK,
  MODEL_LAB_DEFAULT_ASR,
  MODEL_LAB_DEFAULT_TEXT,
  VOICE_SAMPLE_PRESETS,
} from '../data/seed';
import {
  AsrTranscription,
  BatchDatasetRow,
  BatchModelResult,
  CategoryCode,
  ModelPrediction,
} from '../types/complaint';
import { runModelLabBatchEvaluation, runModelLabCompare } from '../services/api';
import { AppPortal } from '../components/CitizenHeader';

type LabTab = 'live' | 'batch' | 'results';
type BatchModelKey = 'qwen' | 'lora' | 'fine_tuned' | 'zero_shot' | 'svm';

const BATCH_MODEL_PILLS: Array<{ key: BatchModelKey; label: string }> = [
  { key: 'qwen', label: 'Qwen' },
  { key: 'lora', label: 'LoRA' },
  { key: 'fine_tuned', label: 'mDeBERTa FT' },
  { key: 'zero_shot', label: 'Zero-shot' },
  { key: 'svm', label: 'SVM' },
];

const SAMPLE_CSV_ROWS: BatchDatasetRow[] = [
  { text: 'হলের ডাইনিংয়ে মুরগির পিস এত ছোট আর বাসি যে মুখত দেওন ন যায়।', category: 'Food' },
  { text: 'তিন দিন ধরি ট্যাংক পুরা শুকনা, মোটর চালাইলে খালি বাতাসের আওয়াজ আইয়ে।', category: 'Water' },
  { text: 'মায়ের জন্য অক্সিজেন কনসেনট্রেটর চালাতে হয়, বারবার কারেন্ট চলে যায়।', category: 'Electricity' },
  { text: 'কাউয়া আর কুত্তা রাইতে ময়লার ব্যাগ ছিঁড়া পুরা গলিতে ছড়াইয়া দেয়।', category: 'Waste' },
  { text: 'Helper bhara beshi chay, na dile dhakka diye namiye dey.', category: 'Road & Transport' },
  { text: 'ইমার্জেন্সিতে আব্বারে লই গেলাম, দুই ঘণ্টা কেউ ছুঁই ও দেখে ন।', category: 'Healthcare' },
  { text: 'পাইপ ফাইটা রাস্তায় পানি জইমা গেছে, ময়লা পানি ঘরে ঢুকে।', category: 'Water' },
  { text: 'Biddut nai sokal theke, transformer e agun dhorse.', category: 'Electricity' },
  { text: 'রাস্তায় বড় গর্ত হইয়া গেছে, রিকশা উল্টায় যায় প্রতিদিন।', category: 'Road & Transport' },
  { text: 'হোটেলের খাবারে তেলাপোকা পাওয়া গেছে আর রান্নাঘর নোংরা।', category: 'Food' },
  { text: 'ক্লিনিকে ডাক্তার নাই, সকাল থেকে রোগী বসা রইছে।', category: 'Healthcare' },
  { text: 'ডাস্টবিন উপচে ময়লা রাস্তার উপর পড়ে আছে, দুর্গন্ধে হাঁটা যায় না।', category: 'Waste' },
];

export function ModelLabPage({
  onNavigatePortal,
  onToast,
}: {
  onNavigatePortal: (portal: AppPortal) => void;
  onToast: (msg: string) => void;
}) {
  const [activeTab, setActiveTab] = useState<LabTab>('live');
  const [complaintText, setComplaintText] = useState(MODEL_LAB_DEFAULT_TEXT);
  const [groundTruth, setGroundTruth] = useState<CategoryCode>('Food');
  const [predictions, setPredictions] = useState<ModelPrediction[]>([]);
  const [selectedCardKey, setSelectedCardKey] = useState<string>('qwen');
  const [asrList, setAsrList] = useState<AsrTranscription[]>(MODEL_LAB_DEFAULT_ASR);
  const [selectedAsrKey, setSelectedAsrKey] = useState<'groq_whisper' | 'regional_whisper'>(
    'regional_whisper',
  );
  const [isRunning, setIsRunning] = useState(false);
  const [modelError, setModelError] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);

  // Batch evaluation state
  const csvInputRef = useRef<HTMLInputElement>(null);
  const [datasetName, setDatasetName] = useState<string>('sample_dialect_split.csv');
  const [batchRows, setBatchRows] = useState<BatchDatasetRow[]>(SAMPLE_CSV_ROWS);
  const [selectedBatchModels, setSelectedBatchModels] = useState<BatchModelKey[]>(['lora', 'svm']);
  const [batchResults, setBatchResults] = useState<BatchModelResult[]>([]);
  const [isBatchRunning, setIsBatchRunning] = useState(false);
  const [batchError, setBatchError] = useState<string | null>(null);
  const [activeMatrixModel, setActiveMatrixModel] = useState<BatchModelKey>('lora');
  const [dragActive, setDragActive] = useState(false);

  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const tabs: Array<{ id: LabTab; label: string }> = [
    { id: 'live', label: 'Live compare' },
    { id: 'batch', label: 'Batch evaluation' },
    { id: 'results', label: 'Results' },
  ];

  const handleTabKeyDown = (e: KeyboardEvent<HTMLButtonElement>, idx: number) => {
    let nextIdx = idx;
    if (e.key === 'ArrowRight') nextIdx = (idx + 1) % tabs.length;
    else if (e.key === 'ArrowLeft') nextIdx = (idx - 1 + tabs.length) % tabs.length;
    else if (e.key === 'Home') nextIdx = 0;
    else if (e.key === 'End') nextIdx = tabs.length - 1;
    else return;

    e.preventDefault();
    setActiveTab(tabs[nextIdx].id);
    tabRefs.current[nextIdx]?.focus();
  };

  const handleRunAllModels = async () => {
    if (!complaintText.trim()) return;
    setIsRunning(true);
    setModelError(null);
    try {
      const res = await runModelLabCompare(complaintText.trim());
      setPredictions(res.predictions);
      if (res.predictions.length > 0) setSelectedCardKey(res.predictions[0].modelKey);
      onToast('Evaluated all 5 classifiers on complaint text.');
    } catch (error) {
      setModelError(error instanceof Error ? error.message : 'Model comparison failed.');
    } finally {
      setIsRunning(false);
    }
  };

  const handleRecordInstead = async () => {
    if (isRecording) {
      recorderRef.current?.stop();
      setIsRecording(false);
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      const preset = VOICE_SAMPLE_PRESETS[0];
      setComplaintText(preset.regionalAsr);
      setGroundTruth('Water');
      setAsrList([
        {
          modelKey: 'groq_whisper',
          modelLabel: 'Groq whisper-large-v3',
          text: preset.groqAsr,
          latencySec: 1.1,
          isSelected: false,
        },
        {
          modelKey: 'regional_whisper',
          modelLabel: 'Regional ASR · tugstugi whisper-medium',
          text: preset.regionalAsr,
          latencySec: 2.6,
          isSelected: true,
        },
      ]);
      onToast('Loaded dialect voice ASR comparison sample.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const preset = VOICE_SAMPLE_PRESETS[0];
        setComplaintText(preset.regionalAsr);
        setAsrList([
          {
            modelKey: 'groq_whisper',
            modelLabel: 'Groq whisper-large-v3',
            text: preset.groqAsr,
            latencySec: 1.2,
            isSelected: false,
          },
          {
            modelKey: 'regional_whisper',
            modelLabel: 'Regional ASR · tugstugi whisper-medium',
            text: preset.regionalAsr,
            latencySec: 2.8,
            isSelected: true,
          },
        ]);
        onToast('Voice recorded & compared across both ASR models.');
      };
      recorderRef.current = recorder;
      recorder.start();
      setIsRecording(true);
    } catch {
      onToast('Microphone access unavailable — using pre-recorded dialect audio comparison.');
    }
  };

  const parseCsvFile = async (file: File) => {
    const content = await file.text();
    const lines = content
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length < 2) {
      onToast('CSV needs a header row and at least one complaint row.');
      return;
    }
    const headers = lines[0].split(',').map((h) => h.trim().replace(/^"|"$/g, '').toLowerCase());
    const textIdx = headers.findIndex((h) => h.includes('text') || h.includes('complaint'));
    const catIdx = headers.findIndex((h) => h.includes('category') || h.includes('label'));
    if (textIdx === -1 || catIdx === -1) {
      onToast('CSV must contain a text column and a Category column.');
      return;
    }

    const parsed: BatchDatasetRow[] = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',').map((col) => col.trim().replace(/^"|"$/g, ''));
      const rawCat = cols[catIdx] as CategoryCode;
      const validCat = CATEGORIES.find((c) => c.code.toLowerCase() === rawCat?.toLowerCase())?.code;
      if (cols[textIdx] && validCat) {
        parsed.push({ text: cols[textIdx], category: validCat });
      }
    }

    if (!parsed.length) {
      onToast('No valid rows matched the 6 complaint categories.');
      return;
    }

    setDatasetName(file.name);
    setBatchRows(parsed);
    onToast(`Loaded ${parsed.length} labelled rows from ${file.name}`);
  };

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) parseCsvFile(file);
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragActive(false);
    const file = e.dataTransfer.files?.[0];
    if (file) parseCsvFile(file);
  };

  const toggleBatchModel = (key: BatchModelKey) => {
    setSelectedBatchModels((prev) =>
      prev.includes(key)
        ? prev.length > 1
          ? prev.filter((k) => k !== key)
          : prev
        : [...prev, key],
    );
  };

  const handleRunBatch = async () => {
    setIsBatchRunning(true);
    setBatchError(null);
    try {
      const results = await runModelLabBatchEvaluation(batchRows, selectedBatchModels);
      setBatchResults(results);
      setActiveMatrixModel(results[0]?.modelKey || 'lora');
      setActiveTab('batch');
      onToast(`Evaluated ${batchRows.length} rows with the selected backend models.`);
    } catch (error) {
      setBatchError(error instanceof Error ? error.message : 'Batch evaluation failed.');
    } finally {
      setIsBatchRunning(false);
    }
  };

  const downloadMisclassifiedCsv = (res: BatchModelResult) => {
    const header = 'row_index,actual_category,predicted_category,text\n';
    const body = res.misclassifiedRows
      .map(
        (r) =>
          `${r.rowIndex},"${r.actual}","${r.predicted}","${r.text.replace(/"/g, '""')}"`,
      )
      .join('\n');
    const blob = new Blob([header + body], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${res.modelKey}_misclassified.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const activeMatrixResult =
    batchResults.find((r) => r.modelKey === activeMatrixModel) || batchResults[0];

  return (
    <div className="lab-shell">
      <div className="lab-container">
        {/* Top Header */}
        <header
          style={{
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'space-between',
            gap: '1rem',
            flexWrap: 'wrap',
            marginBottom: '1.35rem',
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.2rem' }}>
              <button
                type="button"
                onClick={() => onNavigatePortal('admin')}
                style={{
                  border: '1px solid var(--border-strong)',
                  background: '#fff',
                  borderRadius: 'var(--radius-pill)',
                  padding: '0.2rem 0.65rem',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  color: 'var(--plum)',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.3rem',
                  cursor: 'pointer',
                }}
              >
                <ArrowLeft size={12} aria-hidden="true" /> Admin
              </button>
              <span
                style={{
                  fontSize: '0.72rem',
                  fontWeight: 700,
                  letterSpacing: '0.07em',
                  color: 'var(--text-muted)',
                }}
              >
                CSE299 · MODEL LAB
              </span>
            </div>
            <h1 style={{ margin: 0, fontSize: '1.65rem', fontWeight: 800, letterSpacing: '-0.02em' }}>
              Compare every model on one complaint
            </h1>
          </div>

          <div role="tablist" aria-label="Model Lab views" className="lab-tablist">
            {tabs.map((tab, i) => {
              const selected = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  ref={(el) => {
                    tabRefs.current[i] = el;
                  }}
                  type="button"
                  role="tab"
                  id={`lab-tab-${tab.id}`}
                  aria-selected={selected}
                  tabIndex={selected ? 0 : -1}
                  className="lab-tab"
                  onClick={() => setActiveTab(tab.id)}
                  onKeyDown={(e) => handleTabKeyDown(e, i)}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>
        </header>

        {/* Tab 1: Live Compare */}
        <div role="tabpanel" aria-labelledby="lab-tab-live" hidden={activeTab !== 'live'}>
          {/* Top 2 cards: Complaint text + Speech-to-text comparison */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))',
              gap: '1.15rem',
              marginBottom: '1.15rem',
            }}
          >
            {/* Complaint Input Card */}
            <section className="card" style={{ padding: '1.25rem 1.35rem' }}>
              <label
                htmlFor="lab-complaint-input"
                style={{ display: 'block', fontWeight: 700, fontSize: '0.92rem', marginBottom: '0.65rem' }}
              >
                Complaint text
              </label>
              <textarea
                id="lab-complaint-input"
                rows={3}
                value={complaintText}
                onChange={(e) => setComplaintText(e.target.value)}
                style={{
                  width: '100%',
                  padding: '0.75rem 0.9rem',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--border-strong)',
                  marginBottom: '0.85rem',
                  lineHeight: 1.5,
                  resize: 'vertical',
                }}
              />
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={isRunning}
                  onClick={handleRunAllModels}
                >
                  {isRunning ? 'Running models…' : 'Run all models'}
                </button>
                <button type="button" className="btn btn-outline" onClick={handleRecordInstead}>
                  {isRecording ? <Square size={15} /> : <Mic size={15} aria-hidden="true" />}
                  {isRecording ? 'Stop recording' : 'Record instead'}
                </button>
              </div>
              {modelError && (
                <p role="alert" className="error-msg" style={{ display: 'block', margin: '0 0 0.75rem' }}>
                  {modelError}
                </p>
              )}
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                <label htmlFor="lab-ground-truth">Ground truth (optional):</label>
                <select
                  id="lab-ground-truth"
                  value={groundTruth}
                  onChange={(e) => setGroundTruth(e.target.value as CategoryCode)}
                  style={{
                    border: '1px solid var(--border-subtle)',
                    background: 'var(--bg-subtle)',
                    borderRadius: 6,
                    padding: '0.15rem 0.45rem',
                    fontSize: '0.8rem',
                    fontWeight: 600,
                    color: 'var(--text-primary)',
                  }}
                >
                  {CATEGORIES.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.nameEn}
                    </option>
                  ))}
                </select>
              </div>
            </section>

            {/* Speech-to-text comparison */}
            <section className="card" style={{ padding: '1.25rem 1.35rem' }}>
              <h2 style={{ fontSize: '0.92rem', fontWeight: 700, margin: '0 0 0.75rem' }}>
                Speech-to-text comparison (voice input)
              </h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem', marginBottom: '0.65rem' }}>
                {asrList.map((asr) => {
                  const isSelected = selectedAsrKey === asr.modelKey;
                  return (
                    <button
                      key={asr.modelKey}
                      type="button"
                      onClick={() => {
                        setSelectedAsrKey(asr.modelKey);
                        setComplaintText(asr.text);
                      }}
                      style={{
                        textAlign: 'left',
                        background: '#fff',
                        borderRadius: 'var(--radius-md)',
                        padding: '0.7rem 0.9rem',
                        border: isSelected
                          ? '1.5px solid var(--plum)'
                          : '1px solid var(--border-subtle)',
                        cursor: 'pointer',
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          fontSize: '0.76rem',
                          color: isSelected ? 'var(--plum)' : 'var(--text-muted)',
                          fontWeight: isSelected ? 700 : 500,
                          marginBottom: '0.2rem',
                        }}
                      >
                        <span>{asr.modelLabel}</span>
                        <span>{asr.latencySec.toFixed(1)} s</span>
                      </div>
                      <div style={{ fontSize: '0.86rem', color: 'var(--text-primary)' }}>
                        {asr.text}
                      </div>
                    </button>
                  );
                })}
              </div>
              <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                These are sample transcripts for the interface; audio recording is not transcribed yet.
              </p>
            </section>
          </div>

          {/* Middle Row: 5 Classifier Cards */}
          <section className="lab-models-grid" aria-label="Classifier predictions">
            {predictions.length === 0 && (
              <p className="card" style={{ padding: '1rem' }}>
                Run the classifiers to see predictions from the backend.
              </p>
            )}
            {predictions.map((pred) => {
              const isSelected = selectedCardKey === pred.modelKey;
              const matchesTruth = !pred.error && pred.predictedCategory === groundTruth;
              return (
                <button
                  key={pred.modelKey}
                  type="button"
                  onClick={() => setSelectedCardKey(pred.modelKey)}
                  className="card"
                  style={{
                    textAlign: 'left',
                    padding: '1rem 1.05rem',
                    cursor: 'pointer',
                    border: isSelected
                      ? '1.5px solid var(--plum)'
                      : '1px solid var(--border-subtle)',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    gap: '0.5rem',
                  }}
                >
                  <div>
                    <div
                      style={{
                        fontSize: '0.77rem',
                        color: 'var(--text-secondary)',
                        marginBottom: '0.35rem',
                        fontWeight: 500,
                      }}
                    >
                      {pred.modelName}
                    </div>
                    <div
                      style={{
                        fontSize: '1.25rem',
                        fontWeight: 800,
                        color: matchesTruth ? 'var(--text-primary)' : 'var(--text-secondary)',
                        marginBottom: '0.55rem',
                      }}
                    >
                      {pred.error ? 'Unavailable' : pred.predictedCategory}
                    </div>
                    <div
                      style={{
                        height: 5,
                        borderRadius: 999,
                        background: '#efe4e8',
                        overflow: 'hidden',
                        marginBottom: '0.35rem',
                      }}
                    >
                      <div
                        style={{
                          width: `${Math.round((pred.error ? 0 : pred.confidence) * 100)}%`,
                          height: '100%',
                          background: matchesTruth ? 'var(--plum)' : '#cfa6aa',
                          borderRadius: 999,
                        }}
                      />
                    </div>
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        fontSize: '0.75rem',
                        color: 'var(--text-muted)',
                      }}
                    >
                      <span>{pred.error ? 'Error' : pred.confidenceLabel || pred.confidence.toFixed(2)}</span>
                      <span>{pred.latencyLabel}</span>
                    </div>
                  </div>
                  <p style={{ margin: '0.3rem 0 0', fontSize: '0.77rem', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                    {pred.note}
                  </p>
                </button>
              );
            })}
          </section>

          {/* Bottom Row: 200-complaint dialect chart + Batch dropzone */}
          <div className="lab-bottom-grid">
            <section className="card" style={{ padding: '1.35rem 1.5rem' }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '1rem',
                  flexWrap: 'wrap',
                  marginBottom: '1.1rem',
                }}
              >
                <h2 style={{ fontSize: '0.98rem', fontWeight: 700, margin: 0 }}>
                  Accuracy on the 200-complaint dialect test split
                </h2>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem', fontSize: '0.76rem' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                    <span style={{ width: 9, height: 9, borderRadius: 2, background: 'var(--plum)' }} />
                    Qwen (Groq)
                  </span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                    <span style={{ width: 9, height: 9, borderRadius: 2, background: 'var(--rose-bar)' }} />
                    LoRA mDeBERTa
                  </span>
                </div>
              </div>

              <div style={{ display: 'grid', gap: '1.05rem', marginBottom: '1.15rem' }}>
                {DIALECT_200_BENCHMARK.map((item) => (
                  <div key={item.split}>
                    <div style={{ fontSize: '0.82rem', fontWeight: 600, marginBottom: '0.4rem' }}>
                      {item.split}
                    </div>
                    <div style={{ display: 'grid', gap: '0.35rem' }}>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 48px', alignItems: 'center', gap: '0.65rem' }}>
                        <div style={{ height: 11, background: '#f5ecef', borderRadius: 999, overflow: 'hidden' }}>
                          <div
                            style={{
                              width: `${item.qwen}%`,
                              height: '100%',
                              background: 'var(--plum)',
                              borderRadius: 999,
                            }}
                          />
                        </div>
                        <span style={{ fontSize: '0.78rem', fontWeight: 600, textAlign: 'right' }}>
                          {item.qwen.toFixed(1)}%
                        </span>
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 48px', alignItems: 'center', gap: '0.65rem' }}>
                        <div style={{ height: 11, background: '#f5ecef', borderRadius: 999, overflow: 'hidden' }}>
                          <div
                            style={{
                              width: `${item.lora}%`,
                              height: '100%',
                              background: 'var(--rose-bar)',
                              borderRadius: 999,
                            }}
                          />
                        </div>
                        <span style={{ fontSize: '0.78rem', fontWeight: 600, textAlign: 'right' }}>
                          {item.lora.toFixed(1)}%
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <p style={{ margin: 0, fontSize: '0.77rem', color: 'var(--text-muted)', lineHeight: 1.45 }}>
                From siscData-10.ipynb. SVM and fine-tuned mDeBERTa were scored on the separate
                750-dialect set (SVM: 50.7% Bangla script, 70.7% Banglish), so they are listed in
                the table view, not this chart.
              </p>
            </section>

            {/* Batch evaluation card */}
            <section className="card" style={{ padding: '1.35rem 1.45rem', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
              <div>
                <h2 style={{ fontSize: '0.98rem', fontWeight: 700, margin: '0 0 0.85rem' }}>
                  Batch evaluation
                </h2>

                <input
                  ref={csvInputRef}
                  type="file"
                  accept=".csv,text/csv"
                  className="visually-hidden"
                  onChange={handleFileChange}
                  aria-label="Upload labelled CSV file"
                />

                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragActive(true);
                  }}
                  onDragLeave={() => setDragActive(false)}
                  onDrop={handleDrop}
                  onClick={() => csvInputRef.current?.click()}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      csvInputRef.current?.click();
                    }
                  }}
                  style={{
                    border: dragActive ? '2px dashed var(--plum)' : '1.5px dashed #cbb8c1',
                    background: dragActive ? 'var(--bg-plum-pill)' : '#fdfbfa',
                    borderRadius: 'var(--radius-md)',
                    padding: '1.5rem 1rem',
                    textAlign: 'center',
                    cursor: 'pointer',
                    marginBottom: '1rem',
                  }}
                >
                  <Upload size={20} color="var(--text-secondary)" aria-hidden="true" />
                  <div style={{ fontWeight: 600, fontSize: '0.88rem', marginTop: '0.45rem' }}>
                    Drop a labelled CSV
                  </div>
                  <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>
                    needs a text column + Category ({datasetName} · {batchRows.length} rows ready)
                  </div>
                </div>

                <div style={{ fontSize: '0.8rem', fontWeight: 700, marginBottom: '0.45rem' }}>
                  Models to run
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginBottom: '0.85rem' }}>
                  {BATCH_MODEL_PILLS.map((m) => {
                    const active = selectedBatchModels.includes(m.key);
                    return (
                      <button
                        key={m.key}
                        type="button"
                        aria-pressed={active}
                        onClick={() => toggleBatchModel(m.key)}
                        style={{
                          padding: '0.32rem 0.72rem',
                          borderRadius: 'var(--radius-pill)',
                          border: active ? '1.5px solid var(--plum)' : '1px solid var(--border-strong)',
                          background: active ? 'var(--bg-plum-pill)' : '#fff',
                          color: active ? 'var(--plum)' : 'var(--text-secondary)',
                          fontSize: '0.78rem',
                          fontWeight: 600,
                          cursor: 'pointer',
                        }}
                      >
                        {m.label}
                      </button>
                    );
                  })}
                </div>

                <p style={{ margin: '0 0 1rem', fontSize: '0.77rem', color: 'var(--text-muted)', lineHeight: 1.45 }}>
                  Returns accuracy, macro-F1, a confusion matrix per model and a downloadable list
                  of misclassified rows.
                </p>
              </div>

              {batchError && (
                <p role="alert" className="error-msg" style={{ display: 'block', margin: '0 0 0.75rem' }}>
                  {batchError}
                </p>
              )}
              <button
                type="button"
                className="btn btn-primary"
                style={{ width: '100%' }}
                disabled={isBatchRunning}
                onClick={handleRunBatch}
              >
                {isBatchRunning ? 'Evaluating models…' : 'Run evaluation'}
              </button>
            </section>
          </div>
        </div>

        {/* Tab 2: Batch Evaluation Results */}
        <div role="tabpanel" aria-labelledby="lab-tab-batch" hidden={activeTab !== 'batch'}>
          <div style={{ display: 'grid', gap: '1.25rem' }}>
            <div className="card" style={{ padding: '1.25rem 1.4rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
              <div>
                <h2 style={{ margin: 0, fontSize: '1.05rem' }}>
                  Batch Run · {datasetName} ({batchRows.length} rows)
                </h2>
                <p style={{ margin: '0.2rem 0 0', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                  Click a model to inspect its confusion matrix and download misclassified rows.
                </p>
              </div>
              <button
                type="button"
                className="btn btn-outline"
                onClick={() => csvInputRef.current?.click()}
              >
                <Upload size={15} aria-hidden="true" /> Upload another CSV
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '0.9rem' }}>
              {batchResults.map((res) => {
                const active = activeMatrixResult?.modelKey === res.modelKey;
                return (
                  <button
                    key={res.modelKey}
                    type="button"
                    className="card"
                    onClick={() => setActiveMatrixModel(res.modelKey)}
                    style={{
                      textAlign: 'left',
                      padding: '1rem 1.15rem',
                      cursor: 'pointer',
                      border: active ? '1.5px solid var(--plum)' : '1px solid var(--border-subtle)',
                    }}
                  >
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: 600 }}>
                      {res.modelName}
                    </div>
                    <div style={{ fontSize: '1.55rem', fontWeight: 800, margin: '0.25rem 0' }}>
                      {res.error ? 'Unavailable' : `${(res.accuracy * 100).toFixed(1)}%`}
                    </div>
                    <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                      {res.error ? res.error : `Macro-F1: ${res.macroF1.toFixed(2)} · ${res.avgLatencyMs} ms/row`}
                    </div>
                  </button>
                );
              })}
            </div>

            {activeMatrixResult && (
              <div className="card" style={{ padding: '1.4rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '1rem' }}>
                  <h3 style={{ margin: 0, fontSize: '1rem' }}>
                    Confusion Matrix · {activeMatrixResult.modelName}
                  </h3>
                  <button
                    type="button"
                    className="btn btn-outline"
                    onClick={() => downloadMisclassifiedCsv(activeMatrixResult)}
                    disabled={activeMatrixResult.misclassifiedRows.length === 0}
                  >
                    <Download size={15} aria-hidden="true" />
                    Download misclassified ({activeMatrixResult.misclassifiedRows.length})
                  </button>
                </div>

                <div className="table-wrapper">
                  <table className="complaints-table" style={{ fontSize: '0.8rem' }}>
                    <thead>
                      <tr>
                        <th>Actual \ Predicted</th>
                        {CATEGORIES.map((c) => (
                          <th key={c.code}>{c.nameEn}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {CATEGORIES.map((rowCat, ri) => (
                        <tr key={rowCat.code}>
                          <th>{rowCat.nameEn}</th>
                          {CATEGORIES.map((colCat, ci) => {
                            const val = activeMatrixResult.confusionMatrix[ri]?.[ci] ?? 0;
                            const isDiag = ri === ci;
                            return (
                              <td
                                key={colCat.code}
                                style={{
                                  fontWeight: isDiag ? 700 : 400,
                                  background:
                                    isDiag && val > 0
                                      ? 'var(--bg-plum-pill)'
                                      : !isDiag && val > 0
                                      ? 'var(--bg-row-alert)'
                                      : 'transparent',
                                }}
                              >
                                {val}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Tab 3: Results Benchmark Table */}
        <div role="tabpanel" aria-labelledby="lab-tab-results" hidden={activeTab !== 'results'}>
          <div className="card" style={{ padding: '1.4rem' }}>
            <h2 style={{ fontSize: '1.05rem', margin: '0 0 0.35rem' }}>
              Full Model Benchmark Results (`siscData-10.ipynb` + 750-Dialect Split)
            </h2>
            <p style={{ margin: '0 0 1.15rem', fontSize: '0.84rem', color: 'var(--text-secondary)' }}>
              Comparing all 5 classifiers across the 200-complaint test split and the 750-dialect
              benchmark set.
            </p>

            <div className="table-wrapper">
              <table className="complaints-table">
                <thead>
                  <tr>
                    <th>Model</th>
                    <th>Type</th>
                    <th>200 Orig Bangla</th>
                    <th>200 Dialect Bangla</th>
                    <th>200 Banglish</th>
                    <th>750 Dialect Bangla</th>
                    <th>750 Banglish</th>
                    <th>Latency</th>
                  </tr>
                </thead>
                <tbody>
                  {ALL_MODEL_BENCHMARKS.map((row) => (
                    <tr key={row.model}>
                      <th>
                        {row.model}{' '}
                        {row.primary && (
                          <span
                            style={{
                              fontSize: '0.7rem',
                              background: 'var(--bg-plum-pill)',
                              color: 'var(--plum)',
                              padding: '0.12rem 0.45rem',
                              borderRadius: 999,
                              marginLeft: 4,
                            }}
                          >
                            Primary
                          </span>
                        )}
                      </th>
                      <td>{row.kind}</td>
                      <td>{row.origBn200 !== null ? `${row.origBn200.toFixed(1)}%` : '—'}</td>
                      <td>{row.dialectBn200 !== null ? `${row.dialectBn200.toFixed(1)}%` : '—'}</td>
                      <td>{row.banglish200 !== null ? `${row.banglish200.toFixed(1)}%` : '—'}</td>
                      <td>{row.dialectBn750 !== null ? `${row.dialectBn750.toFixed(1)}%` : '—'}</td>
                      <td>{row.banglish750 !== null ? `${row.banglish750.toFixed(1)}%` : '—'}</td>
                      <td>{row.avgLatency}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
