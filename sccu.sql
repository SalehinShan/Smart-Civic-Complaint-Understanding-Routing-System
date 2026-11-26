-- =====================================================================
 — Smart Service Complaint Management (CSE299)
--  PostgreSQL 14+ schema: citizen portal, admin panel, ML predictions,
--  workflow tracking and the Model Lab.
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pg_trgm;    -- fuzzy search on Bangla / Banglish text
CREATE EXTENSION IF NOT EXISTS citext;     -- case-insensitive emails

-- ---------------------------------------------------------------------
-- 1. Enumerations
-- ---------------------------------------------------------------------
CREATE TYPE complaint_status AS ENUM
  ('submitted', 'needs_review', 'assigned', 'in_progress', 'resolved', 'rejected', 'escalated');
CREATE TYPE input_mode       AS ENUM ('text', 'voice');
CREATE TYPE text_script      AS ENUM ('bangla', 'banglish', 'english', 'code_mixed');
CREATE TYPE dialect_code     AS ENUM
  ('standard', 'chittagong', 'sylhet', 'mymensingh', 'barishal', 'noakhali', 'unknown');
CREATE TYPE severity_level   AS ENUM ('low', 'medium', 'high');
CREATE TYPE category_source  AS ENUM ('model', 'citizen', 'admin');
CREATE TYPE model_kind       AS ENUM ('svm', 'zero_shot', 'fine_tuned', 'lora', 'llm', 'asr');
CREATE TYPE attachment_kind  AS ENUM ('audio', 'photo');
CREATE TYPE admin_role       AS ENUM ('super_admin', 'dept_admin', 'officer', 'analyst');
CREATE TYPE job_status       AS ENUM ('queued', 'running', 'done', 'failed');
CREATE TYPE notify_channel   AS ENUM ('sms', 'email');

-- Keeps updated_at current on every UPDATE
CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------
-- 2. Reference data: departments, categories, areas
-- ---------------------------------------------------------------------
CREATE TABLE departments (
  id            smallserial PRIMARY KEY,
  name_en       text NOT NULL UNIQUE,            -- 'Chattogram WASA'
  name_bn       text NOT NULL,
  contact_email citext,
  contact_phone text,
  sla_days      smallint NOT NULL DEFAULT 7,     -- days before a complaint can be escalated
  is_active     boolean NOT NULL DEFAULT true
);

CREATE TABLE categories (
  id            smallserial PRIMARY KEY,
  code          text NOT NULL UNIQUE,            -- must match model labels exactly
  name_en       text NOT NULL,
  name_bn       text NOT NULL,
  department_id smallint NOT NULL REFERENCES departments(id),
  color_hex     char(7)                          -- UI chip colour
);

CREATE TABLE areas (
  id        serial PRIMARY KEY,
  city      text NOT NULL,                       -- 'Chattogram'
  name_en   text NOT NULL,                       -- 'Halishahar'
  name_bn   text NOT NULL,
  ward_no   smallint,
  parent_id int REFERENCES areas(id),            -- city > zone > ward
  UNIQUE (city, name_en, ward_no)
);

-- ---------------------------------------------------------------------
-- 3. Admin panel: users, sessions, audit trail
-- ---------------------------------------------------------------------
CREATE TABLE admin_users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         citext NOT NULL UNIQUE,
  password_hash text NOT NULL,                   -- bcrypt / argon2, never plain text
  full_name     text NOT NULL,
  role          admin_role NOT NULL,
  department_id smallint REFERENCES departments(id) ON DELETE SET NULL,
  is_active     boolean NOT NULL DEFAULT true,
  last_login_at timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  -- department staff must belong to a department; super admins / analysts are global
  CONSTRAINT dept_required CHECK (role NOT IN ('dept_admin', 'officer') OR department_id IS NOT NULL)
);
CREATE TRIGGER admin_users_touch BEFORE UPDATE ON admin_users
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TABLE admin_sessions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id      uuid NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  refresh_token_hash text NOT NULL UNIQUE,
  ip_address         inet,
  user_agent         text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  expires_at         timestamptz NOT NULL,
  revoked_at         timestamptz
);
CREATE INDEX admin_sessions_user_idx ON admin_sessions (admin_user_id);

