const { DynamoDBClient, GetItemCommand } = require("@aws-sdk/client-dynamodb");
const { SFNClient, StartExecutionCommand } = require("@aws-sdk/client-sfn");
const uuid = require('uuid-random');
const emailValidator = require("email-validator");

const clientConfig = { region: process.env.REGION };

const dynamoClient = new DynamoDBClient(clientConfig);
const sfnClient = new SFNClient(clientConfig);

const stackTable = process.env.STACK_DETAILS_TABLE;
const worflowArn = process.env.STACK_PROVISIONER_WORKFLOW_ARN;

exports.main = async function(event, context) {

    console.log("Paylaod", JSON.stringify(event));

    const key = event.requestContext.identity.apiKey;
    let response = {};
    let statusCode = 200;

    const getItemCommand = new GetItemCommand({
        Key: {
            id: {"S": key}
        },
        TableName: stackTable
    });

    const stackDetailsResponse = await dynamoClient.send(getItemCommand);
    console.log("stackDetailsResponse", stackDetailsResponse);

    const stackName = stackDetailsResponse.Item.stackName.S;

    if (event.httpMethod === "GET") {
    
        response["stackName"] = stackName;
        response["numTimesProvisioned"] = stackDetailsResponse.Item.numTimesProvisioned.N;
        response["destroyInSeconds"] = stackDetailsResponse.Item.destroyInSeconds.N;
        response["maxCreationTimes"] = stackDetailsResponse.Item.maxCreationTimes.N;
    
        if (stackDetailsResponse.Item.createdTime) {
            response["createdTime"] = stackDetailsResponse.Item.createdTime.N;
        }
    
        if (stackDetailsResponse.Item.stackStatus) {
            const stackStatus = stackDetailsResponse.Item.stackStatus.S
            response["stackStatus"] = stackStatus;

            if (stackDetailsResponse.Item.outputs && stackStatus === "Created") {
                response["outputs"] = stackDetailsResponse.Item.outputs.M;
            }
        }
    }
    else if (event.httpMethod === "POST") {

        try {
            if (!event.body) {
                throw new Error("Missing body");
            }
    
            const payload = JSON.parse(event.body);
            if (!payload.notificationEmail) {
                throw new Error("Missing notification email");
            }
    
            const email = payload.notificationEmail;
            if (!emailValidator.validate(email)) {
                throw new Error("Invalid email");
            }
    
            const worflowName = `${stackName.replace(" ", "-")}-${uuid()}`;
    
            const startStackCreationWorkflowCommand = new StartExecutionCommand({
                input: `{ "key": "${key}", "notificationEmail": "${email}" }`,
                name: worflowName,
                stateMachineArn: worflowArn
            });
    
            console.log("startStackCreationWorkflowCommand", startStackCreationWorkflowCommand);

            const startStackCreationWorkflowCommandResponse = await sfnClient.send(startStackCreationWorkflowCommand);
            console.log("startStackCreationWorkflowCommandResponse", startStackCreationWorkflowCommandResponse);
            response = {"Status": "Stack Creation Submitted"};
        } catch (error) {
            console.error("Failed to start workflow", error);
            response = {"error": error.toString()};
            statusCode = 400;
        }
    }

    
    return {
        statusCode: statusCode,
        body: JSON.stringify(response),
        "headers": {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Credentials': true
        }
    } 
}
