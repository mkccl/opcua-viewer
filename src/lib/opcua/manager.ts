import "server-only";

import {
  AttributeIds,
  BrowseDirection,
  ClientMonitoredItem,
  ClientSubscription,
  MessageSecurityMode,
  NodeClass,
  OPCUAClient,
  resolveNodeId,
  SecurityPolicy,
  TimestampsToReturn,
  UserTokenType,
  type ClientSession,
  type DataValue,
} from "node-opcua";

import {
  SECURITY_MODES,
  SECURITY_POLICIES,
  type ConnectRequest,
  type NodeDetails,
  type SecurityMode,
  type SecurityPolicyName,
  type TreeNode,
  type WatchItem,
} from "@/lib/types";
import {
  formatAccessLevel,
  formatBrowseName,
  formatLocalizedText,
  formatTimestamp,
  formatValue,
} from "@/lib/opcua/format";

const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const MAX_SESSIONS = 30;
const MAX_WATCHED = 50;
const CONNECT_TIMEOUT_MS = 30_000;

export class ClientError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

type LiveValue = {
  value: string | null;
  statusCode: string | null;
  sourceTimestamp: string | null;
  serverTimestamp: string | null;
};

type Watched = {
  nodeId: string;
  displayName: string;
  item: ReturnType<typeof ClientMonitoredItem.create>;
  last: LiveValue;
};

export type SessionEvent =
  | { type: "value"; item: WatchItem }
  | { type: "removed"; nodeId: string }
  | { type: "session"; connected: false };

type Listener = (event: SessionEvent) => void;

type HeldSession = {
  id: string;
  endpointUrl: string;
  securityMode: SecurityMode;
  securityPolicy: SecurityPolicyName;
  client: OPCUAClient;
  session: ClientSession;
  subscription: ClientSubscription | null;
  watched: Map<string, Watched>;
  listeners: Set<Listener>;
  lastUsed: number;
  closed: boolean;
};

type Store = Map<string, HeldSession>;

const globalStore = globalThis as typeof globalThis & {
  __opcuaViewerSessions?: Store;
};

function sessions(): Store {
  if (!globalStore.__opcuaViewerSessions) {
    globalStore.__opcuaViewerSessions = new Map();
  }
  return globalStore.__opcuaViewerSessions;
}

export function getSession(id: string): HeldSession | null {
  const held = sessions().get(id);
  if (!held || held.closed) return null;
  return held;
}

export function touch(held: HeldSession) {
  held.lastUsed = Date.now();
}

export function sessionInfo(held: HeldSession) {
  return {
    endpointUrl: held.endpointUrl,
    securityMode: held.securityMode,
    securityPolicy: held.securityPolicy,
  };
}

export function listWatch(held: HeldSession): WatchItem[] {
  return [...held.watched.values()].map(toWatchItem);
}

export function addListener(held: HeldSession, listener: Listener): () => void {
  held.listeners.add(listener);
  return () => {
    held.listeners.delete(listener);
  };
}

export async function connect(input: unknown, previousId?: string) {
  const request = parseConnectRequest(input);
  if (previousId) await disconnect(previousId);
  sweep();

  if (sessions().size >= MAX_SESSIONS) {
    throw new ClientError(
      "Too many OPC UA sessions are open on this server. Disconnect one and try again.",
    );
  }

  const securityMode = messageSecurityMode(request.securityMode);
  const securityPolicy = securityPolicyUri(request.securityPolicy);
  const client = OPCUAClient.create({
    applicationName: process.env.OPCUA_APPLICATION_NAME || "Web OPC UA Client",
    applicationUri: "urn:web-opcua-client",
    endpointMustExist: false,
    securityMode,
    securityPolicy,
    requestedSessionTimeout: SESSION_TTL_MS,
    keepSessionAlive: true,
    connectionStrategy: {
      initialDelay: 200,
      maxRetry: 0,
      maxDelay: 1000,
    },
  });

  trustServerCertificates(client);

  try {
    await withTimeout(
      client.connect(request.endpointUrl),
      CONNECT_TIMEOUT_MS,
      "Timed out connecting to the OPC UA server",
    );

    const session = await client.createSession(
      request.authMode === "anonymous"
        ? { type: UserTokenType.Anonymous }
        : {
            type: UserTokenType.UserName,
            userName: request.username ?? "",
            password: request.password ?? "",
          },
    );

    const held: HeldSession = {
      id: crypto.randomUUID(),
      endpointUrl: request.endpointUrl,
      securityMode: request.securityMode,
      securityPolicy: request.securityPolicy,
      client,
      session,
      subscription: null,
      watched: new Map(),
      listeners: new Set(),
      lastUsed: Date.now(),
      closed: false,
    };

    session.on("session_closed", () => {
      void closeHeld(held);
    });

    sessions().set(held.id, held);
    return held;
  } catch (error) {
    await client.disconnect().catch(() => undefined);
    if (error instanceof ClientError) throw error;
    throw new ClientError(causeMessage(error, "Could not connect to the OPC UA server"));
  }
}

