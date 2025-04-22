#!/bin/bash

set -ex

# S3 buckets
# aws --endpoint-url=http://localhost:4566 s3 mb s3://my-bucket

# SNS topic
aws --endpoint-url=http://localhost:4566 sns create-topic --name grant-application

# SQS queues
aws --endpoint-url=http://localhost:4566 sqs create-queue --queue-name grant-application
aws --endpoint-url=http://localhost:4566 sqs create-queue --queue-name dead-letter-queue
aws --endpoint-url=http://localhost:4566 sqs create-queue --queue-name recovery-queue

# Configure dead letter queue
aws --endpoint-url=http://localhost:4566 sqs set-queue-attributes \
--queue-url http://sqs.eu-west-2.127.0.0.1:4566/000000000000/grant-application \
--attributes '{ "RedrivePolicy": "{\"deadLetterTargetArn\":\"arn:aws:sqs:eu-west-2:000000000000:dead-letter-queue\",\"maxReceiveCount\":\"1\"}" }'

# Subscribe queue to topic
aws --endpoint-url=http://localhost:4566 sns subscribe --topic-arn arn:aws:sns:eu-west-2:000000000000:grant-application \
--protocol sqs --notification-endpoint arn:aws:sqs:eu-west-2:000000000000:grant-application
