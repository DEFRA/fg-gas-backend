# Integration Tests for fg-gas-backend

This directory contains comprehensive TestContainers-based integration tests that replaced the external integration tests from fg-gas-case-working-integration.

## Architecture

- Service Layer Tests: Business logic with database persistence
- Event Integration Tests: SNS/SQS event processing
- Workflow Tests: End-to-end grant application lifecycle

## Running Tests

`npm run test:integration`

## Contract Tests

`npm run test:contract`