export async function disconnect(id: string) {
  const held = sessions().get(id);
  if (!held) return;
  await closeHeld(held);
}

export async function browse(held: HeldSession, nodeId: string): Promise<TreeNode[]> {
  requireNodeId(nodeId);
  const references = await browseAll(held.session, nodeId);
  const nodes: TreeNode[] = [];

  for (const reference of references) {
    const childId = reference.nodeId?.toString();
    if (!childId) continue;
    const browseName =
      reference.browseName?.toString() ||
      formatBrowseName(reference.browseName) ||
      childId;
    const displayName =
      formatLocalizedText(reference.displayName) || browseName || childId;
    nodes.push({
      nodeId: childId,
      browseName,
      displayName,
      nodeClass: nodeClassName(reference.nodeClass),
    });
  }

  nodes.sort((a, b) => {
    const order = classOrder(a.nodeClass) - classOrder(b.nodeClass);
    if (order !== 0) return order;
    return a.displayName.localeCompare(b.displayName);
  });

  return nodes;
}

export async function readDetails(held: HeldSession, nodeId: string): Promise<NodeDetails> {
  requireNodeId(nodeId);
  const attributeIds = [
    AttributeIds.NodeClass,
    AttributeIds.BrowseName,
    AttributeIds.DisplayName,
    AttributeIds.Description,
    AttributeIds.DataType,
    AttributeIds.AccessLevel,
    AttributeIds.Value,
  ];
  const values = await held.session.read(
    attributeIds.map((attributeId) => ({ nodeId, attributeId })),
    0,
  );
  const [nodeClass, browseName, displayName, description, dataType, accessLevel, value] =
    values;

  if (!nodeClass?.statusCode.isGood()) {
    throw new ClientError(
      nodeClass?.statusCode.name ?? `Cannot read node ${nodeId}`,
    );
  }

  let dataTypeName: string | null = null;
  if (dataType?.statusCode.isGood()) {
    const dataTypeId = nodeIdText(dataType.value?.value);
    if (dataTypeId) {
      const name = await held.session.read({
        nodeId: dataTypeId,
        attributeId: AttributeIds.DisplayName,
      });
      dataTypeName = name.statusCode.isGood()
        ? formatLocalizedText(name.value?.value) ?? dataTypeId
        : dataTypeId;
    }
  }

  const valueInfo = readValue(value);

  return {
    nodeId,
    browseName: browseName?.statusCode.isGood()
      ? formatBrowseName(browseName.value?.value)
      : null,
    displayName: displayName?.statusCode.isGood()
      ? formatLocalizedText(displayName.value?.value)
      : null,
    nodeClass: nodeClassName(nodeClass.value?.value),
    dataType: dataTypeName,
    accessLevel: accessLevel?.statusCode.isGood()
      ? formatAccessLevel(accessLevel.value?.value)
      : null,
    description: description?.statusCode.isGood()
      ? formatLocalizedText(description.value?.value)
      : null,
    ...valueInfo,
  };
}

export async function addWatch(held: HeldSession, nodeId: string): Promise<WatchItem> {
  requireNodeId(nodeId);
  const existing = held.watched.get(nodeId);
  if (existing) return toWatchItem(existing);

  if (held.watched.size >= MAX_WATCHED) {
    throw new ClientError(`The watch list is limited to ${MAX_WATCHED} variables`);
  }

  const nodeClass = await held.session.read({
    nodeId,
    attributeId: AttributeIds.NodeClass,
  });
  if (!nodeClass.statusCode.isGood()) {
    throw new ClientError(nodeClass.statusCode.name);
  }
  if (nodeClass.value?.value !== NodeClass.Variable) {
    throw new ClientError("Only variable nodes can be added to the watch list");
  }

  const displayNameResult = await held.session.read({
    nodeId,
    attributeId: AttributeIds.DisplayName,
  });
  const displayName = displayNameResult.statusCode.isGood()
    ? formatLocalizedText(displayNameResult.value?.value) ?? nodeId
    : nodeId;

  const current = await held.session.read({
    nodeId,
    attributeId: AttributeIds.Value,
  });

  const subscription = await ensureSubscription(held);
  const item = ClientMonitoredItem.create(
    subscription,
    { nodeId, attributeId: AttributeIds.Value },
    { samplingInterval: 500, discardOldest: true, queueSize: 5 },
    TimestampsToReturn.Both,
  );

  const watched: Watched = {
    nodeId,
    displayName,
    item,
    last: readValue(current),
  };

  item.on("changed", (dataValue: DataValue) => {
    watched.last = readValue(dataValue);
    emit(held, { type: "value", item: toWatchItem(watched) });
  });
  item.on("err", (message: string) => {
    watched.last = { ...watched.last, statusCode: message };
    emit(held, { type: "value", item: toWatchItem(watched) });
  });

  held.watched.set(nodeId, watched);
  return toWatchItem(watched);
}

