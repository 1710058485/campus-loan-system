import { render, screen } from '@testing-library/react';
import App from './App';
import { describe, it, expect, vi } from 'vitest';

// Mock Auth0
vi.mock('@auth0/auth0-react', () => ({
    useAuth0: () => ({
        isLoading: false,
        isAuthenticated: false,
        loginWithRedirect: vi.fn(),
        logout: vi.fn(),
        user: null,
        getAccessTokenSilently: vi.fn(),
    }),
}));

describe('App Component', () => {
    it('renders welcome message', () => {
        render(<App />);
        expect(screen.getByRole('heading', { name: /Campus Device Loan System/i })).toBeInTheDocument();
    });
});
