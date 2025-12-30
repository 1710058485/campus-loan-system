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
        // Standard loan duration is 2 days
        const loanRes = await client.query(
            `INSERT INTO loans (user_id, device_model_id, status, created_at, expected_return_date) 
             VALUES ($1, $2, 'RESERVED', NOW(), NOW() + INTERVAL '2 days') 
             RETURNING id, expected_return_date`,
            [userId, deviceModelId]
        );

        // [关键点 3.5] 从候补名单中移除 (如果存在)
        await client.query(
            `DELETE FROM waitlist WHERE user_id = $1 AND device_model_id = $2`,
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
                loanId: loanRes.rows[0].id,
                expectedReturnDate: loanRes.rows[0].expected_return_date
            });
            channel.sendToQueue('loan_notifications', Buffer.from(message));
            console.log("Notification event published");
        }

        res.status(201).json({ 
            message: 'Reservation successful', 
            loanId: loanRes.rows[0].id,
            expectedReturnDate: loanRes.rows[0].expected_return_date
        });

    } catch (e) {
        await client.query('ROLLBACK'); // 出错必须回滚
        console.error(e);
        res.status(500).json({ error: e.message });
    } finally {
        client.release(); // 释放数据库连接
    }
});

// 新增 API: 加入候补名单 (Subscribe)
// POST /waitlist
app.post('/waitlist', checkJwt, checkRole('Student'), async (req, res) => {
    const { userId, deviceModelId, email } = req.body;
    log('INFO', 'Waitlist subscription received', { correlationId: req.correlationId, userId, deviceModelId });

    try {
        // 1. 检查是否已经存在
        const existing = await pool.query(
            'SELECT id FROM waitlist WHERE user_id = $1 AND device_model_id = $2',
            [userId, deviceModelId]
        );

        if (existing.rows.length > 0) {
            // 已经加入过了，直接返回成功或提示
            return res.status(200).json({ message: 'Already on waitlist', waitlistId: existing.rows[0].id });
        }

        const result = await pool.query(
            'INSERT INTO waitlist (user_id, device_model_id, email, created_at) VALUES ($1, $2, $3, NOW()) RETURNING id',
            [userId, deviceModelId, email]
        );
        res.status(201).json({ message: 'Subscribed to waitlist', waitlistId: result.rows[0].id });
    } catch (err) {
        log('ERROR', 'Waitlist subscription failed', { error: err.message, correlationId: req.correlationId });
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// 新增 API: 获取用户的候补名单
// GET /waitlist
app.get('/waitlist', checkJwt, async (req, res) => {
    const { userId } = req.query;
    log('INFO', 'Fetching user waitlist', { correlationId: req.correlationId, userId });

    try {
        const result = await pool.query(
            `SELECT w.id, w.device_model_id, w.created_at, d.name as device_name, d.quantity_available 
             FROM waitlist w 
             JOIN devices d ON w.device_model_id = d.model_id 
             WHERE w.user_id = $1 
             ORDER BY w.created_at DESC`,
            [userId]
        );
        res.json(result.rows);
    } catch (err) {
        log('ERROR', 'Fetch waitlist failed', { error: err.message, correlationId: req.correlationId });
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// 新增 API: 标记设备为已领取 (Staff)
// POST /collect
app.post('/collect', checkJwt, checkRole('Staff'), async (req, res) => {
    const { loanId } = req.body;
    log('INFO', 'Collection request received', { correlationId: req.correlationId, loanId });
    
    try {
        const result = await pool.query(
            `UPDATE loans SET status = 'COLLECTED' WHERE id = $1 AND status = 'RESERVED' RETURNING *`,
            [loanId]
        );
        
        if (result.rows.length === 0) {
            return res.status(400).json({ error: 'Loan not found or not in RESERVED state' });
        }

        // 触发领取通知
        if (channel) {
             const message = JSON.stringify({
                 event: 'LOAN_COLLECTED',
                 email: 'student@uni.ac.uk', // Should use user's email
                 loanId: loanId
             });
             channel.sendToQueue('loan_notifications', Buffer.from(message));
        }

        res.json({ message: 'Device marked as collected' });
    } catch (err) {
        log('ERROR', 'Collection mark failed', { error: err.message, correlationId: req.correlationId });
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// 4. 获取借阅列表 (Staff可看所有，用户只能看自己)
app.get('/loans', checkJwt, async (req, res) => {
    const { userId } = req.query;
    const auth0Id = req.auth.payload.sub;
    const roles = req.auth.payload['https://campus-loan-system/roles'] || [];
    const isStaff = roles.includes('Staff');

    try {
        let query;
        let params;

        if (isStaff && !userId) {
            // Staff 查看所有
            query = `SELECT l.id, l.status, l.created_at, l.expected_return_date, d.name as device_name, l.user_id 
                     FROM loans l 
                     JOIN devices d ON l.device_model_id = d.model_id 
                     ORDER BY l.created_at DESC`;
            params = [];
        } else {
            // 用户只能查自己的，或者 Staff 查特定用户的
            // 安全检查：如果不是 Staff，查询的 userId 必须是自己的
            const targetId = userId || auth0Id;
            if (!isStaff && targetId !== auth0Id) {
                return res.status(403).json({ error: 'Forbidden' });
            }
            
            query = `SELECT l.id, l.status, l.created_at, l.expected_return_date, d.name as device_name 
                     FROM loans l 
                     JOIN devices d ON l.device_model_id = d.model_id 
                     WHERE l.user_id = $1 
                     ORDER BY l.created_at DESC`;
            params = [targetId];
        }

        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (err) {
        log('ERROR', 'Fetch loans failed', { error: err.message, correlationId: req.correlationId });
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// 5. 归还设备 (Staff Only)
app.post('/returns', checkJwt, checkRole('Staff'), async (req, res) => {
    const { loanId } = req.body;
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // 1. 检查借阅记录
        const loanRes = await client.query(
            `SELECT * FROM loans WHERE id = $1 FOR UPDATE`,
            [loanId]
        );

        if (loanRes.rows.length === 0) {
            throw new Error('Loan not found');
        }

        const loan = loanRes.rows[0];
        if (loan.status === 'RETURNED') {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'Device already returned' });
        }

        // 2. 更新借阅状态
        await client.query(
            `UPDATE loans SET status = 'RETURNED', returned_at = NOW() WHERE id = $1`,
            [loanId]
        );

        // 3. 恢复库存
        await client.query(
            `UPDATE devices SET quantity_available = quantity_available + 1 WHERE model_id = $1`,
            [loan.device_model_id]
        );

        // 4. 检查候补名单并通知
        const waitlistRes = await client.query(
            `SELECT * FROM waitlist WHERE device_model_id = $1 ORDER BY created_at ASC`,
            [loan.device_model_id]
        );

        if (waitlistRes.rows.length > 0) {
            // 通知所有订阅者，或者只通知第一个。通常是通知所有，谁先抢到算谁的。
            // 需求: "On device return, any waitlisted students for that model are notified." -> implies ALL.
            for (const waiter of waitlistRes.rows) {
                 if (channel) {
                    const message = JSON.stringify({
                        event: 'WAITLIST_AVAILABLE',
                        email: waiter.email,
                        deviceModelId: loan.device_model_id
                    });
                    channel.sendToQueue('loan_notifications', Buffer.from(message));
                }
            }
            // Optional: delete from waitlist? Probably not until they reserve or unsubscribe.
        }

        await client.query('COMMIT');
        
        // 5. 触发归还通知给当前用户
        if (channel) {
            const message = JSON.stringify({
                event: 'LOAN_RETURNED',
                email: 'student@uni.ac.uk', // Should use user's email
                loanId: loanId
            });
            channel.sendToQueue('loan_notifications', Buffer.from(message));
        }
        
        log('INFO', `Loan ${loanId} returned`, { correlationId: req.correlationId });
        res.json({ message: 'Device returned successfully' });

    } catch (e) {
        await client.query('ROLLBACK');
        console.error(e);
        res.status(500).json({ error: e.message });
    } finally {
        client.release();
    }
});

// 健康检查 (Observability)
app.get('/health', (req, res) => res.status(200).send('OK'));

const PORT = process.env.PORT || 3001;
if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`Loan Service running on port ${PORT}`);
    });
}

module.exports = app;
