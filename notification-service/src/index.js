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
                console.log(`[x] Received Event: ${content.event} for Loan ID: ${content.loanId}`);

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
    // 这里并没有真的发出去，但在日志里留证
    console.log(`[EMAIL SENT] To: ${data.email}, Subject: Loan Confirmation, Body: Your device reservation (ID: ${data.loanId}) is confirmed.`);
    return new Promise(resolve => setTimeout(resolve, 500)); // 模拟网络延迟
}

startConsumer();