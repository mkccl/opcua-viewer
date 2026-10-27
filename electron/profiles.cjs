const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const SECURITY_MODES = ["None", "Sign", "SignAndEncrypt"];
const SECURITY_POLICIES = [
  "None",
  "Basic256Sha256",
  "Aes128_Sha256_RsaOaep",
  "Aes256_Sha256_RsaPss",
];
const MAX_PROFILES = 30;
const MAX_FILE_BYTES = 1_000_000;

// Profiles store the endpoint, security settings, auth type, and username.
// The password is never written, even if a caller sends one.

function listProfiles(file) {
  return read(file);
}

function saveProfile(file, input) {
  const profile = validate(input);
  const profiles = read(file);
  let index = -1;
  if (profile.id) index = profiles.findIndex((item) => item.id === profile.id);
  if (index === -1) index = profiles.findIndex((item) => item.name === profile.name);

  if (index === -1) {
    if (profiles.length >= MAX_PROFILES) {
      throw new Error(`You can save up to ${MAX_PROFILES} profiles`);
    }
    profile.id = crypto.randomUUID();
    profiles.push(profile);
  } else {
    profile.id = profiles[index].id;
    profiles[index] = profile;
  }

  profiles.sort((a, b) => a.name.localeCompare(b.name));
  write(file, profiles);
  return publicProfile(profile);
}

function deleteProfile(file, id) {
  if (typeof id !== "string" || !id) throw new Error("A profile id is required");
  const profiles = read(file).filter((item) => item.id !== id);
  write(file, profiles);
}

function read(file) {
  if (!fs.existsSync(file)) return [];
  const stat = fs.statSync(file);
  if (stat.size > MAX_FILE_BYTES) throw new Error("The profile file is too large");
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return [];
  }
  const raw = parsed && Array.isArray(parsed.profiles) ? parsed.profiles : [];
  let dirty = false;
  const profiles = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    if ("password" in item) dirty = true;
    try {
      const profile = validate(item);
      if (!profile.id) {
        dirty = true;
        continue;
      }
      profiles.push(profile);
    } catch {
      dirty = true;
    }
  }
  if (dirty) write(file, profiles);
  return profiles.map(publicProfile);
}

function write(file, profiles) {
  const directory = path.dirname(file);
  fs.mkdirSync(directory, { recursive: true });
  const body = JSON.stringify(
    {
      version: 1,
      profiles: profiles.map(publicProfile),
    },
    null,
    2,
  );
  const temporary = `${file}.tmp`;
  fs.writeFileSync(temporary, body);
  fs.renameSync(temporary, file);
}

function validate(input) {
  if (!input || typeof input !== "object") throw new Error("Invalid profile");
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!name || name.length > 80 || /[\r\n]/.test(name)) {
    throw new Error("Enter a profile name up to 80 characters");
  }

  const endpointUrl = typeof input.endpointUrl === "string" ? input.endpointUrl.trim() : "";
  if (
    !endpointUrl.startsWith("opc.tcp://") ||
    endpointUrl.length <= "opc.tcp://".length ||
    endpointUrl.length > 500 ||
    /\s/.test(endpointUrl)
  ) {
    throw new Error("Endpoint URL must start with opc.tcp://");
  }

  if (!SECURITY_MODES.includes(input.securityMode)) throw new Error("Unknown security mode");
  if (!SECURITY_POLICIES.includes(input.securityPolicy)) throw new Error("Unknown security policy");
  if ((input.securityMode === "None") !== (input.securityPolicy === "None")) {
    throw new Error("Security mode None has to be paired with policy None");
  }

  const authMode =
    input.authMode === "username" ? "username" : input.authMode === "anonymous" ? "anonymous" : null;
  if (!authMode) throw new Error("Authentication must be anonymous or username");

  let username;
  if (authMode === "username") {
    username = typeof input.username === "string" ? input.username.trim() : "";
    if (!username) throw new Error("Username is required");
    if (username.length > 200) throw new Error("Username is too long");
  }

  const id = typeof input.id === "string" && /^[0-9a-f-]{36}$/i.test(input.id) ? input.id : undefined;
  return publicProfile({
    id,
    name,
    endpointUrl,
    securityMode: input.securityMode,
    securityPolicy: input.securityPolicy,
    authMode,
    username,
  });
}

function publicProfile(profile) {
  return {
    id: profile.id,
    name: profile.name,
    endpointUrl: profile.endpointUrl,
    securityMode: profile.securityMode,
    securityPolicy: profile.securityPolicy,
    authMode: profile.authMode,
    ...(profile.username ? { username: profile.username } : {}),
  };
}

module.exports = { listProfiles, saveProfile, deleteProfile };
