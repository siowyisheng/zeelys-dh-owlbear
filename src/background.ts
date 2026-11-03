import OBR, { buildLabel, buildShape, type Item, type Player } from "@owlbear-rodeo/sdk";
import { applyMutation, authorizeCommand, normalizeState } from "./domain";
import {
  commitSceneState,
  getSession,
  initializeOwlbear,
  requestMutation,
  sendUiMessage,
  subscribeSession,
} from "./owlbear";
import {
  COMMAND_CHANNEL,
  LOCAL_ITEM_KEY,
  NAMESPACE,
  PREFS_KEY,
  SCENE_KEY,
  UI_CHANNEL,
  type CommandEnvelope,
  type SceneState,
  type UiMessage,
} from "./types";

const AUTHORITY_TTL = 20_000;
const HEARTBEAT_INTERVAL = 8_000;
const CONTEXT_OPEN = `${NAMESPACE}/open`;
const CONTEXT_SPOTLIGHT = `${NAMESPACE}/spotlight`;
const OVERLAY_ID = `${NAMESPACE}/overlay`;
let committing = false;
let overlaySignature = "";
let visualRevision = -1;
const commandQueue: CommandEnvelope[] = [];
let processingQueue = false;

function allPlayers(): Player[] {
  const session = getSession();
  return session.player ? [session.player, ...session.party] : session.party;
}

function electedGm(): Player | undefined {
  return allPlayers()
    .filter(({ role }) => role === "GM")
    .sort((a, b) => a.id.localeCompare(b.id) || a.connectionId.localeCompare(b.connectionId))[0];
}

function isAuthority(state: SceneState): boolean {
  const player = getSession().player;
  return Boolean(
    player &&
      state.authority?.playerId === player.id &&
      state.authority.connectionId === player.connectionId,
  );
}

async function claimAuthority(forceHeartbeat = false) {
  const session = getSession();
  const player = session.player;
  if (!session.sceneReady || !player || player.role !== "GM" || committing) return;
  const elected = electedGm();
  if (elected?.connectionId !== player.connectionId) return;
  const authority = session.state.authority;
  const stale = !authority || Date.now() - authority.seenAt > AUTHORITY_TTL;
  const ours = authority?.connectionId === player.connectionId;
  if (!stale && !ours) return;
  if (!forceHeartbeat && ours) return;
  committing = true;
  try {
    const state = normalizeState((await OBR.scene.getMetadata())[SCENE_KEY]);
    const next: SceneState = {
      ...state,
      revision: state.revision + (ours ? 0 : 1),
      authority: {
        playerId: player.id,
        connectionId: player.connectionId,
        seenAt: Date.now(),
      },
    };
    await commitSceneState(next);
  } finally {
    committing = false;
  }
}

async function reject(command: CommandEnvelope, message: string) {
  await sendUiMessage(
    {
      type: "COMMAND_REJECTED",
      commandId: command.id,
      recipientConnectionId: command.senderConnectionId,
      message,
    },
    "ALL",
  );
}

