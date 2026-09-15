import { useState } from "react";
import "./SettingsModal.css";

export const DEFAULT_PALETTE = ["#1e1e1e", "#e03131", "#2f9e44", "#1971c2", "#f08c00", "#9c36b5"];
export const DEFAULT_BACKGROUND = "#ffffff";

const HEX_COLOR_REGEX = /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

function normalizeHex(value: string): string {
  const trimmed = value.trim();
  return trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
}

type SettingsModalProps = {
  palette: string[];
  background: string;
  onChangePalette: (palette: string[]) => void;
  onChangeBackground: (background: string) => void;
  onClose: () => void;
};

export function SettingsModal({ palette, background, onChangePalette, onChangeBackground, onClose }: SettingsModalProps) {
  const [paletteInputs, setPaletteInputs] = useState(palette);
  const [backgroundInput, setBackgroundInput] = useState(background);

  const isValidHex = (value: string) => HEX_COLOR_REGEX.test(value.trim());

  const handlePaletteChange = (index: number, value: string) => {
    const next = paletteInputs.slice();
    next[index] = value;
    setPaletteInputs(next);
    if (isValidHex(value)) {
      const applied = palette.slice();
      applied[index] = normalizeHex(value);
      onChangePalette(applied);
    }
  };

  const handleBackgroundChange = (value: string) => {
    setBackgroundInput(value);
    if (isValidHex(value)) {
      onChangeBackground(normalizeHex(value));
    }
  };

  const handleReset = () => {
    setPaletteInputs(DEFAULT_PALETTE);
    setBackgroundInput(DEFAULT_BACKGROUND);
    onChangePalette(DEFAULT_PALETTE);
    onChangeBackground(DEFAULT_BACKGROUND);
  };

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <h2>Settings</h2>
          <button className="settings-close" onClick={onClose} title="Close">
            ✕
          </button>
        </div>

        <div className="settings-section">
          <h3>Palette colors</h3>
          {paletteInputs.map((value, i) => (
            <label key={i} className="settings-row">
              <span className="settings-swatch-preview" style={{ background: isValidHex(value) ? normalizeHex(value) : "transparent" }} />
              <input
                type="text"
                value={value}
                spellCheck={false}
                onChange={(e) => handlePaletteChange(i, e.target.value)}
                className={isValidHex(value) ? "settings-input" : "settings-input invalid"}
                placeholder="rrggbb or #rrggbb"
              />
            </label>
          ))}
        </div>

        <div className="settings-section">
          <h3>Whiteboard background</h3>
          <label className="settings-row">
            <span
              className="settings-swatch-preview"
              style={{ background: isValidHex(backgroundInput) ? normalizeHex(backgroundInput) : "transparent" }}
            />
            <input
              type="text"
              value={backgroundInput}
              spellCheck={false}
              onChange={(e) => handleBackgroundChange(e.target.value)}
              className={isValidHex(backgroundInput) ? "settings-input" : "settings-input invalid"}
              placeholder="rrggbb or #rrggbb"
            />
          </label>
        </div>

        <button className="settings-reset" onClick={handleReset}>
          Reset to defaults
        </button>
      </div>
    </div>
  );
}
