export type CategoryCode =
  | 'Water'
  | 'Electricity'
  | 'Waste'
  | 'Road & Transport'
  | 'Healthcare'
  | 'Food';

export type ComplaintStatus =
  | 'submitted'
  | 'needs_review'
  | 'assigned'
  | 'in_progress'
  | 'resolved'
  | 'rejected'
  | 'escalated';

export type InputMode = 'text' | 'voice';

export type TextScript = 'bangla' | 'banglish' | 'english' | 'code_mixed';

export type DialectCode =
  | 'standard'
  | 'chittagong'
  | 'sylhet'
  | 'mymensingh'
  | 'barishal'
  | 'noakhali'
  | 'unknown';

export type ModelKind = 'svm' | 'zero_shot' | 'fine_tuned' | 'lora' | 'llm' | 'asr';

export interface CategoryMeta {
  code: CategoryCode;
  nameEn: string;
  nameBn: string;
  departmentEn: string;
  departmentBn: string;
  chipBg: string;
  chipFg: string;
  dotColor: string;
}

export interface TimelineEvent {
  id: string;
  status: ComplaintStatus;
  titleBn: string;
  titleEn: string;
  detail: string;
  timestamp: string;
  completed: boolean;
  current?: boolean;
}

export interface ModelPrediction {
  modelKey: 'qwen' | 'lora' | 'fine_tuned' | 'zero_shot' | 'svm';
  modelName: string;
  kind: Exclude<ModelKind, 'asr'>;
  predictedCategory: CategoryCode;
  confidence: number;
  confidenceLabel?: string;
  latencyLabel: string;
  latencyMs: number;
  note: string;
  error?: string;
}

export interface AsrTranscription {
  modelKey: 'groq_whisper' | 'regional_whisper';
  modelLabel: string;
  text: string;
  latencySec: number;
  isSelected: boolean;
}

export interface ComplaintRecord {
  id: string;
  shortId: string;
  trackingCode: string;
  inputMode: InputMode;
  originalText: string;
  finalText: string;
  detectedScript: TextScript;
  detectedDialect: DialectCode;
  areaText: string;
  zoneLabel: string;
  phone?: string;
  photoName?: string;
  category: CategoryCode;
  categorySource: 'model' | 'citizen' | 'admin';
  confidence: number;
  reason: string;
  loraPred: CategoryCode | null;
  loraConf: number;
  qwenPred: CategoryCode | null;
  qwenConf: number;
  needsReview: boolean;
  status: ComplaintStatus;
  departmentEn: string;
  departmentBn: string;
  audioDurationSec?: number;
  audioUrl?: string;
  departmentNote?: string;
  internalNotes: string[];
  timeline: TimelineEvent[];
  createdAt: string;
  citizenCorrected?: boolean;
}

export interface BatchDatasetRow {
  text: string;
  category: CategoryCode;
}

export interface BatchModelResult {
  modelKey: 'qwen' | 'lora' | 'fine_tuned' | 'zero_shot' | 'svm';
  modelName: string;
  accuracy: number;
  macroF1: number;
  avgLatencyMs: number;
  confusionMatrix: number[][];
  error?: string;
  misclassifiedRows: Array<{
    rowIndex: number;
    text: string;
    actual: CategoryCode;
    predicted: CategoryCode;
  }>;
}
