"use strict";

const nodemailer = require("nodemailer");
const { SSMClient, GetParameterCommand } = require("@aws-sdk/client-ssm"); 

const ssmClient = new SSMClient({region: process.env.REGION});
const getEmailPasswordCommand = new GetParameterCommand({Name: process.env.PASSWORD_SECRET_NAME, WithDecryption: true});
const passwordPromise =  ssmClient.send(getEmailPasswordCommand);

const EmailState  = {
    Success: "Success",
    Failed: "Failed",
    Starting: "Starting"
}

exports.main = async function (event, context) {

    console.log("Payload", JSON.stringify(event));

    const smtpPassword = await passwordPromise;
    const toEmail = event.input.notificationEmail;
    const stackName = event.input.stackDetails.Item.stackName.S;
    const destroyInMinutes = event.input.stackDetails.Item.destroyInSeconds.N / 60;
    const bcc = process.env.BCC;

    const transporter = nodemailer.createTransport({
        host: process.env.SMTP_SERVER,
        port: process.env.SMTP_PORT,
        secure: false,
        auth: {
            user: process.env.SMTP_USER,
            pass: smtpPassword.Parameter.Value
        },
    });

    let emailResult = undefined;

    if (event.emailState === EmailState.Starting) {
        emailResult = sendEmail(toEmail, bcc, "Application status", "Your application <b>" + stackName + "</b> is being created. You will receive another email with details when it is ready to use.", transporter );
    } 
    else if (event.emailState === EmailState.Failed) {
        emailResult = sendEmail(toEmail, bcc, "Application status", "Oh sorry! Failed to create application <b>" + stackName + "</b>.", transporter );
    } 
    else if (event.emailState === EmailState.Success) {
        emailResult = sendEmail(toEmail, bcc, "Application status", "<p>Your application <b>" + stackName + "</b> has been successfully created and it will be available for " + 
            destroyInMinutes + " minutes before it is destroyed.</p> " + await getStackDetailsHtml(event), transporter );
    }
    else {
        console.error("Invalid email state: ", event.emailState);
        return;
    }

    console.log("Email result: ", await emailResult);
}

async function getStackDetailsHtml(event) {

    let detailsHtml = "";
    const outputs = event.input.createStackResult.outputs.M;

    if (outputs) {
        Object.keys(outputs).forEach(function(parameterKey) {
            detailsHtml = detailsHtml + "<p><b>" + outputs[parameterKey].M.description.S + ": </b> " + outputs[parameterKey].M.value.S + "</p>"
        });
    }

    return detailsHtml;
}

function sendEmail(toEmail, bcc, subject, body, transporter){
    let info = transporter.sendMail({
        from: process.env.FROM_EMAIL,
        to: toEmail,
        subject: subject, 
        html: body,
        bcc: bcc
    });

    return info;
}