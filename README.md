# fg-gas-backend

Grant Application Service defines and manages farming grants and applications. It is the source of truth for all grant applications and their status.

- [User guide](#user-guide)
  - [Configure grant actions](#configure-grant-actions)
- [Developer guide](#developer-guide)
  - [Node.js](#nodejs)
- [Local development](#local-development)
  - [Setup](#setup)
  - [Development](#development)
  - [Testing](#testing)
    - [Unit tests](#unit-tests)
    - [Integration tests](#integration-tests)
  - [Production](#production)
- [Docker](#docker)
  - [Production image](#production-image)
  - [Docker Compose](#docker-compose)
- [Licence](#licence)
  - [About the licence](#about-the-licence)

## User guide

### Configure grant actions

As part of the Grant Application Service, you can configure and call actions on grants.

Given a grant definition is stored in GAS as per the following example:

- Note the $areaId and $segmentId in the URL, these are placeholders that will be replaced with actual values when the action is invoked.

```json
{
  "code": "my-grant-code",
  "actions": [
    {
      "name": "land-area-calculation",
      "method": "POST",
      "url": "https://my-other-server.%ENVIRONMENT%.gov.uk/some-path/area-calc/$areaId/$segmentId"
    }
  ]
}
```

Note: The `%ENVIRONMENT%` placeholder will be replaced with the current CDP environment when running in a CDP environment.

This can be called via the following HTTP request:

- Note the areaId and segmentId query parameters, these will be used to replace the placeholders in the URL.
- The anotherParam query parameter is an example of additional parameters will be passed on in the URL query string.

```http request
POST http://gas-server/grants/my-grant-code/actions/land-area-calculation/invoke?areaId=123&segmentId=456&anotherParam=ABC123
Content-Type: application/json

{
  "someKey": "someValue"
}
```

This wil result in the following HTTP request being made to the configured URL:

```http request
POST https://my-other-server/some-path/area-calc/123/456?code=my-grant-code&anotherParam=ABC123
Content-Type: application/json

{
  "someKey": "someValue"
}
```

## Developer guide

### Node.js

Please install Node Version Manager [nvm](https://github.com/creationix/nvm)

To use the correct version of Node.js for this application, via nvm:

```bash
cd fg-gas-backend
nvm use
```

## Local development

### Setup

Install application dependencies:

```bash
npm install
```

Create a `.env` file in the root of the project. You can use the `.env.example` file as a template.

```bash
cp .env.example .env
```

## SNS/SQS Message retrieval for local development

To verify an SNS message has been queued locally you will need the aws cli installed and some basic configuration.

### Install Aws Cli

Install aws cli (https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html)

### Configure your localstack with aws config

Add the following localstack profile to your `~/.aws/config`

```bash
[profile localstack]
region=eu-west-1
output=json
endpoint_url=http://localhost:4566
```

Add the following config to your `~/.aws/credentials`

```bash
[localstack]
aws_access_key_id=test
aws_secret_access_key=test
```

### Query localstack

Then run the following to fetch messages in the queue. The queue-url should match the output from local stack in your console environment

```bash
aws sqs receive-message --queue-url http://sqs.eu-west-2.127.0.0.1:4566/000000000000/grant_application_created --profile localstack
```

### Development

To run the application in `development` mode run:

```bash
npm run dev
```

### Testing

#### Unit tests

To run the unit tests:

```bash
npm run test:unit
```

#### Integration tests

To run the integration tests:

```bash
npm run test:integration
```

#### Contract tests

Contract tests verify that this service (provider) correctly implements the contracts expected by consumer services.

**Setup for local development:**

1. Copy environment file: `cp .env.example .env`
2. Contact your team lead to get Pact Broker credentials
3. Add credentials to your `.env` file:
   ```bash
   PACT_BROKER_USERNAME=your-username-here
   PACT_BROKER_PASSWORD=your-password-here
   ```

**To run contract tests:**

```bash
npm run test:contracts:provider
```

Contract tests use testcontainers to automatically start and manage required services (MongoDB, LocalStack, fg-gas-backend), so no manual service startup is needed.

## Docker

Launch GAS and dependencies via Docker Compose:

```bash
docker compose up --watch
```

## Project structure

Routes can access use cases and schemas.
Subscriptions can access use cases.
Use cases can access repositories, http clients, domain classes and other use cases.
Use cases should export a single function.
Repositories can access db.

Routes and subscriptions should never respond with a domain object.
Domain objects should never access use cases, repositories or subscriptions.
Repositories should never accept or return db records.

## Licence

THIS INFORMATION IS LICENSED UNDER THE CONDITIONS OF THE OPEN GOVERNMENT LICENCE found at:

<http://www.nationalarchives.gov.uk/doc/open-government-licence/version/3>

The following attribution statement MUST be cited in your products and applications when using this information.

> Contains public sector information licensed under the Open Government license v3

### About the licence

The Open Government Licence (OGL) was developed by the Controller of Her Majesty's Stationery Office (HMSO) to enable
information providers in the public sector to license the use and re-use of their information under a common open
licence.

It is designed to encourage use and re-use of information freely and flexibly, with only a few conditions.
