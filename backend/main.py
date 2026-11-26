"""
Smart Civic Complaint Understanding & Routing System — FastAPI Backend
======================================================================
Endpoints:
  POST /api/complaints          — submit a new complaint
  GET  /api/complaints/{code}   — track by tracking code
  POST /api/complaints/{id}/correct — citizen category correction
  POST /api/complaints/{id}/route   — admin confirm & route
  POST /api/complaints/{id}/notes   — add internal note
  POST /api/complaints/{id}/escalate — escalation
  POST /api/model-lab/compare   — run all 5 classifiers on one text
  GET  /health                  — health check
"""

import os
import re
import logging
from datetime import datetime
from typing import Optional
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from sqlalchemy import text

from database import engine, SessionLocal

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ── Lazy-import ML to avoid startup crash if models not yet downloaded ──
ml = None


def get_ml():
    global ml
    if ml is None:
        import ml_models
        ml = ml_models
    return ml


# ── Category & Department mapping (matches sccu.sql seed) ──────────
CATEGORY_DEPARTMENTS = {
    "Water": {"en": "Water Supply (WASA)", "bn": "পানি সরবরাহ বিভাগ (ওয়াসা)"},
    "Electricity": {"en": "Power Distribution", "bn": "বিদ্যুৎ বিতরণ বিভাগ"},
    "Waste": {"en": "City Corporation — Waste", "bn": "সিটি কর্পোরেশন — বর্জ্য ব্যবস্থাপনা"},
    "Road & Transport": {"en": "Roads & Transport Authority", "bn": "সড়ক ও পরিবহন কর্তৃপক্ষ"},
    "Healthcare": {"en": "Health Services", "bn": "স্বাস্থ্য সেবা বিভাগ"},
    "Food": {"en": "Food Safety Authority", "bn": "নিরাপদ খাদ্য কর্তৃপক্ষ"},
}

VALID_CATEGORIES = list(CATEGORY_DEPARTMENTS.keys())


# ── Script & Dialect detection (server-side mirror of frontend) ─────
def detect_script_and_dialect(txt: str) -> tuple[str, str]:
    has_bangla = bool(re.search(r'[\u0980-\u09FF]', txt))
    has_latin = bool(re.search(r'[a-zA-Z]', txt))

    if has_bangla and has_latin:
        script = 'code_mixed'
    elif has_latin and not has_bangla:
        banglish = re.search(
            r'\b(khali|pani|biddut|bhara|chay|dile|dhakka|nai|korte|hocche|rastay|moyla)\b', txt, re.I
        )
        script = 'banglish' if banglish else 'english'
    else:
        script = 'bangla'

    dialect = 'standard'
    if re.search(r'আইয়ে|দেওন|মুখত|লই|কইরতে|আঁর|তুঁই|চাটগাঁ|ধরি|শুকনা', txt):
        dialect = 'chittagong'
    elif re.search(r'কিতা|খাইসি|ফানি|বালা|হুন|গেসি|আসিল', txt):
        dialect = 'sylhet'
    elif re.search(r'কাউয়া|কুত্তা|রাইতে|ছিঁড়া|ছড়াইয়া|দেয়', txt):
        dialect = 'barishal'
    elif re.search(r'হগল|আইচ্ছা|আব্বারে|লই গেলাম|ছুঁই', txt):
        dialect = 'noakhali'

    return script, dialect


# ── Pydantic models ─────────────────────────────────────────────────
class SubmitComplaintRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=500)
    inputMode: str = "text"
    areaText: str = ""
    phone: Optional[str] = None
    photoName: Optional[str] = None
    audioDurationSec: Optional[float] = None
    audioUrl: Optional[str] = None


class ModelLabCompareRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=500)
    models: Optional[list[str]] = None


class BatchEvaluationRow(BaseModel):
    text: str = Field(..., min_length=1, max_length=500)
    category: str


class BatchEvaluationRequest(BaseModel):
    rows: list[BatchEvaluationRow] = Field(..., min_length=1, max_length=500)
    models: list[str] = Field(..., min_length=1)


class CategoryCorrectionRequest(BaseModel):
    newCategory: str
    source: str = "citizen"  # 'citizen' or 'admin'


