#!/bin/sh

set -eu

ENDPOINT="${AWS_ENDPOINT_URL:-http://localhost:4566}"

function aws_local() {
  aws --endpoint-url="$ENDPOINT" "$@"
}

function create_topic() {
  local topic_name=$1
  local topic_arn=$(aws_local sns create-topic \
    --name "$topic_name" \
    --attributes '{"FifoTopic":"true","ContentBasedDeduplication":"true"}' \
    --query TopicArn \
    --output text)
  echo $topic_arn
}

function create_standard_topic() {
  local topic_name=$1
  local topic_arn=$(aws_local sns create-topic \
    --name "$topic_name" \
    --query TopicArn \
    --output text)
  echo $topic_arn
}

function create_queue() {
  local queue_name=$1
  local base="${queue_name%%_fifo.fifo}"
  # Create the DLQ
  local dlq_url=$(
    aws_local sqs create-queue \
      --queue-name "$base-dead-letter-queue" \
      --query "QueueUrl" --output text
  )

  local dlq_arn=$(
    aws_local sqs get-queue-attributes \
      --queue-url $dlq_url \
      --attribute-names "QueueArn" \
      --query "Attributes.QueueArn" \
      --output text
  )

  # Create the queue with DLQ attached
  local queue_url=$(
    aws_local sqs create-queue \
      --queue-name "$queue_name" \
      --attributes "{\"FifoQueue\":\"true\",\"ContentBasedDeduplication\":\"true\",\"RedrivePolicy\":\"{\\\"deadLetterTargetArn\\\":\\\"$dlq_arn\\\",\\\"maxReceiveCount\\\":\\\"1\\\"}\"}" \
      --query QueueUrl \
      --output text
  )

  local queue_arn=$(aws_local sqs get-queue-attributes \
    --queue-url "$queue_url" \
    --attribute-names "QueueArn" \
    --query "Attributes.QueueArn" \
    --output text
  )

  echo $queue_arn
}

function subscribe_queue_to_topic() {
  local topic_arn=$1
  local queue_arn=$2

  aws_local sns subscribe --topic-arn "$topic_arn" --protocol sqs --notification-endpoint "$queue_arn" --attributes '{"RawMessageDelivery":"true"}'
}

function create_topic_and_queue() {
  local topic_name=$1
  local queue_name=$2

  echo "$topic_name $queue_name"

  local topic_arn=$(create_topic "$topic_name")
  local queue_arn=$(create_queue "$queue_name")

  subscribe_queue_to_topic "$topic_arn" "$queue_arn"
}

create_topic_and_queue "cw__sns__case_status_updated_fifo.fifo" "gas__sqs__update_status_fifo.fifo" &
create_topic_and_queue "gas__sns__update_agreement_status_fifo.fifo" "update_agreement_status_fifo.fifo" &
create_topic_and_queue "agreement_status_updated_fifo.fifo" "gas__sqs__update_agreement_status_fifo.fifo" &
create_topic_and_queue "gas__sns__grant_application_created_fifo.fifo" "gas__sqs__grant_application_created_fifo.fifo" &
create_topic_and_queue "gas__sns__application_status_updated_fifo.fifo" "gas__sqs__application_status_updated_fifo.fifo" &
create_topic_and_queue "gas__sns__create_new_case_fifo.fifo" "cw__sqs__create_new_case_fifo.fifo" &
create_topic_and_queue "gas__sns__update_case_status_fifo.fifo" "cw__sqs__update_status_fifo.fifo" &
create_topic_and_queue "gas__sns__create_agreement_fifo.fifo" "create_agreement_fifo.fifo" &

create_standard_topic "gas__sns__audit_topic_arn" &
create_topic "gas__sns__update_agreement_status_fifo.fifo" &

wait

echo "SNS/SQS ready"

touch /tmp/READY