export async function removeWatch(held: HeldSession, nodeId: string) {
  const watched = held.watched.get(nodeId);
  if (!watched) return;
  held.watched.delete(nodeId);
  await watched.item.terminate().catch(() => undefined);
  emit(held, { type: "removed", nodeId });

  if (held.watched.size === 0 && held.subscription) {
    const subscription = held.subscription;
    held.subscription = null;
    await subscription.terminate().catch(() => undefined);
  }
}

async function closeHeld(held: HeldSession) {
  if (held.closed) return;
  held.closed = true;
  sessions().delete(held.id);
  emit(held, { type: "session", connected: false });
  held.listeners.clear();

  const items = [...held.watched.values()];
  held.watched.clear();
  for (const watched of items) {
    await watched.item.terminate().catch(() => undefined);
  }
  if (held.subscription) {
    const subscription = held.subscription;
    held.subscription = null;
    await subscription.terminate().catch(() => undefined);
  }
  await held.session.close().catch(() => undefined);
  await held.client.disconnect().catch(() => undefined);
}

async function ensureSubscription(held: HeldSession) {
  if (held.subscription?.hasSession) return held.subscription;

  const subscription = ClientSubscription.create(held.session, {
    requestedPublishingInterval: 500,
    requestedLifetimeCount: 60,
    requestedMaxKeepAliveCount: 10,
    maxNotificationsPerPublish: 100,
    publishingEnabled: true,
    priority: 10,
  });

  try {
    await withTimeout(
      new Promise<void>((resolve, reject) => {
        subscription.once("started", () => resolve());
        subscription.once("internal_error", (error: Error) => reject(error));
      }),
      10_000,
      "The OPC UA subscription did not start",
    );
  } catch (error) {
    await subscription.terminate().catch(() => undefined);
    throw new ClientError(causeMessage(error, "Could not start the OPC UA subscription"));
  }

  subscription.on("terminated", () => {
    if (held.subscription === subscription) held.subscription = null;
  });
  held.subscription = subscription;
  return subscription;
}

async function browseAll(session: ClientSession, nodeId: string) {
  let result = await session.browse({
    nodeId,
    browseDirection: BrowseDirection.Forward,
    referenceTypeId: resolveNodeId("HierarchicalReferences"),
    includeSubtypes: true,
    nodeClassMask: 0,
    resultMask: 63,
  });

  const references = [];
  for (let page = 0; page < 20; page += 1) {
    if (result.statusCode?.isBad()) {
      throw new ClientError(result.statusCode.name || "Browse failed");
    }
    if (result.references) references.push(...result.references);
    const continuationPoint = result.continuationPoint;
    if (!continuationPoint || continuationPoint.length === 0) break;
    result = await session.browseNext(continuationPoint, false);
  }
  return references;
}

function readValue(dataValue: DataValue | undefined): LiveValue {
  if (!dataValue) {
    return {
      value: null,
      statusCode: null,
      sourceTimestamp: null,
      serverTimestamp: null,
    };
  }

  const status = dataValue.statusCode?.name ?? null;
  if (status === "BadAttributeIdInvalid" || status === "BadNotReadable") {
    return {
      value: null,
      statusCode: null,
      sourceTimestamp: null,
      serverTimestamp: null,
    };
  }

  return {
    value: dataValue.statusCode?.isGood() ? formatValue(dataValue.value?.value) : null,
    statusCode: status,
    sourceTimestamp: formatTimestamp(dataValue.sourceTimestamp),
    serverTimestamp: formatTimestamp(dataValue.serverTimestamp),
  };
}

function toWatchItem(watched: Watched): WatchItem {
  return {
    nodeId: watched.nodeId,
    displayName: watched.displayName,
    ...watched.last,
  };
}

function emit(held: HeldSession, event: SessionEvent) {
  for (const listener of held.listeners) {
    try {
      listener(event);
    } catch {
      held.listeners.delete(listener);
    }
  }
}

