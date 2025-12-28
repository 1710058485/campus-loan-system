-- 1. (可选) 如果你想清理掉之前的测试表，可以取消下面两行的注释
DROP TABLE IF EXISTS students;
DROP TABLE IF EXISTS courses;

-- 2. 创建设备表
CREATE TABLE devices (
    model_id SERIAL PRIMARY KEY,
    name VARCHAR(100),
    quantity_available INT
);

-- 3. 创建借阅表
CREATE TABLE loans (
    id SERIAL PRIMARY KEY,
    user_id VARCHAR(50),
    device_model_id INT,
    status VARCHAR(20),
    created_at TIMESTAMP
);

-- 4. 插入测试数据
INSERT INTO devices (name, quantity_available) VALUES ('iPad Pro', 1);