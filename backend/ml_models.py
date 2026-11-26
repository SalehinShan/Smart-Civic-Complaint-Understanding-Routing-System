"""
ML Model Inference Module
=========================
Loads all 5 classifiers and exposes a uniform predict interface.
Models are loaded lazily on first use to keep startup fast.
"""

import os
import time
import logging
from typing import Optional
from pathlib import Path

import numpy as np

logger = logging.getLogger(__name__)

MODELS_DIR = Path(__file__).parent / "models"
DATA_DIR = Path(__file__).parent / "data"

LABEL_MAP = {
    0: "Electricity",
    1: "Food",
    2: "Healthcare",
    3: "Road & Transport",
    4: "Waste",
    5: "Water",
}
LABEL_LIST = [LABEL_MAP[i] for i in range(6)]
REVERSE_LABEL = {v: k for k, v in LABEL_MAP.items()}

# ── Singleton holders ───────────────────────────────────────────────
_svm_pipeline = None
_ft_model = None
_ft_tokenizer = None
_lora_model = None
_lora_tokenizer = None
_zeroshot_pipeline = None


# ── SVM (TF-IDF + SVM) ─────────────────────────────────────────────
def _load_svm():
    global _svm_pipeline
    if _svm_pipeline is None:
        import joblib
        pkl_path = MODELS_DIR / "multilingual_grievance_svm_pipeline.pkl"
        logger.info("Loading SVM pipeline from %s", pkl_path)
        _svm_pipeline = joblib.load(pkl_path)
    return _svm_pipeline


def predict_svm(text: str) -> dict:
    t0 = time.time()
    pipe = _load_svm()
    pred_label = pipe.predict([text])[0]
    latency_ms = int((time.time() - t0) * 1000)

    # Try to get decision function scores (SVM margin)
    confidence = 0.0
    scores_dict = {}
    try:
        decision = pipe.decision_function([text])[0]
        # Convert SVM margins to pseudo-probabilities via softmax
        exp_d = np.exp(decision - np.max(decision))
        probs = exp_d / exp_d.sum()
        classes = list(pipe.classes_)
        for i, cls in enumerate(classes):
            scores_dict[cls] = round(float(probs[i]), 4)
        pred_idx = classes.index(pred_label)
        confidence = float(probs[pred_idx])
    except Exception:
        confidence = 0.5

    return {
        "modelKey": "svm",
        "modelName": "TF-IDF + SVM",
        "kind": "svm",
        "predictedCategory": pred_label,
        "confidence": round(confidence, 4),
        "confidenceLabel": f"margin {confidence:.2f}",
        "latencyMs": latency_ms,
        "latencyLabel": f"{latency_ms} ms",
        "note": "Fast linear n-gram baseline.",
        "scores": scores_dict,
    }


# ── Fine-tuned mDeBERTa ────────────────────────────────────────────
def _load_fine_tuned():
    global _ft_model, _ft_tokenizer
    if _ft_model is None:
        import torch
        from transformers import AutoModelForSequenceClassification, AutoTokenizer

        model_path = str(MODELS_DIR / "fine_tuned_mdeberta_grievance")
        logger.info("Loading fine-tuned mDeBERTa from %s", model_path)
        _ft_tokenizer = AutoTokenizer.from_pretrained(model_path)
        _ft_model = AutoModelForSequenceClassification.from_pretrained(model_path)
        _ft_model.eval()
    return _ft_model, _ft_tokenizer


def predict_fine_tuned(text: str) -> dict:
    import torch

    t0 = time.time()
    model, tokenizer = _load_fine_tuned()
    inputs = tokenizer(text, return_tensors="pt", truncation=True, max_length=512)
    with torch.no_grad():
        logits = model(**inputs).logits
    probs = torch.softmax(logits, dim=-1).squeeze().tolist()
    latency_ms = int((time.time() - t0) * 1000)

    pred_idx = int(np.argmax(probs))
    pred_label = LABEL_MAP[pred_idx]
    scores_dict = {LABEL_MAP[i]: round(p, 4) for i, p in enumerate(probs)}

    return {
        "modelKey": "fine_tuned",
        "modelName": "Fine-tuned mDeBERTa",
        "kind": "fine_tuned",
        "predictedCategory": pred_label,
        "confidence": round(probs[pred_idx], 4),
        "latencyMs": latency_ms,
        "latencyLabel": f"{latency_ms / 1000:.2f} s",
        "note": "Full fine-tune baseline.",
        "scores": scores_dict,
    }


