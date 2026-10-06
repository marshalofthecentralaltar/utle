# Ütle's server for a hosted machine (docs/ARCHITECTURE.md 27.4): the same API as `npm run dev`,
# without Vite, on PORT (Railway sets it; default 8787). Both models are fetched at build time,
# so the image holds them (about 180 MB) and a start never downloads anything.
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

# TalTech's recogniser (149 MB) and the speaker model (29 MB) into models/.
RUN npm run model

# The addon's shared libraries sit next to it.
ENV LD_LIBRARY_PATH=/app/node_modules/sherpa-onnx-linux-x64
ENV PORT=8787
EXPOSE 8787

# Needed at run time: ANTHROPIC_API_KEY, UTLE_TOKEN. Optional: SONIOX_API_KEY, UTLE_MODEL.
CMD ["npm", "run", "serve"]
