# Worker canh giá / check vé — chạy Playwright + Chromium.
# Ảnh nền chính thức của Playwright đã có sẵn Chromium + thư viện hệ thống,
# KHỚP đúng version 1.60.0 trong package.json (đổi tag nếu nâng playwright).
FROM mcr.microsoft.com/playwright:v1.60.0-noble

WORKDIR /app

# Cài dependencies theo lockfile trước (tận dụng cache layer khi chỉ đổi code).
# --omit=dev: bỏ devDependencies (nodemon); playwright nằm ở dependencies nên vẫn có.
COPY package*.json ./
RUN npm ci --omit=dev

# Ảnh nền đã có Chromium cho 1.60.0; lệnh này là no-op nếu đã có, hoặc tải đúng bản nếu thiếu.
RUN npx playwright install chromium

# Copy phần code còn lại
COPY . .

ENV NODE_ENV=production
ENV AUTO_MIGRATE=false
ENV WORKER_PORT=6000

# Cổng HTTP nội bộ của worker (reverse proxy/TLS sẽ đứng trước).
EXPOSE 6000

# Chạy worker: vòng canh định kỳ + HTTP server (/internal/check-now, /internal/quote).
CMD ["node", "workers/serve.js"]
