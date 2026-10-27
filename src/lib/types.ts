export const SECURITY_MODES = ["None", "Sign", "SignAndEncrypt"] as const;
export const SECURITY_POLICIES = [
  "None",
  "Basic256Sha256",
  "Aes128_Sha256_RsaOaep",
  "Aes256_Sha256_RsaPss",
] as const;

export type SecurityMode = (typeof SECURITY_MODES)[number];
export type SecurityPolicyName = (typeof SECURITY_POLICIES)[number];
export type AuthMode = "anonymous" | "username";

export const OBJECTS_FOLDER_NODE_ID = "ns=0;i=85";

export type ConnectRequest = {
  endpointUrl: string;
  securityMode: SecurityMode;
  securityPolicy: SecurityPolicyName;
  authMode: AuthMode;
  username?: string;
  password?: string;
};

export type TreeNode = {
  nodeId: string;
  browseName: string;
  displayName: string;
  nodeClass: string;
};

export type NodeDetails = {
  nodeId: string;
  browseName: string | null;
  displayName: string | null;
  nodeClass: string | null;
  dataType: string | null;
  accessLevel: string | null;
  description: string | null;
  value: string | null;
  statusCode: string | null;
  sourceTimestamp: string | null;
  serverTimestamp: string | null;
};

export type WatchItem = {
  nodeId: string;
  displayName: string;
  value: string | null;
  statusCode: string | null;
  sourceTimestamp: string | null;
  serverTimestamp: string | null;
};

export type SessionResponse =
  | {
      connected: true;
      endpointUrl: string;
      securityMode: SecurityMode;
      securityPolicy: SecurityPolicyName;
      items: WatchItem[];
    }
  | { connected: false };
