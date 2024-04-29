import * as cdk from "aws-cdk-lib";
import * as lambdanode from "aws-cdk-lib/aws-lambda-nodejs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as s3n from "aws-cdk-lib/aws-s3-notifications";
import * as events from "aws-cdk-lib/aws-lambda-event-sources";
import * as sqs from "aws-cdk-lib/aws-sqs";
import * as sns from "aws-cdk-lib/aws-sns";
import * as subs from "aws-cdk-lib/aws-sns-subscriptions";
import * as iam from "aws-cdk-lib/aws-iam";
import { Duration } from "aws-cdk-lib";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";

import { Construct } from "constructs";
// import * as sqs from 'aws-cdk-lib/aws-sqs';

export class EDAAppStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    //---------------------------------------------------------------------------

    // phase 1
    const imagesBucket = new s3.Bucket(this, "images", {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      publicReadAccess: false,
    });

    const topic1 = new sns.Topic(this, "topic1", {
      displayName: "topic 1",
    });
    imagesBucket.addEventNotification(
        s3.EventType.OBJECT_CREATED,
        new s3n.SnsDestination(topic1)
    );

    const confirmationMailerFn = new lambdanode.NodejsFunction(
        this,
        "ConfirmationMailerFn",
        {
          runtime: lambda.Runtime.NODEJS_18_X,
          entry: `${__dirname}/../lambdas/confirmationMailer.ts`,
          timeout: cdk.Duration.seconds(15),
          memorySize: 128,
        }
    );
    topic1.addSubscription(new subs.LambdaSubscription(confirmationMailerFn));

    confirmationMailerFn.addToRolePolicy(
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            "ses:SendEmail",
            "ses:SendRawEmail",
            "ses:SendTemplatedEmail",
          ],
          resources: ["*"],
        })
    );

    const DLQ = new sqs.Queue(this, "bad-orders-q", {
      retentionPeriod: Duration.minutes(30),
    });

    const rejectionMailerFn = new lambdanode.NodejsFunction(
        this,
        "RejectionMailerFn",
        {
          runtime: lambda.Runtime.NODEJS_18_X,
          entry: `${__dirname}/../lambdas/rejectionMailer.ts`,
          timeout: cdk.Duration.seconds(15),
          memorySize: 128,
        }
    );
    rejectionMailerFn.addEventSource(
        new events.SqsEventSource(DLQ, {
          batchSize: 5,
          maxBatchingWindow: cdk.Duration.seconds(10),
        })
    );
    rejectionMailerFn.addToRolePolicy(
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            "ses:SendEmail",
            "ses:SendRawEmail",
            "ses:SendTemplatedEmail",
          ],
          resources: ["*"],
        })
    );


    const Queue = new sqs.Queue(this, "orders-queue", {
      receiveMessageWaitTime: cdk.Duration.seconds(10),
      deadLetterQueue: {
        queue: DLQ,
        maxReceiveCount: 2,
      },
    });

    topic1.addSubscription(new subs.SqsSubscription(Queue));


    const processImageFn = new lambdanode.NodejsFunction(
        this,
        "ProcessImageFn",
        {
          runtime: lambda.Runtime.NODEJS_18_X,
          entry: `${__dirname}/../lambdas/processImage.ts`,
          timeout: cdk.Duration.seconds(15),
          memorySize: 128,
        }
    );
    imagesBucket.grantRead(processImageFn);
    processImageFn.addEventSource(
        new events.SqsEventSource(Queue, {
          batchSize: 5,
          maxBatchingWindow: cdk.Duration.seconds(10),
        })
    );

    const imagesTable = new dynamodb.Table(this, "imagesTable", {
        billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
        partitionKey: { name: "ImageName", type: dynamodb.AttributeType.STRING },
        removalPolicy: cdk.RemovalPolicy.DESTROY,
        stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES,
        tableName: "Images",
      });

    imagesTable.grantReadWriteData(processImageFn);


      new cdk.CfnOutput(this, "bucketName", {
          value: imagesBucket.bucketName,
      });
      new cdk.CfnOutput(this, "topic1ARN", {
          value: topic1.topicArn,
      });

  }
}

