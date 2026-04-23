ARG PYTHON_IMAGE=python:3.12-slim-bookworm
FROM ${PYTHON_IMAGE}

ARG DEBIAN_MIRROR=http://deb.debian.org/debian
ARG DEBIAN_SECURITY_MIRROR=http://deb.debian.org/debian-security
ARG PIP_BUILD_INDEX_URL=https://pypi.org/simple

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8080 \
    PIP_INDEX_URL=${PIP_BUILD_INDEX_URL}

WORKDIR /app

RUN if [ -f /etc/apt/sources.list.d/debian.sources ]; then \
        sed -i "s|http://deb.debian.org/debian|${DEBIAN_MIRROR}|g; s|https://deb.debian.org/debian|${DEBIAN_MIRROR}|g; s|http://deb.debian.org/debian-security|${DEBIAN_SECURITY_MIRROR}|g; s|https://deb.debian.org/debian-security|${DEBIAN_SECURITY_MIRROR}|g" /etc/apt/sources.list.d/debian.sources; \
    elif [ -f /etc/apt/sources.list ]; then \
        sed -i "s|http://deb.debian.org/debian|${DEBIAN_MIRROR}|g; s|https://deb.debian.org/debian|${DEBIAN_MIRROR}|g; s|http://deb.debian.org/debian-security|${DEBIAN_SECURITY_MIRROR}|g; s|https://deb.debian.org/debian-security|${DEBIAN_SECURITY_MIRROR}|g" /etc/apt/sources.list; \
    fi \
    && apt-get update \
    && apt-get install -y --no-install-recommends bash curl unzip openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

COPY . /app

RUN chmod 755 /app/vendor/dify-plugin-repackaging-plus/plugin_repackaging.sh \
    /app/vendor/dify-plugin-repackaging-plus/plugin_repackaging_amd64_to_arm64.sh \
    /app/vendor/dify-plugin-repackaging-plus/dify-plugin-linux-amd64-5g \
    /app/vendor/dify-plugin-repackaging-plus/dify-plugin-linux-arm64-5g \
    /app/vendor/dify-plugin-offline-packager/bin/dify-plugin-linux-amd64 \
    /app/vendor/dify-plugin-offline-packager/bin/dify-plugin-linux-arm64

EXPOSE 8080

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8080"]
