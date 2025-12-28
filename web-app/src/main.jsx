import React from 'react';
import ReactDOM from 'react-dom/client';
import { Auth0Provider } from '@auth0/auth0-react';
import App from './App';
import 'bootstrap/dist/css/bootstrap.min.css'; // 引入样式

const domain = "dev-fnovcg4yh5yl3vxf.us.auth0.com"; // 填你的 Auth0 域名 (例: dev-xyz.us.auth0.com)
const clientId = "Z8iTSALCD8lkWHR7sTStHmujHYKc9oW6";  // 填你的 Auth0 Client ID (SPA Application)
const audience = "https://campus-loan-api"; // 填你在 API 设置里的 Identifier

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Auth0Provider
      domain={domain}
      clientId={clientId}
      authorizationParams={{
        redirect_uri: window.location.origin,
        audience: audience, // 关键：没有这个，拿到的 Token 就无法访问后端
      }}
    >
      <App />
    </Auth0Provider>
  </React.StrictMode>,
);