function parseConnectRequest(input: unknown): ConnectRequest {
  if (!input || typeof input !== "object") {
    throw new ClientError("Expected a JSON connection request");
  }
  const body = input as Record<string, unknown>;
  const endpointUrl = typeof body.endpointUrl === "string" ? body.endpointUrl.trim() : "";
  if (!endpointUrl.startsWith("opc.tcp://") || endpointUrl.length <= "opc.tcp://".length) {
    throw new ClientError("Endpoint URL must start with opc.tcp://");
  }
  if (endpointUrl.length > 500 || /\s/.test(endpointUrl)) {
    throw new ClientError("Enter a valid opc.tcp endpoint URL");
  }

  if (!isOneOf(body.securityMode, SECURITY_MODES)) {
    throw new ClientError("Security mode must be None, Sign, or SignAndEncrypt");
  }
  if (!isOneOf(body.securityPolicy, SECURITY_POLICIES)) {
    throw new ClientError("Unknown security policy");
  }
  if ((body.securityMode === "None") !== (body.securityPolicy === "None")) {
    throw new ClientError(
      "Security mode None has to be paired with policy None. Sign and SignAndEncrypt need a policy other than None.",
    );
  }

  const authMode = body.authMode === "username" ? "username" : body.authMode === "anonymous" ? "anonymous" : null;
  if (!authMode) throw new ClientError("Authentication must be anonymous or username");

  let username: string | undefined;
  let password: string | undefined;
  if (authMode === "username") {
    username = typeof body.username === "string" ? body.username : "";
    password = typeof body.password === "string" ? body.password : "";
    if (!username.trim()) throw new ClientError("Username is required");
    if (username.length > 200 || password.length > 200) {
      throw new ClientError("Username or password is too long");
    }
  }

  return {
    endpointUrl,
    securityMode: body.securityMode,
    securityPolicy: body.securityPolicy,
    authMode,
    username,
    password,
  };
}

function messageSecurityMode(mode: SecurityMode): MessageSecurityMode {
  switch (mode) {
    case "None":
      return MessageSecurityMode.None;
    case "Sign":
      return MessageSecurityMode.Sign;
    case "SignAndEncrypt":
      return MessageSecurityMode.SignAndEncrypt;
    default: {
      const neverMode: never = mode;
      return neverMode;
    }
  }
}

function securityPolicyUri(policy: SecurityPolicyName): SecurityPolicy {
  switch (policy) {
    case "None":
      return SecurityPolicy.None;
    case "Basic256Sha256":
      return SecurityPolicy.Basic256Sha256;
    case "Aes128_Sha256_RsaOaep":
      return SecurityPolicy.Aes128_Sha256_RsaOaep;
    case "Aes256_Sha256_RsaPss":
      return SecurityPolicy.Aes256_Sha256_RsaPss;
    default: {
      const neverPolicy: never = policy;
      return neverPolicy;
    }
  }
}

function trustServerCertificates(client: OPCUAClient) {
  const manager = client.clientCertificateManager as {
    automaticallyAcceptUnknownCertificate?: boolean;
  };
  manager.automaticallyAcceptUnknownCertificate = true;
}

function nodeClassName(value: unknown): string {
  if (typeof value === "string" && value) return value;
  if (typeof value === "number") {
    const name = NodeClass[value];
    return typeof name === "string" ? name : String(value);
  }
  return "Unspecified";
}

function nodeIdText(value: unknown): string | null {
  if (typeof value === "string" && value) return value;
  if (value && typeof value === "object" && "toString" in value) {
    const text = String(value);
    return text && text !== "[object Object]" ? text : null;
  }
  return null;
}

function classOrder(nodeClass: string): number {
  const order = ["Object", "Variable", "Method", "View", "ObjectType", "VariableType", "DataType", "ReferenceType"];
  const index = order.indexOf(nodeClass);
  return index === -1 ? order.length : index;
}

function requireNodeId(nodeId: string) {
  if (!nodeId || nodeId.length > 1024) {
    throw new ClientError("A node id is required");
  }
}

function isOneOf<T extends string>(value: unknown, options: readonly T[]): value is T {
  return typeof value === "string" && (options as readonly string[]).includes(value);
}

function causeMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) {
    return error.message.length > 2000 ? `${error.message.slice(0, 2000)}…` : error.message;
  }
  return fallback;
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new ClientError(message)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function sweep() {
  const cutoff = Date.now() - SESSION_TTL_MS;
  for (const held of sessions().values()) {
    if (held.lastUsed < cutoff) void closeHeld(held);
  }
}
