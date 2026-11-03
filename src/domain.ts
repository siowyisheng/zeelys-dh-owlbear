import type { Player } from "@owlbear-rodeo/sdk";
import {
  MAX_CHARACTERS,
  MAX_DICE,
  MAX_ROLLS,
  TRAITS,
  type CharacterTemplate,
  type CommandEnvelope,
  type Countdown,
  type RollDieTerm,
  type RollRecord,
  type SceneMutation,
  type SceneState,
  type TrackedCharacter,
  type UserPreferences,
} from "./types";

export const DEFAULT_TEMPLATE: CharacterTemplate = {
  category: "PC",
  hp: { current: 6, max: 6 },
  stress: { current: 0, max: 6 },
  armor: { current: 0, max: 0 },
  hope: { current: 0, max: 6 },
  evasion: 10,
  traits: {
    agility: 0,
    strength: 0,
    finesse: 0,
    instinct: 0,
    presence: 0,
    knowledge: 0,
  },
  majorThreshold: null,
  severeThreshold: null,
  visibility: { armor: false, hope: false, traits: false, thresholds: false },
};

export const DEFAULT_PREFERENCES: UserPreferences = {
  reducedMotion: null,
  overlayEnabled: true,
  overlayLeft: 18,
  overlayTop: 86,
  overlayWidth: 340,
  overlayHeight: 230,
  dense: false,
  lastCharacterId: null,
  pendingTokenId: null,
  pendingAction: null,
};

export function createDefaultState(): SceneState {
  return {
    schema: 1,
    revision: 0,
    authority: null,
    defaults: structuredClone(DEFAULT_TEMPLATE),
    characters: [],
    fear: 0,
    takesForm: null,
    countdowns: [],
    spotlight: { type: "GM", label: "GM" },
    rolls: [],
    processedCommandIds: [],
  };
}

export function createCharacter(
  tokenId: string,
  name: string,
  template: CharacterTemplate,
): TrackedCharacter {
  return {
    ...structuredClone(template),
    id: crypto.randomUUID(),
    tokenId,
    name: name.trim() || "Untitled character",
    audience: "EVERYONE",
    assigneeId: null,
    assigneeName: null,
    counters: [],
    bars: {
      hp: { enabled: true, width: 180, offsetX: 0, offsetY: 36 },
      armor: { enabled: false, width: 180, offsetX: 0, offsetY: 48 },
    },
    revision: 0,
  };
}

export function normalizeState(value: unknown): SceneState {
  if (!value || typeof value !== "object") return createDefaultState();
  const raw = value as Partial<SceneState>;
  const fallback = createDefaultState();
  if (raw.schema !== 1) return fallback;
  return {
    ...fallback,
    ...raw,
    defaults: { ...fallback.defaults, ...raw.defaults },
    characters: Array.isArray(raw.characters) ? raw.characters.slice(0, MAX_CHARACTERS) : [],
    countdowns: Array.isArray(raw.countdowns) ? raw.countdowns : [],
    rolls: Array.isArray(raw.rolls) ? raw.rolls.slice(0, MAX_ROLLS) : [],
    processedCommandIds: Array.isArray(raw.processedCommandIds)
      ? raw.processedCommandIds.slice(-100)
      : [],
  };
}

export function normalizePreferences(value: unknown): UserPreferences {
  return value && typeof value === "object"
    ? { ...DEFAULT_PREFERENCES, ...(value as Partial<UserPreferences>) }
    : { ...DEFAULT_PREFERENCES };
}

