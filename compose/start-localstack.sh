#!/bin/bash

set -e

function create_topic() {
  local topic_name=$1
  local topic_arn=$(awslocal sns create-topic --name $topic_name --query "TopicArn" --output text)
  echo $topic_arn
}

function create_queue() {
  local queue_name=$1

  # Create the DLQ
  local dlq_url=$(
    awslocal sqs create-queue \
    --queue-name "$queue_name-dead-letter-queue" \
    --query "QueueUrl" --output text
  )

  local dlq_arn=$(
    awslocal sqs get-queue-attributes \
      --queue-url $dlq_url \
      --attribute-name "QueueArn" \
      --query "Attributes.QueueArn" \
      --output text
  )

  # Create the queue with DLQ attached
  local queue_url=$(
    awslocal sqs create-queue \
      --queue-name $queue_name \
      --attributes '{ "RedrivePolicy": "{\"deadLetterTargetArn\":\"'$dlq_arn'\",\"maxReceiveCount\":\"1\"}" }' \
      --query "QueueUrl" \
      --output text
  )

  local queue_arn=$(
    awslocal sqs get-queue-attributes \
      --queue-url $queue_url \
      --attribute-name "QueueArn" \
      --query "Attributes.QueueArn" \
      --output text
  )

  echo $queue_arn
}

function subscribe_queue_to_topic() {
  local topic_arn=$1
  local queue_arn=$2

  awslocal sns subscribe --topic-arn $topic_arn --protocol sqs --notification-endpoint $queue_arn --attributes '{ "RawMessageDelivery": "true" }'
}

function setup_topic_and_queues() {
  local topic_name=$1

  local topic_arn=$(create_topic $topic_name)
  local queue_arn=$(create_queue $topic_name)

  subscribe_queue_to_topic $topic_arn $queue_arn
}

function create_topic_and_queue() {
  local topic_name=$1
  local queue_name=$2

  local topic_arn=$(create_topic $topic_name)
  local queue_arn=$(create_queue $queue_name)

  subscribe_queue_to_topic $topic_arn $queue_arn
}

setup_topic_and_queues "grant_application_approved" &
setup_topic_and_queues "case_stage_updated" &
create_queue "gas__sqs__update_status" &
create_topic_and_queue "agreement_status_updated" "gas__sqs__update_agreement_status" &
create_topic_and_queue "gas__sns__grant_application_created" "gas__sqs__handle_grant_application_created" &
create_topic_and_queue "gas__sns__grant_application_status_updated" "gas__sqs__handle_grant_application_status_updated" &
create_topic_and_queue "gas__sns__create_new_case" "cw__sqs__create_new_case" &
create_topic_and_queue "gas__sns__update_case_status" "cw__sqs__update_status" &

wait


echo "SNS/SQS ready"
