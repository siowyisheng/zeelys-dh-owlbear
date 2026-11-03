import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Minus, Plus, Sparkles, Target, X } from "lucide-react";
import { getSession, initializeOwlbear, OBR, subscribeSession, updatePreferences } from "./owlbear";
import { UI_CHANNEL, type RollRecord, type Session, type UiMessage } from "./types";
import "./styles.css";

function useSession(): Session {
  const [session, setSession] = useState(getSession());
  useEffect(() => {
    void initializeOwlbear();
    return subscribeSession(setSession);
  }, []);
  return session;
}

export function Overlay() {
  const session = useSession();
  const [controls, setControls] = useState(false);
  const [latestRoll, setLatestRoll] = useState<RollRecord | null>(null);
  const preferences = session.preferences;
  const isGm = session.player?.role === "GM";
  const characters = session.state.characters.filter(
    ({ audience }) => audience === "EVERYONE" || isGm,
  );
  const move = (left: number, top: number) =>
    void updatePreferences({
      overlayLeft: Math.max(8, preferences.overlayLeft + left),
      overlayTop: Math.max(8, preferences.overlayTop + top),
    });
  const resize = (amount: number) =>
    void updatePreferences({
      overlayWidth: Math.max(280, Math.min(520, preferences.overlayWidth + amount)),
      overlayHeight: Math.max(180, Math.min(520, preferences.overlayHeight + amount)),
    });

  useEffect(() => {
    if (!session.embedded || !session.ready) return;
    let clearTimer = 0;
    const unsubscribe = OBR.broadcast.onMessage(UI_CHANNEL, (event) => {
      const message = event.data as UiMessage;
      if (message.type !== "PUBLIC_ROLL") return;
      setLatestRoll(message.roll);
      window.clearTimeout(clearTimer);
      clearTimer = window.setTimeout(() => setLatestRoll(null), 5_000);
    });
    return () => {
      window.clearTimeout(clearTimer);
      unsubscribe();
    };
  }, [session.embedded, session.ready]);

  return (
    <main className={`compact-overlay ${preferences.reducedMotion ? "reduce-motion" : ""}`}>
      <header className="overlay-header">
        <div>
          <Sparkles size={14} />
          <strong>Table Companion</strong>
        </div>
        <div className="overlay-actions">
          <button className="overlay-icon" aria-label="Move and resize overlay" onClick={() => setControls((value) => !value)}>
            <Target size={13} />
          </button>
          <button className="overlay-icon" aria-label="Hide overlay" onClick={() => void updatePreferences({ overlayEnabled: false })}>
            <X size={13} />
          </button>
        </div>
      </header>
      {controls && (
        <div className="overlay-controls" aria-label="Overlay position and size controls">
          <button aria-label="Move overlay left" onClick={() => move(-24, 0)}><ChevronLeft size={14} /></button>
          <button aria-label="Move overlay up" onClick={() => move(0, -24)}><ChevronUp size={14} /></button>
          <button aria-label="Move overlay down" onClick={() => move(0, 24)}><ChevronDown size={14} /></button>
          <button aria-label="Move overlay right" onClick={() => move(24, 0)}><ChevronRight size={14} /></button>
          <span />
          <button aria-label="Make overlay smaller" onClick={() => resize(-24)}><Minus size={14} /></button>
          <button aria-label="Make overlay larger" onClick={() => resize(24)}><Plus size={14} /></button>
        </div>
      )}
      {latestRoll && (
        <div className="overlay-roll" role="status" aria-live="polite">
          <div>
            <span>{latestRoll.characterName}</span>
            <strong>{latestRoll.outcome}</strong>
          </div>
          <b>{latestRoll.total}</b>
          <small>Hope {latestRoll.hope} · Fear {latestRoll.fear}</small>
        </div>
      )}
      <div className="overlay-hero">
        <div className="overlay-fear">
          <span>{session.state.fear}</span>
          <small>Fear</small>
        </div>
        <div className="overlay-spotlight">
          <span>✦ Spotlight</span>
          <strong>{session.state.spotlight.label}</strong>
        </div>
        {session.state.takesForm && (
          <div className="overlay-form">
            <strong>{session.state.takesForm.amount}</strong>
            <span>Takes Form</span>
          </div>
        )}
      </div>
      {session.state.countdowns.length > 0 && (
        <div className="overlay-countdowns">
          {session.state.countdowns.map((countdown) => (
            <div key={countdown.id} className={countdown.value === 0 ? "complete" : ""}>
              <span className={`shape-mark shape-${countdown.shape} color-${countdown.color}`} aria-hidden="true" />
              <span>{countdown.name}</span>
              <strong>{countdown.value}</strong>
            </div>
          ))}
        </div>
      )}
      <div className="overlay-characters">
        {characters.slice(0, 8).map((character) => (
          <div key={character.id}>
            <span>{character.name}</span>
            <span aria-label={`${character.hp.current} of ${character.hp.max} HP remaining`}>
              HP <strong>{character.hp.current}/{character.hp.max}</strong>
            </span>
            <span aria-label={`${character.stress.current} of ${character.stress.max} Stress marked`}>
              ST <strong>{character.stress.current}/{character.stress.max}</strong>
            </span>
          </div>
        ))}
        {characters.length > 8 && <small>+{characters.length - 8} more in the action panel</small>}
      </div>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Overlay />
  </StrictMode>,
);
