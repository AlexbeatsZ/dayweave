import { Check } from 'lucide-react';
import { colors } from '../model';

export function ColorPicker({
  value,
  onChange,
  label = '颜色',
}: {
  value: string;
  onChange: (color: string) => void;
  label?: string;
}) {
  return (
    <div className="color-picker">
      <div className="color-choices">
        {colors.map((color) => (
          <button
            type="button"
            key={color}
            aria-label={`${label} ${color}`}
            className={value === color ? 'selected-color' : ''}
            style={{ background: color }}
            onClick={() => onChange(color)}
          >
            {value === color && <Check size={15} />}
          </button>
        ))}
      </div>
      <label className="custom-color">
        自定义颜色
        <input
          type="color"
          aria-label={`自定义${label}`}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
        <span>{value}</span>
      </label>
    </div>
  );
}
