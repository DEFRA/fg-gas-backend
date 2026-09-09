# Grants Reporting CDP messaging setup

## Conclusion

GAS publishes Agreement reporting events to an SNS topic. It does not consume the
reporting SQS queue, so GAS needs the topic ARN and SNS publish permission, not a
queue URL.

The Grants Reporting collector owns and consumes the standard queue
`gfr__sqs__grants_reporting_events`. Its local setup names the corresponding
standard topic `gfr__sns___reporting_events` and subscribes that queue to it.

The topic and subscription are not currently declared in CDP tenant config. The
collector's queue exists in every runtime environment, but its `subscriptions`
array is empty. CDP must therefore provision the topic and subscription and grant
GAS permission to publish before the application configuration can work.

## Application configuration

Add `GAS__SNS__REPORTING_EVENTS_TOPIC_ARN` to the GAS configuration in each
environment that runs GAS and the collector:

| Environment | Value |
| --- | --- |
| `dev` | `arn:aws:sns:eu-west-2:332499610595:gfr__sns___reporting_events` |
| `test` | `arn:aws:sns:eu-west-2:756547862786:gfr__sns___reporting_events` |
| `perf-test` | `arn:aws:sns:eu-west-2:120185944470:gfr__sns___reporting_events` |
| `ext-test` | `arn:aws:sns:eu-west-2:711387132227:gfr__sns___reporting_events` |
| `prod` | `arn:aws:sns:eu-west-2:409408189387:gfr__sns___reporting_events` |

The collector already configures `REPORTING_EVENTS_QUEUE_URL` for
`gfr__sqs__grants_reporting_events` in these five environments. GAS should not
configure that queue URL.

The `infra-dev` and `management` app-config files for GAS and the collector are
currently empty and their tenant definitions do not provision these messaging
resources. Do not add invented ARNs there unless these services are intended to
run the reporting flow in those environments.

## CDP registration

The recommended ownership is for Grants Reporting to own both the topic and the
collector queue, matching its local setup and the `gfr` resource prefix. For each
of the five runtime environments, CDP tenant configuration needs to:

1. Declare the standard SNS topic `gfr__sns___reporting_events` for the Grants
   Reporting collector.
2. Subscribe the existing standard queue `gfr__sqs__grants_reporting_events` to
   that topic with raw message delivery.
3. Add `gfr__sns___reporting_events` to the GAS service's allowed IAM topics so
   its task role receives `sns:Publish` permission.

CDP's current guidance says resources owned by one team can be requested through
Portal's **Create → Resource Request** flow. A subscription involving a resource
owned by another team is not self-service: obtain the owning team's agreement and
request it in `#cdp-support`. Because GAS publishes to Grants Reporting-owned
infrastructure, confirm ownership with that team and use the cross-team support
route if the teams differ.

After the app-config change is merged, GAS must be redeployed for the environment
variable to take effect.

## Sources

- [`grants-reporting-publisher` usage examples](https://github.com/DEFRA/grants-reporting-publisher/blob/main/EXAMPLES.md) configure an SNS client and a target topic ARN; they do not configure a queue.
- [`grants-reporting-publisher/src/publish.js`](https://github.com/DEFRA/grants-reporting-publisher/blob/main/src/publish.js) sends a `PublishCommand` to `sns.topicArn`.
- [`grants-reporting-collector` local resource setup](https://github.com/DEFRA/grants-reporting-collector/blob/main/compose/floci/start.d/10-setup-resources.sh) creates `gfr__sns___reporting_events`, creates `gfr__sqs__grants_reporting_events`, and subscribes the queue to the topic.
- [`grants-reporting-collector` CDP app config](https://github.com/DEFRA/cdp-app-config/tree/main/services/grants-reporting-collector) supplies the existing queue URL per environment.
- [`grants-reporting-collector` CDP tenant config](https://github.com/DEFRA/cdp-tenant-config/blob/main/environments/dev/tenants/grants-reporting-collector.json) shows the queue with no subscription and no reporting SNS topic; the same state exists in `test`, `perf-test`, `ext-test`, and `prod`.
- [CDP SQS/SNS guidance](https://github.com/DEFRA/cdp-documentation/blob/main/how-to/sqs-sns.md) documents resource ownership, cross-team subscription requests, IAM permissions, raw message delivery, and environment account IDs.
- [CDP application configuration guidance](https://github.com/DEFRA/cdp-documentation/blob/main/how-to/config.md) requires app-config changes and a redeployment before new values take effect.
