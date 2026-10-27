const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("opcuaDesktop", {
  listProfiles() {
    return ipcRenderer.invoke("profiles:list");
  },
  saveProfile(input) {
    const profile = input && typeof input === "object" ? { ...input } : input;
    if (profile && typeof profile === "object") delete profile.password;
    return ipcRenderer.invoke("profiles:save", profile);
  },
  deleteProfile(id) {
    return ipcRenderer.invoke("profiles:delete", id);
  },
});
