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
  telegramChatId: string | null;
  avatarUrl: string | null;
  salaryAccess: boolean;
}

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  logout: () => Promise<void>;
  updateAvatar: (avatarUrl: string | null) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  loading: true,
  logout: async () => {},
  updateAvatar: async () => {},
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

  const updateAvatar = async (avatarUrl: string | null) => {
    const res = await api.put<AuthUser>('/auth/avatar', { avatarUrl });
    setUser(res.data);
  };

  return (
    <AuthContext.Provider value={{ user, loading, logout, updateAvatar }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
