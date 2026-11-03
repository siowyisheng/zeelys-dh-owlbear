import type { Player } from "@owlbear-rodeo/sdk";

export const NAMESPACE = "com.daggerheart.table-companion";
export const SCENE_KEY = `${NAMESPACE}/scene`;
export const PREFS_KEY = `${NAMESPACE}/preferences`;
export const COMMAND_CHANNEL = `${NAMESPACE}/commands`;
export const UI_CHANNEL = `${NAMESPACE}/ui`;
export const LOCAL_ITEM_KEY = `${NAMESPACE}/local-item`;
export const MAX_CHARACTERS = 40;
export const MAX_ROLLS = 20;
export const MAX_DICE = 100;

export const TRAITS = [
  "agility",
  "strength",
  "finesse",
  "instinct",
  "presence",
  "knowledge",
] as const;

export type Trait = (typeof TRAITS)[number];
export type Role = "GM" | "PLAYER";
export type Audience = "EVERYONE" | "GM_ONLY";
export type ResourceKey = "hp" | "stress" | "armor" | "hope";
export type CounterShape = "CIRCLE" | "SQUARE" | "DIAMOND" | "HEXAGON";
export type CounterColor = "GOLD" | "ROSE" | "SKY" | "MINT" | "VIOLET";

export interface BoundedValue {
  current: number;
  max: number;
}

export interface CustomCounter extends BoundedValue {
  id: string;
  name: string;
  shape: CounterShape;
  color: CounterColor;
}

export interface BarConfig {
  enabled: boolean;
  width: number;
  offsetX: number;
  offsetY: number;
}

export interface FieldVisibility {
  armor: boolean;
  hope: boolean;
  traits: boolean;
  thresholds: boolean;
}

export interface CharacterTemplate {
  category: string;
  hp: BoundedValue;
  stress: BoundedValue;
  armor: BoundedValue;
  hope: BoundedValue;
  evasion: number;
  traits: Record<Trait, number>;
  majorThreshold: number | null;
  severeThreshold: number | null;
  visibility: FieldVisibility;
}

export interface TrackedCharacter extends CharacterTemplate {
  id: string;
  tokenId: string;
  name: string;
  audience: Audience;
  assigneeId: string | null;
  assigneeName: string | null;
  counters: CustomCounter[];
  bars: {
    hp: BarConfig;
    armor: BarConfig;
  };
  revision: number;
}

export interface Countdown {
  id: string;
  name: string;
  value: number;
  shape: CounterShape;
  color: CounterColor;
  order: number;
  revision: number;
}

export type Spotlight =
  | { type: "GM"; label: "GM"; characterId?: never }
  | { type: "CHARACTER"; label: string; characterId: string }
  | { type: "FREEFORM"; label: string; characterId?: never };

export interface RollDieTerm {
  notation: string;
  sign: 1 | -1;
  values: number[];
}

export interface RollRecord {
  id: string;
  timestamp: number;
  playerId: string;
  playerName: string;
  characterId: string;
  characterName: string;
  rollType: "ACTION" | "REACTION";
  visibility: "PUBLIC" | "PRIVATE";
  hope: number;
  fear: number;
  terms: RollDieTerm[];
  flatModifier: number;
  advantage: "ADVANTAGE" | "DISADVANTAGE" | "NONE";
  advantageValue: number | null;
  difficulty: number | null;
  total: number;
  outcome: string;
}

export interface SceneAuthority {
  playerId: string;
  connectionId: string;
  seenAt: number;
}

export interface SceneState {
  schema: 1;
  revision: number;
  authority: SceneAuthority | null;
  defaults: CharacterTemplate;
  characters: TrackedCharacter[];
  fear: number;
  takesForm: { amount: number; createdAt: number } | null;
  countdowns: Countdown[];
  spotlight: Spotlight;
  rolls: RollRecord[];
  processedCommandIds: string[];
}

export interface UserPreferences {
  reducedMotion: boolean | null;
  overlayEnabled: boolean;
  overlayLeft: number;
  overlayTop: number;
  overlayWidth: number;
  overlayHeight: number;
  dense: boolean;
  lastCharacterId: string | null;
  pendingTokenId: string | null;
  pendingAction: "MANAGE" | "ASSIGN" | "UNTRACK" | "ROLL" | null;
}

export interface Session {
  ready: boolean;
  sceneReady: boolean;
  player: Player | null;
  party: Player[];
  state: SceneState;
  preferences: UserPreferences;
  error: string | null;
  embedded: boolean;
}

export type SceneMutation =
  | { type: "SET_FEAR"; fear: number }
  | { type: "CREATE_TAKES_FORM"; amount: number }
  | { type: "DISMISS_TAKES_FORM" }
  | { type: "ADD_COUNTDOWN"; countdown: Countdown }
  | { type: "PATCH_COUNTDOWN"; id: string; patch: Partial<Countdown> }
  | { type: "REORDER_COUNTDOWN"; id: string; direction: -1 | 1 }
  | { type: "DELETE_COUNTDOWN"; id: string }
  | { type: "TRACK_CHARACTER"; character: TrackedCharacter }
  | { type: "PATCH_CHARACTER"; id: string; patch: Partial<TrackedCharacter> }
  | { type: "UNTRACK_CHARACTER"; id: string }
  | { type: "SET_SPOTLIGHT"; spotlight: Spotlight }
  | { type: "TAKE_SPOTLIGHT"; characterId: string; expectedSpotlightRevision: number }
  | { type: "ADD_ROLL"; roll: RollRecord }
  | { type: "SET_DEFAULTS"; defaults: CharacterTemplate };

export interface CommandEnvelope {
  protocol: 1;
  id: string;
  senderPlayerId: string;
  senderConnectionId: string;
  expectedRevision: number;
  createdAt: number;
  mutation: SceneMutation;
}

export type UiMessage =
  | { type: "STATE_CHANGED" }
  | { type: "PREFERENCES_CHANGED" }
  | {
      type: "COMMAND_REJECTED";
      commandId: string;
      recipientConnectionId: string;
      message: string;
    }
  | { type: "PUBLIC_ROLL"; roll: RollRecord };
