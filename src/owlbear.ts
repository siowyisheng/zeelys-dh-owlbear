import OBR, { type Metadata, type Player } from "@owlbear-rodeo/sdk";
import {
  applyMutation,
  createDefaultState,
  DEFAULT_PREFERENCES,
  normalizePreferences,
  normalizeState,
} from "./domain";
import {
  COMMAND_CHANNEL,
  PREFS_KEY,
  SCENE_KEY,
  UI_CHANNEL,
  type CommandEnvelope,
  type SceneMutation,
  type SceneState,
  type Session,
  type UiMessage,
  type UserPreferences,
} from "./types";

type Listener = (session: Session) => void;

let session: Session = {
  ready: false,
  sceneReady: false,
  player: null,
  party: [],
  state: createDefaultState(),
  preferences: { ...DEFAULT_PREFERENCES },
  error: null,
  embedded: OBR.isAvailable,
};

const listeners = new Set<Listener>();
let initialized = false;
let predictedRevision = 0;
const unsubscribers: (() => void)[] = [];

function emit(patch: Partial<Session> = {}) {
  session = { ...session, ...patch };
  for (const listener of listeners) listener(session);
}

export function getSession(): Session {
  return session;
}

export function subscribeSession(listener: Listener): () => void {
  listeners.add(listener);
  listener(session);
  return () => listeners.delete(listener);
}

async function currentPlayer(): Promise<Player> {
  const [id, connectionId, role, name, color, syncView, selection, metadata] =
    await Promise.all([
      OBR.player.getId(),
      OBR.player.getConnectionId(),
      OBR.player.getRole(),
      OBR.player.getName(),
      OBR.player.getColor(),
      OBR.player.getSyncView(),
      OBR.player.getSelection(),
      OBR.player.getMetadata(),
    ]);
  return { id, connectionId, role, name, color, syncView, selection, metadata };
}

async function loadSceneState(): Promise<SceneState> {
  if (!(await OBR.scene.isReady())) return createDefaultState();
  const metadata = await OBR.scene.getMetadata();
  return normalizeState(metadata[SCENE_KEY]);
}

async function refreshAll() {
  const [player, party, sceneReady] = await Promise.all([
    currentPlayer(),
    OBR.party.getPlayers(),
    OBR.scene.isReady(),
  ]);
  const [state, metadata] = await Promise.all([
    sceneReady ? loadSceneState() : Promise.resolve(createDefaultState()),
    OBR.player.getMetadata(),
  ]);
  predictedRevision = state.revision;
  emit({
    ready: true,
    sceneReady,
    player,
    party,
    state,
    preferences: normalizePreferences(metadata[PREFS_KEY]),
    error: null,
    embedded: true,
  });
}

export async function initializeOwlbear(): Promise<void> {
  if (initialized) return;
  initialized = true;
  if (!OBR.isAvailable) {
    emit({ ready: true, embedded: false });
    return;
  }
  await new Promise<void>((resolve) => {
    if (OBR.isReady) resolve();
    else OBR.onReady(resolve);
  });
  await refreshAll();
  unsubscribers.push(
    OBR.scene.onReadyChange(async (sceneReady) => {
      const state = sceneReady ? await loadSceneState() : createDefaultState();
      predictedRevision = state.revision;
      emit({
        sceneReady,
        state,
      });
    }),
    OBR.scene.onMetadataChange((metadata) => {
      const state = normalizeState(metadata[SCENE_KEY]);
      predictedRevision = Math.max(predictedRevision, state.revision);
      emit({ state });
    }),
    OBR.player.onChange((player) => {
      emit({
        player,
        preferences: normalizePreferences(player.metadata[PREFS_KEY]),
      });
    }),
    OBR.party.onChange((party) => emit({ party })),
    OBR.broadcast.onMessage(UI_CHANNEL, (event) => {
      const message = event.data as UiMessage;
      if (
        message.type === "COMMAND_REJECTED" &&
        message.recipientConnectionId === session.player?.connectionId
      ) {
        predictedRevision = session.state.revision;
        emit({ error: message.message });
      }
      if (message.type === "STATE_CHANGED") void loadSceneState().then((state) => emit({ state }));
    }),
  );
}

export function destroyOwlbear() {
  for (const unsubscribe of unsubscribers.splice(0)) unsubscribe();
  initialized = false;
}

export async function requestMutation(mutation: SceneMutation): Promise<string> {
  const player = session.player;
  if (!player) {
    if (!session.embedded) {
      const state = applyMutation(session.state, mutation);
      emit({ state, error: null });
      return "local";
    }
    throw new Error("Player identity is unavailable.");
  }
  if (!session.sceneReady) throw new Error("Open a scene before changing table state.");
  const authority = session.state.authority;
  const authorityOnline =
    authority &&
    [session.player, ...session.party].some(
      (candidate) => candidate?.connectionId === authority.connectionId,
    ) &&
    Date.now() - authority.seenAt < 20_000;
  if (!authorityOnline) {
    throw new Error("Shared controls are unavailable until a GM authority is connected.");
  }
  const id = crypto.randomUUID();
  const expectedRevision = Math.max(session.state.revision, predictedRevision);
  predictedRevision = expectedRevision + 1;
  const command: CommandEnvelope = {
    protocol: 1,
    id,
    senderPlayerId: player.id,
    senderConnectionId: player.connectionId,
    expectedRevision,
    createdAt: Date.now(),
    mutation,
  };
  await OBR.broadcast.sendMessage(COMMAND_CHANNEL, command, { destination: "ALL" });
  return id;
}

export async function updatePreferences(patch: Partial<UserPreferences>) {
  const preferences = { ...session.preferences, ...patch };
  emit({ preferences });
  if (!session.embedded) return;
  await OBR.player.setMetadata({ [PREFS_KEY]: preferences });
  await OBR.broadcast.sendMessage(
    UI_CHANNEL,
    { type: "PREFERENCES_CHANGED" } satisfies UiMessage,
    { destination: "LOCAL" },
  );
}

export async function notify(message: string, variant: "DEFAULT" | "ERROR" | "INFO" | "SUCCESS" | "WARNING" = "DEFAULT") {
  emit({ error: variant === "ERROR" ? message : null });
  if (session.embedded) await OBR.notification.show(message, variant);
}

export async function getSelectedToken() {
  if (!session.embedded || !session.sceneReady) return null;
  const selection = await OBR.player.getSelection();
  const pending = session.preferences.pendingTokenId;
  const tokenId = pending ?? selection?.[0];
  if (!tokenId) return null;
  const items = await OBR.scene.items.getItems([tokenId]);
  if (pending) {
    const preferences = {
      ...session.preferences,
      pendingTokenId: null,
      pendingAction: null,
    };
    await OBR.player.setMetadata({ [PREFS_KEY]: preferences });
    emit({ preferences });
  }
  return items[0] ?? null;
}

export async function commitSceneState(state: SceneState): Promise<void> {
  const encoded = new TextEncoder().encode(JSON.stringify(state));
  if (encoded.byteLength > 512 * 1024) {
    throw new Error("The scene companion data is too large to save safely.");
  }
  await OBR.scene.setMetadata({ [SCENE_KEY]: state as unknown as Metadata[string] });
}

export async function sendUiMessage(message: UiMessage, destination: "REMOTE" | "LOCAL" | "ALL" = "ALL") {
  await OBR.broadcast.sendMessage(UI_CHANNEL, message, { destination });
}

export { OBR };
