import * as s3 from '@aws-cdk/aws-s3';
import * as cdk from '@aws-cdk/core';
import * as iam from '@aws-cdk/aws-iam';
import * as sns from '@aws-cdk/aws-sns';
import * as ssm from '@aws-cdk/aws-ssm';
import * as lambdaNode from '@aws-cdk/aws-lambda-nodejs';
import * as lambda from '@aws-cdk/aws-lambda';
import { StackProvisionerWorkflow } from './construct/workflow'
import { CfnOutput, CfnParameter, RemovalPolicy, Duration } from "@aws-cdk/core";
import { SnsEventSource } from '@aws-cdk/aws-lambda-event-sources';
import { ApiGatewayStack as StackProvisionerApi } from './construct/apigateway';
import { DetailsTableStack as DetailsTable } from './construct/dynamoDB';

export class StackProvisionerBackendStack extends cdk.Stack {
  constructor(scope: cdk.App, id: string, props ? : cdk.StackProps) {
    super(scope, id, props);

    // Parameters

    const maxWorflowDurationDays = new CfnParameter(this, "MaxWorkflowDurationDays", {
      type: "Number",
      description: "The max duration for the step function workflow. This should be longer then you intend to keep your stacks running.",
      default: 1});

    const stackBucketNameParam = new CfnParameter(this, "StackBucketName", {
      type: "String",
      description: "The name of the Amazon S3 bucket where stacks will be stored.",
      default: "fabioandreola-stacks-bucket"});

    const smtpServerParam = new CfnParameter(this, "SMTPServer", {
      type: "String",
      description: "The SMTP server used to send emails",
      default: "smtp.mail.yahoo.com"});

    const smtpPortParam = new CfnParameter(this, "SMTPPort", {
      type: "Number",
      description: "The SMTP port",
      default: 587});

    const fromEmailParam = new CfnParameter(this, "FromEmail", {
      type: "String",
      description: "The from email for stack notifications",
      default: '"Fabio Andreola" <fabioandreola@yahoo.com>'});

    const bccEmailParam = new CfnParameter(this, "BccEmail", {
      type: "String",
      description: "The bcc email to receive copies of the stack notifications send to users",
    });

    const smtpUser = new CfnParameter(this, "SmtpUser", {
      type: "String",
      description: "The SMTP user",
      default: "fabioandreola@yahoo.com"});

    const emailSMTPPasswordSecretNameParam = new CfnParameter(this, "EmailPasswordSecretName", {
      type: "String",
      description: "The SMPT server email password secret name",
      default: "/stackProvisioner/smtpPasswordSecret"});

    const smtpPasswordSecretParam = ssm.StringParameter.fromSecureStringParameterAttributes(this, 'SecureSmtpPasswordSecret', {
      parameterName: emailSMTPPasswordSecretNameParam.valueAsString,
      simpleName: false,
      version: 1
    });

    const domainParam = new CfnParameter(this, "Domain", {
      type: "String",
      description: "The API route 53 domain"});

    const subdomainParam = new CfnParameter(this, "Subdomain", {
      type: "String",
      description: "The API subdomain for this app"});

    const publicHostedZoneIdParam = new CfnParameter(this, "PublicHostedZoneId", {
      type: "String",
      description: "The public hosted zone id"});


    // Resources

    const sendEmailFunction = new lambdaNode.NodejsFunction(this, "SendEmailFunction", {
      runtime: lambda.Runtime.NODEJS_14_X,
      handler: "main",
      entry: "backend/sendEmail.js",
      timeout: Duration.seconds(15),
      environment: {
        SMTP_SERVER: smtpServerParam.valueAsString,
        SMTP_PORT: smtpPortParam.valueAsString,
        FROM_EMAIL: fromEmailParam.valueAsString,
        SMTP_USER: smtpUser.valueAsString,
        PASSWORD_SECRET_NAME: emailSMTPPasswordSecretNameParam.valueAsString,
        REGION: this.region,
        BCC: bccEmailParam.valueAsString
      }
    });

    const stackDetailsTable = new DetailsTable(this, "StackDetailsTable", {}).table;

    const stackProvisionerRole = new iam.Role(this, "StackProvisionerRole", {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
    });

    const stackCreatedTopic = new sns.Topic(this, "StackCreatedTopic", {
      topicName: "StackCreatedTopic",
      displayName: "Stack Created Topic"
    });

    new CfnOutput(this, "StackCreatedTopicOutput", {
      value: stackCreatedTopic.topicArn,
      description: "Topic to publish events when a stack is created",
      exportName: "stackCreatedTopic"
    });

    const stackManagementFunction = new lambdaNode.NodejsFunction(this, "StackManagementFunction", {
      runtime: lambda.Runtime.NODEJS_14_X,
      handler: "main",
      entry: "backend/stackManagement.js",
      environment: {
        STACK_DETAILS_TABLE: stackDetailsTable.tableName,
        REGION: this.region,
        SNS_NOTIFICATION_TOPIC_ARN: stackCreatedTopic.topicArn
      },
      role: stackProvisionerRole
    });

    const stackProvisionerApiFunction = new lambdaNode.NodejsFunction(this, "ApiHandler", {
      runtime: lambda.Runtime.NODEJS_14_X,
      handler: "main",
      entry: "backend/apiHandler.js",
      environment: {
        REGION: this.region,
        STACK_DETAILS_TABLE: stackDetailsTable.tableName,
      }
    });

    const notifyStackCreatedFunction = new lambdaNode.NodejsFunction(this, "NotifyStackCreation", {
      runtime: lambda.Runtime.NODEJS_14_X,
      handler: "main",
      entry: "backend/notifyStackCreated.js",
      environment: {
        STACK_DETAILS_TABLE: stackDetailsTable.tableName,
        REGION: this.region
      }
    });

    notifyStackCreatedFunction.addEventSource(new SnsEventSource(stackCreatedTopic));

    const stackBucket = new s3.Bucket(this, 'StackBucket', {
      bucketName: stackBucketNameParam.valueAsString,
      removalPolicy: RemovalPolicy.DESTROY
    });

    const apiStack = new StackProvisionerApi(this, "StackProvisionerApi", { 
      apiHandlerFunction: stackProvisionerApiFunction, 
      domain: domainParam.valueAsString, 
      subdomain: subdomainParam.valueAsString,
      publicHostedZoneId: publicHostedZoneIdParam.valueAsString
    });

    const stackProvisionerWorkflow = new StackProvisionerWorkflow(this, 'StackProvisionerWorkflow', { 
      sendEmailFunction, 
      stackManagementFunction, 
      stackDetailsTable,
      maxWorflowDurationDays: maxWorflowDurationDays.valueAsNumber
    });

    stackProvisionerApiFunction.addEnvironment("STACK_PROVISIONER_WORKFLOW_ARN", stackProvisionerWorkflow.stateMachine.stateMachineArn);

    // Permissions

    stackDetailsTable.grantReadData(stackProvisionerApiFunction);
    stackDetailsTable.grantReadWriteData(notifyStackCreatedFunction);
    stackDetailsTable.grantReadData(stackProvisionerWorkflow.stateMachine);

    stackProvisionerWorkflow.stateMachine.grantTaskResponse(notifyStackCreatedFunction);
    stackProvisionerWorkflow.stateMachine.grantStartExecution(stackProvisionerApiFunction);

    smtpPasswordSecretParam.grantRead(sendEmailFunction);

    // TODO: Don't use the admin policy and create a role just for deployment
    const stackManagementPolicy = iam.ManagedPolicy.fromManagedPolicyArn(this, 'AdminAccessPolicy', 'arn:aws:iam::aws:policy/AdministratorAccess');
    stackProvisionerRole.addManagedPolicy(stackManagementPolicy);

    notifyStackCreatedFunction.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ["cloudformation:DescribeStacks"],
      resources: ["*"] 
    }));
  }
}