# ── LoRA mDeBERTa (primary) ────────────────────────────────────────
def _load_lora():
    global _lora_model, _lora_tokenizer
    if _lora_model is None:
        import torch
        from transformers import AutoModelForSequenceClassification, AutoTokenizer
        from peft import PeftModel

        base_model_name = "MoritzLaurer/mDeBERTa-v3-base-mnli-xnli"
        adapter_path = str(MODELS_DIR / "mdeberta_lora_robust_model")
        logger.info("Loading LoRA adapter from %s onto base %s", adapter_path, base_model_name)

        _lora_tokenizer = AutoTokenizer.from_pretrained(adapter_path)

        base_model = AutoModelForSequenceClassification.from_pretrained(
            base_model_name,
            num_labels=6,
            ignore_mismatched_sizes=True,
        )
        _lora_model = PeftModel.from_pretrained(base_model, adapter_path)
        _lora_model = _lora_model.merge_and_unload()
        _lora_model.eval()
    return _lora_model, _lora_tokenizer


def predict_lora(text: str) -> dict:
    import torch

    t0 = time.time()
    model, tokenizer = _load_lora()
    inputs = tokenizer(text, return_tensors="pt", truncation=True, max_length=512)
    with torch.no_grad():
        logits = model(**inputs).logits
    probs = torch.softmax(logits, dim=-1).squeeze().tolist()
    latency_ms = int((time.time() - t0) * 1000)

    pred_idx = int(np.argmax(probs))
    pred_label = LABEL_MAP[pred_idx]
    scores_dict = {LABEL_MAP[i]: round(p, 4) for i, p in enumerate(probs)}

    return {
        "modelKey": "lora",
        "modelName": "LoRA mDeBERTa (ours)",
        "kind": "lora",
        "predictedCategory": pred_label,
        "confidence": round(probs[pred_idx], 4),
        "latencyMs": latency_ms,
        "latencyLabel": f"{latency_ms / 1000:.2f} s",
        "note": "Main model for Bangla & dialect script.",
        "scores": scores_dict,
    }


# ── Zero-shot mDeBERTa ─────────────────────────────────────────────
def _load_zeroshot():
    global _zeroshot_pipeline
    if _zeroshot_pipeline is None:
        from transformers import pipeline

        logger.info("Loading zero-shot mDeBERTa pipeline")
        _zeroshot_pipeline = pipeline(
            "zero-shot-classification",
            model="MoritzLaurer/mDeBERTa-v3-base-mnli-xnli",
        )
    return _zeroshot_pipeline


def predict_zero_shot(text: str) -> dict:
    t0 = time.time()
    pipe = _load_zeroshot()
    result = pipe(text, candidate_labels=LABEL_LIST, multi_label=False)
    latency_ms = int((time.time() - t0) * 1000)

    pred_label = result["labels"][0]
    pred_conf = result["scores"][0]
    scores_dict = {label: round(score, 4) for label, score in zip(result["labels"], result["scores"])}

    return {
        "modelKey": "zero_shot",
        "modelName": "Zero-shot mDeBERTa",
        "kind": "zero_shot",
        "predictedCategory": pred_label,
        "confidence": round(pred_conf, 4),
        "latencyMs": latency_ms,
        "latencyLabel": f"{latency_ms / 1000:.2f} s",
        "note": "No training; reads label semantics as waste.",
        "scores": scores_dict,
    }


