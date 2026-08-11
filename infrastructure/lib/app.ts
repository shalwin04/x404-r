#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { CrashProofStack } from './crash-proof-stack';

const app = new cdk.App();

// Get environment variables for secrets
const databaseSecretArn = process.env.DATABASE_SECRET_ARN;
const geminiApiKeySecretArn = process.env.GEMINI_API_KEY_SECRET_ARN;

new CrashProofStack(app, 'CrashProofAgentStack', {
  databaseSecretArn,
  geminiApiKeySecretArn,
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || 'us-east-1',
  },
  description: 'Crash-proof agent system with CockroachDB, Lambda, and Gemini',
});

app.synth();