async function processCommand(command: CommandEnvelope) {
  if (command.protocol !== 1 || !isAuthority(getSession().state)) return;
  while (committing) {
    await new Promise<void>((resolve) => window.setTimeout(resolve, 20));
  }
  committing = true;
  try {
    const state = normalizeState((await OBR.scene.getMetadata())[SCENE_KEY]);
    const player = getSession().player;
    if (
      !player ||
      state.authority?.playerId !== player.id ||
      state.authority.connectionId !== player.connectionId
    ) {
      await reject(command, "The GM authority changed before this request was processed.");
      return;
    }
    const sender = allPlayers().find(
      ({ id, connectionId }) =>
        id === command.senderPlayerId && connectionId === command.senderConnectionId,
    );
    const authorization = authorizeCommand(state, command, sender);
    if (authorization === "DUPLICATE") {
      await sendUiMessage({ type: "STATE_CHANGED" }, "ALL");
      return;
    }
    if (authorization) {
      await reject(command, authorization);
      return;
    }
    if (command.expectedRevision !== state.revision) {
      await reject(
        command,
        command.mutation.type === "TAKE_SPOTLIGHT"
          ? "Someone else took the spotlight first."
          : "The scene changed before this request arrived. Review and try again.",
      );
      return;
    }
    let next: SceneState;
    try {
      next = applyMutation(state, command.mutation);
    } catch (error) {
      await reject(command, error instanceof Error ? error.message : "That change was rejected.");
      return;
    }
    next.authority = {
      playerId: getSession().player!.id,
      connectionId: getSession().player!.connectionId,
      seenAt: Date.now(),
    };
    next.processedCommandIds = [...state.processedCommandIds, command.id].slice(-100);
    await commitSceneState(next);
    await sendUiMessage({ type: "STATE_CHANGED" }, "ALL");
    if (command.mutation.type === "ADD_ROLL") {
      await sendUiMessage({ type: "PUBLIC_ROLL", roll: command.mutation.roll }, "ALL");
    }
  } catch (error) {
    await reject(command, error instanceof Error ? error.message : "The change could not be saved.");
  } finally {
    committing = false;
  }
}

function enqueueCommand(command: CommandEnvelope) {
  commandQueue.push(command);
  if (processingQueue) return;
  processingQueue = true;
  void (async () => {
    try {
      while (commandQueue.length) {
        const next = commandQueue.shift();
        if (next) await processCommand(next);
      }
    } finally {
      processingQueue = false;
    }
  })();
}

async function returnDisconnectedSpotlight() {
  const session = getSession();
  if (!isAuthority(session.state) || session.state.spotlight.type !== "CHARACTER") return;
  const character = session.state.characters.find(
    ({ id }) => id === session.state.spotlight.characterId,
  );
  if (!character?.assigneeId) return;
  if (allPlayers().some(({ id }) => id === character.assigneeId)) return;
  await requestMutation({ type: "SET_SPOTLIGHT", spotlight: { type: "GM", label: "GM" } });
}

async function configureContextMenus() {
  const icon = new URL("/icon.svg", window.location.origin).toString();
  const openItem = async (
    item: Item | undefined,
    pendingAction: "MANAGE" | "ASSIGN" | "UNTRACK" | "ROLL",
  ) => {
    if (!item || item.layer !== "CHARACTER") {
      await OBR.notification.show("Select one character token.", "INFO");
      return;
    }
    const preferences = {
      ...getSession().preferences,
      pendingTokenId: item.id,
      pendingAction,
    };
    await OBR.player.setMetadata({ [PREFS_KEY]: preferences });
    await OBR.action.open();
  };
  await OBR.contextMenu.create({
    id: CONTEXT_OPEN,
    icons: [{ icon, label: "Open in Daggerheart Table Companion", filter: { min: 1, max: 1 } }],
    onClick: async ({ items }) => openItem(items[0], "MANAGE"),
  });
  for (const action of [
    { id: "track", label: "Track or manage character", roles: ["GM"] as const },
    { id: "assign", label: "Assign character", roles: ["GM"] as const },
    { id: "untrack", label: "Untrack character", roles: ["GM"] as const },
    { id: "roll", label: "Roll for character", roles: ["GM", "PLAYER"] as const },
  ]) {
    await OBR.contextMenu.create({
      id: `${NAMESPACE}/${action.id}`,
      icons: [
        {
          icon,
          label: action.label,
          filter: { min: 1, max: 1, roles: [...action.roles] },
        },
      ],
      onClick: async ({ items }) => {
        const item = items[0];
        const character = getSession().state.characters.find(({ tokenId }) => tokenId === item?.id);
        if (action.id === "roll") {
          const player = getSession().player;
          if (!character || (player?.role !== "GM" && character.assigneeId !== player?.id)) {
            await OBR.notification.show("You cannot roll for this character.", "WARNING");
            return;
          }
        }
        if ((action.id === "assign" || action.id === "untrack") && !character) {
          await OBR.notification.show("Track this token first.", "INFO");
          return;
        }
        const pendingAction =
          action.id === "assign"
            ? "ASSIGN"
            : action.id === "untrack"
              ? "UNTRACK"
              : action.id === "roll"
                ? "ROLL"
                : "MANAGE";
        await openItem(item, pendingAction);
      },
    });
  }
  await OBR.contextMenu.create({
    id: CONTEXT_SPOTLIGHT,
    icons: [
      {
        icon,
        label: "Give spotlight",
        filter: { min: 1, max: 1, roles: ["GM"] },
      },
    ],
    onClick: async ({ items }) => {
      const item = items[0];
      const character = getSession().state.characters.find(({ tokenId }) => tokenId === item?.id);
      if (!character) {
        await OBR.notification.show("Track this token before giving it the spotlight.", "INFO");
        return;
      }
      await requestMutation({
        type: "SET_SPOTLIGHT",
        spotlight: { type: "CHARACTER", characterId: character.id, label: character.name },
      });
    },
  });
}