class RouteRequest(BaseModel):
    category: str
    departmentOverride: Optional[str] = None


class NoteRequest(BaseModel):
    body: str
    isPublic: bool = False


class EscalateRequest(BaseModel):
    reason: str = "No resolution within SLA period"
    escalatedTo: str = "Ward councillor"


# ── Lifespan ────────────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("🚀 Civic Complaint System starting up...")
    yield
    logger.info("Shutting down…")


# ── App ─────────────────────────────────────────────────────────────
app = FastAPI(title="Civic Complaint Understanding System", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Helpers ─────────────────────────────────────────────────────────
def _fmt_datetime(dt: Optional[datetime] = None) -> str:
    d = dt or datetime.now()
    return d.strftime("%d %b %Y, %H:%M")


def _build_complaint_response(row: dict, predictions: list[dict] | None = None) -> dict:
    """Build the ComplaintRecord shape the frontend expects."""
    cat = row.get("category", "Water")
    dept = CATEGORY_DEPARTMENTS.get(cat, CATEGORY_DEPARTMENTS["Water"])
    created = row.get("created_at", datetime.now())
    created_str = _fmt_datetime(created) if isinstance(created, datetime) else str(created)

    lora_pred = None
    lora_conf = None
    qwen_pred = None
    qwen_conf = None
    if predictions:
        for p in predictions:
            if p.get("error"):
                continue
            if p.get("modelKey") == "lora":
                lora_pred = p["predictedCategory"]
                lora_conf = p["confidence"]
            elif p.get("modelKey") == "qwen":
                qwen_pred = p["predictedCategory"]
                qwen_conf = p["confidence"]

    return {
        "id": row.get("id", ""),
        "shortId": row.get("short_id", row.get("tracking_code", "")[-8:]),
        "trackingCode": row.get("tracking_code", ""),
        "inputMode": row.get("input_mode", "text"),
        "originalText": row.get("original_text", row.get("final_text", "")),
        "finalText": row.get("final_text", ""),
        "detectedScript": row.get("detected_script", "bangla"),
        "detectedDialect": row.get("detected_dialect", "unknown"),
        "areaText": row.get("address_text", ""),
        "zoneLabel": (row.get("address_text", "") or "").split(",")[0].strip() or "Chattogram",
        "phone": row.get("phone"),
        "photoName": row.get("photo_name"),
        "category": cat,
        "categorySource": row.get("category_source", "model"),
        "confidence": row.get("category_confidence", 0.0) or 0.0,
        "reason": row.get("category_reason", ""),
        "loraPred": lora_pred,
        "loraConf": lora_conf or 0.0,
        "qwenPred": qwen_pred,
        "qwenConf": qwen_conf or 0.0,
        "needsReview": row.get("needs_review", False),
        "status": row.get("status", "submitted"),
        "departmentEn": dept["en"],
        "departmentBn": dept["bn"],
        "audioDurationSec": row.get("audio_duration_sec"),
        "audioUrl": row.get("audio_url"),
        "internalNotes": [],
        "createdAt": created_str,
        "timeline": [
            {
                "id": "t1",
                "status": "submitted",
                "titleBn": "জমা হয়েছে",
                "titleEn": "Submitted",
                "detail": f"Submitted · {created_str}",
                "timestamp": created_str,
                "completed": True,
            },
            {
                "id": "t2",
                "status": "assigned",
                "titleBn": "বিভাগে পাঠানো হয়েছে",
                "titleEn": "Auto-routed",
                "detail": f"Auto-routed to the {cat} department · {created_str}",
                "timestamp": created_str,
                "completed": True,
                "current": True,
            },
            {
                "id": "t3",
                "status": "in_progress",
                "titleBn": "কাজ চলছে",
                "titleEn": "In progress",
                "detail": "Awaiting field team assignment",
                "timestamp": "pending",
                "completed": False,
            },
            {
                "id": "t4",
                "status": "resolved",
                "titleBn": "সমাধান হয়েছে",
                "titleEn": "Resolved",
                "detail": "Resolved · pending",
                "timestamp": "pending",
                "completed": False,
            },
        ],
    }


# ── Endpoints ───────────────────────────────────────────────────────

@app.get("/")
def home():
    return {"message": "Civic Complaint System API is running!"}


@app.get("/health")
def health_check():
    try:
        with engine.connect() as conn:
            result = conn.execute(text("SELECT 1")).scalar()
            tables = conn.execute(text("""
                SELECT
                    to_regclass('public.complaints') IS NOT NULL AS complaints,
                    to_regclass('public.categories') IS NOT NULL AS categories,
                    to_regclass('public.departments') IS NOT NULL AS departments,
                    to_regclass('public.ml_models') IS NOT NULL AS ml_models,
                    to_regclass('public.predictions') IS NOT NULL AS predictions
            """)).mappings().one()
            missing_tables = [name for name, exists in tables.items() if not exists]
            category_count = 0
            model_count = 0
            if not missing_tables:
                category_count = conn.execute(text("SELECT count(*) FROM categories")).scalar_one()
                model_count = conn.execute(text("SELECT count(*) FROM ml_models")).scalar_one()

        if missing_tables or category_count == 0:
            return {
                "status": "schema_missing",
                "database": "civic_complaint_understanding",
                "message": "PostgreSQL is reachable, but the project schema or seed data is missing. Run sccu.sql against the database configured in backend/.env.",
                "missingTables": missing_tables,
                "categoryCount": category_count,
            }

        if model_count == 0:
            return {
                "status": "schema_incomplete",
                "database": "civic_complaint_understanding",
                "message": "The project tables exist, but model seed data is missing. Re-run sccu.sql against the configured database.",
                "categoryCount": category_count,
                "modelCount": model_count,
            }

        return {
            "status": "connected",
            "database": "civic_complaint_understanding",
            "test_result": result,
            "categoryCount": category_count,
            "modelCount": model_count,
        }
    except Exception as e:
        logger.exception("Database health check failed")
        return {"status": "error", "message": str(e)}


# ── POST /api/complaints ────────────────────────────────────────────
@app.post("/api/complaints")
def submit_complaint(req: SubmitComplaintRequest):
    if not req.text.strip():
        raise HTTPException(422, "Complaint text must not be blank.")
    ml_mod = get_ml()
    script, dialect = detect_script_and_dialect(req.text)

    # Run all 5 classifiers
    predictions = ml_mod.predict_all(req.text)
    primary = ml_mod.determine_primary_category(predictions)
    if primary.get("error"):
        raise HTTPException(status_code=503, detail=primary["error"])

    cat = primary["category"]
    dept = CATEGORY_DEPARTMENTS.get(cat, CATEGORY_DEPARTMENTS["Water"])
    now_str = _fmt_datetime()

    # Try to persist to DB
    db_row = {}
    try:
        with SessionLocal() as session:
            # Look up category_id and department_id from DB
            cat_row = session.execute(
                text("SELECT id, department_id FROM categories WHERE code = :code"),
                {"code": cat},
            ).mappings().first()

            category_id = cat_row["id"] if cat_row else None
            department_id = cat_row["department_id"] if cat_row else None

            result = session.execute(
                text("""
                    INSERT INTO complaints
                        (input_mode, original_text, final_text, detected_script,
                         detected_dialect, address_text, category_id, category_source,
                         category_confidence, category_reason, needs_review, status,
                         department_id)
                    VALUES
                        (CAST(:input_mode AS input_mode), :original_text, :final_text,
                         CAST(:detected_script AS text_script),
                         CAST(:detected_dialect AS dialect_code), :address_text,
                         :category_id, 'model', :confidence, :reason, :needs_review,
                         CAST(:status AS complaint_status),
                         :department_id)
                    RETURNING id, tracking_code, created_at
                """),
                {
                    "input_mode": req.inputMode,
                    "original_text": req.text,
                    "final_text": req.text,
                    "detected_script": script,
                    "detected_dialect": dialect,
                    "address_text": req.areaText,
                    "category_id": category_id,
                    "confidence": primary["confidence"],
                    "reason": primary["reason"],
                    "needs_review": primary["needsReview"],
                    "status": "needs_review" if primary["needsReview"] else "assigned",
                    "department_id": department_id,
                },
            )
            row = result.mappings().first()
            complaint_id = str(row["id"])
            tracking_code = row["tracking_code"]
            created_at = row["created_at"]

            # Save individual predictions
            for pred in predictions:
                if pred.get("error"):
                    continue
                p_cat_row = session.execute(
                    text("SELECT id FROM categories WHERE code = :code"),
                    {"code": pred["predictedCategory"]},
                ).mappings().first()
                p_cat_id = p_cat_row["id"] if p_cat_row else None

                # Look up model_id
                model_kind_map = {
                    "svm": "svm", "fine_tuned": "fine_tuned",
                    "lora": "lora", "zero_shot": "zero_shot", "qwen": "llm",
                }
                mk = model_kind_map.get(pred["modelKey"], pred["modelKey"])
                m_row = session.execute(
                    text("SELECT id FROM ml_models WHERE kind = CAST(:kind AS model_kind) LIMIT 1"),
                    {"kind": mk},
                ).mappings().first()

                if m_row:
                    try:
                        import json
                        with session.begin_nested():
                            session.execute(
                                text("""
                                    INSERT INTO predictions
                                        (complaint_id, model_id, predicted_category_id,
                                         confidence, reason, scores, latency_ms)
                                    VALUES
                                        (CAST(:cid AS uuid), :mid, :pcid, :conf,
                                         :reason, CAST(:scores AS jsonb), :lat)
                                    ON CONFLICT (complaint_id, model_id) DO NOTHING
                                """),
                                {
                                    "cid": complaint_id,
                                    "mid": m_row["id"],
                                    "pcid": p_cat_id,
                                    "conf": pred["confidence"],
                                    "reason": pred.get("note", ""),
                                    "scores": json.dumps(pred.get("scores", {})),
                                    "lat": pred.get("latencyMs", 0),
                                },
                            )
                    except Exception as pe:
                        logger.warning("Failed to save prediction for %s: %s", pred["modelKey"], pe)

            session.commit()

            db_row = {
                "id": complaint_id,
                "tracking_code": tracking_code,
                "created_at": created_at,
                "input_mode": req.inputMode,
                "original_text": req.text,
                "final_text": req.text,
                "detected_script": script,
                "detected_dialect": dialect,
                "address_text": req.areaText,
                "category": cat,
                "category_source": "model",
                "category_confidence": primary["confidence"],
                "category_reason": primary["reason"],
                "needs_review": primary["needsReview"],
                "status": "needs_review" if primary["needsReview"] else "assigned",
                "phone": req.phone,
            }
    except Exception as e:
        logger.exception("DB insert failed")
        raise HTTPException(
            status_code=503,
            detail="The prediction completed, but the complaint could not be saved. Check http://localhost:8000/health for missing schema details and check the backend terminal for the database error.",
        ) from e

    return _build_complaint_response(db_row, predictions)


# ── GET /api/complaints/{code} ──────────────────────────────────────
@app.get("/api/complaints/{tracking_code}")
def get_complaint(tracking_code: str):
    try:
        with SessionLocal() as session:
            row = session.execute(
                text("""
                    SELECT c.id, c.tracking_code, c.input_mode, c.original_text,
                           c.final_text, c.detected_script, c.detected_dialect,
                           c.address_text, cat.code AS category, c.category_source,
                           c.category_confidence, c.category_reason, c.needs_review,
                           c.status, c.created_at, c.resolved_at,
                           d.name_en AS department_en
                    FROM complaints c
                    LEFT JOIN categories cat ON cat.id = c.category_id
                    LEFT JOIN departments d ON d.id = c.department_id
                    WHERE c.tracking_code = :tc
                """),
                {"tc": tracking_code},
            ).mappings().first()

            if not row:
                raise HTTPException(404, f"Complaint {tracking_code} not found")

            # Get status history for timeline
            history = session.execute(
                text("""
                    SELECT to_status, public_note, created_at
                    FROM status_history
                    WHERE complaint_id = :cid
                    ORDER BY created_at
                """),
                {"cid": str(row["id"])},
            ).mappings().all()

            # Get predictions
            preds = session.execute(
                text("""
                    SELECT p.confidence, p.reason, cat.code AS predicted_category,
                           m.kind
                    FROM predictions p
                    LEFT JOIN categories cat ON cat.id = p.predicted_category_id
                    LEFT JOIN ml_models m ON m.id = p.model_id
                    WHERE p.complaint_id = :cid
                """),
                {"cid": str(row["id"])},
            ).mappings().all()

        result = _build_complaint_response(dict(row))

        # Enrich timeline from status history
        if history:
            timeline = []
            status_labels = {
                "submitted": ("জমা হয়েছে", "Submitted"),
                "assigned": ("বিভাগে পাঠানো হয়েছে", "Auto-routed"),
                "needs_review": ("পর্যালোচনা প্রয়োজন", "Needs review"),
                "in_progress": ("কাজ চলছে", "In progress"),
                "resolved": ("সমাধান হয়েছে", "Resolved"),
                "rejected": ("প্রত্যাখ্যান", "Rejected"),
                "escalated": ("এস্কালেট করা হয়েছে", "Escalated"),
            }
            for i, h in enumerate(history):
                st = h["to_status"]
                labels = status_labels.get(st, (st, st))
                ts = _fmt_datetime(h["created_at"]) if isinstance(h["created_at"], datetime) else str(h["created_at"])
                detail = h["public_note"] or f"{labels[1]} · {ts}"
                timeline.append({
                    "id": f"t{i + 1}",
                    "status": st,
                    "titleBn": labels[0],
                    "titleEn": labels[1],
                    "detail": detail,
                    "timestamp": ts,
                    "completed": True,
                    "current": i == len(history) - 1,
                })
            # Add pending steps
            final_status = history[-1]["to_status"]
            if final_status not in ("resolved", "rejected"):
                if final_status != "in_progress":
                    timeline.append({
                        "id": f"t{len(timeline) + 1}",
                        "status": "in_progress",
                        "titleBn": "কাজ চলছে",
                        "titleEn": "In progress",
                        "detail": "Awaiting field team assignment",
                        "timestamp": "pending",
                        "completed": False,
                    })
                timeline.append({
                    "id": f"t{len(timeline) + 1}",
                    "status": "resolved",
                    "titleBn": "সমাধান হয়েছে",
                    "titleEn": "Resolved",
                    "detail": "Resolved · pending",
                    "timestamp": "pending",
                    "completed": False,
                })
            result["timeline"] = timeline

        # Add department note from latest public status_history note
        for h in reversed(list(history)):
            if h.get("public_note"):
                result["departmentNote"] = h["public_note"]
                break

        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Track complaint failed: %s", e)
        raise HTTPException(500, str(e))


# ── POST /api/complaints/{id}/correct ──────────────────────────────
@app.post("/api/complaints/{complaint_id}/correct")
def correct_category(complaint_id: str, req: CategoryCorrectionRequest):
    if req.newCategory not in VALID_CATEGORIES:
        raise HTTPException(400, f"Invalid category: {req.newCategory}")

    try:
        with SessionLocal() as session:
            # Get current category
            comp = session.execute(
                text("SELECT id, category_id FROM complaints WHERE id = :cid::uuid"),
                {"cid": complaint_id},
            ).mappings().first()
            if not comp:
                raise HTTPException(404, "Complaint not found")

            # Look up new category_id
            new_cat = session.execute(
                text("SELECT id, department_id FROM categories WHERE code = :code"),
                {"code": req.newCategory},
            ).mappings().first()

            # Update complaint
            session.execute(
                text("""
                    UPDATE complaints
                    SET category_id = :new_cat_id, category_source = 'citizen',
                        department_id = :dept_id
                    WHERE id = :cid::uuid
                """),
                {
                    "new_cat_id": new_cat["id"],
                    "dept_id": new_cat["department_id"],
                    "cid": complaint_id,
                },
            )

            # Record correction
            session.execute(
                text("""
                    INSERT INTO category_corrections
                        (complaint_id, old_category_id, new_category_id, corrected_by)
                    VALUES (:cid::uuid, :old_id, :new_id, :source)
                """),
                {
                    "cid": complaint_id,
                    "old_id": comp["category_id"],
                    "new_id": new_cat["id"],
                    "source": req.source,
                },
            )
            session.commit()

        return {"success": True, "newCategory": req.newCategory}
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Correction failed: %s", e)
        raise HTTPException(500, str(e))


# ── POST /api/complaints/{id}/route ─────────────────────────────────
@app.post("/api/complaints/{complaint_id}/route")
def route_complaint(complaint_id: str, req: RouteRequest):
    if req.category not in VALID_CATEGORIES:
        raise HTTPException(400, f"Invalid category: {req.category}")

    try:
        with SessionLocal() as session:
            cat = session.execute(
                text("SELECT id, department_id FROM categories WHERE code = :code"),
                {"code": req.category},
            ).mappings().first()

            session.execute(
                text("""
                    UPDATE complaints
                    SET category_id = :cat_id, category_source = 'admin',
                        department_id = :dept_id, needs_review = false,
                        status = 'assigned'
                    WHERE id = :cid::uuid
                """),
                {
                    "cat_id": cat["id"],
                    "dept_id": cat["department_id"],
                    "cid": complaint_id,
                },
            )
            session.commit()

        return {"success": True, "category": req.category, "status": "assigned"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Route failed: %s", e)
        raise HTTPException(500, str(e))


# ── POST /api/complaints/{id}/notes ─────────────────────────────────
@app.post("/api/complaints/{complaint_id}/notes")
def add_note(complaint_id: str, req: NoteRequest):
    try:
        with SessionLocal() as session:
            if req.isPublic:
                # Add as public status_history note
                session.execute(
                    text("""
                        INSERT INTO status_history
                            (complaint_id, to_status, public_note)
                        SELECT :cid::uuid, status, :note
                        FROM complaints WHERE id = :cid::uuid
                    """),
                    {"cid": complaint_id, "note": req.body},
                )
            else:
                # For internal notes, we'd need admin_user_id — use a system placeholder
                # In production this would come from the authenticated session
                session.execute(
                    text("""
                        INSERT INTO status_history
                            (complaint_id, to_status, public_note)
                        SELECT :cid::uuid, status, :note
                        FROM complaints WHERE id = :cid::uuid
                    """),
                    {"cid": complaint_id, "note": req.body},
                )
            session.commit()

        return {"success": True}
    except Exception as e:
        logger.error("Add note failed: %s", e)
        raise HTTPException(500, str(e))


# ── POST /api/complaints/{id}/escalate ──────────────────────────────
@app.post("/api/complaints/{complaint_id}/escalate")
def escalate_complaint(complaint_id: str, req: EscalateRequest):
    try:
        with SessionLocal() as session:
            session.execute(
                text("""
                    INSERT INTO escalations
                        (complaint_id, raised_by, reason, escalated_to)
                    VALUES (:cid::uuid, 'citizen', :reason, :to)
                """),
                {"cid": complaint_id, "reason": req.reason, "to": req.escalatedTo},
            )
            session.execute(
                text("UPDATE complaints SET status = 'escalated' WHERE id = :cid::uuid"),
                {"cid": complaint_id},
            )
            session.commit()

        return {"success": True, "status": "escalated"}
    except Exception as e:
        logger.error("Escalate failed: %s", e)
        raise HTTPException(500, str(e))


# ── POST /api/model-lab/compare ─────────────────────────────────────
@app.post("/api/model-lab/compare")
def model_lab_compare(req: ModelLabCompareRequest):
    ml_mod = get_ml()
    model_keys = set(ml_mod.MODEL_PREDICTORS)
    invalid_models = sorted(set(req.models or []) - model_keys)
    if invalid_models:
        raise HTTPException(400, f"Unknown model key(s): {', '.join(invalid_models)}")
    if not req.text.strip():
        raise HTTPException(422, "Complaint text must not be blank.")
    predictions = ml_mod.predict_all(req.text, req.models)

    return {
        "predictions": predictions,
        "asr": [],
    }


@app.post("/api/model-lab/evaluate")
def model_lab_evaluate(req: BatchEvaluationRequest):
    ml_mod = get_ml()
    categories = set(VALID_CATEGORIES)
    model_keys = set(ml_mod.MODEL_PREDICTORS)
    invalid_categories = sorted({row.category for row in req.rows} - categories)
    invalid_models = sorted(set(req.models) - model_keys)
    if invalid_categories:
        raise HTTPException(400, f"Unknown category value(s): {', '.join(invalid_categories)}")
    if invalid_models:
        raise HTTPException(400, f"Unknown model key(s): {', '.join(invalid_models)}")

    labels = VALID_CATEGORIES
    results = []
    for model_key in dict.fromkeys(req.models):
        confusion_matrix = [[0 for _ in labels] for _ in labels]
        misclassified_rows = []
        correct = 0
        latency_total = 0
        model_name = model_key
        model_error = None

        for row_index, row in enumerate(req.rows, start=1):
            prediction = ml_mod.predict_all(row.text, [model_key])[0]
            if prediction.get("error"):
                model_error = prediction["error"]
                break

            model_name = prediction["modelName"]
            latency_total += prediction.get("latencyMs", 0)
            actual_index = labels.index(row.category)
            predicted_index = labels.index(prediction["predictedCategory"])
            confusion_matrix[actual_index][predicted_index] += 1
            if actual_index == predicted_index:
                correct += 1
            else:
                misclassified_rows.append({
                    "rowIndex": row_index,
                    "text": row.text,
                    "actual": row.category,
                    "predicted": prediction["predictedCategory"],
                })

        if model_error:
            results.append({
                "modelKey": model_key,
                "modelName": model_name,
                "accuracy": 0,
                "macroF1": 0,
                "avgLatencyMs": 0,
                "confusionMatrix": [[0 for _ in labels] for _ in labels],
                "misclassifiedRows": [],
                "error": model_error,
            })
            continue

        f1_scores = []
        for index in range(len(labels)):
            true_positive = confusion_matrix[index][index]
            false_positive = sum(confusion_matrix[row][index] for row in range(len(labels)) if row != index)
            false_negative = sum(confusion_matrix[index][column] for column in range(len(labels)) if column != index)
            if true_positive + false_positive and true_positive + false_negative:
                precision = true_positive / (true_positive + false_positive)
                recall = true_positive / (true_positive + false_negative)
                f1_scores.append(2 * precision * recall / (precision + recall))

        results.append({
            "modelKey": model_key,
            "modelName": model_name,
            "accuracy": correct / len(req.rows),
            "macroF1": sum(f1_scores) / len(f1_scores) if f1_scores else 0,
            "avgLatencyMs": round(latency_total / len(req.rows)),
            "confusionMatrix": confusion_matrix,
            "misclassifiedRows": misclassified_rows,
        })

    return {"results": results}


# ── GET /api/admin/dashboard ────────────────────────────────────────
@app.get("/api/admin/dashboard")
def admin_dashboard():
    try:
        with SessionLocal() as session:
            # KPIs
            kpis = session.execute(text("SELECT * FROM v_dashboard_kpis")).mappings().first()

            # Department queues
            queues = session.execute(text("SELECT * FROM v_department_queues")).mappings().all()

            # Recent complaints
            complaints = session.execute(
                text("""
                    SELECT c.id, c.tracking_code, c.final_text, c.detected_dialect,
                           c.input_mode, c.address_text, c.needs_review, c.status,
                           c.created_at, cat.code AS category,
                           lp.predicted_category_id, lc.code AS lora_pred,
                           qp.predicted_category_id AS qwen_pred_id, qc.code AS qwen_pred
                    FROM complaints c
                    LEFT JOIN categories cat ON cat.id = c.category_id
                    LEFT JOIN predictions lp ON lp.complaint_id = c.id
                        AND lp.model_id = (SELECT id FROM ml_models WHERE kind = 'lora' LIMIT 1)
                    LEFT JOIN categories lc ON lc.id = lp.predicted_category_id
                    LEFT JOIN predictions qp ON qp.complaint_id = c.id
                        AND qp.model_id = (SELECT id FROM ml_models WHERE kind = 'llm' LIMIT 1)
                    LEFT JOIN categories qc ON qc.id = qp.predicted_category_id
                    ORDER BY c.created_at DESC
                    LIMIT 50
                """),
            ).mappings().all()

        return {
            "kpis": dict(kpis) if kpis else {},
            "queues": [dict(q) for q in queues],
            "complaints": [dict(c) for c in complaints],
        }
    except Exception as e:
        logger.error("Dashboard failed: %s", e)
        raise HTTPException(500, str(e))
