import type { ConnectionProfile } from "@/lib/types";

export type ConnectionProfileInput = Omit<ConnectionProfile, "id"> & { id?: string };

declare global {
  interface Window {
    opcuaDesktop?: {
      listProfiles: () => Promise<ConnectionProfile[]>;
      saveProfile: (input: ConnectionProfileInput) => Promise<ConnectionProfile>;
      deleteProfile: (id: string) => Promise<void>;
    };
  }
}

export {};
