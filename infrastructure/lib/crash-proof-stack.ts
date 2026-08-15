import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import * as path from 'path';

export interface CrashProofStackProps extends cdk.StackProps {
  databaseSecretArn?: string;
  geminiApiKeySecretArn?: string;
  /** Enable AWS Bedrock for AI inference */
  enableBedrock?: boolean;
  /** Bedrock region (defaults to stack region) */
  bedrockRegion?: string;
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
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handler.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../packages/worker/dist')),
      timeout: cdk.Duration.minutes(5),
      memorySize: 1024,
      environment: {
        ...environment,
        DATABASE_URL: databaseSecret?.secretValue.unsafeUnwrap() || '',
        GEMINI_API_KEY: geminiSecret?.secretValue.unsafeUnwrap() || '',
        AI_PROVIDER: props?.enableBedrock ? 'bedrock' : 'gemini',
        BEDROCK_REGION: props?.bedrockRegion || cdk.Stack.of(this).region,
      },
      description: 'x404-r worker - claims and executes crash-proof tasks',
      logRetention: logs.RetentionDays.ONE_WEEK,
    });

    // Grant secrets access
    databaseSecret?.grantRead(this.workerLambda);
    geminiSecret?.grantRead(this.workerLambda);

    // Grant Bedrock access if enabled
    if (props?.enableBedrock) {
      this.workerLambda.addToRolePolicy(new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'bedrock:InvokeModel',
          'bedrock:InvokeModelWithResponseStream',
        ],
        resources: ['*'],
      }));
    }

    // Supervisor Lambda
    this.supervisorLambda = new lambda.Function(this, 'SupervisorLambda', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handler.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../packages/supervisor/dist')),
      timeout: cdk.Duration.minutes(2),
      memorySize: 1024,
      environment: {
        ...environment,
        DATABASE_URL: databaseSecret?.secretValue.unsafeUnwrap() || '',
        GEMINI_API_KEY: geminiSecret?.secretValue.unsafeUnwrap() || '',
        AI_PROVIDER: props?.enableBedrock ? 'bedrock' : 'gemini',
        BEDROCK_REGION: props?.bedrockRegion || cdk.Stack.of(this).region,
      },
      description: 'x404-r supervisor - manages jobs, time travel, and cost tracking',
      logRetention: logs.RetentionDays.ONE_WEEK,
    });

    // Grant secrets access
    databaseSecret?.grantRead(this.supervisorLambda);
    geminiSecret?.grantRead(this.supervisorLambda);

    // Grant Bedrock access if enabled
    if (props?.enableBedrock) {
      this.supervisorLambda.addToRolePolicy(new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'bedrock:InvokeModel',
          'bedrock:InvokeModelWithResponseStream',
        ],
        resources: ['*'],
      }));
    }

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

    // Time Travel endpoints - checkpoints and replay
    const checkpoints = singleJob.addResource('checkpoints');
    checkpoints.addMethod('GET', supervisorIntegration);

    const replay = singleJob.addResource('replay');
    replay.addMethod('POST', supervisorIntegration);

    // Cost tracking endpoint
    const cost = singleJob.addResource('cost');
    cost.addMethod('GET', supervisorIntegration);

    // Usage tracking endpoint
    const usage = this.api.root.addResource('usage');
    usage.addMethod('GET', supervisorIntegration);

    // Tenant management endpoints
    const tenants = this.api.root.addResource('tenants');
    tenants.addMethod('POST', supervisorIntegration);

    const singleTenant = tenants.addResource('{tenantId}');
    singleTenant.addMethod('GET', supervisorIntegration);

    const apiKeys = singleTenant.addResource('api-keys');
    apiKeys.addMethod('POST', supervisorIntegration);
    apiKeys.addMethod('GET', supervisorIntegration);

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
