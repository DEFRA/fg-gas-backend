#!/bin/bash

set -ex

# SNS topic - grant application created
aws --endpoint-url=http://localhost:4566 sns create-topic --name grant-application-created

# SQS queues
aws --endpoint-url=http://localhost:4566 sqs create-queue --queue-name grant-application-created
aws --endpoint-url=http://localhost:4566 sqs create-queue --queue-name grant-application-dead-letter-queue
aws --endpoint-url=http://localhost:4566 sqs create-queue --queue-name grant-application-recovery-queue

# Configure dead letter queue
aws --endpoint-url=http://localhost:4566 sqs set-queue-attributes \
--queue-url http://sqs.eu-west-2.127.0.0.1:4566/000000000000/grant-application-created \
--attributes '{ "RedrivePolicy": "{\"deadLetterTargetArn\":\"arn:aws:sqs:eu-west-2:000000000000:grant-application-dead-letter-queue\",\"maxReceiveCount\":\"1\"}" }'

# Subscribe queue to topic
aws --endpoint-url=http://localhost:4566 sns subscribe --topic-arn arn:aws:sns:eu-west-2:000000000000:grant-application-created \
--protocol sqs --notification-endpoint arn:aws:sqs:eu-west-2:000000000000:grant-application-created

# SNS topic - grant application approved
aws --endpoint-url=http://localhost:4566 sns create-topic --name grant_application_approved

# SQS queues = case stage updates
aws --endpoint-url=http://localhost:4566 sqs create-queue --queue-name case_stage_updates_queue
aws --endpoint-url=http://localhost:4566 sqs create-queue --queue-name case_stage_updates_queue-dead-letter-queue

# Subscribe queue to topic
aws --endpoint-url=http://localhost:4566 sns subscribe --topic-arn arn:aws:sns:eu-west-2:000000000000:grant_application_approved \
--protocol sqs --notification-endpoint arn:aws:sqs:eu-west-2:000000000000:case_stage_updates_queue
