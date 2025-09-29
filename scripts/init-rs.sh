#!/usr/bin/env bash
set -euo pipefail

PRIMARY="${PRIMARY:-mongodb:27017}"
REPLSET="${REPLSET:-mongoRepl}"

echo "Waiting for mongod to respond on $PRIMARY..."
for i in {1..60}; do
  if mongosh "mongodb://$PRIMARY/?directConnection=true" --quiet --eval "db.runCommand({ping:1}).ok" | grep -q 1; then
    break
  fi
  sleep 2
done

# Initiate if needed (no-op if already initiated)
mongosh "mongodb://$PRIMARY/?directConnection=true" --quiet <<EOF
try { rs.status() } catch(e) {
  rs.initiate({
    _id: "$REPLSET",
    members: [
      { _id: 0, host: "mongodb:27017",   priority: 2 },
      { _id: 1, host: "mongodb-2:27017", priority: 1 },
      { _id: 2, host: "mongodb-3:27017", priority: 1 }
    ]
  })
}
EOF

echo "Waiting for PRIMARY election..."
for i in {1..90}; do
  if mongosh "mongodb://$PRIMARY/?directConnection=true" --quiet --eval "db.hello().isWritablePrimary" | grep -q true; then
    echo "Replica set ready."
    # Keep the container alive; healthcheck below will reflect readiness.
    exec tail -f /dev/null
  fi
  sleep 2
done

echo "Timed out waiting for PRIMARY"
exit 1
