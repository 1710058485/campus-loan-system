DROP TABLE IF EXISTS students;
DROP TABLE IF EXISTS courses;

CREATE TABLE devices (
    model_id SERIAL PRIMARY KEY,
    name VARCHAR(100),
    brand VARCHAR(50),
    category VARCHAR(50),
    quantity_available INT
);

CREATE TABLE loans (
    id SERIAL PRIMARY KEY,
    user_id VARCHAR(50),
    device_model_id INT,
    status VARCHAR(20),
    created_at TIMESTAMP,
    expected_return_date TIMESTAMP,
    returned_at TIMESTAMP
);

CREATE TABLE waitlist (
    id SERIAL PRIMARY KEY,
    device_model_id INT,
    user_id VARCHAR(50),
    email VARCHAR(100),
    created_at TIMESTAMP
);

INSERT INTO devices (name, brand, category, quantity_available) VALUES ('iPad Pro', 'Apple', 'Tablet', 1);