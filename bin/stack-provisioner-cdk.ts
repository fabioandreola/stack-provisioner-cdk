#!/usr/bin/env node
import * as cdk from '@aws-cdk/core';
import { StackProvisionerCdkStack } from '../lib/stack-provisioner-cdk-stack';

const app = new cdk.App();
new StackProvisionerCdkStack(app, 'StackProvisionerCdkStack');
