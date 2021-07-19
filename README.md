# Welcome to the Stack Provisioner App

This app provisions other stacks for demo purposes from a given token. A stack is provisioned for x minutes and it is deleted after that period but it can be re-provisoned using the same token for a configurable number of times.

This is useful if you need to demo an application to a third-party but don't want to provision the stack in advance the demo and overpay for it.

### Adding a demo application

```
aws dynamodb put-item \
    --table-name StackDetailsTable \
    --item '{
        "id": {"S": "xxxxx"}, // This must be an api key associated with the ApiGateway
        "stackName": {"S": "Demo app"} ,
        "stackLocation": {"S": "<bucket-url>/some-stack.yml"},
        "maxCreationTimes": {"N": "3"},
        "numTimesProvisioned": {"N": "0"},
        "destroyInSeconds": {"N": "120"},
        "stackStatus": {"S": ""},
        "parameters": {"M": {
            "<parameter name>": {"S": "parameter value"} //Only simple string parameters are supported
        }
    }
}'
```
