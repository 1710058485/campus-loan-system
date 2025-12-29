const request = require('supertest');

// Mock pg
jest.mock('pg', () => {
  const mPool = {
    query: jest.fn(),
    end: jest.fn(),
  };
  return { Pool: jest.fn(() => mPool) };
});

const app = require('../index');
const { Pool } = require('pg');

describe('Inventory Service API', () => {
    let pool;

    beforeEach(() => {
        pool = new Pool();
        jest.clearAllMocks();
    });

    it('GET /devices should return list of devices', async () => {
        const mockDevices = [
            { model_id: '1', name: 'iPhone 13', quantity_available: 10 },
            { model_id: '2', name: 'MacBook Pro', quantity_available: 5 }
        ];
        pool.query.mockResolvedValue({ rows: mockDevices });

        const res = await request(app).get('/devices');
        expect(res.statusCode).toEqual(200);
        expect(res.body).toEqual(mockDevices);
        expect(pool.query).toHaveBeenCalledWith('SELECT * FROM devices ORDER BY model_id');
    });

    it('POST /devices should add a new device', async () => {
        const newDevice = { name: 'iPad Air', quantity_available: 20 };
        const savedDevice = { ...newDevice, model_id: '3' };
        pool.query.mockResolvedValue({ rows: [savedDevice] });

        const res = await request(app).post('/devices').send(newDevice);
        expect(res.statusCode).toEqual(201);
        expect(res.body).toEqual(savedDevice);
    });
    
    // Error handling test
    it('GET /devices should handle errors', async () => {
        pool.query.mockRejectedValue(new Error('DB Error'));
        const res = await request(app).get('/devices');
        expect(res.statusCode).toEqual(500);
    });
});
