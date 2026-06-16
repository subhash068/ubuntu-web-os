FROM python:3.11-slim

# Set work directory
WORKDIR /app

# Copy application files
COPY server.py index.html index.css app.js stats.sh ./

# Expose the application port
EXPOSE 9500

# Run server.py
CMD ["python", "server.py"]
