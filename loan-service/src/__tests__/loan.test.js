const request = require('supertest');

// Mock dependencies BEFORE importing the app
const mockClient = {
    query: jest.fn(),
    release: jest.fn(),
};

jest.mock('pg', () => {
    const mPool = {
        connect: jest.fn(() => mockClient),
        query: jest.fn(),
        end: jest.fn(),
    };
    return { Pool: jest.fn(() => mPool) };
});

jest.mock('amqplib', () => ({
    connect: jest.fn().mockResolvedValue({
        createChannel: jest.fn().mockResolvedValue({
            assertQueue: jest.fn().mockResolvedValue(),
            sendToQueue: jest.fn(),
        }),
    }),
}));

jest.mock('express-oauth2-jwt-bearer', () => ({
    auth: () => (req, res, next) => next(),
    requiredScopes: () => (req, res, next) => next(),
    claimCheck: () => (req, res, next) => next(),
}));

const app = require('../index'); // Import the app
const { Pool } = require('pg');
const pool = new Pool();

describe('Loan Service API', () => {

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('GET /health should return 200 OK', async () => {
        const res = await request(app).get('/health');
        expect(res.statusCode).toEqual(200);
        expect(res.text).toEqual('OK');
    });

    it('POST /reservations should create a loan if device available', async () => {
        // Mock DB transaction steps
        mockClient.query
            .mockResolvedValueOnce() // BEGIN
            .mockResolvedValueOnce({ rows: [{ quantity_available: 5 }] }) // SELECT FOR UPDATE
            .mockResolvedValueOnce() // UPDATE inventory
            .mockResolvedValueOnce({ rows: [{ id: 101, expected_return_date: '2023-01-03' }] }) // INSERT loan
            .mockResolvedValueOnce() // DELETE waitlist
            .mockResolvedValueOnce(); // COMMIT

        const res = await request(app)
            .post('/reservations')
            .send({ userId: 'user123', deviceModelId: 'dev1' });

        expect(res.statusCode).toEqual(201);
        expect(res.body.loanId).toEqual(101);
        expect(mockClient.query).toHaveBeenCalledTimes(6);
    });

    it('POST /reservations should fail if device out of stock', async () => {
        mockClient.query
            .mockResolvedValueOnce() // BEGIN
            .mockResolvedValueOnce({ rows: [{ quantity_available: 0 }] }) // SELECT FOR UPDATE
            .mockResolvedValueOnce(); // ROLLBACK

        const res = await request(app)
            .post('/reservations')
            .send({ userId: 'user123', deviceModelId: 'dev1' });

        expect(res.statusCode).toEqual(409);
        expect(res.body.error).toEqual('Device out of stock');
        expect(mockClient.query).toHaveBeenCalledTimes(3); // BEGIN, SELECT, ROLLBACK
    });

    it('POST /waitlist should add user to waitlist', async () => {
        pool.query
            .mockResolvedValueOnce({ rows: [] }) // Check existing
            .mockResolvedValueOnce({ rows: [{ id: 50 }] }); // Insert

        const res = await request(app)
            .post('/waitlist')
            .send({ userId: 'user123', deviceModelId: 'dev1', email: 'test@test.com' });

        expect(res.statusCode).toEqual(201);
        expect(res.body.waitlistId).toEqual(50);
    });

    it('GET /waitlist should return user waitlist', async () => {
        const mockWaitlist = [{ id: 1, device_name: 'MacBook', quantity_available: 0 }];
        pool.query.mockResolvedValue({ rows: mockWaitlist });

        const res = await request(app).get('/waitlist').query({ userId: 'user123' });

        expect(res.statusCode).toEqual(200);
        expect(res.body).toEqual(mockWaitlist);
    });
});
