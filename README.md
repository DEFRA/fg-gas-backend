# fg-gas-backend

Grant Application Service defines and manages farming grants and applications. It is the source of truth for all grant applications and their status.

- [Requirements](#requirements)
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

## Requirements

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
aws sqs receive-message --queue-url http://sqs.eu-west-2.127.0.0.1:4566/000000000000/grant-application-created --profile localstack
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

## Docker

Launch GAS and dependencies via Docker Compose:

```bash
docker compose up --watch
```

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