CREATE TABLE audit_log (
  id            bigserial PRIMARY KEY,
  admin_user_id uuid REFERENCES admin_users(id) ON DELETE SET NULL,
  action        text NOT NULL,                   -- 'complaint.reassign', 'model.activate', ...
  entity_type   text NOT NULL,                   -- 'complaint', 'admin_user', 'ml_model', ...
  entity_id     text NOT NULL,
  before_data   jsonb,
  after_data    jsonb,
  ip_address    inet,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_entity_idx ON audit_log (entity_type, entity_id);
CREATE INDEX audit_log_time_idx   ON audit_log (created_at DESC);

-- ---------------------------------------------------------------------
-- 4. Citizens (optional: complaints can be anonymous)
-- ---------------------------------------------------------------------
CREATE TABLE citizens (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone            text UNIQUE,                  -- for SMS updates; optional
  name             text,
  preferred_language char(2) NOT NULL DEFAULT 'bn',
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- 5. ML models registry (all 5 classifiers + 2 ASR models)
-- ---------------------------------------------------------------------
CREATE TABLE ml_models (
  id            smallserial PRIMARY KEY,
  name          text NOT NULL,                   -- 'LoRA mDeBERTa', 'Qwen via Groq', ...
  version       text NOT NULL,
  kind          model_kind NOT NULL,
  provider      text,                            -- 'local', 'groq', 'huggingface'
  artifact_path text,                            -- .pkl / adapter folder / API model id
  is_active     boolean NOT NULL DEFAULT true,   -- runs on new complaints
  is_primary    boolean NOT NULL DEFAULT false,  -- its answer is shown to the citizen
  metrics       jsonb,                           -- {"orig_bn":0.89,"dialect_bn":0.87,...}
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (name, version)
);
-- at most one primary classifier and one primary ASR model
CREATE UNIQUE INDEX ml_models_one_primary_classifier
  ON ml_models (is_primary) WHERE is_primary AND kind <> 'asr';
CREATE UNIQUE INDEX ml_models_one_primary_asr
  ON ml_models (is_primary) WHERE is_primary AND kind = 'asr';

-- ---------------------------------------------------------------------
-- 6. Complaints — the core table
-- ---------------------------------------------------------------------
CREATE SEQUENCE tracking_seq;

CREATE TABLE complaints (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tracking_code      text NOT NULL UNIQUE
                     DEFAULT 'SC-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('tracking_seq')::text, 5, '0'),
  citizen_id         uuid REFERENCES citizens(id) ON DELETE SET NULL,
  input_mode         input_mode NOT NULL,
  original_text      text,                       -- typed text (NULL for voice-only)
  final_text         text NOT NULL,              -- text the models classified (typed or edited transcript)
  detected_script    text_script,
  detected_dialect   dialect_code NOT NULL DEFAULT 'unknown',
  area_id            int REFERENCES areas(id) ON DELETE SET NULL,
  address_text       text,
  latitude           numeric(9,6),
  longitude          numeric(9,6),
  category_id        smallint REFERENCES categories(id),   -- current/final category
  category_source    category_source NOT NULL DEFAULT 'model',
  category_confidence real CHECK (category_confidence BETWEEN 0 AND 1),
  category_reason    text,                       -- Qwen's one-line reason shown to the citizen
  severity           severity_level,             -- optional; not predicted by current models
  needs_review       boolean NOT NULL DEFAULT false,       -- models disagree / low confidence
  status             complaint_status NOT NULL DEFAULT 'submitted',
  department_id      smallint REFERENCES departments(id),  -- routed department
  assigned_to        uuid REFERENCES admin_users(id) ON DELETE SET NULL, -- officer handling it
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  resolved_at        timestamptz,
  CONSTRAINT text_present CHECK (input_mode = 'voice' OR original_text IS NOT NULL),
  CONSTRAINT resolved_has_time CHECK (status <> 'resolved' OR resolved_at IS NOT NULL)
);
CREATE TRIGGER complaints_touch BEFORE UPDATE ON complaints
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE INDEX complaints_queue_idx   ON complaints (department_id, status, created_at DESC);
CREATE INDEX complaints_review_idx  ON complaints (created_at DESC) WHERE needs_review;
CREATE INDEX complaints_area_idx    ON complaints (area_id);
CREATE INDEX complaints_citizen_idx ON complaints (citizen_id);
CREATE INDEX complaints_text_trgm   ON complaints USING gin (final_text gin_trgm_ops);

-- Audio recordings and photos (files live in object storage; DB keeps the link)
CREATE TABLE complaint_attachments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  complaint_id uuid NOT NULL REFERENCES complaints(id) ON DELETE CASCADE,
  kind         attachment_kind NOT NULL,
  storage_url  text NOT NULL,
  mime_type    text NOT NULL,
  size_bytes   int,
  duration_sec real,                             -- audio only
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX attachments_complaint_idx ON complaint_attachments (complaint_id);

-- Speech-to-text output: one row per ASR model (Groq Whisper vs regional Whisper)
CREATE TABLE transcriptions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  complaint_id      uuid NOT NULL REFERENCES complaints(id) ON DELETE CASCADE,
  attachment_id     uuid NOT NULL REFERENCES complaint_attachments(id) ON DELETE CASCADE,
  model_id          smallint NOT NULL REFERENCES ml_models(id),
  text              text NOT NULL,
  latency_ms        int,
  is_selected       boolean NOT NULL DEFAULT false,  -- the one shown to the citizen
  edited_by_citizen boolean NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX transcriptions_complaint_idx ON transcriptions (complaint_id);

-- Every classifier's output for every complaint (feeds "models disagree" + Model Lab)
CREATE TABLE predictions (
  id                    bigserial PRIMARY KEY,
  complaint_id          uuid NOT NULL REFERENCES complaints(id) ON DELETE CASCADE,
  model_id              smallint NOT NULL REFERENCES ml_models(id),
  predicted_category_id smallint REFERENCES categories(id),  -- NULL if the model failed
  confidence            real CHECK (confidence BETWEEN 0 AND 1),
  reason                text,                    -- LLM explanation, if any
  scores                jsonb,                   -- {"Water":0.86,"Waste":0.05,...}
  raw_output            jsonb,                   -- untouched API / model response
  latency_ms            int,
  error                 text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (complaint_id, model_id)
);
CREATE INDEX predictions_model_idx ON predictions (model_id, created_at DESC);

-- Category fixes by citizens or admins = new labelled training data
CREATE TABLE category_corrections (
  id               bigserial PRIMARY KEY,
  complaint_id     uuid NOT NULL REFERENCES complaints(id) ON DELETE CASCADE,
  old_category_id  smallint REFERENCES categories(id),
  new_category_id  smallint NOT NULL REFERENCES categories(id),
  corrected_by     category_source NOT NULL CHECK (corrected_by IN ('citizen', 'admin')),
  admin_user_id    uuid REFERENCES admin_users(id) ON DELETE SET NULL,
  note             text,
  used_in_training boolean NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT admin_named CHECK (corrected_by = 'citizen' OR admin_user_id IS NOT NULL)
);
CREATE INDEX corrections_training_idx ON category_corrections (created_at) WHERE NOT used_in_training;

-- ---------------------------------------------------------------------
-- 7. Workflow: status timeline, notes, escalations, notifications
-- ---------------------------------------------------------------------
CREATE TABLE status_history (
  id            bigserial PRIMARY KEY,
  complaint_id  uuid NOT NULL REFERENCES complaints(id) ON DELETE CASCADE,
  from_status   complaint_status,
  to_status     complaint_status NOT NULL,
  changed_by    uuid REFERENCES admin_users(id) ON DELETE SET NULL, -- NULL = system (auto-routing)
  public_note   text,                             -- shown on the citizen Track page
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX status_history_complaint_idx ON status_history (complaint_id, created_at);

-- Record every status change automatically
CREATE OR REPLACE FUNCTION log_status_change() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO status_history (complaint_id, from_status, to_status, changed_by)
    VALUES (NEW.id, CASE WHEN TG_OP = 'UPDATE' THEN OLD.status END, NEW.status,
            NULLIF(current_setting('app.admin_user_id', true), '')::uuid);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER complaints_status_log AFTER INSERT OR UPDATE OF status ON complaints
  FOR EACH ROW EXECUTE FUNCTION log_status_change();

CREATE TABLE internal_notes (
  id            bigserial PRIMARY KEY,
  complaint_id  uuid NOT NULL REFERENCES complaints(id) ON DELETE CASCADE,
  admin_user_id uuid NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  body          text NOT NULL,                    -- staff only, never shown to citizens
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX internal_notes_complaint_idx ON internal_notes (complaint_id);

CREATE TABLE escalations (
  id            bigserial PRIMARY KEY,
  complaint_id  uuid NOT NULL REFERENCES complaints(id) ON DELETE CASCADE,
  raised_by     category_source NOT NULL CHECK (raised_by IN ('citizen', 'admin')),
  reason        text NOT NULL,
  escalated_to  text NOT NULL,                    -- 'Ward councillor, Ward 26'
  resolved      boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE notifications (
  id            bigserial PRIMARY KEY,
  complaint_id  uuid NOT NULL REFERENCES complaints(id) ON DELETE CASCADE,
  channel       notify_channel NOT NULL,
  recipient     text NOT NULL,
  message       text NOT NULL,
  status        job_status NOT NULL DEFAULT 'queued',
  sent_at       timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- 8. Model Lab: batch evaluations on uploaded CSVs
-- ---------------------------------------------------------------------
CREATE TABLE evaluation_runs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by      uuid NOT NULL REFERENCES admin_users(id),
  dataset_name    text NOT NULL,                  -- '750 dialect complaints set 3'
  file_url        text NOT NULL,
  text_column     text NOT NULL,                  -- e.g. 'Dialect Text (Banglish)'
  label_column    text NOT NULL DEFAULT 'Category',
  row_count       int,
  status          job_status NOT NULL DEFAULT 'queued',
  error           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  finished_at     timestamptz
);

CREATE TABLE evaluation_results (
  id                bigserial PRIMARY KEY,
  run_id            uuid NOT NULL REFERENCES evaluation_runs(id) ON DELETE CASCADE,
  model_id          smallint NOT NULL REFERENCES ml_models(id),
  accuracy          real,
  macro_f1          real,
  per_class         jsonb,                        -- precision / recall / f1 per category
  confusion_matrix  jsonb,                        -- {"labels":[...],"matrix":[[...]]}
  misclassified_url text,                         -- downloadable CSV of wrong rows
  avg_latency_ms    int,
  UNIQUE (run_id, model_id)
);

-- ---------------------------------------------------------------------
-- 9. Views for the admin dashboard
-- ---------------------------------------------------------------------
-- Department queue counts (sidebar)
CREATE VIEW v_department_queues AS
SELECT d.id AS department_id, d.name_en,
       count(c.id) FILTER (WHERE c.status NOT IN ('resolved', 'rejected')) AS open_count,
       count(c.id) FILTER (WHERE c.needs_review)                          AS review_count
FROM departments d
LEFT JOIN complaints c ON c.department_id = d.id
GROUP BY d.id, d.name_en;

-- Review queue: primary model vs LLM side by side
CREATE VIEW v_review_queue AS
SELECT c.id, c.tracking_code, c.final_text, c.detected_dialect, c.input_mode, c.created_at,
       pc.code AS primary_pred, pp.confidence AS primary_conf,
       lc.code AS llm_pred, lp.reason AS llm_reason
FROM complaints c
LEFT JOIN predictions pp ON pp.complaint_id = c.id
     AND pp.model_id = (SELECT id FROM ml_models WHERE is_primary AND kind <> 'asr' LIMIT 1)
LEFT JOIN categories pc ON pc.id = pp.predicted_category_id
LEFT JOIN predictions lp ON lp.complaint_id = c.id
     AND lp.model_id = (SELECT id FROM ml_models WHERE kind = 'llm' AND is_active LIMIT 1)
LEFT JOIN categories lc ON lc.id = lp.predicted_category_id
WHERE c.needs_review AND c.status NOT IN ('resolved', 'rejected');

-- Headline numbers (KPI cards)
CREATE VIEW v_dashboard_kpis AS
SELECT
  count(*) FILTER (WHERE created_at >= date_trunc('day', now()))                         AS new_today,
  count(*) FILTER (WHERE created_at >= date_trunc('day', now()) AND input_mode = 'voice') AS voice_today,
  count(*) FILTER (WHERE needs_review AND status NOT IN ('resolved', 'rejected'))          AS needs_review,
  round(avg(extract(epoch FROM resolved_at - created_at) / 86400)::numeric, 1)            AS avg_resolution_days,
  round(100.0 * (SELECT count(DISTINCT complaint_id) FROM category_corrections)
        / NULLIF(count(*), 0), 1)                                                          AS correction_rate_pct
FROM complaints;

-- Citizen Track page (only public fields)
CREATE VIEW v_public_tracking AS
SELECT c.tracking_code, c.final_text, c.status, c.created_at, c.resolved_at,
       cat.name_en AS category, cat.name_bn AS category_bn, d.name_en AS department,
       a.name_bn AS area_bn, c.category_reason
FROM complaints c
LEFT JOIN categories  cat ON cat.id = c.category_id
LEFT JOIN departments d   ON d.id = c.department_id
LEFT JOIN areas       a   ON a.id = c.area_id;

-- ---------------------------------------------------------------------
-- 10. Seed data
-- ---------------------------------------------------------------------
INSERT INTO departments (name_en, name_bn) VALUES
  ('Water Supply (WASA)',            'পানি সরবরাহ বিভাগ (ওয়াসা)'),
  ('Power Distribution',             'বিদ্যুৎ বিতরণ বিভাগ'),
  ('City Corporation — Waste',       'সিটি কর্পোরেশন — বর্জ্য ব্যবস্থাপনা'),
  ('Roads & Transport Authority',    'সড়ক ও পরিবহন কর্তৃপক্ষ'),
  ('Health Services',                'স্বাস্থ্য সেবা বিভাগ'),
  ('Food Safety Authority',          'নিরাপদ খাদ্য কর্তৃপক্ষ');

INSERT INTO categories (code, name_en, name_bn, department_id, color_hex) VALUES
  ('Water',            'Water',            'পানি',           1, '#38A3D9'),
  ('Electricity',      'Electricity',      'বিদ্যুৎ',          2, '#F2B33D'),
  ('Waste',            'Waste',            'বর্জ্য',           3, '#7BBF6A'),
  ('Road & Transport', 'Road & Transport', 'সড়ক ও পরিবহন',    4, '#A58BE0'),
  ('Healthcare',       'Healthcare',       'স্বাস্থ্যসেবা',       5, '#F07A7A'),
  ('Food',             'Food',             'খাদ্য',           6, '#E88FC4');

INSERT INTO ml_models (name, version, kind, provider, artifact_path, is_primary, metrics) VALUES
  ('TF-IDF + SVM',        'v1', 'svm',        'local', 'multilingual_grievance_svm_pipeline.pkl', false,
     '{"dialect_bn_750":0.5067,"dialect_banglish_750":0.7067}'),
  ('Zero-shot mDeBERTa',  'v1', 'zero_shot',  'huggingface', 'MoritzLaurer/mDeBERTa-v3-base-mnli-xnli', false, NULL),
  ('Fine-tuned mDeBERTa', 'v1', 'fine_tuned', 'local', 'fine_tuned_mdeberta_grievance', false,
     '{"dialect_bn_750":0.784,"dialect_banglish_750":0.6213}'),
  ('LoRA mDeBERTa',       'v1', 'lora',       'local', 'mdeberta_lora_robust_model', true,
     '{"orig_bn":0.89,"dialect_bn":0.87,"dialect_banglish":0.63}'),
  ('Qwen via Groq',       'qwen3.8-27b', 'llm', 'groq', 'qwen/qwen3.8-27b', false,
     '{"orig_bn":0.90,"dialect_bn":0.855,"dialect_banglish":0.78}'),
  ('Groq Whisper',        'large-v3', 'asr', 'groq', 'whisper-large-v3', false, NULL),
  ('Regional Whisper',    'medium',   'asr', 'huggingface', 'bengaliAI/tugstugi_bengaliai-regional-asr_whisper-medium', true, NULL);