# ── Qwen via Groq (LLM) ────────────────────────────────────────────
def predict_qwen(text: str) -> dict:
    t0 = time.time()
    api_key = os.getenv("GROQ_API_KEY", "")

    if not api_key:
        return {
            "modelKey": "qwen",
            "modelName": "Qwen via Groq",
            "kind": "llm",
            "predictedCategory": "Water",
            "confidence": 0.0,
            "latencyMs": 0,
            "latencyLabel": "N/A",
            "note": "GROQ_API_KEY not set — skipped.",
            "scores": {},
            "error": "GROQ_API_KEY not configured",
        }

    try:
        from groq import Groq

        client = Groq(api_key=api_key)
        system_prompt = (
            "You are a civic complaint classifier for Bangladesh. "
            "Given a complaint text (in Bangla, Banglish, or English), classify it into exactly one of these categories:\n"
            "Water, Electricity, Waste, Road & Transport, Healthcare, Food\n\n"
            "Respond ONLY in this JSON format (no markdown, no extra text):\n"
            '{"category": "<one of the 6 categories>", "confidence": <0.0-1.0>, "reason": "<one-line explanation>"}'
        )

        response = client.chat.completions.create(
            model="qwen/qwen3-8b",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": f"Classify this complaint:\n{text}"},
            ],
            temperature=0.1,
            max_tokens=200,
        )

        raw_text = response.choices[0].message.content.strip()
        # Remove <think>...</think> tags if present (Qwen reasoning)
        import re
        raw_text = re.sub(r"<think>.*?</think>", "", raw_text, flags=re.DOTALL).strip()

        latency_ms = int((time.time() - t0) * 1000)

        # Parse JSON response
        import json

        # Try to find JSON in the response
        json_match = re.search(r'\{[^}]+\}', raw_text)
        if json_match:
            parsed = json.loads(json_match.group())
        else:
            parsed = json.loads(raw_text)

        pred_label = parsed.get("category")
        if not isinstance(pred_label, str):
            raise ValueError("Qwen response did not contain a category.")
        # Validate category
        if pred_label not in LABEL_LIST:
            # Try fuzzy match
            for valid in LABEL_LIST:
                if valid.lower() in pred_label.lower() or pred_label.lower() in valid.lower():
                    pred_label = valid
                    break
            else:
                raise ValueError(f"Qwen returned an unknown category: {pred_label}")

        confidence = float(parsed.get("confidence", 0.85))
        if not 0 <= confidence <= 1:
            raise ValueError("Qwen returned a confidence outside the 0-1 range.")
        reason = parsed.get("reason", "LLM classification.")

        return {
            "modelKey": "qwen",
            "modelName": "Qwen via Groq",
            "kind": "llm",
            "predictedCategory": pred_label,
            "confidence": round(confidence, 4),
            "confidenceLabel": "match",
            "latencyMs": latency_ms,
            "latencyLabel": f"{latency_ms / 1000:.1f} s",
            "note": reason,
            "scores": {},
        }
    except Exception as e:
        latency_ms = int((time.time() - t0) * 1000)
        logger.error("Qwen prediction failed: %s", e)
        return {
            "modelKey": "qwen",
            "modelName": "Qwen via Groq",
            "kind": "llm",
            "predictedCategory": "Water",
            "confidence": 0.0,
            "latencyMs": latency_ms,
            "latencyLabel": f"{latency_ms / 1000:.1f} s",
            "note": f"Error: {str(e)[:100]}",
            "scores": {},
            "error": str(e)[:200],
        }


# ── Unified interface ───────────────────────────────────────────────
MODEL_PREDICTORS = {
    "svm": predict_svm,
    "fine_tuned": predict_fine_tuned,
    "lora": predict_lora,
    "zero_shot": predict_zero_shot,
    "qwen": predict_qwen,
}


def predict_all(text: str, model_keys: Optional[list[str]] = None) -> list[dict]:
    """Run all (or selected) classifiers on the given text."""
    keys = model_keys or list(MODEL_PREDICTORS.keys())
    results = []
    for key in keys:
        if key in MODEL_PREDICTORS:
            try:
                result = MODEL_PREDICTORS[key](text)
                results.append(result)
            except Exception as e:
                logger.error("Model %s failed: %s", key, e)
                results.append({
                    "modelKey": key,
                    "modelName": key,
                    "kind": key,
                    "predictedCategory": "Water",
                    "confidence": 0.0,
                    "latencyMs": 0,
                    "latencyLabel": "N/A",
                    "note": f"Error: {str(e)[:100]}",
                    "scores": {},
                    "error": str(e)[:200],
                })
    return results


def determine_primary_category(predictions: list[dict]) -> dict:
    """
    Choose the final category from model predictions.
    Primary model = LoRA mDeBERTa. If LoRA and Qwen disagree → needs_review.
    """
    available_predictions = [p for p in predictions if not p.get("error")]
    lora_pred = next((p for p in available_predictions if p["modelKey"] == "lora"), None)
    qwen_pred = next((p for p in available_predictions if p["modelKey"] == "qwen"), None)

    if lora_pred:
        primary = lora_pred
    elif qwen_pred:
        primary = qwen_pred
    elif available_predictions:
        primary = max(available_predictions, key=lambda p: p.get("confidence", 0))
    else:
        return {
            "category": "Water",
            "confidence": 0.0,
            "reason": "No classifiers were available to make a prediction.",
            "needsReview": True,
            "error": "All classifiers failed or were unavailable.",
        }

    needs_review = False
    reason = primary.get("note", "")

    # Check if LoRA and Qwen disagree
    if lora_pred and qwen_pred:
        if lora_pred["predictedCategory"] != qwen_pred["predictedCategory"]:
            needs_review = True
            reason = qwen_pred.get("note", reason)

    # Low confidence → needs review
    if primary["confidence"] < 0.5:
        needs_review = True

    return {
        "category": primary["predictedCategory"],
        "confidence": primary["confidence"],
        "reason": reason,
        "needsReview": needs_review,
        "loraPred": lora_pred["predictedCategory"] if lora_pred else None,
        "loraConf": lora_pred["confidence"] if lora_pred else None,
        "qwenPred": qwen_pred["predictedCategory"] if qwen_pred else None,
        "qwenConf": qwen_pred["confidence"] if qwen_pred else None,
    }
