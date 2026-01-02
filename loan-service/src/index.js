// loan-service/src/index.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const { Pool } = require('pg');
const amqp = require('amqplib');
const { auth, requiredScopes, claimCheck } = require('express-oauth2-jwt-bearer');

const app = express();
app.use(express.json());
app.use(cors());

// Create a correlation id for each request
app.use((req, res, next) => {
    // check if request has correlation id
    const correlationId = req.headers['x-correlation-id'] || uuidv4();
    req.correlationId = correlationId;
    res.setHeader('x-correlation-id', correlationId);
    next();
});

// JSON Logging for better observability
const log = (level, message, extra = {}) => {
    console.log(JSON.stringify({
        timestamp: new Date().toISOString(),
        level: level,
        message: message,
        correlationId: extra.correlationId || 'N/A', // ID is key for tracing
        ...extra
    }));
};

// JWT and RBAC middleware for identity check
const checkJwt = auth({
  audience: 'https://campus-loan-api',
  issuerBaseURL: `https://dev-fnovcg4yh5yl3vxf.us.auth0.com/`,
  tokenSigningAlg: 'RS256',
});
const checkRole = (role) => claimCheck((claims) => {
  const roles = claims['https://campus-loan-system/roles'];
  return roles && roles.includes(role);
});

// Database connection pool
const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://admin:password123@localhost:5432/campus_db'
});

// RabbitMQ Connection
let channel;
async function connectQueue() {
    try {
        const connection = await amqp.connect(process.env.RABBITMQ_URL || 'amqp://user:password@localhost:5672');
        channel = await connection.createChannel();
        await channel.assertQueue('loan_notifications'); // ensure queue exists
        console.log("Connected to RabbitMQ");
    } catch (err) {
        console.error("RabbitMQ Connect Failed", err);
        setTimeout(connectQueue, 5000); // retry mechanism for resilience
    }
}
connectQueue();

// Core API: Create a loan reservation
// POST /reservations
app.post('/reservations', checkJwt, checkRole('Student'), async (req, res) => {
    const { userId, deviceModelId } = req.body; // TODO: get userId from Auth0

    log('INFO', 'Reservation request received', { correlationId: req.correlationId, userId, deviceModelId });
    
    // get a database client to start a transaction
    const client = await pool.connect();

    try {
        // Transaction Start
        await client.query('BEGIN');

        // for concurrency control, we should check and lock the inventory
        const inventoryRes = await client.query(
            `SELECT quantity_available FROM devices WHERE model_id = $1 FOR UPDATE`,
            [deviceModelId]
        );

        if (inventoryRes.rows.length === 0) {
            throw new Error('Device not found');
        }

        const available = inventoryRes.rows[0].quantity_available;

        // if the device is not available, we should rollback the transaction
        if (available <= 0) {
            await client.query('ROLLBACK');
            return res.status(409).json({ error: 'Device out of stock' }); // 409 Conflict
        }

        // then we should update the inventory
        await client.query(
            `UPDATE devices SET quantity_available = quantity_available - 1 WHERE model_id = $1`,
            [deviceModelId]
        );

        // create Loan Record, Standard loan duration is 2 days
        const loanRes = await client.query(
            `INSERT INTO loans (user_id, device_model_id, status, created_at, expected_return_date) 
             VALUES ($1, $2, 'RESERVED', NOW(), NOW() + INTERVAL '2 days') 
             RETURNING id, expected_return_date`,
            [userId, deviceModelId]
        );

        // if user is in the waitlist, remove them from the list
        await client.query(
            `DELETE FROM waitlist WHERE user_id = $1 AND device_model_id = $2`,
            [userId, deviceModelId]
        );

        // finally, we should commit the transaction
        await client.query('COMMIT');
        
        // asynchronously notify the user via RabbitMQ
        if (channel) {
            const message = JSON.stringify({
                event: 'LOAN_CREATED',
                email: 'student@uni.ac.uk', // TODO: get email from Auth0
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
        await client.query('ROLLBACK'); // rollback the transaction if any error occurs
        console.error(e);
        res.status(500).json({ error: e.message });
    } finally {
        client.release(); // release the database connection
    }
});

// API: Add to Waitlist
// POST /waitlist
app.post('/waitlist', checkJwt, checkRole('Student'), async (req, res) => {
    const { userId, deviceModelId, email } = req.body;
    log('INFO', 'Waitlist subscription received', { correlationId: req.correlationId, userId, deviceModelId });

    try {
        // check if the user is already on the waitlist for this device
        const existing = await pool.query(
            'SELECT id FROM waitlist WHERE user_id = $1 AND device_model_id = $2',
            [userId, deviceModelId]
        );

        if (existing.rows.length > 0) {
            // user is already on the waitlist, return the existing list ID
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

// API: Get User Waitlist
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

// API: Mark Loan as Collected
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

        // asynchronously notify the user via RabbitMQ
        if (channel) {
             const message = JSON.stringify({
                 event: 'LOAN_COLLECTED',
                 email: 'student@uni.ac.uk', // TODO: get email from Auth0
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

// API: Get Loan List
// GET /loans
app.get('/loans', checkJwt, async (req, res) => {
    const { userId } = req.query;
    const auth0Id = req.auth.payload.sub;
    const roles = req.auth.payload['https://campus-loan-system/roles'] || [];
    const isStaff = roles.includes('Staff');

    try {
        let query;
        let params;

        if (isStaff && !userId) {
            // Staff, see all
            query = `SELECT l.id, l.status, l.created_at, l.expected_return_date, d.name as device_name, l.user_id 
                     FROM loans l 
                     JOIN devices d ON l.device_model_id = d.model_id 
                     ORDER BY l.created_at DESC`;
            params = [];
        } else {
            // User, see their own loan
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

// API: Return Loan
// POST /returns
app.post('/returns', checkJwt, checkRole('Staff'), async (req, res) => {
    const { loanId } = req.body;
    const client = await pool.connect();

    try {
        // start transaction
        await client.query('BEGIN');

        // check loan existence and status
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

        // update loan status to returned
        await client.query(
            `UPDATE loans SET status = 'RETURNED', returned_at = NOW() WHERE id = $1`,
            [loanId]
        );

        // update device quantity available
        await client.query(
            `UPDATE devices SET quantity_available = quantity_available + 1 WHERE model_id = $1`,
            [loan.device_model_id]
        );

        // check waitlist for this device model
        const waitlistRes = await client.query(
            `SELECT * FROM waitlist WHERE device_model_id = $1 ORDER BY created_at ASC`,
            [loan.device_model_id]
        );

        if (waitlistRes.rows.length > 0) {
            // notify all waitlisted students for this device model
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
        }

        await client.query('COMMIT');
        
        // trigger notification to current user
        if (channel) {
            const message = JSON.stringify({
                event: 'LOAN_RETURNED',
                email: 'student@uni.ac.uk', // TODO: get email from Auth0
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

// API: Health Check
// GET /health
app.get('/health', (req, res) => res.status(200).send('OK'));

const PORT = process.env.PORT || 3001;
if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`Loan Service running on port ${PORT}`);
    });
}

module.exports = app;
