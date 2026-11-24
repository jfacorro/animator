import { useEffect, useState } from 'react';
import { ACTIONS, assignKey, DEFAULT_KEYMAP, displayKey, FIXED, isReserved, keyOf, type ActionId, type Keymap } from '../keys';
import * as I from './Icons';

interface Props {
  keymap: Keymap;
  onChange: (keymap: Keymap) => void;
  onClose: () => void;
}

const GROUPS = ['Tools', 'Frames', 'Drawing', 'View'] as const;

/** See every keyboard shortcut and change the ones that can be changed. */
export function ShortcutsDialog({ keymap, onChange, onClose }: Props) {
  /** The action waiting for its new key. */
  const [recording, setRecording] = useState<ActionId | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    // Capture runs before the app's own shortcuts, so a key pressed here only lands here.
    const onKey = (e: KeyboardEvent) => {
      if (!recording) {
        if (e.key === 'Escape') { e.stopImmediatePropagation(); onClose(); }
        return;
      }
      e.preventDefault();
      e.stopImmediatePropagation();
      const label = ACTIONS.find((a) => a.id === recording)!.label;
      if (e.key === 'Escape') { setRecording(null); setNote(null); return; }
      if (e.key === 'Backspace' || e.key === 'Delete') {
        onChange({ ...keymap, [recording]: '' });
        setNote(`${label} has no key now.`);
        setRecording(null);
        return;
      }
      const key = keyOf(e);
      if (!key) return; // a modifier on its own: wait for the real key
      if (isReserved(key)) { setNote(`${displayKey(key)} keeps its own job. Pick another key.`); return; }
      const { map, displaced } = assignKey(keymap, recording, key);
      onChange(map);
      setNote(displaced
        ? `${displayKey(key)} is now ${label}. ${ACTIONS.find((a) => a.id === displaced)!.label} has no key now.`
        : `${displayKey(key)} is now ${label}.`);
      setRecording(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [recording, keymap, onChange, onClose]);

  const changed = ACTIONS.some((a) => keymap[a.id] !== DEFAULT_KEYMAP[a.id]);

  return (
    <div className="backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dialog shortcuts" role="dialog" aria-modal="true" aria-labelledby="keys-title">
        <div className="dialog-head">
          <h2 id="keys-title">Keyboard shortcuts</h2>
          <button className="icon-btn" aria-label="Close" title="Close (Esc)" onClick={onClose}><I.Close /></button>
        </div>
        <p className="keys-intro muted">
          Click a key to change it, then press the new key. Backspace removes it, Esc cancels. Your keys are kept in this browser.
        </p>
        <div className="keys-grid">
          {GROUPS.map((g) => (
            <section key={g}>
              <h3>{g}</h3>
              {ACTIONS.filter((a) => a.group === g).map((a) => (
                <div className="key-row" key={a.id}>
                  <span>{a.label}</span>
                  <button
                    className={`key-btn${recording === a.id ? ' recording' : ''}${keymap[a.id] !== a.key ? ' changed' : ''}`}
                    aria-label={`${a.label}: ${keymap[a.id] ? displayKey(keymap[a.id]) : 'no key'}. Click to change.`}
                    title={keymap[a.id] !== a.key ? `Changed. The original key is ${displayKey(a.key)}.` : 'Click, then press a key'}
                    onClick={() => { setRecording(recording === a.id ? null : a.id); setNote(null); }}
                  >
                    {recording === a.id ? 'Press a key…' : displayKey(keymap[a.id])}
                  </button>
                </div>
              ))}
            </section>
          ))}
          <section>
            <h3>Fixed</h3>
            {FIXED.map((f) => (
              <div className="key-row" key={f.keys}>
                <span>{f.label}</span>
                <kbd>{f.keys}</kbd>
              </div>
            ))}
          </section>
        </div>
        <div className="dialog-foot">
          {note && <span className="keys-note" role="status">{note}</span>}
          <button className="btn" disabled={!changed} title="Go back to the original keys" onClick={() => { onChange(DEFAULT_KEYMAP); setNote('Back to the original keys.'); }}>Reset all</button>
          <button className="btn primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}
