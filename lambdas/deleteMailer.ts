import { DynamoDBStreamHandler } from "aws-lambda";
import { SES_EMAIL_FROM, SES_EMAIL_TO, SES_REGION } from "../env";
import { SESClient, SendEmailCommand, SendEmailCommandInput } from "@aws-sdk/client-ses";

if (!SES_EMAIL_TO || !SES_EMAIL_FROM || !SES_REGION) {
    throw new Error("Please add the SES_EMAIL_TO, SES_EMAIL_FROM, and SES_REGION environment variables in an env.js file located in the root directory");
}

const client = new SESClient({ region: SES_REGION });

export const handler: DynamoDBStreamHandler = async (event) => {
    console.log("DynamoDB Stream Event: ", event);

    for (const record of event.Records) {
        if (record.eventName === "REMOVE") {
            const oldImage = record.dynamodb?.OldImage;
            const imageName = oldImage?.ImageName?.S || "Unknown";

            try {
                const message = `The image "${imageName}" has been deleted from the DynamoDB table.`;
                await sendEmailMessage(message);
            } catch (error: unknown) {
                console.log("Error occurred: ", error);
            }
        }
    }
};

async function sendEmailMessage(message: string) {
    const parameters: SendEmailCommandInput = {
        Destination: {
            ToAddresses: [SES_EMAIL_TO],
        },
        Message: {
            Body: {
                Html: {
                    Charset: "UTF-8",
                    Data: getHtmlContent(message),
                },
            },
            Subject: {
                Charset: "UTF-8",
                Data: "Record Deleted",
            },
        },
        Source: SES_EMAIL_FROM,
    };
    await client.send(new SendEmailCommand(parameters));
}

function getHtmlContent(message: string) {
    return `
    <html>
      <body>
        <p style="font-size:18px">${message}</p>
      </body>
    </html>
  `;
}
