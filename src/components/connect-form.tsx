"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ApiError, api } from "@/lib/api";
import {
  SECURITY_MODES,
  SECURITY_POLICIES,
  type AuthMode,
  type ConnectionProfile,
  type ConnectRequest,
  type SecurityMode,
  type SecurityPolicyName,
  type SessionResponse,
} from "@/lib/types";

const DEFAULT_ENDPOINT = "opc.tcp://opc-sim.ccl-dev.com:4840";

type DesktopApi = NonNullable<Window["opcuaDesktop"]>;

export function ConnectForm({
  onConnected,
}: {
  onConnected: (session: SessionResponse) => void;
}) {
  const [endpointUrl, setEndpointUrl] = useState(DEFAULT_ENDPOINT);
  const [securityMode, setSecurityMode] = useState<SecurityMode>("None");
  const [securityPolicy, setSecurityPolicy] = useState<SecurityPolicyName>("None");
  const [authMode, setAuthMode] = useState<AuthMode>("anonymous");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const desktop = useDesktop();
  const [profiles, setProfiles] = useState<ConnectionProfile[]>([]);
  const [profilesReady, setProfilesReady] = useState(false);
  const [selectedProfileId, setSelectedProfileId] = useState("");
  const [profileName, setProfileName] = useState("");
  const [profileMessage, setProfileMessage] = useState<string | null>(null);
  const [profileBusy, setProfileBusy] = useState<"save" | "delete" | null>(null);

  useEffect(() => {
    if (!desktop) return;
    let ignore = false;
    desktop
      .listProfiles()
      .then((next) => {
        if (ignore) return;
        setProfiles(next);
        setProfilesReady(true);
      })
      .catch((caught: unknown) => {
        if (ignore) return;
        setProfilesReady(true);
        setProfileMessage(desktopMessage(caught, "Could not load saved profiles"));
      });
    return () => {
      ignore = true;
    };
  }, [desktop]);

  function changeMode(mode: SecurityMode) {
    setSecurityMode(mode);
    if (mode === "None") setSecurityPolicy("None");
    else if (securityPolicy === "None") setSecurityPolicy("Basic256Sha256");
  }

  function changePolicy(policy: SecurityPolicyName) {
    setSecurityPolicy(policy);
    if (policy === "None") setSecurityMode("None");
    else if (securityMode === "None") setSecurityMode("SignAndEncrypt");
  }

  function applyProfile(id: string) {
    const profile = profiles.find((item) => item.id === id);
    if (!profile) return;
    setSelectedProfileId(profile.id);
    setProfileName(profile.name);
    setEndpointUrl(profile.endpointUrl);
    setSecurityMode(profile.securityMode);
    setSecurityPolicy(profile.securityPolicy);
    setAuthMode(profile.authMode);
    setUsername(profile.username ?? "");
    setPassword("");
    setProfileMessage(null);
  }

  async function saveProfile() {
    if (!desktop) return;
    const name = profileName.trim();
    if (!name) {
      setProfileMessage("Enter a profile name");
      return;
    }
    setProfileBusy("save");
    setProfileMessage(null);
    try {
      const saved = await desktop.saveProfile({
        id: selectedProfileId || undefined,
        name,
        endpointUrl,
        securityMode,
        securityPolicy,
        authMode,
        username: authMode === "username" ? username : undefined,
      });
      const next = await desktop.listProfiles();
      setProfiles(next);
      setSelectedProfileId(saved.id);
      setProfileName(saved.name);
    } catch (caught) {
      setProfileMessage(desktopMessage(caught, "Could not save the profile"));
    } finally {
      setProfileBusy(null);
    }
  }

  async function deleteProfile() {
    if (!desktop || !selectedProfileId) return;
    setProfileBusy("delete");
    setProfileMessage(null);
    try {
      await desktop.deleteProfile(selectedProfileId);
      const next = await desktop.listProfiles();
      setProfiles(next);
      setSelectedProfileId("");
      setProfileName("");
    } catch (caught) {
      setProfileMessage(desktopMessage(caught, "Could not delete the profile"));
    } finally {
      setProfileBusy(null);
    }
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);
    const body: ConnectRequest = {
      endpointUrl,
      securityMode,
      securityPolicy,
      authMode,
      username: authMode === "username" ? username : undefined,
      password: authMode === "username" ? password : undefined,
    };
    try {
      const session = await api<SessionResponse>("/api/connect", {
        method: "POST",
        body: JSON.stringify(body),
      });
      onConnected(session);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not connect");
    } finally {
      setPending(false);
    }
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>Connect to an OPC UA server</CardTitle>
        <CardDescription>
          The browser talks to this app. The app holds the session. Nothing is
          written to the server.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className="flex flex-col gap-4" onSubmit={onSubmit}>
          {desktop ? (
            <div className="flex flex-col gap-3 rounded-lg border p-3">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="saved-profile">Saved connections</Label>
                <span className="text-xs text-muted-foreground">Passwords are not saved</span>
              </div>
              {profilesReady && profiles.length > 0 ? (
                <div className="flex gap-2">
                  <Select value={selectedProfileId} onValueChange={applyProfile}>
                    <SelectTrigger id="saved-profile" className="w-full min-w-0">
                      <SelectValue placeholder="Choose a profile" />
                    </SelectTrigger>
                    <SelectContent>
                      {profiles.map((profile) => (
                        <SelectItem key={profile.id} value={profile.id}>
                          {profile.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void deleteProfile()}
                    disabled={!selectedProfileId || profileBusy !== null || pending}
                  >
                    Delete
                  </Button>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {profilesReady ? "No saved profiles yet." : "Loading saved profiles…"}
                </p>
              )}
              <div className="flex gap-2">
                <Input
                  id="profile-name"
                  value={profileName}
                  onChange={(event) => setProfileName(event.target.value)}
                  placeholder="Profile name"
                  aria-label="Profile name"
                  maxLength={80}
                  disabled={profileBusy !== null || pending}
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void saveProfile()}
                  disabled={profileBusy !== null || pending || profileName.trim().length === 0}
                >
                  {profileBusy === "save" ? "Saving…" : "Save"}
                </Button>
              </div>
              {profileMessage ? (
                <p className="text-sm text-destructive">{profileMessage}</p>
              ) : null}
            </div>
          ) : null}

          <div className="flex flex-col gap-2">
            <Label htmlFor="endpoint">Endpoint URL</Label>
            <Input
              id="endpoint"
              value={endpointUrl}
              onChange={(event) => setEndpointUrl(event.target.value)}
              spellCheck={false}
              autoCapitalize="off"
              className="font-mono"
              required
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="security-mode">Security mode</Label>
              <Select value={securityMode} onValueChange={(value) => changeMode(value as SecurityMode)}>
                <SelectTrigger id="security-mode" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SECURITY_MODES.map((mode) => (
                    <SelectItem key={mode} value={mode}>
                      {mode}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="security-policy">Security policy</Label>
              <Select
                value={securityPolicy}
                onValueChange={(value) => changePolicy(value as SecurityPolicyName)}
              >
                <SelectTrigger id="security-policy" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SECURITY_POLICIES.map((policy) => (
                    <SelectItem key={policy} value={policy}>
                      {policy}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Label>Authentication</Label>
            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                variant={authMode === "anonymous" ? "default" : "outline"}
                onClick={() => setAuthMode("anonymous")}
              >
                Anonymous
              </Button>
              <Button
                type="button"
                variant={authMode === "username" ? "default" : "outline"}
                onClick={() => setAuthMode("username")}
              >
                Username
              </Button>
            </div>
          </div>

          {authMode === "username" ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <Label htmlFor="username">Username</Label>
                <Input
                  id="username"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  autoComplete="username"
                  required
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="current-password"
                />
              </div>
            </div>
          ) : null}

          {error ? (
            <Alert variant="destructive">
              <AlertTitle>Could not connect</AlertTitle>
              <AlertDescription className="break-words whitespace-pre-wrap">
                {error}
              </AlertDescription>
            </Alert>
          ) : null}

          <Button type="submit" disabled={pending || profileBusy !== null}>
            {pending ? "Connecting…" : "Connect"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function useDesktop(): DesktopApi | null {
  return useSyncExternalStore(
    () => () => {},
    () => window.opcuaDesktop ?? null,
    () => null,
  );
}

function desktopMessage(error: unknown, fallback: string) {
  if (!(error instanceof Error) || !error.message) return fallback;
  const text = error.message.replace(/^Error invoking remote method '[^']+':\s*/, "");
  return text || fallback;
}
