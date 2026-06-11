FROM python:3.12-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    libpq-dev \
    libffi-dev \
    libjpeg-dev \
    zlib1g-dev \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.prod.txt .
RUN pip install --no-cache-dir -r requirements.prod.txt

COPY . .

# Run as a non-root user — any RCE in the app should not get root in-container.
# Create the user, give it the app dir + a keys dir it can write to (the dev
# keypair is generated at boot when JWT keys aren't mounted).
RUN mkdir -p /app/keys \
    && useradd --create-home --uid 10001 appuser \
    && chown -R appuser:appuser /app
USER appuser

EXPOSE 8000

CMD ["sh", "/app/start.sh"]
