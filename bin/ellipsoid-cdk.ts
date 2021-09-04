#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from '@aws-cdk/core';
import EllipsoidCdkStack from '../lib/ellipsoid-cdk-stack';

const app = new cdk.App();

new EllipsoidCdkStack(app, 'EllipsoidCdkStack', {
  env: {
    account: '105320045388',
    region: 'us-east-1',
  },
});
