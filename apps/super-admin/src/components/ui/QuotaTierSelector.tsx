import React, { useState, useEffect } from 'react';

export interface QuotaTier {
  id: string;
  label: string;
  value: number;
}

export const DEFAULT_QUOTA_TIERS: QuotaTier[] = [
  { id: 'solo', label: 'Just you (1)', value: 1 },
  { id: 'small', label: '2 – 9', value: 10 },
  { id: 'growth', label: '10 – 99', value: 50 },
  { id: 'mid', label: '100 – 299', value: 100 },
  { id: 'enterprise', label: '300+ Enterprise tier', value: 300 },
];

interface QuotaTierSelectorProps {
  value: number;
  minAllowed?: number;
  maxAllowed?: number;
  onChange: (value: number) => void;
  disabled?: boolean;
  tiers?: QuotaTier[];
  label?: string;
  helperText?: string;
}

export const QuotaTierSelector: React.FC<QuotaTierSelectorProps> = ({
  value,
  minAllowed = 1,
  maxAllowed = 10000,
  onChange,
  disabled = false,
  tiers = DEFAULT_QUOTA_TIERS,
  label = 'Mailbox Quota Limit',
  helperText,
}) => {
  const [isCustom, setIsCustom] = useState(false);
  const [customInputVal, setCustomInputVal] = useState<string>(String(value || minAllowed));

  // Determine if value matches one of the preset tiers
  useEffect(() => {
    const matched = tiers.find((t) => t.value === value);
    if (!matched) {
      setIsCustom(true);
      setCustomInputVal(String(value));
    } else {
      setIsCustom(false);
    }
  }, [value, tiers]);

  const handleSelectPreset = (tier: QuotaTier) => {
    if (disabled || tier.value < minAllowed) return;
    setIsCustom(false);
    onChange(tier.value);
  };

  const handleSelectCustom = () => {
    if (disabled) return;
    setIsCustom(true);
    setCustomInputVal(String(value));
  };

  const handleCustomChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    setCustomInputVal(raw);
    const parsed = parseInt(raw, 10);
    if (!isNaN(parsed) && parsed >= 0) {
      onChange(parsed);
    }
  };

  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between">
        <label className="field-label mb-0 select-none">
          {label} <span className="text-red-500">*</span>
        </label>
        <span className="text-xs font-medium text-slate-500">
          Selected: <span className="font-semibold text-slate-800 tabular-nums">{value}</span> mailboxes
        </span>
      </div>

      {/* Selectable Buttons Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {tiers.map((tier) => {
          const isSelected = !isCustom && value === tier.value;
          const isOptionDisabled = disabled || tier.value < minAllowed;

          return (
            <button
              type="button"
              key={tier.id}
              disabled={isOptionDisabled}
              onClick={() => handleSelectPreset(tier)}
              className={`relative flex items-center justify-center p-3 rounded-lg text-xs cursor-pointer transition select-none ${
                isSelected
                  ? 'border-2 border-[#0f172a] bg-slate-50 font-semibold text-[#0f172a]'
                  : isOptionDisabled
                  ? 'border border-[#eaedf1] bg-slate-100/70 text-slate-400 cursor-not-allowed opacity-50'
                  : 'border border-[#eaedf1] bg-white hover:border-gray-300 font-medium text-[#334155]'
              }`}
              title={
                isOptionDisabled && tier.value < minAllowed
                  ? `Must be at least ${minAllowed} (current active mailboxes)`
                  : undefined
              }
            >
              <span>{tier.label}</span>
            </button>
          );
        })}

        {/* Custom Option Button */}
        <button
          type="button"
          disabled={disabled}
          onClick={handleSelectCustom}
          className={`relative flex items-center justify-center p-3 rounded-lg text-xs cursor-pointer transition select-none ${
            isCustom
              ? 'border-2 border-[#0f172a] bg-slate-50 font-semibold text-[#0f172a]'
              : 'border border-[#eaedf1] bg-white hover:border-gray-300 font-medium text-[#334155]'
          }`}
        >
          <span>Custom</span>
        </button>
      </div>

      {/* Custom Input Field when Custom is Active */}
      {isCustom && (
        <div className="pt-1">
          <input
            id="customMailboxLimit"
            type="number"
            min={minAllowed}
            max={maxAllowed}
            className="form-input text-sm h-10 w-full tabular-nums"
            placeholder={`Enter quota (min ${minAllowed})`}
            value={customInputVal}
            onChange={handleCustomChange}
            disabled={disabled}
            required
            autoFocus
          />
        </div>
      )}

      {/* Helper text */}
      <div className="text-[11px] text-slate-500 flex items-center justify-between">
        <span>
          {helperText || `Must be at least ${minAllowed} (current active mailboxes).`}
        </span>
        {minAllowed > 1 && (
          <span className="text-amber-600 font-medium">
            Min allowed: {minAllowed}
          </span>
        )}
      </div>
    </div>
  );
};
