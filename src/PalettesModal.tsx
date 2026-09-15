import "./PalettesModal.css";

const BLACK = "#1e1e1e";

export type Preset = {
  name: string;
  colors: string[];
};

export const PRESET_PALETTES: Preset[] = [
  {
    name: "Sunset",
    colors: [BLACK, "#DF301C", "#FF9100", "#FFF1D1", "#00B7CD", "#DE3E3E"],
  },
];

type PalettesModalProps = {
  onSelectPreset: (colors: string[]) => void;
  onClose: () => void;
};

export function PalettesModal({ onSelectPreset, onClose }: PalettesModalProps) {
  return (
    <div className="palettes-overlay" onClick={onClose}>
      <div className="palettes-modal" onClick={(e) => e.stopPropagation()}>
        <div className="palettes-header">
          <h2>Palettes</h2>
          <button className="palettes-close" onClick={onClose} title="Close">
            ✕
          </button>
        </div>

        <div className="palettes-list">
          {PRESET_PALETTES.map((preset) => (
            <button
              key={preset.name}
              className="palettes-preset"
              onClick={() => {
                onSelectPreset(preset.colors);
                onClose();
              }}
            >
              <div className="palettes-preset-swatches">
                {preset.colors.map((c, i) => (
                  <span key={i} className="palettes-preset-swatch" style={{ background: c }} />
                ))}
              </div>
              <span className="palettes-preset-name">{preset.name}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
