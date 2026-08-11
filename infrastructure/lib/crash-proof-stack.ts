import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';
import * as path from 'path';

export interface CrashProofStackProps extends cdk.StackProps {
  databaseSecretArn?: string;
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

    // Worker Lambda
    this.workerLambda = new lambda.Function(this, 'WorkerLambda', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'handler.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../packages/worker/dist')),
      timeout: cdk.Duration.minutes(5),
      memorySize: 512,
      environment: {
        ...environment,
        DATABASE_URL: databaseSecret?.secretValue.unsafeUnwrap() || '',
        GEMINI_API_KEY: geminiSecret?.secretValue.unsafeUnwrap() || '',
      },
      description: 'Crash-proof agent worker - claims and executes tasks',
    });

    // Grant secrets access
    databaseSecret?.grantRead(this.workerLambda);
    geminiSecret?.grantRead(this.workerLambda);

    // Supervisor Lambda
    this.supervisorLambda = new lambda.Function(this, 'SupervisorLambda', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'handler.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../packages/supervisor/dist')),
      timeout: cdk.Duration.minutes(2),
      memorySize: 512,
      environment: {
        ...environment,
        DATABASE_URL: databaseSecret?.secretValue.unsafeUnwrap() || '',
        GEMINI_API_KEY: geminiSecret?.secretValue.unsafeUnwrap() || '',
      },
      description: 'Crash-proof agent supervisor - decomposes tasks and manages jobs',
    });

    // Grant secrets access
    databaseSecret?.grantRead(this.supervisorLambda);
    geminiSecret?.grantRead(this.supervisorLambda);

    // API Gateway
    this.api = new apigateway.RestApi(this, 'CrashProofApi', {
      restApiName: 'Crash-Proof Agent API',
      description: 'API for the crash-proof agent system',
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ['Content-Type', 'Authorization'],
      },
    });

    // Supervisor integration
    const supervisorIntegration = new apigateway.LambdaIntegration(this.supervisorLambda);

    // Jobs endpoints
    const jobs = this.api.root.addResource('jobs');
    jobs.addMethod('GET', supervisorIntegration);
    jobs.addMethod('POST', supervisorIntegration);

    const demoJobs = jobs.addResource('demo');
    demoJobs.addMethod('POST', supervisorIntegration);

    const singleJob = jobs.addResource('{jobId}');
    singleJob.addMethod('GET', supervisorIntegration);

    // Chaos endpoints
    const chaos = this.api.root.addResource('chaos');
    const killWorker = chaos.addResource('kill-worker');
    killWorker.addMethod('POST', supervisorIntegration);

    // Trigger endpoints (for manual testing)
    const triggerWorker = this.api.root.addResource('trigger-worker');
    triggerWorker.addMethod('POST', new apigateway.LambdaIntegration(this.workerLambda));

    const triggerReclaim = this.api.root.addResource('trigger-reclaim');
    triggerReclaim.addMethod('POST', new apigateway.LambdaIntegration(this.workerLambda));

    // EventBridge rule for worker polling (every 10 seconds)
    new events.Rule(this, 'WorkerPollRule', {
      schedule: events.Schedule.rate(cdk.Duration.seconds(10)),
      targets: [
        new targets.LambdaFunction(this.workerLambda, {
          event: events.RuleTargetInput.fromObject({ action: 'process' }),
        }),
      ],
      description: 'Poll for new tasks every 10 seconds',
    });

    // EventBridge rule for stale task reclaim (every minute)
    new events.Rule(this, 'ReclaimRule', {
      schedule: events.Schedule.rate(cdk.Duration.minutes(1)),
      targets: [
        new targets.LambdaFunction(this.workerLambda, {
          event: events.RuleTargetInput.fromObject({ action: 'reclaim' }),
        }),
      ],
      description: 'Reclaim stale tasks every minute',
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