export function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function normalizeCharacter(character: TrackedCharacter): TrackedCharacter {
  const next = structuredClone(character);
  next.name = next.name.trim().slice(0, 80) || "Untitled character";
  next.hp.max = clampInt(next.hp.max, 0, 12);
  next.stress.max = clampInt(next.stress.max, 0, 12);
  next.armor.max = clampInt(next.armor.max, 0, 12);
  next.hope.max = clampInt(next.hope.max, 0, 6);
  next.hp.current = clampInt(next.hp.current, 0, next.hp.max);
  next.stress.current = clampInt(next.stress.current, 0, next.stress.max);
  next.armor.current = clampInt(next.armor.current, 0, next.armor.max);
  next.hope.current = clampInt(next.hope.current, 0, next.hope.max);
  next.evasion = clampInt(next.evasion, -999, 999);
  for (const trait of TRAITS) next.traits[trait] = clampInt(next.traits[trait], -999, 999);
  next.majorThreshold =
    next.majorThreshold === null ? null : clampInt(next.majorThreshold, 0, 999);
  next.severeThreshold =
    next.severeThreshold === null ? null : clampInt(next.severeThreshold, 0, 999);
  next.counters = next.counters.map((counter) => {
    const max = clampInt(counter.max, 1, 12);
    return {
      ...counter,
      name: counter.name.trim().slice(0, 40) || "Counter",
      max,
      current: clampInt(counter.current, 0, max),
    };
  });
  for (const bar of [next.bars.hp, next.bars.armor]) {
    bar.width = clampInt(bar.width, 80, 420);
    bar.offsetX = clampInt(bar.offsetX, -500, 500);
    bar.offsetY = clampInt(bar.offsetY, -500, 500);
  }
  return next;
}

export function applyMutation(state: SceneState, mutation: SceneMutation): SceneState {
  const next = structuredClone(state);
  switch (mutation.type) {
    case "SET_FEAR":
      next.fear = clampInt(mutation.fear, 0, 12);
      break;
    case "CREATE_TAKES_FORM": {
      if (next.takesForm) throw new Error("A Takes Form group is already active.");
      const amount = clampInt(mutation.amount, 1, 12);
      if (amount > next.fear) throw new Error("Not enough Fear is available.");
      next.fear -= amount;
      next.takesForm = { amount, createdAt: Date.now() };
      break;
    }
    case "DISMISS_TAKES_FORM":
      next.takesForm = null;
      break;
    case "ADD_COUNTDOWN":
      next.countdowns.push(normalizeCountdown(mutation.countdown, next.countdowns.length));
      break;
    case "PATCH_COUNTDOWN":
      next.countdowns = next.countdowns.map((countdown) =>
        countdown.id === mutation.id
          ? normalizeCountdown(
              { ...countdown, ...mutation.patch },
              mutation.patch.order ?? countdown.order,
            )
          : countdown,
      );
      break;
    case "REORDER_COUNTDOWN": {
      const index = next.countdowns.findIndex(({ id }) => id === mutation.id);
      const target = index + mutation.direction;
      if (index >= 0 && target >= 0 && target < next.countdowns.length) {
        const [moved] = next.countdowns.splice(index, 1);
        if (moved) next.countdowns.splice(target, 0, moved);
        next.countdowns = next.countdowns.map((countdown, order) => ({
          ...countdown,
          order,
        }));
      }
      break;
    }
    case "DELETE_COUNTDOWN":
      next.countdowns = next.countdowns
        .filter((countdown) => countdown.id !== mutation.id)
        .map((countdown, order) => ({ ...countdown, order }));
      break;
    case "TRACK_CHARACTER":
      if (next.characters.length >= MAX_CHARACTERS) {
        throw new Error(`This scene already tracks ${MAX_CHARACTERS} characters.`);
      }
      if (next.characters.some((character) => character.tokenId === mutation.character.tokenId)) {
        throw new Error("That token is already tracked.");
      }
      next.characters.push(normalizeCharacter(mutation.character));
      break;
    case "PATCH_CHARACTER":
      next.characters = next.characters.map((character) =>
        character.id === mutation.id
          ? normalizeCharacter({
              ...character,
              ...mutation.patch,
              revision: character.revision + 1,
            })
          : character,
      );
      break;
    case "UNTRACK_CHARACTER":
      next.characters = next.characters.filter((character) => character.id !== mutation.id);
      if (
        next.spotlight.type === "CHARACTER" &&
        next.spotlight.characterId === mutation.id
      ) {
        next.spotlight = { type: "GM", label: "GM" };
      }
      break;
    case "SET_SPOTLIGHT":
      next.spotlight = mutation.spotlight;
      break;
    case "TAKE_SPOTLIGHT": {
      if (mutation.expectedSpotlightRevision !== state.revision) {
        throw new Error("Someone else took the spotlight first.");
      }
      const character = next.characters.find(({ id }) => id === mutation.characterId);
      if (!character) throw new Error("That character is no longer tracked.");
      next.spotlight = {
        type: "CHARACTER",
        characterId: character.id,
        label: character.name,
      };
      break;
    }
    case "ADD_ROLL":
      next.rolls = [mutation.roll, ...next.rolls].slice(0, MAX_ROLLS);
      break;
    case "SET_DEFAULTS":
      next.defaults = normalizeCharacter(
        createCharacter("template", "Template", mutation.defaults),
      );
      next.defaults = {
        category: next.defaults.category,
        hp: next.defaults.hp,
        stress: next.defaults.stress,
        armor: next.defaults.armor,
        hope: next.defaults.hope,
        evasion: next.defaults.evasion,
        traits: next.defaults.traits,
        majorThreshold: next.defaults.majorThreshold,
        severeThreshold: next.defaults.severeThreshold,
        visibility: next.defaults.visibility,
      };
      break;
  }
  next.revision += 1;
  return next;
}

