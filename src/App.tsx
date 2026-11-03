import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  CircleDot,
  Clock3,
  Dices,
  Eye,
  EyeOff,
  Heart,
  Minus,
  Plus,
  Settings2,
  Shield,
  Sparkles,
  Target,
  Trash2,
  UserRound,
  UsersRound,
} from "lucide-react";
import {
  clampInt,
  createCharacter,
  performRoll,
  type RollInput,
} from "./domain";
import {
  getSelectedToken,
  getSession,
  initializeOwlbear,
  notify,
  requestMutation,
  subscribeSession,
  updatePreferences,
} from "./owlbear";
import {
  TRAITS,
  type BarConfig,
  type BoundedValue,
  type CharacterTemplate,
  type Countdown,
  type CounterColor,
  type CounterShape,
  type CustomCounter,
  type ResourceKey,
  type RollRecord,
  type Session,
  type Spotlight,
  type TrackedCharacter,
} from "./types";

const SHAPES: CounterShape[] = ["CIRCLE", "SQUARE", "DIAMOND", "HEXAGON"];
const COLORS: CounterColor[] = ["GOLD", "ROSE", "SKY", "MINT", "VIOLET"];

function useSession(): Session {
  const [session, setSession] = useState(getSession());
  useEffect(() => {
    void initializeOwlbear();
    return subscribeSession(setSession);
  }, []);
  return session;
}

async function mutate(mutation: Parameters<typeof requestMutation>[0]) {
  try {
    await requestMutation(mutation);
  } catch (error) {
    await notify(error instanceof Error ? error.message : "That change could not be requested.", "ERROR");
  }
}

function formatSigned(value: number) {
  return value >= 0 ? `+${value}` : String(value);
}

function Section({
  title,
  icon,
  badge,
  children,
  defaultOpen = true,
}: {
  title: string;
  icon: React.ReactNode;
  badge?: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="section-card">
      <button className="section-heading" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
        <span className="section-title">
          {icon}
          {title}
        </span>
        <span className="section-heading-right">
          {badge}
          {open ? <ChevronDown size={17} /> : <ChevronRight size={17} />}
        </span>
      </button>
      {open && <div className="section-body">{children}</div>}
    </section>
  );
}

function Stepper({
  label,
  value,
  min,
  max,
  disabled,
  onChange,
  compact = false,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  disabled?: boolean;
  onChange: (value: number) => void;
  compact?: boolean;
}) {
  return (
    <div className={`stepper ${compact ? "stepper-compact" : ""}`}>
      {!compact && <span className="stepper-label">{label}</span>}
      <button
        className="icon-button"
        aria-label={`Decrease ${label}`}
        disabled={disabled || value <= min}
        onClick={() => onChange(value - 1)}
      >
        <Minus size={14} />
      </button>
      <input
        aria-label={label}
        type="number"
        value={value}
        min={min}
        max={max}
        disabled={disabled}
        onChange={(event) => onChange(clampInt(Number(event.target.value), min, max))}
        onKeyDown={(event) => {
          if (event.key === "ArrowUp") onChange(Math.min(max, value + 1));
          if (event.key === "ArrowDown") onChange(Math.max(min, value - 1));
        }}
      />
      <button
        className="icon-button"
        aria-label={`Increase ${label}`}
        disabled={disabled || value >= max}
        onClick={() => onChange(value + 1)}
      >
        <Plus size={14} />
      </button>
    </div>
  );
}

function ResourcePips({
  label,
  value,
  mode,
  color,
}: {
  label: string;
  value: BoundedValue;
  mode: "remaining" | "accumulated";
  color: string;
}) {
  const semantic =
    mode === "accumulated"
      ? `${value.current} of ${value.max} ${label} marked`
      : `${value.current} of ${value.max} ${label} remaining`;
  return (
    <div className="pips" role="img" aria-label={semantic} title={semantic}>
      {Array.from({ length: value.max }, (_, index) => (
        <span
          key={index}
          className={`pip ${index < value.current ? "pip-filled" : ""}`}
          style={{ "--pip-color": color } as React.CSSProperties}
          aria-hidden="true"
        />
      ))}
      {value.max === 0 && <span className="zero-value">0</span>}
    </div>
  );
}

function ResourceEditor({
  label,
  value,
  resource,
  editable,
  onChange,
}: {
  label: string;
  value: BoundedValue;
  resource: ResourceKey;
  editable: boolean;
  onChange: (value: BoundedValue) => void;
}) {
  const maxLimit = resource === "hope" ? 6 : 12;
  const accumulated = resource === "stress";
  const colors: Record<ResourceKey, string> = {
    hp: "#dc7187",
    stress: "#a98ce0",
    armor: "#77c8d7",
    hope: "#f2c969",
  };
  return (
    <div className="resource-card">
      <div className="resource-topline">
        <span>{label}</span>
        <strong>
          {value.current}/{value.max}
        </strong>
      </div>
      <ResourcePips
        label={label}
        value={value}
        mode={accumulated ? "accumulated" : "remaining"}
        color={colors[resource]}
      />
      {editable && (
        <div className="resource-controls">
          <Stepper
            compact
            label={`${label} current`}
            value={value.current}
            min={0}
            max={value.max}
            onChange={(current) => onChange({ ...value, current })}
          />
          <label className="max-field">
            max
            <input
              type="number"
              min={0}
              max={maxLimit}
              value={value.max}
              onChange={(event) => {
                const max = clampInt(Number(event.target.value), 0, maxLimit);
                if (
                  max < value.current &&
                  !window.confirm(
                    `Reduce ${label} maximum to ${max}? Current will be clamped from ${value.current} to ${max}.`,
                  )
                ) {
                  return;
                }
                onChange({ current: Math.min(value.current, max), max });
              }}
            />
          </label>
        </div>
      )}
    </div>
  );
}

