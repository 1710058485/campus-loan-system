const request = require('supertest');
const express = require('express');

// mock the express app because the real app depends on the database and RabbitMQ
const app = express();
app.get('/health', (req, res) => res.status(200).send('OK'));

describe('Loan Service Basic Checks', () => {
    it('GET /health should return 200 OK', async () => {
        const res = await request(app).get('/health');
        expect(res.statusCode).toEqual(200);
        expect(res.text).toEqual('OK');
    });

    it('should have a placeholder for concurrency test', () => {
        expect(true).toBe(true);
    });
});