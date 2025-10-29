ARG PARENT_VERSION=2.8.14-node22.20.0
ARG PORT=3000
ARG PORT_DEBUG=9229

FROM defradigital/node:${PARENT_VERSION}
ARG PARENT_VERSION
LABEL uk.gov.defra.ffc.parent-image=defradigital/node:${PARENT_VERSION}

# Add curl to template.
# CDP PLATFORM HEALTHCHECK REQUIREMENT
USER root
RUN apk add --no-cache curl
USER node

COPY --chown=node:node package*.json ./
COPY --chown=node:node scripts/run.sh scripts/run.sh
COPY --chown=node:node migrate-mongo-config.js ./
COPY --chown=node:node migrations ./migrations

RUN npm ci --omit=dev \
  chmod +x scripts/run.sh

COPY --chown=node:node src src

ARG PORT
ENV PORT=${PORT}
EXPOSE ${PORT}

CMD [ "scripts/run.sh" ]
