#!/bin/bash

# Sorts last of all the init scripts mounted into floci, so by the time it runs
# every queue and topic the stack needs has been created. The floci healthcheck
# waits on this marker rather than on the gateway being up, because floci starts
# serving HTTP before the init hooks have finished.
#
# Only mounted when gas owns the floci container. When gas is pulled into
# another stack that stack owns the marker - see
# compose/ext/compose.gas-ext.example.yml.

set -e

echo READY > /tmp/READY
