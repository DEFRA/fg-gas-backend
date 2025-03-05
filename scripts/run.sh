#!/bin/sh

set -e

env | grep "^TRUSTSTORE_" | cut -d'=' -f2- > /tmp/certs.pem

export NODE_EXTRA_CA_CERTS="/tmp/certs.pem"

node .

