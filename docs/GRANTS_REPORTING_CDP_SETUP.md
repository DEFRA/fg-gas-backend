# GAS Grants Reporting setup in CDP

GAS owns and publishes Agreement reporting events to the standard SNS topic
`gfr__sns___reporting_events`. The topic must be subscribed to the Grants
Reporting queue before GAS is deployed with reporting enabled.

## Create the resources

In the CDP Portal, select **Create → Resources request** and add these resources.

### SNS topic

- Owning service: `fg-gas-backend`
- Topic name: `gfr__sns___reporting_events`
- FIFO topic: `No`

Owning the topic gives the GAS task role permission to publish to it.

### SQS SNS subscription

- Queue service: `grants-reporting-collector`
- Queue name: `gfr__sqs__grants_reporting_events`
- Topic service: `fg-gas-backend`
- Topic name: `gfr__sns___reporting_events`

Request the resources for `dev`, `test`, `perf-test`, `ext-test`, and `prod`. If
the new topic is not available in the subscription form immediately, submit the
topic request first and request the subscription after the topic is provisioned.

## Configure GAS

Set `GAS__SNS__REPORTING_EVENTS_TOPIC_ARN` for GAS in each environment:

| Environment | Value |
| --- | --- |
| `dev` | `arn:aws:sns:eu-west-2:332499610595:gfr__sns___reporting_events` |
| `test` | `arn:aws:sns:eu-west-2:756547862786:gfr__sns___reporting_events` |
| `perf-test` | `arn:aws:sns:eu-west-2:120185944470:gfr__sns___reporting_events` |
| `ext-test` | `arn:aws:sns:eu-west-2:711387132227:gfr__sns___reporting_events` |
| `prod` | `arn:aws:sns:eu-west-2:409408189387:gfr__sns___reporting_events` |

The application configuration is proposed in
[`DEFRA/cdp-app-config#4449`](https://github.com/DEFRA/cdp-app-config/pull/4449).
Do not configure `infra-dev` or `management` unless GAS will run there and the
messaging resources have been created for that environment.

## Deploy and verify

Wait for both the resource request and application configuration to be merged
before deploying the reporting code. Deploying with only the ARN configured lets
GAS start, but failed publications will exhaust their outbox retries and become
`DEAD_LETTER`; making the topic available later does not replay them
automatically.

After deployment, create or transition a managed Agreement and confirm that its
reporting outbox record reaches `COMPLETED`.

## Sources

- [CDP SQS/SNS guidance](https://github.com/DEFRA/cdp-documentation/blob/main/how-to/sqs-sns.md)
- [CDP application configuration guidance](https://github.com/DEFRA/cdp-documentation/blob/main/how-to/config.md)
