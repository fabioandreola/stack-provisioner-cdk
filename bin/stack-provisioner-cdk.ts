#!/usr/bin/env node
import * as cdk from '@aws-cdk/core';
import { StackProvisionerBackendStack } from '../lib/stack-provisioner-backend';
import { StackProvisionerFrontendStack } from '../lib/stack-provisioner-frontend';

const app = new cdk.App();
new StackProvisionerBackendStack(app, 'StackProvisionerBackendStack');
new StackProvisionerFrontendStack(app, 'StackProvisionerFrontendStack', { });
