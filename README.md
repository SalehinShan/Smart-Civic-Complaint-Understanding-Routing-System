# Smart-Civic-Complaint-Understanding-Routing-System

## Run locally

The application has a Vite/React frontend and a FastAPI backend. Use Python 3.11 for the
backend (the API uses Python 3.10+ syntax and the pinned NumPy release requires Python 3.10+).

### 1. Prepare PostgreSQL

Create a PostgreSQL database, then load the schema and seed data from `sccu.sql`. For example:

```sh
psql -h localhost -U postgres -d civic_complaint_understanding -f sccu.sql
```

Set `DATABASE_URL` in `backend/.env` to the SQLAlchemy PostgreSQL URL for that database:

```text
DATABASE_URL=postgresql+psycopg://USER:PASSWORD@localhost:5432/civic_complaint_understanding
```

Qwen through Groq is optional. To enable it, add a newly generated `GROQ_API_KEY` to
`backend/.env`. Do not put API keys in the frontend or commit them. If a key has been shared
publicly or in chat, revoke it and generate a replacement.

### 2. Install and start the backend

From the project root:

```sh
cd backend
python3.11 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
python -m uvicorn main:app --reload
```

The backend listens at `http://localhost:8000`. The first real model run may download model
weights from Hugging Face and can take several minutes. The SVM model is bundled in the
repository. Without `GROQ_API_KEY`, local classifiers still run; the Qwen card reports that it
is unavailable.

### 3. Start the frontend

In another terminal, from the project root:

```sh
cd frontend
npm ci
npm run dev
```

Open the URL Vite prints (usually `http://localhost:5173`). The Vite proxy forwards `/api`
requests to the backend without changing their paths.

The Model Lab's **Live compare** and **Batch evaluation** call backend classifiers. Complaint
submission also uses the backend and requires PostgreSQL to save the resulting complaint.
Voice capture currently records audio but does not transcribe it; the displayed ASR examples
are sample text, not model output.