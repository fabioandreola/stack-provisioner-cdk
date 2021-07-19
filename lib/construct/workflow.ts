import * as sfn from '@aws-cdk/aws-stepfunctions';
import * as tasks from '@aws-cdk/aws-stepfunctions-tasks';
import * as logs from '@aws-cdk/aws-logs';
import * as lambda from "@aws-cdk/aws-lambda";
import * as dynamodb from '@aws-cdk/aws-dynamodb';
import { Duration, Construct } from "@aws-cdk/core";
import { DynamoAttributeValue } from '@aws-cdk/aws-stepfunctions-tasks';
import { StateMachine } from '@aws-cdk/aws-stepfunctions';


export interface WorkflowPoperties {
  sendEmailFunction: lambda.Function,
  stackManagementFunction: lambda.Function,
  stackDetailsTable: dynamodb.Table
}

enum StackStatus {
  Creating = "Creating",
  Created = "Created",
  Deleted = "Deleted",
  Failed = "Failed"
}

enum EmailState {
  Success = "Success",
  Failed = "Failed",
  Starting = "Starting"
}


export class StackProvisionerWorkflow extends Construct {

  public readonly stateMachine: StateMachine;

  constructor(scope: Construct, id: string, props: WorkflowPoperties) {
    super(scope, id);

    const getStackDetails = new tasks.DynamoGetItem(scope, 'Get Stack Details', {
      key: {
        id: tasks.DynamoAttributeValue.fromString(sfn.JsonPath.stringAt('$.key'))
      },
      table: props.stackDetailsTable,
      resultPath: "$.stackDetails"
    });

    const updateStackStatus = new tasks.DynamoUpdateItem(scope, 'Update Stack Status', {
      key: {
        id: tasks.DynamoAttributeValue.fromString(sfn.JsonPath.stringAt('$.key'))
      },
      updateExpression: "SET numTimesProvisioned = if_not_exists(numTimesProvisioned, :start) + :inc, stackStatus = :st, createdTime = :dt",
      expressionAttributeValues: {
        ':inc': DynamoAttributeValue.fromNumber(1),
        ':start': DynamoAttributeValue.fromNumber(0),
        ':st': DynamoAttributeValue.fromString("Created"),
        ':dt': DynamoAttributeValue.numberFromString(sfn.JsonPath.stringAt('$.createStackResult.createdTime'))
      },
      table: props.stackDetailsTable,
      resultPath: "$.updateStatusResult"
    });

    const updateStackFailed = new tasks.DynamoUpdateItem(scope, 'Update Stack Failed', {
      key: {
        id: tasks.DynamoAttributeValue.fromString(sfn.JsonPath.stringAt('$.key'))
      },
      updateExpression: "SET stackStatus = :st",
      expressionAttributeValues: {
        ':st': DynamoAttributeValue.fromString("Failed")
      },
      table: props.stackDetailsTable,
      resultPath: "$.updateStatusResult"
    });

    const sendEmailStartTask = new tasks.LambdaInvoke(scope, 'Send Email - Stack creation Started', {
      lambdaFunction: props.sendEmailFunction,
      resultPath: "$.sendEmailResult",
      payload: sfn.TaskInput.fromObject({
        input: sfn.JsonPath.entirePayload,
        emailState: EmailState.Starting.toString()
      })
    });

    const sendEmailFailedTask = new tasks.LambdaInvoke(scope, 'Send Email - Stack creation Failed', {
      lambdaFunction: props.sendEmailFunction,
      resultPath: "$.sendEmailResult",
      payload: sfn.TaskInput.fromObject({
        input: sfn.JsonPath.entirePayload,
        emailState: EmailState.Failed.toString()
      })
    });

    const sendEmailSucceededTask = new tasks.LambdaInvoke(scope, 'Send Email - Stack creation Succeeded', {
      lambdaFunction: props.sendEmailFunction,
      resultPath: "$.sendEmailResult",
      payload: sfn.TaskInput.fromObject({
        input: sfn.JsonPath.entirePayload,
        emailState: EmailState.Success.toString()
      })
    });

    const createStackTask = new tasks.LambdaInvoke(scope, 'Create Stack', {
      lambdaFunction: props.stackManagementFunction,
      integrationPattern: sfn.IntegrationPattern.WAIT_FOR_TASK_TOKEN ,
      payload: sfn.TaskInput.fromObject({
        token: sfn.JsonPath.taskToken,
        input: sfn.JsonPath.entirePayload,
        stackStatus: StackStatus.Creating.toString()
      }),
      resultPath: "$.createStackResult"
    });

    const deleteStackTask = new tasks.LambdaInvoke(scope, 'Delete Stack', {
      lambdaFunction: props.stackManagementFunction,
      payload: sfn.TaskInput.fromObject({
        input: sfn.JsonPath.entirePayload,
        stackStatus: StackStatus.Created.toString()
      }),
      resultPath: "$.deleteStackResult"
    });

    const deleteStackTaskAfterFailure = new tasks.LambdaInvoke(scope, 'Delete Stack After Failure', {
      lambdaFunction: props.stackManagementFunction,
      payload: sfn.TaskInput.fromObject({
        input: sfn.JsonPath.entirePayload,
        stackStatus: StackStatus.Created.toString()
      }),
      resultPath: "$.deleteStackResult"
    });

    createStackTask.addCatch(deleteStackTaskAfterFailure, {
      resultPath: "$.createTaskError"
    });

    const waitX = new sfn.Wait(scope, 'Wait X Seconds', {
      time: sfn.WaitTime.secondsPath('$.stackDetails.Item.destroyInSeconds.N'),
    });

    const stackCreationSucceeded = new sfn.Succeed(scope, 'Stack Creation Succeeded');
    const stackCreationFailed = new sfn.Fail(scope, "Stack Creation Failed");

    const workflowDefinition = getStackDetails
      .next(new sfn.Choice(scope, 'Is request valid')
        .when(sfn.Condition.and(
            sfn.Condition.not(sfn.Condition.stringEqualsJsonPath('$.stackDetails.Item.numTimesProvisioned.N', '$.stackDetails.Item.maxCreationTimes.N')),
            sfn.Condition.not(sfn.Condition.stringEquals('$.stackDetails.Item.stackStatus.S', StackStatus.Created.toString())),
            sfn.Condition.not(sfn.Condition.stringEquals('$.stackDetails.Item.stackStatus.S', StackStatus.Creating.toString()))), sendEmailStartTask
          .next(createStackTask)
          .next(updateStackStatus)
          .next(sendEmailSucceededTask)
          .next(waitX)
          .next(deleteStackTask)
          .next(stackCreationSucceeded))
        .otherwise(deleteStackTaskAfterFailure
          .next(updateStackFailed)
          .next(sendEmailFailedTask)
          .next(stackCreationFailed)));

    const stepFunctionLogGroup = new logs.LogGroup(scope, 'StackProvisionerStepFunctionLogs');

    this.stateMachine = new sfn.StateMachine(scope, 'StateMachine', {
      definition: workflowDefinition,
      timeout: Duration.days(1),
      logs: {
        destination: stepFunctionLogGroup,
        level: sfn.LogLevel.ERROR
      }
    });
  }
}