// client/src/context/AuthContext.tsx
import React, { createContext, useContext, useEffect, useState } from 'react';
import api from '../api';

export type UserRole = 'head' | 'lead' | 'agent' | 'peek_handler';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  agentId: string | null;
}

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  loading: true,
  logout: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get<AuthUser>('/auth/me')
      .then((r) => setUser(r.data))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  const logout = async () => {
    await api.post('/auth/logout');
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
