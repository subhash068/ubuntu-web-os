FROM python:3.11-slim

# Set work directory
WORKDIR /app

# Install curl for healthcheck
RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*

# Copy backend, frontend and scripts
COPY backend/ ./backend/
COPY frontend/ ./frontend/
COPY scripts/ ./scripts/
COPY .env.example ./

# Install python dependencies
RUN pip install --no-cache-dir fastapi uvicorn pg8000

# Expose the application port
EXPOSE 9500

# Run uvicorn server
CMD ["uvicorn", "backend.api.main:app", "--host", "0.0.0.0", "--port", "9500"]
