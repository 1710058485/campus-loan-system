const request = require('supertest');

// Mock dependencies BEFORE importing the app
jest.mock('pg', () => {
  const mPool = {
    connect: jest.fn(),
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

describe('Loan Service API', () => {
  
  it('GET /health should return 200 OK', async () => {
    const res = await request(app).get('/health');
    expect(res.statusCode).toEqual(200);
    expect(res.text).toEqual('OK');
  });

});
