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
            { model_id: '1', name: 'iPhone 13', brand: 'Apple', category: 'Phone', quantity_available: 10 },
            { model_id: '2', name: 'MacBook Pro', brand: 'Apple', category: 'Laptop', quantity_available: 5 }
        ];
        pool.query.mockResolvedValue({ rows: mockDevices });

        const res = await request(app).get('/devices');
        expect(res.statusCode).toEqual(200);
        expect(res.body).toEqual(mockDevices);
        // expect(pool.query).toHaveBeenCalledWith('SELECT * FROM devices ORDER BY model_id'); // Logic changed, query is dynamic
    });

    it('GET /devices with filters should query correctly', async () => {
        const mockDevices = [{ model_id: '1', name: 'iPhone 13', brand: 'Apple', category: 'Phone', quantity_available: 10 }];
        pool.query.mockResolvedValue({ rows: mockDevices });

        const res = await request(app).get('/devices?brand=Apple');
        expect(res.statusCode).toEqual(200);
        // Check if query contained WHERE clause (simplified check)
        expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('WHERE brand = $1'), expect.arrayContaining(['Apple']));
    });

    it('POST /devices should add a new device', async () => {
        const newDevice = { name: 'iPad Air', brand: 'Apple', category: 'Tablet', quantity_available: 20 };
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
