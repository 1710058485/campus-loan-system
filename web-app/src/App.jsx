import React, { useState } from 'react';
import { useAuth0 } from '@auth0/auth0-react';
import axios from 'axios';
import './App.css';

function App() {
  const { loginWithRedirect, logout, user, isAuthenticated, getAccessTokenSilently } = useAuth0();
  const [status, setStatus] = useState('');

  // 调用后端 API：预定设备
  const reserveDevice = async () => {
    try {
      setStatus('Processing...');
      
      // 1. 获取 Token (这一步 Auth0 会自动处理刷新)
      const token = await getAccessTokenSilently();

      // 2. 发起请求
      // 注意：这里需要后端开启 CORS (跨域)，稍后我们会配置
      const response = await axios.post('http://localhost:3001/reservations', 
        { 
          userId: user.sub, // 使用 Auth0 的用户 ID
          deviceModelId: 1 
        },
        {
          headers: {
            Authorization: `Bearer ${token}`, // 关键：把 Token 带上
          },
        }
      );

      setStatus(`Success! Loan ID: ${response.data.loanId}`);
    } catch (error) {
      if (error.response) {
        // 展示 HTTP 错误状态码，比如 403 Forbidden, 409 Conflict
        setStatus(`Error: ${error.response.status} - ${error.response.data.error || error.response.statusText}`);
      } else {
        setStatus(`Error: ${error.message}`);
      }
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
                <h5 className="mb-0">Welcome, {user.name}</h5>
                <small style={{ color: '#888' }}>You are currently logged in.</small>
              </div>
              <button className="btn btn-secondary btn-sm" onClick={() => logout()}>Log Out</button>
            </div>
          </div>

          <div className="card">
            <div className="card-header">Device List</div>
            <div className="card-body">
              <div className="row">
                <div className="col-md-6">
                  <div className="card h-100" style={{ background: '#f8f9fa', border: '1px solid #eee' }}>
                    <div className="card-body text-center">
                      <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>📱</div>
                      <h5 className="card-title">iPad Pro (High Demand)</h5>
                      <p className="card-text">Available: Check backend</p>
                      
                      {/* 核心功能：预定 */}
                      <button className="btn btn-success mt-2" onClick={reserveDevice}>
                        Reserve Now
                      </button>
                    </div>
                  </div>
                </div>
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