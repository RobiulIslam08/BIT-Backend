// Registration Interface
export interface IRegister {
  name: string;
  email: string;
  password: string;
  phone?: string;
  address?: string;
}

// Login Interface
export interface ILogin {
  email: string;
  password: string;
}

// Change Password Interface
export interface IChangePassword {
  oldPassword: string;
  newPassword: string;
}

// Auth Response Interface
export interface IAuthResponse {
  accessToken: string;
  refreshToken: string;
  user: {
    _id: string;
    name: string;
    email: string;
    role: string;
  };
}
