# Use Python 3.11 as the base image for our unified server
FROM python:3.11-slim

# Set standard working directory
WORKDIR /app

# Copy the pre-compiled frontend assets
# Note: Ensure you have run `cd frontend && npm run build` before building the docker image
COPY ./frontend/dist /app/frontend/dist

# Copy the backend code
COPY ./backend /app/backend

# Navigate to backend to install dependencies
WORKDIR /app/backend
RUN pip install --no-cache-dir -r requirements.txt

# Expose port 8000 (often required or re-mapped by cloud providers like Render)
EXPOSE 8000

# Command to run the Uvicorn monolithic server mapping host and port
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
