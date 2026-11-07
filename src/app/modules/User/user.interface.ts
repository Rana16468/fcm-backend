export interface TUser {

    name: string;
    phone: string;
    password?: string;
    email: string;
    status:"ACTIVE" | "INACTIVE" | "BLOCKED";
    role :"ADMIN" | "USER";
    os?: string;
    browser?: string;
    device?: string;
    ipAddress?: string;
    photo?: string;
    isOnline?: boolean;
    isDeleted?: boolean;

}

export type TJwtPayload = {
  id: string;
  role: string;
  email?: string;
  phone?: string;
  sessionId?: string;
};

export interface QrAuthorizePayload {
    sessionId: string;
    phone: string;
    name?: string;
    ipAddress?: string;
    os?: string;
    browser?: string;
    device?: string;
}

export interface QrStatusPayload {
    sessionId: string;
    watchToken: string;
}

export interface QrClientMetadata {
    os?: string;
    browser?: string;
    device?: string;
}