import * as cdk from '@aws-cdk/core';
import * as s3Deployment from '@aws-cdk/aws-s3-deployment';
import * as s3 from '@aws-cdk/aws-s3';
import * as fs from 'fs';
import * as cfn from "@aws-sdk/client-cloudformation";
import * as cloudfront from "@aws-cdk/aws-cloudfront";
import * as route53 from '@aws-cdk/aws-route53';
import * as targets from '@aws-cdk/aws-route53-targets';
import * as cert from '@aws-cdk/aws-certificatemanager';

export class StackProvisionerFrontendStack extends cdk.Stack {
    constructor(scope: cdk.App, id: string, props ? : cdk.StackProps) {

        super(scope, id, props);

        const domainParam = new cdk.CfnParameter(this, "Domain", {
            type: "String",
            description: "The route 53 domain"
        });

        const subdomainParam = new cdk.CfnParameter(this, "Subdomain", {
            type: "String",
            description: "The subdomain for this app"
        });

        const publicHostedZoneIdParam = new cdk.CfnParameter(this, "PublicHostedZoneId", {
            type: "String",
            description: "The public hosted zone id"
        });

        const fullDomain = `${subdomainParam.valueAsString}.${domainParam.valueAsString}`;

        const frontendBucket = new s3.Bucket(this, "stack-provisioner-frontend-bucket", {
            bucketName: fullDomain,
            publicReadAccess: false,
            blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
            websiteIndexDocument: "index.html"
        });

        const publicHostedZone = route53.HostedZone.fromHostedZoneAttributes(this, "PublicHostedZone", {
            hostedZoneId: publicHostedZoneIdParam.valueAsString,
            zoneName: domainParam.valueAsString
        });

        // TLS certificate
        const certificateArn = new cert.DnsValidatedCertificate(
            this,
            "SiteCertificate", {
                domainName: fullDomain,
                hostedZone: publicHostedZone,
                region: "us-east-1", // Cloudfront only checks this region for certificates.
            }
        ).certificateArn;
        new cdk.CfnOutput(this, "Certificate", {
            value: certificateArn
        });

        const oia = new cloudfront.OriginAccessIdentity(this, 'OIA', {
            comment: "Created by CDK"
        });

        frontendBucket.grantRead(oia);

        // CloudFront distribution that provides HTTPS
        const distribution = new cloudfront.CloudFrontWebDistribution(
            this,
            "SiteDistribution", {
                aliasConfiguration: {
                    acmCertRef: certificateArn,
                    names: [fullDomain],
                    sslMethod: cloudfront.SSLMethod.SNI,
                    securityPolicy: cloudfront.SecurityPolicyProtocol.TLS_V1_1_2016,
                },
                originConfigs: [{
                    s3OriginSource: {
                        s3BucketSource: frontendBucket,
                        originAccessIdentity: oia,
                    },
                    behaviors: [{
                        isDefaultBehavior: true,
                    }],
                }, ],
            }
        );
        new cdk.CfnOutput(this, "DistributionId", {
            value: distribution.distributionId,
        });

        // Route53 alias record for the CloudFront distribution
        new route53.ARecord(this, "SiteAliasRecord", {
            recordName: subdomainParam.valueAsString,
            target: route53.RecordTarget.fromAlias(
                new targets.CloudFrontTarget(distribution)
            ),
            zone: publicHostedZone,
        });

        const cfClient = new cfn.CloudFormationClient({});
        const describeStackCommand = new cfn.DescribeStacksCommand({
            StackName: "StackProvisionerBackendStack"
        });

        // Get the backend api so the frontend knows where it is located. Using the api instead of the imported value because we need the result to be 
        // resolved before the stack is created.
        cfClient.send(describeStackCommand).then(data => {
            if (data && data.Stacks && data.Stacks[0] && data.Stacks[0].Outputs) {
                data.Stacks[0].Outputs.forEach((output, idx) => {
                    if (output.ExportName === "stackProvisionerApiUrl") {
                        fs.writeFile("frontend/js/env.json", `{"api": "${output.OutputValue}"}`, error => {
                            if (error) {
                                throw new Error("Failed to write to frontend file!")
                            }
                        });
                    }
                });
            }
        });


        const deployment = new s3Deployment.BucketDeployment(this, "deployStaticWebsite", {
            sources: [s3Deployment.Source.asset("frontend")],
            destinationBucket: frontendBucket,
            distribution,
            distributionPaths: ["/*"]
        });

        new cdk.CfnOutput(this, "StackProvisionerFrontendBucket", {
            value: frontendBucket.bucketWebsiteUrl,
            description: "Bucket with the stack provisioner frontend",
            exportName: "stackProvisionerFrontendBucket"
        });

        new cdk.CfnOutput(this, "Website url", {
            value: `https://${fullDomain}`,
            description: "Url for the stack provisioner app"
        });
    }
}