async function syncOverlay() {
  const { preferences, sceneReady } = getSession();
  const signature = JSON.stringify([
    sceneReady,
    preferences.overlayEnabled,
    preferences.overlayLeft,
    preferences.overlayTop,
    preferences.overlayWidth,
    preferences.overlayHeight,
  ]);
  if (signature === overlaySignature) return;
  overlaySignature = signature;
  try {
    await OBR.popover.close(OVERLAY_ID);
  } catch {
    // Closing an unopened popover is harmless.
  }
  if (!sceneReady || !preferences.overlayEnabled) return;
  await OBR.popover.open({
    id: OVERLAY_ID,
    url: new URL("/overlay.html", window.location.origin).toString(),
    width: preferences.overlayWidth,
    height: preferences.overlayHeight,
    anchorReference: "POSITION",
    anchorPosition: { left: preferences.overlayLeft, top: preferences.overlayTop },
    anchorOrigin: { horizontal: "LEFT", vertical: "TOP" },
    transformOrigin: { horizontal: "LEFT", vertical: "TOP" },
    hidePaper: true,
    disableClickAway: true,
    marginThreshold: 8,
  });
}

function isOurLocalItem(item: Item): boolean {
  return item.metadata[LOCAL_ITEM_KEY] === true;
}

async function clearLocalVisuals() {
  const items = await OBR.scene.local.getItems(isOurLocalItem);
  if (items.length) await OBR.scene.local.deleteItems(items.map(({ id }) => id));
}

