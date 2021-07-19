const { DynamoDBClient, GetItemCommand, UpdateItemCommand } = require("@aws-sdk/client-dynamodb");
const { SFNClient, SendTaskSuccessCommand, SendTaskFailureCommand } = require("@aws-sdk/client-sfn");
const { CloudFormationClient, DescribeStacksCommand } = require("@aws-sdk/client-cloudformation");

const clientConfig = { region: process.env.REGION };

const dynamoClient = new DynamoDBClient(clientConfig);
const sfnClient = new SFNClient(clientConfig);
const cfClient = new CloudFormationClient(clientConfig);

const stackTable = process.env.STACK_DETAILS_TABLE;

const MAX_ERROR_MSG_LENGTH = 200;

exports.main = async function(event, context) {

    console.log("Payload", JSON.stringify(event));

    const stackMessage = event.Records[0].Sns.Message;
    console.log("Stack message", stackMessage);

    if(!stackMessage.includes('CREATE_IN_PROGRESS')){

        let stackDetails = stackMessage.split("\n");
        let key = undefined;
        
        stackDetails.forEach(item => {
            if (item.includes('ClientRequestToken')){
                const keyWithQuotes = item.split("=")[1];
                key = keyWithQuotes.substr(1, keyWithQuotes.lastIndexOf("'") -1);
            }
        });

        const getItemCommand = new GetItemCommand({
            Key: {
                id: {"S": key}
            },
            TableName: stackTable
        });
    
        const stackDetailsResponse = await dynamoClient.send(getItemCommand);
        console.log("stackDetailsResponse", stackDetailsResponse);
    
        const token = stackDetailsResponse.Item.workflowToken.S;
        const stackName = stackDetailsResponse.Item.stackName.S;
        const indexOfReason = stackMessage.indexOf("ResourceStatusReason='");
        let errorReson = "Unknown";

        if (indexOfReason !== -1){
            errorReson = stackMessage.substring(indexOfReason, indexOfReason + MAX_ERROR_MSG_LENGTH);
        }

        if (stackMessage.includes('ROLLBACK_IN_PROGRESS')){
            const sendFailureCommand = new SendTaskFailureCommand({
                taskToken: token,
                error: errorReson,
                output: JSON.stringify({status: "Failed"})
            });
            const sendFailureCommandResponse = await sfnClient.send(sendFailureCommand);
            console.log("sendFailureCommandResponse", sendFailureCommandResponse);

        }
        else if(stackMessage.includes('CREATE_COMPLETE')){

            const describeStackCommand = new DescribeStacksCommand({
                StackName: stackName.replace(" ", "-")
            });

            const stackDetails = await cfClient.send(describeStackCommand);
            console.log("Stack details result", JSON.stringify(stackDetails));

            let outputs = {"M": {}};
            stackDetails.Stacks[0].Outputs.forEach( (output, idx) => {
                outputs.M[idx] = {"M": {
                    "description" : {"S": output.Description},
                    "value": {"S": output.OutputValue }
                }}
            });

            const updateOutputs = new UpdateItemCommand({
                Key: {
                    id: {"S": key}
                },
                UpdateExpression: "SET outputs = :out, lastUpdated = :dt",
                ExpressionAttributeValues: {
                    ":out": outputs,
                    ":dt": {"N": new Date().getTime().toString()}
                },
                TableName: stackTable
            });

            console.log("Updating outputs", JSON.stringify(updateOutputs));

            await dynamoClient.send(updateOutputs);

            const sendSuccessCommand = new SendTaskSuccessCommand({
                taskToken: token,
                output: JSON.stringify({status: "Success", "outputs": outputs, "createdTime": new Date().getTime().toString()})
            });
            const sendSuccessCommandResponse = await sfnClient.send(sendSuccessCommand);
            console.log("sendSuccessCommandResponse", sendSuccessCommandResponse);
        }
    }
}