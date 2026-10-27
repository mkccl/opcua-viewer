"use client";

import { useState } from "react";

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
  type ConnectRequest,
  type SecurityMode,
  type SecurityPolicyName,
  type SessionResponse,
} from "@/lib/types";

const DEFAULT_ENDPOINT = "opc.tcp://opc-sim.ccl-dev.com:4840";

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

          <Button type="submit" disabled={pending}>
            {pending ? "Connecting…" : "Connect"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
