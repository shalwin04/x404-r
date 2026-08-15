#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { CrashProofStack } from './crash-proof-stack';

const app = new cdk.App();

// Get environment variables for secrets
const databaseSecretArn = process.env.DATABASE_SECRET_ARN;
const geminiApiKeySecretArn = process.env.GEMINI_API_KEY_SECRET_ARN;

// Determine AI provider from environment
const enableBedrock = process.env.AI_PROVIDER === 'bedrock';
const bedrockRegion = process.env.BEDROCK_REGION;

new CrashProofStack(app, 'X404rStack', {
  databaseSecretArn,
  geminiApiKeySecretArn,
  enableBedrock,
  bedrockRegion,
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || 'us-east-1',
  },
  description: 'x404-r: Database-native runtime for crash-proof AI agents',
  tags: {
    Project: 'x404-r',
    Environment: process.env.ENVIRONMENT || 'development',
  },
});

app.synth();
