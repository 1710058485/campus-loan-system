// loan-service/src/index.js
require('dotenv').config();
const express = require('express');
const cors = require('cors'); // 新增
const { v4: uuidv4 } = require('uuid'); // 新增
const { Pool } = require('pg');
const amqp = require('amqplib');
const { auth, requiredScopes, claimCheck } = require('express-oauth2-jwt-bearer');

const app = express();
app.use(express.json());
app.use(cors()); // 新增：允许跨域请求

// 0.1. 中间件：为每个请求生成 Correlation ID
app.use((req, res, next) => {
    // 如果请求头里带了 ID 就用，没带就生成一个新的
    const correlationId = req.headers['x-correlation-id'] || uuidv4();
    req.correlationId = correlationId;
    res.setHeader('x-correlation-id', correlationId); // 返回给前端
    next();
});

// 0.2. Observability: 结构化日志辅助函数 (JSON Logging)
const log = (level, message, extra = {}) => {
    console.log(JSON.stringify({
        timestamp: new Date().toISOString(),
        level: level,
        message: message,
        correlationId: extra.correlationId || 'N/A', // 关键：日志里要有 ID
        ...extra
    }));
};

// 0.3 配置 JWT 中间件 并 定义角色检查中间件 (RBAC)
const checkJwt = auth({
  audience: 'https://campus-loan-api', // 刚才你在 Auth0 填的 Identifier
  issuerBaseURL: `https://dev-fnovcg4yh5yl3vxf.us.auth0.com/`, // 你的 Auth0 Domain
  tokenSigningAlg: 'RS256',
});
const checkRole = (role) => claimCheck((claims) => {
  const roles = claims['https://campus-loan-system/roles']; // 对应刚才 Action 里的 namespace
  return roles && roles.includes(role);
});

// 1. 数据库连接池
const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://admin:password123@localhost:5432/campus_db'
});

// 2. RabbitMQ 连接 (异步初始化)
let channel;
async function connectQueue() {
    try {
        const connection = await amqp.connect(process.env.RABBITMQ_URL || 'amqp://user:password@localhost:5672');
        channel = await connection.createChannel();
        await channel.assertQueue('loan_notifications'); // 确保队列存在
        console.log("Connected to RabbitMQ");
    } catch (err) {
        console.error("RabbitMQ Connect Failed", err);
        setTimeout(connectQueue, 5000); // 重试机制 (Resilience)
    }
}
connectQueue();

// 3. 核心接口：预定设备 (处理并发!)
// POST /reservations
app.post('/reservations', checkJwt, checkRole('Student'), async (req, res) => {
    // TODO: Better way is use auth0's userId instead of our own userId
    const { userId, deviceModelId } = req.body;

    // 0.3.1 记录请求日志
    log('INFO', 'Reservation request received', { correlationId: req.correlationId, userId, deviceModelId });
    
    // 获取一个数据库客户端以开启事务
    const client = await pool.connect();

    try {
        // --- 开启事务 (Transaction Start) ---
        await client.query('BEGIN');

        // [关键点 1] 检查并锁定库存 (Concurrency Control)
        // "FOR UPDATE" 会锁定这一行，直到事务结束。其他请求必须等待。
        // 这就是你在报告里要吹嘘的 "Pessimistic Locking" (悲观锁)
        const inventoryRes = await client.query(
            `SELECT quantity_available FROM devices WHERE model_id = $1 FOR UPDATE`,
            [deviceModelId]
        );

        if (inventoryRes.rows.length === 0) {
            throw new Error('Device not found');
        }

        const available = inventoryRes.rows[0].quantity_available;

        if (available <= 0) {
            await client.query('ROLLBACK');
            return res.status(409).json({ error: 'Device out of stock' }); // 409 Conflict
        }

        // [关键点 2] 扣减库存
        await client.query(
            `UPDATE devices SET quantity_available = quantity_available - 1 WHERE model_id = $1`,
            [deviceModelId]
        );

        // [关键点 3] 创建借阅记录
        const loanRes = await client.query(
            `INSERT INTO loans (user_id, device_model_id, status, created_at) VALUES ($1, $2, 'RESERVED', NOW()) RETURNING id`,
            [userId, deviceModelId]
        );

        // --- 提交事务 (Transaction Commit) ---
        await client.query('COMMIT');
        
        // [关键点 4] 异步通知 (Async Flow)
        // 发送消息到 RabbitMQ，而不是在这里直接发邮件
        if (channel) {
            const message = JSON.stringify({
                event: 'LOAN_CREATED',
                email: 'student@uni.ac.uk', // 这里后续应该从Auth0拿
                loanId: loanRes.rows[0].id
            });
            channel.sendToQueue('loan_notifications', Buffer.from(message));
            console.log("Notification event published");
        }

        res.status(201).json({ 
            message: 'Reservation successful', 
            loanId: loanRes.rows[0].id 
        });

    } catch (e) {
        await client.query('ROLLBACK'); // 出错必须回滚
        console.error(e);
        res.status(500).json({ error: e.message });
    } finally {
        client.release(); // 释放数据库连接
    }
});

// 健康检查 (Observability)
app.get('/health', (req, res) => res.status(200).send('OK'));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log(`Loan Service running on port ${PORT}`);
});