async function syncLocalVisuals() {
  const session = getSession();
  if (!session.sceneReady || visualRevision === session.state.revision) return;
  visualRevision = session.state.revision;
  await clearLocalVisuals();
  const visibleCharacters = session.state.characters.filter(
    ({ audience }) => audience === "EVERYONE" || session.player?.role === "GM",
  );
  const tokenIds = visibleCharacters.map(({ tokenId }) => tokenId);
  const tokens = tokenIds.length ? await OBR.scene.items.getItems(tokenIds) : [];
  const tokenById = new Map(tokens.map((token) => [token.id, token]));
  const localItems: Item[] = [];

  for (const character of visibleCharacters) {
    const token = tokenById.get(character.tokenId);
    if (!token) continue;
    let bounds;
    try {
      bounds = await OBR.scene.items.getItemBounds([token.id]);
    } catch {
      continue;
    }
    const barEntries = [
      { key: "hp", value: character.hp, config: character.bars.hp, color: "#d9687c", dash: [] },
      {
        key: "armor",
        value: character.armor,
        config: character.bars.armor,
        color: "#7dc8d8",
        dash: [8, 4],
      },
    ] as const;
    for (const { key, value, config, color, dash } of barEntries) {
      if (!config.enabled || value.max <= 0) continue;
      const y = bounds.max.y + config.offsetY;
      const x = bounds.center.x + config.offsetX;
      const ratio = value.current / value.max;
      const fillWidth = Math.max(0.1, config.width * ratio);
      const base = (builder: ReturnType<typeof buildShape>) =>
        builder
          .height(10)
          .shapeType("RECTANGLE")
          .position({ x, y })
          .attachedTo(token.id)
          .layer("CONTROL")
          .locked(true)
          .disableHit(true)
          .disableAttachmentBehavior(["COPY"])
          .metadata({ [LOCAL_ITEM_KEY]: true });
      localItems.push(
        base(buildShape())
          .name(`${character.name} ${key} capacity`)
          .width(config.width)
          .fillColor("#151823")
          .fillOpacity(0.88)
          .strokeColor(color)
          .strokeOpacity(0.95)
          .strokeWidth(2)
          .strokeDash([...dash])
          .build(),
        base(buildShape())
          .name(`${character.name} ${key} ${value.current} of ${value.max}`)
          .width(fillWidth)
          .position({ x: x - config.width / 2 + fillWidth / 2, y })
          .fillColor(color)
          .fillOpacity(0.96)
          .strokeColor(color)
          .strokeOpacity(1)
          .strokeWidth(1)
          .strokeDash([...dash])
          .build(),
      );
    }
  }

  if (session.state.spotlight.type === "CHARACTER") {
    const character = session.state.characters.find(
      ({ id }) => id === session.state.spotlight.characterId,
    );
    const token = character ? tokenById.get(character.tokenId) : undefined;
    if (character && token) {
      const bounds = await OBR.scene.items.getItemBounds([token.id]);
      localItems.push(
        buildLabel()
          .plainText(`✦ SPOTLIGHT · ${character.name}`)
          .name(`Spotlight: ${character.name}`)
          .position({ x: bounds.center.x, y: bounds.min.y - 28 })
          .attachedTo(token.id)
          .layer("CONTROL")
          .locked(true)
          .disableHit(true)
          .disableAttachmentBehavior(["COPY"])
          .backgroundColor("#171923")
          .backgroundOpacity(0.94)
          .fillColor("#f3c969")
          .fontSize(18)
          .fontWeight(700)
          .padding(8)
          .cornerRadius(8)
          .metadata({ [LOCAL_ITEM_KEY]: true })
          .build(),
      );
    }
  }
  if (localItems.length) await OBR.scene.local.addItems(localItems);
}

async function updateActionBadge() {
  const { state, sceneReady } = getSession();
  if (!sceneReady) {
    await OBR.action.setBadgeText(undefined);
    return;
  }
  await OBR.action.setBadgeText(`F${state.fear}`);
  await OBR.action.setBadgeBackgroundColor(state.takesForm ? "#d66c88" : "#7e6bb8");
}

async function start() {
  await initializeOwlbear();
  if (!OBR.isAvailable) return;
  await configureContextMenus();
  OBR.broadcast.onMessage(COMMAND_CHANNEL, (event) => {
    enqueueCommand(event.data as CommandEnvelope);
  });
  OBR.broadcast.onMessage(UI_CHANNEL, (event) => {
    const message = event.data as UiMessage;
    if (message.type === "PREFERENCES_CHANGED") {
      void OBR.player.getMetadata().then((metadata) => {
        const preferences = metadata[PREFS_KEY];
        if (preferences) overlaySignature = "";
        void syncOverlay();
      });
    }
  });
  subscribeSession(() => {
    void claimAuthority();
    void returnDisconnectedSpotlight();
    void syncOverlay();
    void syncLocalVisuals();
    void updateActionBadge();
  });
  OBR.scene.onReadyChange(() => {
    visualRevision = -1;
    void clearLocalVisuals();
  });
  window.setInterval(() => void claimAuthority(true), HEARTBEAT_INTERVAL);
}

void start();
