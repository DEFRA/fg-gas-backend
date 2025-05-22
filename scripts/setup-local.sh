#!/bin/bash
set -e

echo "Setting up LocalStack SNS/SQS resources for GAS..."

# Create SNS topic (GAS publishes to this)
awslocal sns create-topic --name grant-application-created

# Create SQS queue (to simulate GAS receiving a response, if needed)
awslocal sqs create-queue --queue-name gas_case_updates

# Create topic for responses (Caseworking publishes to this)
awslocal sns create-topic --name grant_application_approved

echo "✅ GAS SNS/SQS setup complete."
