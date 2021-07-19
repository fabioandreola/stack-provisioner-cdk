const { CloudFormationClient, CreateStackCommand, DeleteStackCommand } = require("@aws-sdk/client-cloudformation");
const { DynamoDBClient, UpdateItemCommand } = require("@aws-sdk/client-dynamodb");

const clientConfig = { region: process.env.REGION };

const cfClient = new CloudFormationClient(clientConfig);
const dynamoClient = new DynamoDBClient(clientConfig);
const stackTable = process.env.STACK_DETAILS_TABLE;

exports.main = async function (event, context) {

    console.log("Payload", JSON.stringify(event));

    const key = event.input.key;
    const token = event.token;
    const stackName = event.input.stackDetails.Item.stackName.S;
    const stackTemplateS3Location = event.input.stackDetails.Item.stackLocation.S;
    const snsTopicArn = process.env.SNS_NOTIFICATION_TOPIC_ARN;
    const stackParameters = event.input.stackDetails.Item.parameters;

    if (event.stackStatus === "Creating") {

        // get simple parameters
        let parameters = [];

        if( stackParameters && stackParameters.M ) {
            Object.keys(stackParameters.M).forEach(function(parameterKey) {
                var value = stackParameters.M[parameterKey];
                parameters.push({ParameterKey: parameterKey, ParameterValue: value.S});
            })
        }

        const command = new CreateStackCommand({
            StackName: stackName.replace(" ", "-"),
            TemplateURL: stackTemplateS3Location,
            NotificationARNs: [snsTopicArn],
            Capabilities: ["CAPABILITY_IAM"],
            ClientRequestToken: key,
            Parameters: parameters
        });
        const createStackResponse = await cfClient.send(command);
        console.log("Stack Creation Response", createStackResponse);

        await updateStackStatus(key, "Creating", token);

    } else {
        // delete stack
        const deleteStackCommand = new DeleteStackCommand({
            StackName: stackName.replace(" ", "-")
        });
        const deleteStackReponse = await cfClient.send(deleteStackCommand);
        console.log("Delete stack Response", deleteStackReponse);

        await updateStackStatus(key, "Deleted", "");
    }

}

function updateStackStatus(key, status, token) {
    
    const updateStackStatusCommand = new UpdateItemCommand({
        Key: {
            id: {"S": key}
        },
        UpdateExpression: "SET workflowToken = :token, stackStatus = :st, lastUpdated = :dt",
        ExpressionAttributeValues: {
            ":token": { "S":token },
            ":st": { "S":status },
            ":dt": {"N": new Date().getTime().toString()}
        },
        TableName: stackTable
    });

    console.log("Update stack Status Command", updateStackStatusCommand);
    return dynamoClient.send(updateStackStatusCommand);
}