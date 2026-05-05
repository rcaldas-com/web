export type UserRole = 'admin' | 'wallet' | 'digitar';
export type ThemePreference = 'light' | 'dark';

export type AuthUser = {
  _id: string;
  name: string;
  email: string;
  password: string;
  globalRole: 'admin' | null;
  roles: UserRole[];
  createdAt: Date;
  isActive: boolean;
  emailVerified: boolean;
  verificationToken: string | null;
  verificationTokenExpires: Date | null;
  theme?: ThemePreference;
};

export type UserSession = {
  _id: string;
  name: string;
  email: string;
  globalRole: 'admin' | null;
  roles: UserRole[];
  isActive: boolean;
  emailVerified: boolean;
  theme?: ThemePreference;
};
