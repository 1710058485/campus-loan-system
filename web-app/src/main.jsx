import React from 'react';
import ReactDOM from 'react-dom/client';
import { Auth0Provider } from '@auth0/auth0-react';
import App from './App';
import 'bootstrap/dist/css/bootstrap.min.css';

const domain = "dev-fnovcg4yh5yl3vxf.us.auth0.com";
const clientId = "Z8iTSALCD8lkWHR7sTStHmujHYKc9oW6";
const audience = "https://campus-loan-api";

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Auth0Provider
      domain={domain}
      clientId={clientId}
      authorizationParams={{
        redirect_uri: window.location.origin,
        audience: audience,
      }}
    >
      <App />
    </Auth0Provider>
  </React.StrictMode>,
);