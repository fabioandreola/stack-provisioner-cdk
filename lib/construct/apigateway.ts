import * as apigateway from "@aws-cdk/aws-apigateway";
import * as route53 from '@aws-cdk/aws-route53';
import { CfnOutput, Construct, Fn } from "@aws-cdk/core";
import * as iam from '@aws-cdk/aws-iam';
import * as lambda from "@aws-cdk/aws-lambda";
import * as cert from "@aws-cdk/aws-certificatemanager";
import * as targets from '@aws-cdk/aws-route53-targets';

export interface ApiGatewayProperties {
    apiHandlerFunction: lambda.Function,
        domain: string,
        subdomain: string,
        publicHostedZoneId: string
}

export class ApiGatewayStack extends Construct {

    constructor(scope: Construct, id: string, props: ApiGatewayProperties) {
        super(scope, id);

        const publicHostedZone = route53.HostedZone.fromHostedZoneAttributes(this, "PublicHostedZone", {
            hostedZoneId: props.publicHostedZoneId,
            zoneName: props.domain
        });

        const apiDomain = `api${props.subdomain}`
        const fullDomain = `${apiDomain}.${props.domain}`;

        // TLS certificate
        const certificate = new cert.DnsValidatedCertificate(
            this,
            "SiteCertificate", {
                domainName: fullDomain,
                hostedZone: publicHostedZone
            }
        );

        new CfnOutput(this, "Certificate", {
            value: certificate.certificateArn
        });

        const apiPolicyDocument = new iam.PolicyDocument();

        const api = new apigateway.RestApi(this, "stacks-api", {
            restApiName: "Stack Service",
            description: "Stack Provisioner API",
            policy: apiPolicyDocument,
            defaultCorsPreflightOptions: {
                allowOrigins: apigateway.Cors.ALL_ORIGINS
            },
            deployOptions: {
                loggingLevel: apigateway.MethodLoggingLevel.INFO
            },
            domainName: {
                domainName: fullDomain,
                certificate: certificate,
                securityPolicy: apigateway.SecurityPolicy.TLS_1_2
            }
        });

        new route53.ARecord(this, 'StackProvisionerApiAliasRecord', {
            zone: publicHostedZone,
            recordName: apiDomain,
            target: route53.RecordTarget.fromAlias(new targets.ApiGateway(api))
        });

        const getStackDetailsIntegration = new apigateway.LambdaIntegration(props.apiHandlerFunction);
        const stackResource = api.root.addResource("stack");
        const getMethod = stackResource.addMethod("GET", getStackDetailsIntegration, {
            apiKeyRequired: true
        });
        const postMethod = stackResource.addMethod("POST", getStackDetailsIntegration, {
            apiKeyRequired: true
        });

        const throttleConfig = {
            rateLimit: 1,
            burstLimit: 2
        }

        const plan = api.addUsagePlan('UsagePlan', {
            name: "StackUsagePlan",
            throttle: throttleConfig
        });

        plan.addApiStage({
            stage: api.deploymentStage,
            throttle: [{
                    method: getMethod,
                    throttle: throttleConfig
                },
                {
                    method: postMethod,
                    throttle: throttleConfig
                }
            ]
        });

        apiPolicyDocument.addStatements(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            principals: [new iam.AnyPrincipal()],
            actions: ["execute-api:Invoke"],
            resources: [Fn.join('', ['execute-api:/', '*'])]
        }));

        new CfnOutput(this, "StackProvisionerApiUrl", {
            value: `https://${fullDomain}/`,
            description: "Stack provisioner API URL",
            exportName: "stackProvisionerApiUrl"
        });
    }
}