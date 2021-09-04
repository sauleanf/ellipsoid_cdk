import * as cdk from '@aws-cdk/core';
import { Construct, Duration } from '@aws-cdk/core';
import * as ec2 from '@aws-cdk/aws-ec2';
import * as iam from '@aws-cdk/aws-iam';
import * as actions from '@aws-cdk/aws-codepipeline-actions';
import * as codepipeline from '@aws-cdk/aws-codepipeline';
import * as cloudwatch from '@aws-cdk/aws-cloudwatch';
import * as codedeploy from '@aws-cdk/aws-codedeploy';

export default class EllipsoidCdkStack extends cdk.Stack {
    // name fields
    private readonly instanceName: string;

    private readonly instanceRoleName: string;

    // pipeline related fields
    private readonly pipelineName: string;

    private readonly owner: string;

    private readonly repo: string;

    private readonly branch: string;

    private readonly codeDeployName: string;

    private readonly codeDeployGroupName: string;

    private readonly alarmName: string;

    // AWS resource fields
    private instance: ec2.Instance;

    private instanceRole: iam.Role;

    private vpc: ec2.Vpc;

    private securityGroup: ec2.SecurityGroup;

    private pipeline: codepipeline.Pipeline;

    private metric: cloudwatch.Metric;

    constructor(scope: Construct,
      id: string,
      props?: cdk.StackProps) {
      super(scope, id, props);

      this.instanceName = 'EllipsoidInstance';
      this.instanceRoleName = 'ellipsoid-webserver-role';

      this.pipelineName = 'EllipsoidPipeline';
      this.owner = 'sauleanf';
      this.repo = 'ellipsoid_appserver';
      this.branch = 'deploy';
      this.codeDeployName = 'EllipsoidCodeDeploy';
      this.codeDeployGroupName = 'DeployEllipsoidAppserverGroup';

      this.alarmName = 'EllipsoidCeleryAlarm';

      this.createVPC();
      this.createInstance();
      this.createPipeline();
      this.createAlarms();
    }

    createRoles(): void {
      this.instanceRole = new iam.Role(this, this.instanceRoleName, {
        assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
        managedPolicies: [
          iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonS3ReadOnlyAccess'),
        ],
      });
    }

    createVPC(): void {
      this.vpc = new ec2.Vpc(this, 'EllipsoidVPC', {
        subnetConfiguration: [
          {
            name: 'EllipsoidPublicSubnet',
            cidrMask: 24,
            subnetType: ec2.SubnetType.PUBLIC,
          },
        ],
      });

      this.securityGroup = new ec2.SecurityGroup(this, 'EllipsoidSecurityGroup', {
        vpc: this.vpc,
        allowAllOutbound: true,
      });

      this.securityGroup.addIngressRule(
        ec2.Peer.anyIpv4(),
        ec2.Port.tcp(443),
        'allow HTTPS traffic from anywhere',
      );
    }

    createAlarms(): void {
      this.metric = new cloudwatch.Metric({
        namespace: 'CeleryHealth',
        metricName: 'WorkHealthStatus',
        dimensions: {
          APP_SERVICE: 'EllipsoidApplication',
        },
      });

      this.metric.with({
        period: Duration.seconds(30),
      });

      this.metric.createAlarm(this, this.alarmName, {
        alarmName: this.alarmName,
        treatMissingData: cloudwatch.TreatMissingData.BREACHING,
        evaluationPeriods: 1,
        threshold: 0,
      });
    }

    createInstance(): void {
      this.instance = new ec2.Instance(this, this.instanceName, {
        instanceType: ec2.InstanceType.of(
          ec2.InstanceClass.T2,
          ec2.InstanceSize.MICRO,
        ),
        machineImage: new ec2.AmazonLinuxImage({
          generation: ec2.AmazonLinuxGeneration.AMAZON_LINUX_2,
        }),
        vpc: this.vpc,
        instanceName: this.instanceName,
        role: this.instanceRole,
      });
    }

    createPipeline(): void {
      this.pipeline = new codepipeline.Pipeline(this, this.pipelineName, {
        pipelineName: this.pipelineName,
      });

      // adds github repo source stage
      const sourceOutput = new codepipeline.Artifact();
      const gitHubOAuthToken = cdk.SecretValue.secretsManager('ellipsoid/github/token');
      const githubSourceAction = new actions.GitHubSourceAction({
        output: sourceOutput,
        actionName: 'fetchEllipsoidFromGithub',
        oauthToken: gitHubOAuthToken,
        owner: this.owner,
        repo: this.repo,
        branch: this.branch,
      });
      this.pipeline.addStage({
        stageName: 'SourceStage',
        actions: [githubSourceAction],
      });

      // adds code deploy stage
      const application = new codedeploy.ServerApplication(this, this.codeDeployName, {
        applicationName: this.codeDeployName,
      });
      const deploymentGroup = new codedeploy.ServerDeploymentGroup(this, this.codeDeployGroupName, {
        application,
        deploymentGroupName: this.codeDeployGroupName,
        installAgent: true,
        ec2InstanceTags: new codedeploy.InstanceTagSet(
          {
            Name: [this.instanceName],
          },
        ),
        ignorePollAlarmsFailure: false,
        autoRollback: {
          failedDeployment: true,
          stoppedDeployment: true,
        },
      });
      const deployAction = new actions.CodeDeployServerDeployAction({
        actionName: 'CodeDeploy',
        input: sourceOutput,
        deploymentGroup,
      });
      this.pipeline.addStage({
        stageName: 'Deploy',
        actions: [deployAction],
      });
    }
}