function FearPanel({ session }: { session: Session }) {
  const isGm = session.player?.role === "GM";
  const [formAmount, setFormAmount] = useState(1);
  const fear = session.state.fear;
  return (
    <Section
      title="Fear"
      icon={<Sparkles size={17} />}
      badge={<span className="value-badge">{fear}/12</span>}
    >
      <div className="fear-display">
        <div className="fear-orbit" aria-label={`${fear} of 12 Fear available`}>
          <span>{fear}</span>
          <small>available</small>
        </div>
        <div>
          <p className="muted">Shared scene pool</p>
          {isGm ? (
            <Stepper label="Fear" value={fear} min={0} max={12} onChange={(value) => void mutate({ type: "SET_FEAR", fear: value })} />
          ) : (
            <p className="permission-note">Only the GM can adjust Fear.</p>
          )}
        </div>
      </div>
      {session.state.takesForm ? (
        <div className="takes-form">
          <span className="shape-mark shape-HEXAGON color-ROSE" aria-hidden="true" />
          <div>
            <strong>Fear Takes Form</strong>
            <span>{session.state.takesForm.amount} Fear committed</span>
          </div>
          {isGm && (
            <button
              className="button button-danger button-small"
              onClick={() => {
                if (window.confirm("Dismiss this Takes Form group? Committed Fear will not be refunded.")) {
                  void mutate({ type: "DISMISS_TAKES_FORM" });
                }
              }}
            >
              Dismiss
            </button>
          )}
        </div>
      ) : (
        isGm && (
          <div className="inline-form">
            <Stepper
              label="Commit"
              value={Math.min(formAmount, Math.max(1, fear))}
              min={1}
              max={Math.max(1, fear)}
              disabled={fear === 0}
              onChange={setFormAmount}
            />
            <button
              className="button button-secondary"
              disabled={fear === 0}
              onClick={() => void mutate({ type: "CREATE_TAKES_FORM", amount: formAmount })}
            >
              Takes Form
            </button>
          </div>
        )
      )}
    </Section>
  );
}

function SpotlightPanel({ session }: { session: Session }) {
  const isGm = session.player?.role === "GM";
  const [freeform, setFreeform] = useState("");
  const visibleCharacters = session.state.characters.filter(
    ({ audience }) => audience === "EVERYONE" || isGm,
  );
  const own = visibleCharacters.filter(({ assigneeId }) => assigneeId === session.player?.id);
  const setSpotlight = (spotlight: Spotlight) => void mutate({ type: "SET_SPOTLIGHT", spotlight });
  return (
    <Section
      title="Spotlight"
      icon={<Target size={17} />}
      badge={<span className="text-badge">{session.state.spotlight.label}</span>}
    >
      <div className="spotlight-current">
        <span className="spotlight-glyph" aria-hidden="true">✦</span>
        <div>
          <span className="eyebrow">In focus</span>
          <strong>{session.state.spotlight.label}</strong>
        </div>
      </div>
      {own.map((character) => (
        <button
          className="button button-primary button-full"
          key={character.id}
          onClick={() =>
            void mutate({
              type: "TAKE_SPOTLIGHT",
              characterId: character.id,
              expectedSpotlightRevision: session.state.revision,
            })
          }
        >
          Take spotlight as {character.name}
        </button>
      ))}
      {isGm && (
        <div className="stack">
          <label>
            Assign spotlight
            <select
              value={
                session.state.spotlight.type === "CHARACTER"
                  ? session.state.spotlight.characterId
                  : session.state.spotlight.type
              }
              onChange={(event) => {
                if (event.target.value === "GM") setSpotlight({ type: "GM", label: "GM" });
                else {
                  const character = session.state.characters.find(({ id }) => id === event.target.value);
                  if (character) {
                    setSpotlight({
                      type: "CHARACTER",
                      characterId: character.id,
                      label: character.name,
                    });
                  }
                }
              }}
            >
              <option value="GM">GM</option>
              {visibleCharacters.map((character) => (
                <option value={character.id} key={character.id}>
                  {character.name}
                </option>
              ))}
              {session.state.spotlight.type === "FREEFORM" && (
                <option value="FREEFORM">{session.state.spotlight.label}</option>
              )}
            </select>
          </label>
          <div className="inline-form">
            <label className="grow">
              Adversary or label
              <input
                value={freeform}
                maxLength={60}
                placeholder="e.g. Glass Snake"
                onChange={(event) => setFreeform(event.target.value)}
              />
            </label>
            <button
              className="button button-secondary align-end"
              disabled={!freeform.trim()}
              onClick={() => {
                setSpotlight({ type: "FREEFORM", label: freeform.trim() });
                setFreeform("");
              }}
            >
              Set
            </button>
          </div>
        </div>
      )}
    </Section>
  );
}

