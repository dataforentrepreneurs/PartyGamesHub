# ==== Stage 1: Build the React Frontend ====
FROM node:20 AS frontend-builder
WORKDIR /app/frontend

# Install dependencies and build
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ ./
RUN npm run build

# ==== Stage 2: Build the FastAPI Backend ====
FROM python:3.11-slim
WORKDIR /app

# Copy the compiled React assets from the Node container
COPY --from=frontend-builder /app/frontend/dist /app/frontend/dist

# Setup backend
COPY backend/ /app/backend/
WORKDIR /app/backend
RUN pip install --no-cache-dir -r requirements.txt

EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
