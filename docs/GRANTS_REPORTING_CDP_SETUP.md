# GAS access to Grants Reporting in CDP

GAS publishes Agreement reporting events to the standard SNS topic
`gfr__sns___reporting_events`. GAS needs the topic ARN in its application
configuration and `sns:Publish` permission for its CDP task role. GAS does not
need a reporting queue URL or permission to consume from a queue.

## Required configuration

Set `GAS__SNS__REPORTING_EVENTS_TOPIC_ARN` for GAS in each environment:

| Environment | Value |
| --- | --- |
| `dev` | `arn:aws:sns:eu-west-2:332499610595:gfr__sns___reporting_events` |
| `test` | `arn:aws:sns:eu-west-2:756547862786:gfr__sns___reporting_events` |
| `perf-test` | `arn:aws:sns:eu-west-2:120185944470:gfr__sns___reporting_events` |
| `ext-test` | `arn:aws:sns:eu-west-2:711387132227:gfr__sns___reporting_events` |
| `prod` | `arn:aws:sns:eu-west-2:409408189387:gfr__sns___reporting_events` |

This configuration is proposed in
[`DEFRA/cdp-app-config#4449`](https://github.com/DEFRA/cdp-app-config/pull/4449).
Do not configure `infra-dev` or `management` unless GAS will run the reporting
flow there and CDP provides an ARN for that environment.

## Requesting access

For each environment where this feature will be deployed:

1. Confirm with the Grants Reporting team that the topic exists and that the ARN
   above is correct.
2. Obtain their approval for GAS to publish to their topic.
3. Ask CDP Support in `#cdp-support` to add
   `gfr__sns___reporting_events` to the allowed SNS topics for
   `fg-gas-backend`. Include:
   - the target environment;
   - the topic name and ARN;
   - the `fg-gas-backend` service name;
   - the required `sns:Publish` permission; and
   - the Grants Reporting team's approval.
4. Merge the app-config change.
5. Redeploy GAS after CDP confirms that the topic and publish permission are
   ready.

Do not deploy the reporting code before both the environment variable and publish
permission are available. GAS will start when the ARN is configured even if it
cannot access the topic, but reporting publications will exhaust their outbox
retries and become `DEAD_LETTER`; granting access later does not replay them
automatically.

## Verification

After deployment, create or transition a managed Agreement and confirm that its
reporting outbox record reaches `COMPLETED`. An `AccessDenied` or `NotFound` SNS
error means the CDP access or topic setup is not ready.

## Sources

- [CDP SQS/SNS guidance](https://github.com/DEFRA/cdp-documentation/blob/main/how-to/sqs-sns.md)
- [CDP application configuration guidance](https://github.com/DEFRA/cdp-documentation/blob/main/how-to/config.md)
- [`grants-reporting-publisher` usage examples](https://github.com/DEFRA/grants-reporting-publisher/blob/main/EXAMPLES.md)
