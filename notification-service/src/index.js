require('dotenv').config();
const amqp = require('amqplib');
const nodemailer = require('nodemailer');

// Mock interface for email service
const transporter = nodemailer.createTransport({
    host: 'smtp.ethereal.email', // Mock SMTP server for testing
    port: 587,
    auth: { user: 'test', pass: 'test' }
});

async function startConsumer() {
    try {
        const amqpUrl = process.env.RABBITMQ_URL || 'amqp://user:password@localhost:5672';
        const connection = await amqp.connect(amqpUrl);
        const channel = await connection.createChannel();
        
        const queue = 'loan_notifications';
        await channel.assertQueue(queue);

        console.log(`[*] Waiting for messages in ${queue}.`);

        // it subscribes to the queue and consume msg from it
        channel.consume(queue, async (msg) => {
            if (msg !== null) {
                const content = JSON.parse(msg.content.toString());
                console.log(`[x] Received Event: ${content.event}`);

                // mock the mailing process
                await sendEmailMock(content);

                // it acknowledges the msg to RabbitMQ
                channel.ack(msg);
            }
        });

    } catch (err) {
        console.error("RabbitMQ Connection Error, retrying in 5s...", err);
        setTimeout(startConsumer, 5000); // resilience, retry after 5s
    }
}

async function sendEmailMock(data) {
    let subject, body;
    
    switch (data.event) {
        case 'LOAN_CREATED':
            subject = 'Loan Reservation Confirmed';
            body = `Your device reservation (ID: ${data.loanId}) is confirmed. Please pick it up. Expected Return Date: ${data.expectedReturnDate}`;
            break;
        case 'LOAN_COLLECTED':
            subject = 'Device Collected';
            body = `You have collected the device (Loan ID: ${data.loanId}). Please return it on time.`;
            break;
        case 'LOAN_RETURNED':
            subject = 'Device Returned';
            body = `You have successfully returned the device (Loan ID: ${data.loanId}). Thank you.`;
            break;
        case 'WAITLIST_AVAILABLE':
            subject = 'Device Available';
            body = `A device you are interested in (Model ID: ${data.deviceModelId}) is now available! Reserve it quickly.`;
            break;
        default:
            subject = 'Notification';
            body = JSON.stringify(data);
    }

    // it simulates the email sending process
    console.log(`[EMAIL SENT] To: ${data.email}, Subject: ${subject}, Body: ${body}`);
    return new Promise(resolve => setTimeout(resolve, 500));
}

if (require.main === module) {
    startConsumer();
}

module.exports = { startConsumer, sendEmailMock };