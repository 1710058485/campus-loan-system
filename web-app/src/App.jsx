import React, { useState, useEffect, useCallback } from 'react';
import { useAuth0 } from '@auth0/auth0-react';
import axios from 'axios';
import { jwtDecode } from "jwt-decode";
import './App.css';

function App() {
  const { loginWithRedirect, logout, user, isAuthenticated, getAccessTokenSilently } = useAuth0();
  const [devices, setDevices] = useState([]);
  const [myLoans, setMyLoans] = useState([]); // 新增：用户借阅列表
  const [status, setStatus] = useState('');
  const [userRole, setUserRole] = useState(''); // 存储当前用户角色

  const fetchDevices = useCallback(async () => {
    try {
      // 指向 Inventory Service (3002)
      const res = await axios.get('http://localhost:3002/devices'); 
      setDevices(res.data);
    } catch (err) {
      console.error("Failed to fetch devices", err);
    }
  }, []);

  // 新增：获取我的借阅
  const fetchMyLoans = useCallback(async () => {
    if (!user) return;
    try {
      const token = await getAccessTokenSilently();
      const res = await axios.get(`http://localhost:3001/loans?userId=${user.sub}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setMyLoans(res.data);
    } catch (err) {
      console.error("Failed to fetch loans", err);
    }
  }, [user, getAccessTokenSilently]);

  // 1. 获取设备列表 (从 Inventory Service)
  useEffect(() => {
    fetchDevices();
    if (isAuthenticated) {
        fetchMyLoans();
    }
  }, [fetchDevices, fetchMyLoans, isAuthenticated]);

  // 2. 获取用户角色 (从 Token 解析)
  useEffect(() => {
    const checkRole = async () => {
      if (isAuthenticated) {
        try {
          const token = await getAccessTokenSilently();
          const decoded = jwtDecode(token);
          // 这里的 namespace 必须和你 Auth0 Action 里写的一样
          const roles = decoded['https://campus-loan-system/roles'];
          setUserRole(roles && roles.length > 0 ? roles[0] : 'Student'); // 默认 Student
        } catch (e) {
          console.error(e);
        }
      }
    };
    checkRole();
  }, [isAuthenticated, getAccessTokenSilently]);

  // 调用后端 API：预定设备
  const reserveDevice = async (modelId) => {
    try {
      setStatus('Processing...');
      
      // 1. 获取 Token (这一步 Auth0 会自动处理刷新)
      const token = await getAccessTokenSilently();

      // 2. 发起请求
      // 指向 Loan Service (3001)
      const response = await axios.post('http://localhost:3001/reservations', 
        { userId: user.sub, deviceModelId: modelId },
        { headers: { Authorization: `Bearer ${token}` } }
      );

      setStatus(`Success! Loan ID: ${response.data.loanId}`);
      fetchDevices(); // 刷新设备列表
      fetchMyLoans(); // 刷新我的借阅列表
    } catch (error) {
      if (error.response) {
        // 展示 HTTP 错误状态码，比如 403 Forbidden, 409 Conflict
        setStatus(`Error: ${error.response.status} - ${error.response.data.error || error.response.statusText}`);
      } else {
        setStatus(`Error: ${error.message}`);
      }
    }
  };

  // 新增：归还设备
  const returnDevice = async (loanId) => {
    try {
        const token = await getAccessTokenSilently();
        await axios.post('http://localhost:3001/returns', 
            { loanId },
            { headers: { Authorization: `Bearer ${token}` } }
        );
        alert('Device returned successfully!');
        fetchDevices();
        fetchMyLoans();
    } catch (error) {
        console.error(error);
        alert('Failed to return device');
    }
  };

  // Manager: 删除设备
  const deleteDevice = async (id) => {
    if (!window.confirm("Are you sure you want to delete this device?")) return;
    try {
        await axios.delete(`http://localhost:3002/devices/${id}`);
        alert('Device deleted successfully!');
        fetchDevices();
    } catch (error) {
        console.error(error);
        alert('Failed to delete device');
    }
  };

  // Manager: 添加设备
  const addDevice = async (name, quantity) => {
    try {
      await axios.post('http://localhost:3002/devices', { name, quantity_available: quantity });
      alert('Device added successfully!');
      fetchDevices();
    } catch (error) {
      alert('Failed to add device');
      console.error(error);
    }
  };

  // Manager: 更新库存
  const updateDeviceStock = async (id, quantity) => {
    try {
        const newQty = parseInt(prompt("Enter new quantity:", quantity));
        if (isNaN(newQty)) return;
        
        await axios.put(`http://localhost:3002/devices/${id}`, { quantity_available: newQty });
        fetchDevices();
    } catch (error) {
        console.error(error);
        alert('Failed to update stock');
    }
  };

  return (
    <div className="container">
      <h1>Campus Device Loan System</h1>
      
      {!isAuthenticated ? (
        <div className="text-center mt-5">
          <p className="lead mb-4" style={{ fontSize: '1.2rem', color: '#666' }}>
            Please log in to reserve equipment for your campus projects.
          </p>
          <button className="btn btn-primary btn-lg" onClick={() => loginWithRedirect()}>
            Log In (Student/Staff)
          </button>
        </div>
      ) : (
        <div>
          <div className="card mb-4">
            <div className="card-body user-welcome">
              <div>
                <h5 className="mb-0">Welcome, {user.name} ({userRole})</h5>
                <small style={{ color: '#888' }}>You are currently logged in.</small>
              </div>
              <button className="btn btn-secondary btn-sm" onClick={() => logout()}>Log Out</button>
            </div>
          </div>

          {userRole === 'Staff' && (
            <div className="card mb-4">
              <div className="card-header bg-dark text-white">Manager Panel (Staff Only)</div>
              <div className="card-body">
                  <button className="btn btn-outline-primary" onClick={() => {
                      const name = prompt("Device Name:");
                      if (!name) return;
                      const qty = parseInt(prompt("Quantity:"));
                      if (isNaN(qty)) return;
                      addDevice(name, qty);
                  }}>
                      + Add New Device
                  </button>
              </div>
            </div>
          )}

          {userRole !== 'Staff' && (
            <div className="card mb-4">
              <div className="card-header bg-info text-white">My Devices</div>
              <div className="card-body">
                  {myLoans.length === 0 ? (
                      <p>You have not reserved any devices.</p>
                  ) : (
                      <ul className="list-group">
                          {myLoans.map(loan => (
                              <li key={loan.id} className="list-group-item d-flex justify-content-between align-items-center">
                                  <div>
                                      <strong>{loan.device_name}</strong>
                                      <br/>
                                      <small className="text-muted">
                                          Status: {loan.status} | Date: {new Date(loan.created_at).toLocaleDateString()}
                                      </small>
                                  </div>
                                  {loan.status === 'RESERVED' && (
                                      <button 
                                          className="btn btn-sm btn-warning"
                                          onClick={() => returnDevice(loan.id)}
                                      >
                                          Return
                                      </button>
                                  )}
                              </li>
                          ))}
                      </ul>
                  )}
              </div>
            </div>
          )}

          <div className="card">
            <div className="card-header">Device List</div>
            <div className="card-body">
              <div className="row">
                {devices.map((device) => (
                  <div className="col-md-6 mb-3" key={device.model_id}>
                    <div className="card h-100" style={{ background: '#f8f9fa', border: '1px solid #eee' }}>
                      <div className="card-body text-center">
                        <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>📱</div>
                        <h5 className="card-title mb-3">{device.name}</h5>
                        
                        {/* 库存状态 Badge */}
                        <div className="mb-3">
                            <span className={`badge rounded-pill ${
                                device.quantity_available === 0 ? 'bg-danger' : 
                                device.quantity_available < 3 ? 'bg-warning text-dark' : 'bg-success'
                            }`} style={{ fontSize: '0.9rem', padding: '8px 16px' }}>
                                {device.quantity_available === 0 ? 'Out of Stock' : 
                                 device.quantity_available < 3 ? `Low Stock: ${device.quantity_available}` : 
                                 `${device.quantity_available} Available`}
                            </span>
                        </div>
                        
                        {/* 核心功能：预定 */}
                        {userRole !== 'Staff' && (
                            <button 
                              className="btn btn-success mt-2 me-2" 
                              onClick={() => reserveDevice(device.model_id)}
                              disabled={device.quantity_available <= 0}
                            >
                              {device.quantity_available > 0 ? 'Reserve Now' : 'Out of Stock'}
                            </button>
                        )}

                        {/* Manager 功能：编辑 & 删除 */}
                        {userRole === 'Staff' && (
                          <div className="mt-2">
                              <button 
                                  className="btn btn-sm btn-outline-secondary me-2"
                                  onClick={() => updateDeviceStock(device.model_id, device.quantity_available)}
                              >
                                  Edit
                              </button>
                              <button 
                                  className="btn btn-sm btn-outline-danger"
                                  onClick={() => deleteDevice(device.model_id)}
                              >
                                  Remove
                              </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
                
                {devices.length === 0 && (
                  <div className="col-12 text-center">
                    <p className="text-muted">Loading devices or no devices available...</p>
                  </div>
                )}
              </div>
            </div>
          </div>

          {status && (
            <div className={`alert mt-4 ${status.includes('Error') ? 'alert-danger' : 'alert-success'}`}>
              {status}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default App;