
from fastapi import FastAPI
from database import test_connection

app = FastAPI(
    title="Civic Complaint Understanding System"
)

@app.get("/")
def home():
    return {
        "message": "Civic Complaint System API is running!"
    }

@app.get("/health")
def health_check():
    try:
        result = test_connection()

        return {
            "status": "connected",
            "database": "civic_complaint_understanding",
            "test_result": result
        }

    except Exception as e:
        return {
            "status": "error",
            "message": str(e)
        }