function normalizeCountdown(countdown: Countdown, order: number): Countdown {
  return {
    ...countdown,
    name: countdown.name.trim().slice(0, 60) || "Countdown",
    value: clampInt(countdown.value, 0, 99),
    order,
    revision: clampInt(countdown.revision, 0, Number.MAX_SAFE_INTEGER),
  };
}

const PLAYER_CHARACTER_PATCH_KEYS = new Set([
  "name",
  "category",
  "hp",
  "stress",
  "armor",
  "hope",
  "evasion",
  "traits",
  "majorThreshold",
  "severeThreshold",
  "visibility",
  "counters",
  "bars",
]);

export function authorizeCommand(
  state: SceneState,
  command: CommandEnvelope,
  sender: Player | undefined,
): string | null {
  if (!sender || sender.id !== command.senderPlayerId || sender.connectionId !== command.senderConnectionId) {
    return "The sender could not be verified.";
  }
  if (state.processedCommandIds.includes(command.id)) return "DUPLICATE";
  if (sender.role === "GM") return null;

  const mutation = command.mutation;
  if (mutation.type === "PATCH_CHARACTER") {
    const character = state.characters.find(({ id }) => id === mutation.id);
    if (!character || character.assigneeId !== sender.id) return "You cannot edit that character.";
    if (Object.keys(mutation.patch).some((key) => !PLAYER_CHARACTER_PATCH_KEYS.has(key))) {
      return "That character property is GM-only.";
    }
    return null;
  }
  if (mutation.type === "TAKE_SPOTLIGHT") {
    const character = state.characters.find(({ id }) => id === mutation.characterId);
    return character?.assigneeId === sender.id ? null : "You cannot take for that character.";
  }
  if (mutation.type === "ADD_ROLL") {
    const character = state.characters.find(({ id }) => id === mutation.roll.characterId);
    if (mutation.roll.visibility !== "PUBLIC" || mutation.roll.playerId !== sender.id) {
      return "Player rolls must be public.";
    }
    return character?.assigneeId === sender.id ? null : "You cannot roll for that character.";
  }
  return "Only a GM can make that change.";
}

export interface ParsedExpression {
  dice: { count: number; sides: number; sign: 1 | -1; notation: string }[];
  flatModifier: number;
  diceCount: number;
}

