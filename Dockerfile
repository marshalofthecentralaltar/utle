# Ütle's server for a hosted machine (docs/ARCHITECTURE.md 27.4): the same API as `npm run dev`,
# without Vite, on PORT (Railway sets it; default 8787). All three models are fetched at build time,
# so the image holds them (about 199 MB) and a start never downloads anything.
#
# Node 22.18 or later: the decode worker is a .ts file and Node strips its types (ARCHITECTURE 20.1).
FROM node:22.20-bookworm-slim

WORKDIR /app

# Dependencies first, so a code change does not reinstall them. Dev dependencies are needed:
# `npm run serve` and `npm run model` run through tsx. The lock holds sherpa-onnx-linux-x64,
# the native addon's prebuilt package for this platform.
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .

# Three models into models/ (round 7), and the hotword list next to them:
#   streaming-zipformer-large.et-en/  TalTech's recogniser, 156 221 502 bytes (encoder.int8.onnx 154 895 904)
#   speaker/nemo_en_titanet_small.onnx  the speaker model, 40 257 283 bytes (server/speaker.ts)
#   vad/silero_vad_v5.onnx  the speech detector, 2 313 101 bytes (server/vad.ts)
RUN npm run model

# The addon's shared libraries sit next to it.
ENV LD_LIBRARY_PATH=/app/node_modules/sherpa-onnx-linux-x64
ENV PORT=8787
EXPOSE 8787

# Needed at run time: ANTHROPIC_API_KEY, UTLE_TOKEN. Optional: SONIOX_API_KEY, UTLE_MODEL.
CMD ["npm", "run", "serve"]
