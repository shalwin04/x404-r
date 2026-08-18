import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import * as path from 'path';

export interface CrashProofStackProps extends cdk.StackProps {
  /** ARN of the secret containing the CockroachDB connection string */
  databaseSecretArn?: string;
  /** ARN of the secret containing the Gemini API key */
  geminiApiKeySecretArn?: string;
}

export class CrashProofStack extends cdk.Stack {
  public readonly api: apigateway.RestApi;
  public readonly workerLambda: lambda.Function;
  public readonly supervisorLambda: lambda.Function;

  constructor(scope: Construct, id: string, props?: CrashProofStackProps) {
    super(scope, id, props);

    // Environment variables for Lambda functions
    const environment: Record<string, string> = {
      NODE_OPTIONS: '--enable-source-maps',
    };

    // Reference secrets if ARNs provided
    let databaseSecret: secretsmanager.ISecret | undefined;
    let geminiSecret: secretsmanager.ISecret | undefined;

    if (props?.databaseSecretArn) {
      databaseSecret = secretsmanager.Secret.fromSecretCompleteArn(
        this,
        'DatabaseSecret',
        props.databaseSecretArn
      );
    }

    if (props?.geminiApiKeySecretArn) {
      geminiSecret = secretsmanager.Secret.fromSecretCompleteArn(
        this,
        'GeminiSecret',
        props.geminiApiKeySecretArn
      );
    }

    // Worker Lambda log group
    const workerLogGroup = new logs.LogGroup(this, 'WorkerLogGroup', {
      logGroupName: '/aws/lambda/x404r-worker',
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Worker Lambda
    this.workerLambda = new lambda.Function(this, 'WorkerLambda', {
      functionName: 'x404r-worker',
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handler.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../packages/worker/dist')),
      timeout: cdk.Duration.minutes(5),
      memorySize: 1024,
      environment: {
        ...environment,
        DATABASE_URL: databaseSecret?.secretValue.unsafeUnwrap() || '',
        GEMINI_API_KEY: geminiSecret?.secretValue.unsafeUnwrap() || '',
      },
      description: 'x404-r worker - claims and executes crash-proof tasks using Gemini AI',
      logGroup: workerLogGroup,
    });

    // Grant secrets access to worker
    databaseSecret?.grantRead(this.workerLambda);
    geminiSecret?.grantRead(this.workerLambda);

    // Supervisor Lambda log group
    const supervisorLogGroup = new logs.LogGroup(this, 'SupervisorLogGroup', {
      logGroupName: '/aws/lambda/x404r-supervisor',
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Supervisor Lambda
    this.supervisorLambda = new lambda.Function(this, 'SupervisorLambda', {
      functionName: 'x404r-supervisor',
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handler.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../packages/supervisor/dist')),
      timeout: cdk.Duration.minutes(2),
      memorySize: 1024,
      environment: {
        ...environment,
        DATABASE_URL: databaseSecret?.secretValue.unsafeUnwrap() || '',
        GEMINI_API_KEY: geminiSecret?.secretValue.unsafeUnwrap() || '',
      },
      description: 'x404-r supervisor - manages jobs and task decomposition using Gemini AI',
      logGroup: supervisorLogGroup,
    });

    // Grant secrets access to supervisor
    databaseSecret?.grantRead(this.supervisorLambda);
    geminiSecret?.grantRead(this.supervisorLambda);

    // API Gateway
    this.api = new apigateway.RestApi(this, 'X404rApi', {
      restApiName: 'x404-r API',
      description: 'Crash-proof agent runtime API',
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ['Content-Type', 'Authorization'],
      },
    });

    // Supervisor integration for API endpoints
    const supervisorIntegration = new apigateway.LambdaIntegration(this.supervisorLambda);

    // Health check endpoint
    const ready = this.api.root.addResource('ready');
    ready.addMethod('GET', supervisorIntegration);

    // Jobs endpoints
    const jobs = this.api.root.addResource('jobs');
    jobs.addMethod('GET', supervisorIntegration);   // List jobs
    jobs.addMethod('POST', supervisorIntegration);  // Create job

    // Demo job endpoint
    const demoJobs = jobs.addResource('demo');
    demoJobs.addMethod('POST', supervisorIntegration);

    // Single job endpoint
    const singleJob = jobs.addResource('{jobId}');
    singleJob.addMethod('GET', supervisorIntegration);

    // Usage endpoint
    const usage = this.api.root.addResource('usage');
    usage.addMethod('GET', supervisorIntegration);

    // Chaos testing endpoints
    const chaos = this.api.root.addResource('chaos');
    const killWorker = chaos.addResource('kill-worker');
    killWorker.addMethod('POST', supervisorIntegration);

    // Worker integration for manual triggers
    const workerIntegration = new apigateway.LambdaIntegration(this.workerLambda);

    // Manual trigger endpoints (for testing)
    const triggerWorker = this.api.root.addResource('trigger-worker');
    triggerWorker.addMethod('POST', workerIntegration);

    // EventBridge rule for worker polling (every 1 minute)
    new events.Rule(this, 'WorkerPollRule', {
      schedule: events.Schedule.rate(cdk.Duration.minutes(1)),
      targets: [
        new targets.LambdaFunction(this.workerLambda, {
          event: events.RuleTargetInput.fromObject({ action: 'process' }),
        }),
      ],
      description: 'Poll for new tasks every minute',
    });

    // EventBridge rule for stale task reclaim (every 2 minutes)
    new events.Rule(this, 'ReclaimRule', {
      schedule: events.Schedule.rate(cdk.Duration.minutes(2)),
      targets: [
        new targets.LambdaFunction(this.workerLambda, {
          event: events.RuleTargetInput.fromObject({ action: 'reclaim' }),
        }),
      ],
      description: 'Reclaim stale tasks every 2 minutes',
    });

    // Outputs
    new cdk.CfnOutput(this, 'ApiUrl', {
      value: this.api.url,
      description: 'API Gateway URL',
    });

    new cdk.CfnOutput(this, 'WorkerLambdaArn', {
      value: this.workerLambda.functionArn,
      description: 'Worker Lambda ARN',
    });

    new cdk.CfnOutput(this, 'SupervisorLambdaArn', {
      value: this.supervisorLambda.functionArn,
      description: 'Supervisor Lambda ARN',
    });
  }
}