export function parseDiceExpression(expression: string): ParsedExpression {
  const compact = expression.replace(/\s+/g, "");
  if (!compact) return { dice: [], flatModifier: 0, diceCount: 0 };
  if (!/^[+-]?/.test(compact)) throw new Error("The dice expression is invalid.");

  const tokens = compact.match(/[+-]?[^+-]+/g) ?? [];
  if (tokens.join("") !== compact) throw new Error("The dice expression contains an invalid term.");

  const dice: ParsedExpression["dice"] = [];
  let flatModifier = 0;
  let diceCount = 0;
  for (const token of tokens) {
    const sign: 1 | -1 = token.startsWith("-") ? -1 : 1;
    const body = token.replace(/^[+-]/, "");
    const die = /^(\d*)d(\d+)$/i.exec(body);
    if (die) {
      const count = die[1] ? Number(die[1]) : 1;
      const sides = Number(die[2]);
      if (!Number.isInteger(count) || count < 1) throw new Error(`Invalid die count in “${token}”.`);
      if (![4, 6, 8, 10, 12, 20].includes(sides)) {
        throw new Error(`d${sides} is not supported.`);
      }
      diceCount += count;
      dice.push({ count, sides, sign, notation: `${sign < 0 ? "-" : ""}${count}d${sides}` });
      continue;
    }
    if (!/^\d+$/.test(body)) throw new Error(`Invalid term “${token}”.`);
    flatModifier += sign * Number(body);
  }
  return { dice, flatModifier, diceCount };
}

function randomDie(sides: number): number {
  const max = Math.floor(0x1_0000_0000 / sides) * sides;
  const values = new Uint32Array(1);
  do crypto.getRandomValues(values);
  while ((values[0] ?? 0) >= max);
  return ((values[0] ?? 0) % sides) + 1;
}

export interface RollInput {
  playerId: string;
  playerName: string;
  characterId: string;
  characterName: string;
  rollType: "ACTION" | "REACTION";
  visibility: "PUBLIC" | "PRIVATE";
  baseModifier: number;
  expression: string;
  advantage: "ADVANTAGE" | "DISADVANTAGE" | "NONE";
  difficulty: number | null;
}

export function performRoll(input: RollInput): RollRecord {
  const parsed = parseDiceExpression(input.expression);
  const advantageDice = input.advantage === "NONE" ? 0 : 1;
  if (parsed.diceCount + advantageDice + 2 > MAX_DICE) {
    throw new Error(`A roll can generate at most ${MAX_DICE} dice.`);
  }
  const hope = randomDie(12);
  const fear = randomDie(12);
  const terms: RollDieTerm[] = parsed.dice.map((term) => ({
    notation: term.notation,
    sign: term.sign,
    values: Array.from({ length: term.count }, () => randomDie(term.sides)),
  }));
  const advantageValue = input.advantage === "NONE" ? null : randomDie(6);
  const diceTotal = terms.reduce(
    (sum, term) => sum + term.sign * term.values.reduce((termSum, value) => termSum + value, 0),
    0,
  );
  const advantageTotal =
    advantageValue === null
      ? 0
      : input.advantage === "ADVANTAGE"
        ? advantageValue
        : -advantageValue;
  const total =
    hope + fear + input.baseModifier + parsed.flatModifier + diceTotal + advantageTotal;
  const critical = hope === fear;
  let outcome: string;
  if (critical) {
    outcome = "Critical Success";
  } else if (input.rollType === "REACTION") {
    outcome =
      input.difficulty === null
        ? `Reaction total ${total}`
        : total >= input.difficulty
          ? "Reaction Success"
          : "Reaction Failure";
  } else {
    const duality = hope > fear ? "Hope" : "Fear";
    outcome =
      input.difficulty === null
        ? `With ${duality}`
        : `${total >= input.difficulty ? "Success" : "Failure"} with ${duality}`;
  }
  return {
    id: crypto.randomUUID(),
    timestamp: Date.now(),
    playerId: input.playerId,
    playerName: input.playerName,
    characterId: input.characterId,
    characterName: input.characterName,
    rollType: input.rollType,
    visibility: input.visibility,
    hope,
    fear,
    terms,
    flatModifier: parsed.flatModifier + input.baseModifier,
    advantage: input.advantage,
    advantageValue,
    difficulty: input.difficulty,
    total,
    outcome,
  };
}
