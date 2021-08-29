import * as cdk from '@aws-cdk/core';
import {Construct} from '@aws-cdk/core';
import * as ec2 from '@aws-cdk/aws-ec2';
import * as iam from '@aws-cdk/aws-iam';
import * as actions from '@aws-cdk/aws-codepipeline-actions'
import * as codepipeline from '@aws-cdk/aws-codepipeline';
import * as codedeploy from '@aws-cdk/aws-codedeploy';

export class EllipsoidCdkStack extends cdk.Stack {
    private vpc: ec2.Vpc;
    private securityGroup: ec2.SecurityGroup;
    private instance: ec2.Instance;
    private instanceRole: iam.Role;

    constructor(scope: Construct,
                id: string,
                props?: cdk.StackProps) {
        super(scope, id, props);

        this.createVPC();
        this.createInstance();
        this.createPipeline();
    }

    createRoles() {
        this.instanceRole = new iam.Role(this, 'webserver-role', {
            assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
            managedPolicies: [
                iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonS3ReadOnlyAccess'),
            ],
        });
    }

    createVPC() {
        this.vpc = new ec2.Vpc(this, 'EllipsoidVPC', {
            subnetConfiguration: [
                {
                    name: 'EllipsoidPublicSubnet',
                    cidrMask: 24,
                    subnetType: ec2.SubnetType.PUBLIC
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

    createInstance() {
        this.instance = new ec2.Instance(this, 'EllipsoidInstance', {
            instanceType: ec2.InstanceType.of(
                ec2.InstanceClass.T2,
                ec2.InstanceSize.MICRO,
            ),
            machineImage: new ec2.AmazonLinuxImage({
                generation: ec2.AmazonLinuxGeneration.AMAZON_LINUX_2,
            }),
            vpc: this.vpc,
            instanceName: 'EllipsoidInstance',
            role: this.instanceRole,
        });
    }

    createPipeline() {
        const pipeline = new codepipeline.Pipeline(this, 'EllipsoidPipeline', {
            pipelineName: 'EllipsoidPipeline',
        });

        const sourceOutput = new codepipeline.Artifact();

        const gitHubOAuthToken = cdk.SecretValue.secretsManager('ellipsoid/github/token');

        const githubSourceAction = new actions.GitHubSourceAction({
            output: sourceOutput,
            actionName: "fetchEllipsoidFromGithub",
            oauthToken: gitHubOAuthToken,
            owner: "sauleanf",
            repo: "ellipsoid_appserver",
            branch: 'deploy',
        });
        pipeline.addStage({
            stageName: 'SourceStage',
            actions: [
                githubSourceAction
            ],
        });

        const application = new codedeploy.ServerApplication(this, 'EllipsoidCodeDeploy', {
            applicationName: 'EllipsoidCodeDeploy',
        });

        const deploymentGroup = new codedeploy.ServerDeploymentGroup(this, 'CodeDeployDeploymentGroup', {
            application,
            deploymentGroupName: 'MyDeploymentGroup',
            installAgent: true,
            ec2InstanceTags: new codedeploy.InstanceTagSet(
                {
                    'owner': ['sauleanf@umich.edu'],
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

        pipeline.addStage({
            stageName: 'Deploy',
            actions: [deployAction],
        });
    }
}
