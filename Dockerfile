FROM python:3.11-slim

# 1. Install Playwright System Dependencies (Cached layer - rarely changes)
RUN apt-get update && apt-get install -y \
    wget \
    gnupg \
    libglib2.0-0 \
    libnss3 \
    libnspr4 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libdbus-1-3 \
    libxcb1 \
    libxkbcommon0 \
    libx11-6 \
    libxcomposite1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libasound2 \
    && rm -rf /var/lib/apt/lists/*

# 2. Set up the non-root user (Required by Hugging Face Spaces)
RUN useradd -m -u 1000 user
USER user
ENV PATH="/home/user/.local/bin:$PATH"
WORKDIR /app

# 3. 🚨 THE SPEED HACK: Copy ONLY requirements.txt first
COPY --chown=user requirements.txt .

# 4. Install Heavy Dependencies
RUN pip install --no-cache-dir -r requirements.txt
ENV PLAYWRIGHT_BROWSERS_PATH=/home/user/.cache/ms-playwright
RUN playwright install chromium

# 5. NOW copy the rest of your application code
COPY --chown=user . /app

# 6. Generate Prisma Client
RUN prisma generate

# 7. Expose the mandatory Hugging Face port
EXPOSE 7860

# 8. Start the application
CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "7860"]