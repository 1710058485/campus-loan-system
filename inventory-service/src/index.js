require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(cors());
app.use(express.json());

// Database connection, reuse on postgres instance
const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://admin:password123@localhost:5432/campus_db'
});

// Middleware: Correlation id & Logger for observability
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

// Core API: get devices and filter with brand category and name
// GET /devices?brand=Apple&category=Laptop
app.get('/devices', async (req, res) => {
    const { brand, category, name } = req.query;
    log('INFO', 'Fetching device list', { correlationId: req.correlationId, filters: { brand, category, name } });
    
    let query = 'SELECT * FROM devices';
    const params = [];
    const conditions = [];

    // filtering conditions
    if (brand) {
        params.push(brand);
        conditions.push(`brand = $${params.length}`);
    }
    if (category) {
        params.push(category);
        conditions.push(`category = $${params.length}`);
    }
    if (name) {
        params.push(`%${name}%`);
        conditions.push(`name ILIKE $${params.length}`);
    }

    if (conditions.length > 0) {
        query += ' WHERE ' + conditions.join(' AND ');
    }
    
    // construct the query
    query += ' ORDER BY model_id';

    try {
        const result = await pool.query(query, params);
        log('INFO', `Successfully fetched ${result.rows.length} devices`, { correlationId: req.correlationId });
        res.json(result.rows);
    } catch (err) {
        log('ERROR', 'DB Query failed', { error: err.message, correlationId: req.correlationId });
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// API: add devices, called by manager
// POST /devices
app.post('/devices', async (req, res) => {
    const { name, brand, category, quantity_available } = req.body;
    log('INFO', 'Adding new device', { correlationId: req.correlationId, name, brand, category, quantity_available });
    try {
        const result = await pool.query(
            'INSERT INTO devices (name, brand, category, quantity_available) VALUES ($1, $2, $3, $4) RETURNING *',
            [name, brand, category, quantity_available]
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        log('ERROR', 'Add device failed', { error: err.message, correlationId: req.correlationId });
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// API: update devices, called by manager
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

// API: delete devices, called by manager
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

// Health check API
app.get('/health', (req, res) => res.status(200).send('OK'));

const PORT = process.env.PORT || 3002;
if (require.main === module) {
    app.listen(PORT, () => {
        log('INFO', `Inventory Service running on port ${PORT}`);
    });
}

module.exports = app;