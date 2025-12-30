require('dotenv').config();
const amqp = require('amqplib');
const nodemailer = require('nodemailer');

// 模拟邮件发送器 (这里我们只打印日志，但在真实生产环境中会配置 SMTP)
// Mock interface as per Assessment Spec [cite: 78]
const transporter = nodemailer.createTransport({
    host: 'smtp.ethereal.email', // 一个假的测试邮件服务
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

        // 监听队列
        channel.consume(queue, async (msg) => {
            if (msg !== null) {
                const content = JSON.parse(msg.content.toString());
                console.log(`[x] Received Event: ${content.event}`);

                // 模拟耗时的邮件发送过程
                await sendEmailMock(content);

                // 关键：确认消息已处理 (ACK)。
                // 如果这里不ACK，RabbitMQ会以为处理失败，重新发给别人。
                channel.ack(msg);
            }
        });

    } catch (err) {
        console.error("RabbitMQ Connection Error, retrying in 5s...", err);
        setTimeout(startConsumer, 5000); // Resilience: Self-healing [cite: 45]
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

    // 这里并没有真的发出去，但在日志里留证
    console.log(`[EMAIL SENT] To: ${data.email}, Subject: ${subject}, Body: ${body}`);
    return new Promise(resolve => setTimeout(resolve, 500)); // 模拟网络延迟
}

if (require.main === module) {
    startConsumer();
}

module.exports = { startConsumer, sendEmailMock };