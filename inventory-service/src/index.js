require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(cors());
app.use(express.json());

// 数据库连接 (复用同一个 Postgres 实例)
const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://admin:password123@localhost:5432/campus_db'
});

// 中间件：Correlation ID & Logger (Observability)
app.use((req, res, next) => {
    const correlationId = req.headers['x-correlation-id'] || uuidv4();
    req.correlationId = correlationId;
    res.setHeader('x-correlation-id', correlationId);
    next();
});

const log = (level, message, extra = {}) => {
    console.log(JSON.stringify({
        timestamp: new Date().toISOString(),
        level,
        message,
        correlationId: extra.correlationId || 'N/A',
        service: 'inventory-service',
        ...extra
    }));
};

// 核心 API: 获取设备列表
// GET /devices
app.get('/devices', async (req, res) => {
    log('INFO', 'Fetching device list', { correlationId: req.correlationId });
    try {
        const result = await pool.query('SELECT * FROM devices ORDER BY model_id');
        log('INFO', `Successfully fetched ${result.rows.length} devices`, { correlationId: req.correlationId });
        res.json(result.rows);
    } catch (err) {
        log('ERROR', 'DB Query failed', { error: err.message, correlationId: req.correlationId });
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// 新增 API: 添加设备 (Manager)
// POST /devices
app.post('/devices', async (req, res) => {
    const { name, quantity_available } = req.body;
    log('INFO', 'Adding new device', { correlationId: req.correlationId, name, quantity_available });
    try {
        const result = await pool.query(
            'INSERT INTO devices (name, quantity_available) VALUES ($1, $2) RETURNING *',
            [name, quantity_available]
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        log('ERROR', 'Add device failed', { error: err.message, correlationId: req.correlationId });
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// 新增 API: 更新设备 (Manager)
// PUT /devices/:id
app.put('/devices/:id', async (req, res) => {
    const { id } = req.params;
    const { quantity_available } = req.body;
    log('INFO', 'Updating device', { correlationId: req.correlationId, id, quantity_available });
    try {
        const result = await pool.query(
            'UPDATE devices SET quantity_available = $1 WHERE model_id = $2 RETURNING *',
            [quantity_available, id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Device not found' });
        }
        res.json(result.rows[0]);
    } catch (err) {
        log('ERROR', 'Update device failed', { error: err.message, correlationId: req.correlationId });
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// 新增 API: 删除设备 (Manager)
// DELETE /devices/:id
app.delete('/devices/:id', async (req, res) => {
    const { id } = req.params;
    log('INFO', 'Deleting device', { correlationId: req.correlationId, id });
    try {
        const result = await pool.query(
            'DELETE FROM devices WHERE model_id = $1 RETURNING *',
            [id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Device not found' });
        }
        res.json({ message: 'Device deleted successfully' });
    } catch (err) {
        log('ERROR', 'Delete device failed', { error: err.message, correlationId: req.correlationId });
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// 健康检查
app.get('/health', (req, res) => res.status(200).send('OK'));

const PORT = process.env.PORT || 3002; // 注意：这是 3002 端口
if (require.main === module) {
    app.listen(PORT, () => {
        log('INFO', `Inventory Service running on port ${PORT}`);
    });
}

module.exports = app;