function ShapeColorFields({
  shape,
  color,
  onShape,
  onColor,
}: {
  shape: CounterShape;
  color: CounterColor;
  onShape: (shape: CounterShape) => void;
  onColor: (color: CounterColor) => void;
}) {
  return (
    <div className="shape-color">
      <label>
        Shape
        <select value={shape} onChange={(event) => onShape(event.target.value as CounterShape)}>
          {SHAPES.map((value) => (
            <option value={value} key={value}>
              {value.toLowerCase()}
            </option>
          ))}
        </select>
      </label>
      <label>
        Color
        <select value={color} onChange={(event) => onColor(event.target.value as CounterColor)}>
          {COLORS.map((value) => (
            <option value={value} key={value}>
              {value.toLowerCase()}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

function CountdownsPanel({ session }: { session: Session }) {
  const isGm = session.player?.role === "GM";
  const [draft, setDraft] = useState({ name: "", value: 4, shape: "CIRCLE" as CounterShape, color: "GOLD" as CounterColor });
  return (
    <Section
      title="Countdowns"
      icon={<Clock3 size={17} />}
      badge={<span className="value-badge">{session.state.countdowns.length}</span>}
    >
      <div className="countdown-list">
        {session.state.countdowns.length === 0 && <p className="empty-state">No countdowns in this scene.</p>}
        {session.state.countdowns.map((countdown, index) => (
          <div className="countdown-block" key={countdown.id}>
            <div className={`countdown-row ${countdown.value === 0 ? "is-complete" : ""}`}>
              <span
                className={`shape-mark shape-${countdown.shape} color-${countdown.color}`}
                aria-hidden="true"
              />
              <div className="grow">
                <strong>{countdown.name}</strong>
                <span className="muted">{countdown.value === 0 ? "Complete · remains until removed" : `${countdown.value} remaining`}</span>
              </div>
              {isGm ? (
                <>
                  <Stepper
                    compact
                    label={`${countdown.name} value`}
                    value={countdown.value}
                    min={0}
                    max={99}
                    onChange={(value) =>
                      void mutate({ type: "PATCH_COUNTDOWN", id: countdown.id, patch: { value } })
                    }
                  />
                  <button
                    className="icon-button danger"
                    aria-label={`Delete ${countdown.name}`}
                    onClick={() => {
                      if (window.confirm(`Delete “${countdown.name}”?`)) {
                        void mutate({ type: "DELETE_COUNTDOWN", id: countdown.id });
                      }
                    }}
                  >
                    <Trash2 size={15} />
                  </button>
                </>
              ) : (
                <span className="countdown-number">{countdown.value}</span>
              )}
            </div>
            {isGm && (
              <div className="countdown-edit-row">
                <label className="grow">
                  Name
                  <input
                    value={countdown.name}
                    maxLength={60}
                    onChange={(event) =>
                      void mutate({
                        type: "PATCH_COUNTDOWN",
                        id: countdown.id,
                        patch: { name: event.target.value },
                      })
                    }
                  />
                </label>
                <ShapeColorFields
                  shape={countdown.shape}
                  color={countdown.color}
                  onShape={(shape) =>
                    void mutate({ type: "PATCH_COUNTDOWN", id: countdown.id, patch: { shape } })
                  }
                  onColor={(color) =>
                    void mutate({ type: "PATCH_COUNTDOWN", id: countdown.id, patch: { color } })
                  }
                />
                <div className="reorder-buttons">
                  <button
                    className="icon-button"
                    aria-label={`Move ${countdown.name} up`}
                    disabled={index === 0}
                    onClick={() =>
                      void mutate({ type: "REORDER_COUNTDOWN", id: countdown.id, direction: -1 })
                    }
                  >
                    ↑
                  </button>
                  <button
                    className="icon-button"
                    aria-label={`Move ${countdown.name} down`}
                    disabled={index === session.state.countdowns.length - 1}
                    onClick={() =>
                      void mutate({ type: "REORDER_COUNTDOWN", id: countdown.id, direction: 1 })
                    }
                  >
                    ↓
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
      {isGm && (
        <div className="editor-box">
          <h3>New countdown</h3>
          <label>
            Name
            <input
              value={draft.name}
              maxLength={60}
              placeholder="Ritual completes"
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            />
          </label>
          <div className="inline-form">
            <Stepper
              label="Starting value"
              value={draft.value}
              min={0}
              max={99}
              onChange={(value) => setDraft({ ...draft, value })}
            />
            <ShapeColorFields
              shape={draft.shape}
              color={draft.color}
              onShape={(shape) => setDraft({ ...draft, shape })}
              onColor={(color) => setDraft({ ...draft, color })}
            />
          </div>
          <button
            className="button button-secondary button-full"
            disabled={!draft.name.trim()}
            onClick={() => {
              const countdown: Countdown = {
                id: crypto.randomUUID(),
                name: draft.name,
                value: draft.value,
                shape: draft.shape,
                color: draft.color,
                order: session.state.countdowns.length,
                revision: 0,
              };
              void mutate({ type: "ADD_COUNTDOWN", countdown });
              setDraft({ ...draft, name: "" });
            }}
          >
            <Plus size={15} /> Add countdown
          </button>
        </div>
      )}
    </Section>
  );
}

function CounterEditor({
  counter,
  editable,
  onChange,
  onDelete,
}: {
  counter: CustomCounter;
  editable: boolean;
  onChange: (counter: CustomCounter) => void;
  onDelete: () => void;
}) {
  return (
    <div className="counter-card">
      <div className="counter-heading">
        <span className={`shape-mark shape-${counter.shape} color-${counter.color}`} aria-hidden="true" />
        {editable ? (
          <input
            aria-label="Counter name"
            value={counter.name}
            maxLength={40}
            onChange={(event) => onChange({ ...counter, name: event.target.value })}
          />
        ) : (
          <strong>{counter.name}</strong>
        )}
        {editable && (
          <button className="icon-button danger" aria-label={`Delete ${counter.name}`} onClick={onDelete}>
            <Trash2 size={14} />
          </button>
        )}
      </div>
      <ResourcePips label={counter.name} value={counter} mode="remaining" color={`var(--${counter.color.toLowerCase()})`} />
      <div className="counter-bottom">
        {editable ? (
          <>
            <Stepper
              compact
              label={`${counter.name} current`}
              value={counter.current}
              min={0}
              max={counter.max}
              onChange={(current) => onChange({ ...counter, current })}
            />
            <label className="max-field">
              max
              <input
                type="number"
                min={1}
                max={12}
                value={counter.max}
                onChange={(event) => {
                  const max = clampInt(Number(event.target.value), 1, 12);
                  onChange({ ...counter, max, current: Math.min(counter.current, max) });
                }}
              />
            </label>
          </>
        ) : (
          <span>{counter.current}/{counter.max}</span>
        )}
      </div>
      {editable && (
        <ShapeColorFields
          shape={counter.shape}
          color={counter.color}
          onShape={(shape) => onChange({ ...counter, shape })}
          onColor={(color) => onChange({ ...counter, color })}
        />
      )}
    </div>
  );
}

function BarEditor({
  name,
  value,
  onChange,
}: {
  name: string;
  value: BarConfig;
  onChange: (value: BarConfig) => void;
}) {
  return (
    <div className="bar-editor">
      <label className="check-label">
        <input
          type="checkbox"
          checked={value.enabled}
          onChange={(event) => onChange({ ...value, enabled: event.target.checked })}
        />
        {name} bar
      </label>
      {value.enabled && (
        <div className="bar-grid">
          <label>
            Width
            <input type="number" min={80} max={420} value={value.width} onChange={(event) => onChange({ ...value, width: clampInt(Number(event.target.value), 80, 420) })} />
          </label>
          <label>
            X offset
            <input type="number" min={-500} max={500} value={value.offsetX} onChange={(event) => onChange({ ...value, offsetX: clampInt(Number(event.target.value), -500, 500) })} />
          </label>
          <label>
            Y offset
            <input type="number" min={-500} max={500} value={value.offsetY} onChange={(event) => onChange({ ...value, offsetY: clampInt(Number(event.target.value), -500, 500) })} />
          </label>
        </div>
      )}
    </div>
  );
}

function CharacterCard({
  character,
  session,
  onlineIds,
  onRoll,
  defaultExpanded = false,
}: {
  character: TrackedCharacter;
  session: Session;
  onlineIds: Set<string>;
  onRoll: () => void;
  defaultExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const isGm = session.player?.role === "GM";
  const editable = isGm || character.assigneeId === session.player?.id;
  const players = [session.player, ...session.party].filter(
    (player): player is NonNullable<typeof player> => Boolean(player),
  );
  const patch = (value: Partial<TrackedCharacter>) =>
    void mutate({ type: "PATCH_CHARACTER", id: character.id, patch: value });
  const resource = (key: ResourceKey, value: BoundedValue) => patch({ [key]: value });

  return (
    <article className="character-card">
      <div className="character-summary">
        <button
          className="character-expand"
          aria-label={`${expanded ? "Collapse" : "Expand"} ${character.name}`}
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? <ChevronDown size={17} /> : <ChevronRight size={17} />}
        </button>
        <div className="avatar" aria-hidden="true">{character.name.slice(0, 1).toUpperCase()}</div>
        <div className="grow character-identity">
          <strong>{character.name}</strong>
          <span>
            {character.category} ·{" "}
            {character.assigneeName ?? "GM controlled"}
            {character.assigneeId && !onlineIds.has(character.assigneeId) ? " · offline" : ""}
          </span>
        </div>
        <div className="summary-stats">
          <span title="HP remaining"><Heart size={13} /> {character.hp.current}</span>
          <span title="Stress marked"><CircleDot size={13} /> {character.stress.current}</span>
        </div>
      </div>
      <div className="resource-grid">
        <ResourceEditor label="HP" value={character.hp} resource="hp" editable={editable} onChange={(value) => resource("hp", value)} />
        <ResourceEditor label="Stress" value={character.stress} resource="stress" editable={editable} onChange={(value) => resource("stress", value)} />
        {character.visibility.armor && <ResourceEditor label="Armor" value={character.armor} resource="armor" editable={editable} onChange={(value) => resource("armor", value)} />}
        {character.visibility.hope && <ResourceEditor label="Hope" value={character.hope} resource="hope" editable={editable} onChange={(value) => resource("hope", value)} />}
      </div>
      <div className="character-actions">
        <span className="evasion">Evasion <strong>{character.evasion}</strong></span>
        {editable && (
          <button className="button button-primary button-small" onClick={onRoll}>
            <Dices size={15} /> Roll
          </button>
        )}
        {character.assigneeId === session.player?.id && (
          <button
            className="button button-ghost button-small"
            onClick={() =>
              void mutate({
                type: "TAKE_SPOTLIGHT",
                characterId: character.id,
                expectedSpotlightRevision: session.state.revision,
              })
            }
          >
            <Target size={14} /> Take
          </button>
        )}
      </div>
      {expanded && (
        <div className="character-details">
          {editable && (
            <div className="field-grid">
              <label>
                Name
                <input value={character.name} maxLength={80} onChange={(event) => patch({ name: event.target.value })} />
              </label>
              <label>
                Category
                <input value={character.category} maxLength={30} onChange={(event) => patch({ category: event.target.value })} />
              </label>
              <label>
                Evasion
                <input type="number" value={character.evasion} onChange={(event) => patch({ evasion: Number(event.target.value) })} />
              </label>
            </div>
          )}
          {isGm && (
            <div className="field-grid">
              <label>
                Assigned player
                <select
                  value={character.assigneeId ?? ""}
                  onChange={(event) => {
                    const assignee = players.find(({ id }) => id === event.target.value);
                    patch({
                      assigneeId: assignee?.id ?? null,
                      assigneeName: assignee?.name ?? null,
                      audience: assignee ? "EVERYONE" : character.audience,
                    });
                  }}
                >
                  <option value="">Unassigned</option>
                  {players.map((player) => (
                    <option value={player.id} key={`${player.id}-${player.connectionId}`}>
                      {player.name} ({player.role.toLowerCase()})
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Audience
                <select
                  value={character.audience}
                  disabled={Boolean(character.assigneeId)}
                  onChange={(event) => patch({ audience: event.target.value as TrackedCharacter["audience"] })}
                >
                  <option value="EVERYONE">Everyone</option>
                  <option value="GM_ONLY">GM only</option>
                </select>
              </label>
            </div>
          )}
          {editable && (
            <div className="visibility-row">
              {(["armor", "hope", "traits", "thresholds"] as const).map((field) => (
                <label className="check-label" key={field}>
                  <input
                    type="checkbox"
                    checked={character.visibility[field]}
                    onChange={(event) =>
                      patch({ visibility: { ...character.visibility, [field]: event.target.checked } })
                    }
                  />
                  Show {field}
                </label>
              ))}
            </div>
          )}
          {character.visibility.traits && (
            <div className="traits-grid">
              {TRAITS.map((trait) => (
                <label key={trait}>
                  <span>{trait}</span>
                  {editable ? (
                    <input
                      type="number"
                      value={character.traits[trait]}
                      onChange={(event) =>
                        patch({ traits: { ...character.traits, [trait]: Number(event.target.value) } })
                      }
                    />
                  ) : (
                    <strong>{formatSigned(character.traits[trait])}</strong>
                  )}
                </label>
              ))}
            </div>
          )}
          {character.visibility.thresholds && (
            <div className="thresholds">
              {(["majorThreshold", "severeThreshold"] as const).map((key) => (
                <label key={key}>
                  {key === "majorThreshold" ? "Major" : "Severe"} threshold
                  {editable ? (
                    <input
                      type="number"
                      placeholder="Unset"
                      value={character[key] ?? ""}
                      onChange={(event) => patch({ [key]: event.target.value ? Number(event.target.value) : null })}
                    />
                  ) : (
                    <strong>{character[key] ?? "Unset"}</strong>
                  )}
                </label>
              ))}
              <p className="permission-note">Reference only. Thresholds never apply damage.</p>
            </div>
          )}
          <div className="counter-grid">
            {character.counters.map((counter) => (
              <CounterEditor
                key={counter.id}
                counter={counter}
                editable={editable}
                onChange={(nextCounter) =>
                  patch({
                    counters: character.counters.map((value) =>
                      value.id === counter.id ? nextCounter : value,
                    ),
                  })
                }
                onDelete={() =>
                  patch({ counters: character.counters.filter(({ id }) => id !== counter.id) })
                }
              />
            ))}
          </div>
          {editable && (
            <button
              className="button button-ghost button-small"
              onClick={() =>
                patch({
                  counters: [
                    ...character.counters,
                    {
                      id: crypto.randomUUID(),
                      name: "Counter",
                      current: 0,
                      max: 6,
                      color: "MINT",
                      shape: "DIAMOND",
                    },
                  ],
                })
              }
            >
              <Plus size={14} /> Custom counter
            </button>
          )}
          {editable && (
            <div className="bars-box">
              <h3>Token bars</h3>
              <p className="permission-note">Bars appear below the token and inherit this row’s audience.</p>
              <BarEditor name="HP" value={character.bars.hp} onChange={(hp) => patch({ bars: { ...character.bars, hp } })} />
              <BarEditor name="Armor" value={character.bars.armor} onChange={(armor) => patch({ bars: { ...character.bars, armor } })} />
            </div>
          )}
          {isGm && (
            <button
              className="button button-danger button-full"
              onClick={() => {
                if (
                  window.confirm(
                    `Untrack ${character.name}? All companion data for this character will be deleted. The Owlbear token will remain.`,
                  )
                ) {
                  void mutate({ type: "UNTRACK_CHARACTER", id: character.id });
                }
              }}
            >
              <Trash2 size={15} /> Untrack and delete companion data
            </button>
          )}
        </div>
      )}
    </article>
  );
}

function CharactersPanel({
  session,
  onRoll,
}: {
  session: Session;
  onRoll: (characterId: string) => void;
}) {
  const isGm = session.player?.role === "GM";
  const visible = session.state.characters.filter(
    ({ audience }) => audience === "EVERYONE" || isGm,
  );
  const onlineIds = new Set([session.player, ...session.party].filter(Boolean).map((player) => player!.id));
  const [selectedTokenName, setSelectedTokenName] = useState<string | null>(null);
  const [selectedTokenId, setSelectedTokenId] = useState<string | null>(null);
  const [pendingAction, setPendingAction] =
    useState<Session["preferences"]["pendingAction"]>(null);

  async function refreshSelection() {
    const token = await getSelectedToken();
    setSelectedTokenId(token?.id ?? null);
    setSelectedTokenName(token?.name ?? null);
  }

  useEffect(() => {
    const contextAction = session.preferences.pendingAction;
    void getSelectedToken().then((token) => {
      setSelectedTokenId(token?.id ?? null);
      setSelectedTokenName(token?.name ?? null);
      if (contextAction) setPendingAction(contextAction);
      const character = session.state.characters.find(({ tokenId }) => tokenId === token?.id);
      if (contextAction === "ROLL" && character) onRoll(character.id);
    });
  }, [
    onRoll,
    session.preferences.pendingAction,
    session.preferences.pendingTokenId,
    session.player?.selection,
    session.state.characters,
  ]);

  const selectedTracked = session.state.characters.find(({ tokenId }) => tokenId === selectedTokenId);

  return (
    <Section
      title="Characters"
      icon={<UsersRound size={17} />}
      badge={<span className="value-badge">{session.state.characters.length}/40</span>}
    >
      {isGm && (
        <div className="selection-card">
          <div>
            <span className="eyebrow">Selected token</span>
            <strong>{selectedTokenName ?? "None selected"}</strong>
          </div>
          <button className="button button-ghost button-small" onClick={() => void refreshSelection()}>
            Refresh
          </button>
          {selectedTokenId && !selectedTracked && (
            <button
              className="button button-primary button-small"
              disabled={session.state.characters.length >= 40}
              onClick={() => {
                const character = createCharacter(
                  selectedTokenId,
                  selectedTokenName ?? "Untitled character",
                  session.state.defaults,
                );
                const accepted = window.confirm(
                  `Track “${character.name}” with these initial values?\n\n` +
                    `HP ${character.hp.current}/${character.hp.max} · ` +
                    `Stress ${character.stress.current}/${character.stress.max} · ` +
                    `Armor ${character.armor.current}/${character.armor.max} · ` +
                    `Hope ${character.hope.current}/${character.hope.max} · ` +
                    `Evasion ${character.evasion}`,
                );
                if (!accepted) return;
                void mutate({ type: "TRACK_CHARACTER", character });
              }}
            >
              <Plus size={14} /> Track token
            </button>
          )}
          {selectedTracked && <span className="status-chip success">Tracked as {selectedTracked.name}</span>}
        </div>
      )}
      <div className="character-list">
        {visible.length === 0 && (
          <div className="empty-state illustrated">
            <UserRound size={26} />
            <strong>No visible characters</strong>
            <span>{isGm ? "Select a token and track it to begin." : "The GM has not shared a character yet."}</span>
          </div>
        )}
        {visible.map((character) => (
          <CharacterCard
            key={`${character.id}-${character.tokenId === selectedTokenId ? pendingAction : "idle"}`}
            character={character}
            session={session}
            onlineIds={onlineIds}
            onRoll={() => onRoll(character.id)}
            defaultExpanded={
              character.tokenId === selectedTokenId &&
              pendingAction !== null &&
              pendingAction !== "ROLL"
            }
          />
        ))}
      </div>
    </Section>
  );
}

function RollCard({ roll, privateRoll = false }: { roll: RollRecord; privateRoll?: boolean }) {
  return (
    <article className={`roll-card ${privateRoll ? "private" : ""}`}>
      <div className="roll-heading">
        <div>
          <strong>{roll.characterName}</strong>
          <span>{roll.playerName} · {roll.rollType.toLowerCase()}</span>
        </div>
        <span className="roll-total">{roll.total}</span>
      </div>
      <div className="duality">
        <span className="hope-die"><small>Hope</small>{roll.hope}</span>
        <span className="fear-die"><small>Fear</small>{roll.fear}</span>
        <strong>{roll.outcome}</strong>
      </div>
      <div className="roll-detail">
        {roll.difficulty !== null && <span>Difficulty {roll.difficulty}</span>}
        {roll.advantageValue !== null && (
          <span>
            {roll.advantage === "ADVANTAGE" ? "+" : "−"}d6: {roll.advantageValue}
          </span>
        )}
        {roll.terms.map((term, index) => (
          <span key={`${term.notation}-${index}`}>{term.notation}: {term.values.join(", ")}</span>
        ))}
        {roll.flatModifier !== 0 && <span>Modifier {formatSigned(roll.flatModifier)}</span>}
        {privateRoll && <span className="private-label"><EyeOff size={12} /> Private · ephemeral</span>}
      </div>
    </article>
  );
}

function DicePanel({
  session,
  selectedId,
  onSelected,
}: {
  session: Session;
  selectedId: string | null;
  onSelected: (id: string | null) => void;
}) {
  const isGm = session.player?.role === "GM";
  const rollable = session.state.characters.filter(
    (character) => isGm || character.assigneeId === session.player?.id,
  );
  const character = rollable.find(({ id }) => id === selectedId) ?? rollable[0];
  const [rollType, setRollType] = useState<RollInput["rollType"]>("ACTION");
  const [visibility, setVisibility] = useState<RollInput["visibility"]>("PUBLIC");
  const [trait, setTrait] = useState<string>("none");
  const [baseModifier, setBaseModifier] = useState(0);
  const [expression, setExpression] = useState("");
  const [hasAdvantage, setHasAdvantage] = useState(false);
  const [hasDisadvantage, setHasDisadvantage] = useState(false);
  const [difficulty, setDifficulty] = useState("");
  const [privateRolls, setPrivateRolls] = useState<RollRecord[]>([]);
  const [rollError, setRollError] = useState<string | null>(null);

  function roll() {
    if (!character || !session.player) return;
    try {
      const traitModifier =
        trait === "none" ? 0 : character.traits[trait as keyof typeof character.traits];
      const advantage: RollInput["advantage"] =
        hasAdvantage === hasDisadvantage
          ? "NONE"
          : hasAdvantage
            ? "ADVANTAGE"
            : "DISADVANTAGE";
      const result = performRoll({
        playerId: session.player.id,
        playerName: session.player.name,
        characterId: character.id,
        characterName: character.name,
        rollType,
        visibility: isGm ? visibility : "PUBLIC",
        baseModifier: baseModifier + traitModifier,
        expression,
        advantage,
        difficulty: difficulty === "" ? null : Number(difficulty),
      });
      setRollError(null);
      if (result.visibility === "PRIVATE") setPrivateRolls((rolls) => [result, ...rolls]);
      else void mutate({ type: "ADD_ROLL", roll: result });
    } catch (error) {
      setRollError(error instanceof Error ? error.message : "The roll could not be parsed.");
    }
  }

  return (
    <Section
      title="Duality Dice"
      icon={<Dices size={17} />}
      badge={<span className="text-badge">2d12</span>}
    >
      {rollable.length === 0 ? (
        <p className="empty-state">You do not have a character available to roll.</p>
      ) : (
        <div className="roll-composer">
          <div className="field-grid">
            <label>
              Character
              <select value={character?.id ?? ""} onChange={(event) => onSelected(event.target.value)}>
                {rollable.map((value) => (
                  <option value={value.id} key={value.id}>{value.name}</option>
                ))}
              </select>
            </label>
            <label>
              Roll type
              <select value={rollType} onChange={(event) => setRollType(event.target.value as RollInput["rollType"])}>
                <option value="ACTION">Action</option>
                <option value="REACTION">Reaction</option>
              </select>
            </label>
            {isGm && (
              <label>
                Audience
                <select value={visibility} onChange={(event) => setVisibility(event.target.value as RollInput["visibility"])}>
                  <option value="PUBLIC">Public</option>
                  <option value="PRIVATE">Private · this device only</option>
                </select>
              </label>
            )}
            <label>
              Trait
              <select value={trait} onChange={(event) => setTrait(event.target.value)}>
                <option value="none">No trait (+0)</option>
                {TRAITS.map((value) => (
                  <option value={value} key={value}>
                    {value[0]?.toUpperCase()}{value.slice(1)} ({formatSigned(character!.traits[value])})
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label>
            Additional dice and modifiers
            <input
              value={expression}
              placeholder="e.g. 2d8 - d4 + 3"
              onChange={(event) => setExpression(event.target.value)}
            />
          </label>
          <div className="field-grid">
            <label>
              Base modifier
              <input
                type="number"
                value={baseModifier}
                onChange={(event) => setBaseModifier(Number(event.target.value))}
              />
            </label>
            <label>
              Difficulty (optional)
              <input
                type="number"
                value={difficulty}
                placeholder="Unset"
                onChange={(event) => setDifficulty(event.target.value)}
              />
            </label>
          </div>
          <div className="visibility-row">
            <label className="check-label">
              <input
                type="checkbox"
                checked={hasAdvantage}
                onChange={(event) => setHasAdvantage(event.target.checked)}
              />
              Advantage · add d6
            </label>
            <label className="check-label">
              <input
                type="checkbox"
                checked={hasDisadvantage}
                onChange={(event) => setHasDisadvantage(event.target.checked)}
              />
              Disadvantage · subtract d6
            </label>
          </div>
          {hasAdvantage && hasDisadvantage && (
            <p className="info-banner">Advantage and disadvantage cancel; no d6 will be rolled.</p>
          )}
          {rollType === "REACTION" && (
            <p className="info-banner">Reaction rolls suppress Hope and Fear in the outcome.</p>
          )}
          {rollError && <p className="error-banner" role="alert">{rollError}</p>}
          <button className="button button-primary button-full roll-button" onClick={roll}>
            <Dices size={17} />
            Roll {isGm && visibility === "PRIVATE" ? "privately" : "publicly"}
          </button>
          <p className="permission-note">
            Rolls report results only. They never change Hope, Fear, Stress, HP, Armor, countdowns, or spotlight.
          </p>
        </div>
      )}
      {privateRolls.length > 0 && (
        <div className="private-rolls">
          <h3>Private rolls · cleared on reload</h3>
          {privateRolls.map((roll) => <RollCard key={roll.id} roll={roll} privateRoll />)}
        </div>
      )}
    </Section>
  );
}

function RollHistory({ session }: { session: Session }) {
  return (
    <Section
      title="Public rolls"
      icon={<Eye size={17} />}
      badge={<span className="value-badge">{session.state.rolls.length}/20</span>}
      defaultOpen={false}
    >
      <div className="roll-list">
        {session.state.rolls.length === 0 && <p className="empty-state">No public rolls in this scene.</p>}
        {session.state.rolls.map((roll) => <RollCard key={roll.id} roll={roll} />)}
      </div>
    </Section>
  );
}

function DefaultsPanel({ session }: { session: Session }) {
  const [draft, setDraft] = useState<CharacterTemplate>(session.state.defaults);
  if (session.player?.role !== "GM") return null;
  return (
    <Section title="Scene defaults" icon={<Settings2 size={17} />} defaultOpen={false}>
      <p className="permission-note">Applied only to newly tracked characters.</p>
      <div className="resource-grid">
        {(["hp", "stress", "armor", "hope"] as ResourceKey[]).map((resource) => (
          <ResourceEditor
            key={resource}
            label={resource[0]!.toUpperCase() + resource.slice(1)}
            value={draft[resource]}
            resource={resource}
            editable
            onChange={(value) => setDraft({ ...draft, [resource]: value })}
          />
        ))}
      </div>
      <div className="field-grid">
        <label>
          Category
          <input
            value={draft.category}
            maxLength={30}
            onChange={(event) => setDraft({ ...draft, category: event.target.value })}
          />
        </label>
        <label>
          Evasion
          <input type="number" value={draft.evasion} onChange={(event) => setDraft({ ...draft, evasion: Number(event.target.value) })} />
        </label>
        <label>
          Major threshold
          <input
            type="number"
            placeholder="Unset"
            value={draft.majorThreshold ?? ""}
            onChange={(event) =>
              setDraft({
                ...draft,
                majorThreshold: event.target.value ? Number(event.target.value) : null,
              })
            }
          />
        </label>
        <label>
          Severe threshold
          <input
            type="number"
            placeholder="Unset"
            value={draft.severeThreshold ?? ""}
            onChange={(event) =>
              setDraft({
                ...draft,
                severeThreshold: event.target.value ? Number(event.target.value) : null,
              })
            }
          />
        </label>
        {TRAITS.map((trait) => (
          <label key={trait}>
            {trait}
            <input
              type="number"
              value={draft.traits[trait]}
              onChange={(event) => setDraft({ ...draft, traits: { ...draft.traits, [trait]: Number(event.target.value) } })}
            />
          </label>
        ))}
      </div>
      <div className="visibility-row">
        {(["armor", "hope", "traits", "thresholds"] as const).map((field) => (
          <label className="check-label" key={field}>
            <input
              type="checkbox"
              checked={draft.visibility[field]}
              onChange={(event) => setDraft({ ...draft, visibility: { ...draft.visibility, [field]: event.target.checked } })}
            />
            Show {field}
          </label>
        ))}
      </div>
      <button className="button button-primary button-full" onClick={() => void mutate({ type: "SET_DEFAULTS", defaults: draft })}>
        Save defaults
      </button>
    </Section>
  );
}

function PreferencesPanel({ session }: { session: Session }) {
  return (
    <Section title="Display" icon={<Settings2 size={17} />} defaultOpen={false}>
      <label className="check-label">
        <input
          type="checkbox"
          checked={session.preferences.overlayEnabled}
          onChange={(event) => void updatePreferences({ overlayEnabled: event.target.checked })}
        />
        Show compact scene overlay
      </label>
      <label className="check-label">
        <input
          type="checkbox"
          checked={
            session.preferences.reducedMotion ??
            window.matchMedia("(prefers-reduced-motion: reduce)").matches
          }
          onChange={(event) => void updatePreferences({ reducedMotion: event.target.checked })}
        />
        Reduce motion
      </label>
      <label className="check-label">
        <input
          type="checkbox"
          checked={session.preferences.dense}
          onChange={(event) => void updatePreferences({ dense: event.target.checked })}
        />
        Compact panel density
      </label>
      <p className="permission-note">Overlay position and size can be adjusted from the overlay itself.</p>
    </Section>
  );
}

export default function App() {
  const session = useSession();
  const [rollCharacterId, setRollCharacterId] = useState<string | null>(null);
  const chooseRollCharacter = useCallback((characterId: string) => {
    setRollCharacterId(characterId);
    window.requestAnimationFrame(() =>
      document
        .getElementById("duality-dice")
        ?.scrollIntoView({ behavior: session.preferences.reducedMotion ? "auto" : "smooth" }),
    );
  }, [session.preferences.reducedMotion]);
  const authorityOnline = useMemo(() => {
    const authority = session.state.authority;
    if (!authority) return false;
    return [session.player, ...session.party].some(
      (player) => player?.connectionId === authority.connectionId,
    );
  }, [session.party, session.player, session.state.authority]);

  if (!session.ready) {
    return (
      <main className="loading-screen">
        <div className="brand-mark"><Sparkles size={24} /></div>
        <strong>Joining the table…</strong>
      </main>
    );
  }

  return (
    <main
      className={`app-shell ${session.preferences.dense ? "is-dense" : ""} ${
        session.preferences.reducedMotion ? "reduce-motion" : ""
      }`}
    >
      <header className="app-header">
        <div className="brand-lockup">
          <div className="brand-mark"><Sparkles size={18} /></div>
          <div>
            <span>Daggerheart</span>
            <strong>Table Companion</strong>
          </div>
        </div>
        <span className={`connection-dot ${session.sceneReady && authorityOnline ? "online" : ""}`}>
          {session.sceneReady ? (authorityOnline ? "Synced" : "Waiting for GM") : "No scene"}
        </span>
      </header>

      {!session.embedded && (
        <div className="info-banner">
          Preview mode. Load the manifest in Owlbear Rodeo to synchronize a scene.
        </div>
      )}
      {session.embedded && !session.sceneReady && (
        <div className="empty-stage">
          <Target size={30} />
          <h1>Open an Owlbear scene</h1>
          <p>Companion state is stored per scene and becomes available when the scene is ready.</p>
        </div>
      )}
      {session.error && <div className="error-banner" role="alert">{session.error}</div>}

      {(!session.embedded || session.sceneReady) && (
        <div className="section-stack">
          <div className="scene-overview">
            <div>
              <span className="eyebrow">Fear</span>
              <strong>{session.state.fear}<small>/12</small></strong>
            </div>
            <div>
              <span className="eyebrow">Spotlight</span>
              <strong className="overview-label">{session.state.spotlight.label}</strong>
            </div>
            <div>
              <span className="eyebrow">Next countdown</span>
              <strong>
                {session.state.countdowns.length
                  ? Math.min(...session.state.countdowns.map(({ value }) => value))
                  : "—"}
              </strong>
            </div>
          </div>
          {session.embedded && !authorityOnline && (
            <p className="error-banner" role="status">
              Shared controls are read-only until a GM authority is connected.
            </p>
          )}
          <fieldset
            className="shared-controls"
            disabled={session.embedded && !authorityOnline}
            aria-label="Shared scene controls"
          >
            <FearPanel session={session} />
            <SpotlightPanel session={session} />
            <CountdownsPanel session={session} />
            <CharactersPanel session={session} onRoll={chooseRollCharacter} />
            <div id="duality-dice">
              <DicePanel
                session={session}
                selectedId={rollCharacterId}
                onSelected={setRollCharacterId}
              />
            </div>
            <RollHistory session={session} />
            <DefaultsPanel session={session} />
          </fieldset>
          <PreferencesPanel session={session} />
        </div>
      )}

      <footer>
        <Shield size={13} />
        Cooperative table authority · scene-local state
      </footer>
    </main>
  );
}
