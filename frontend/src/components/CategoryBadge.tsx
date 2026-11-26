import { Bus, Droplets, HeartPulse, Trash2, Utensils, Zap } from 'lucide-react';
import { CATEGORY_MAP } from '../data/seed';
import { CategoryCode } from '../types/complaint';

export function CategoryIcon({
  category,
  size = 18,
}: {
  category: CategoryCode;
  size?: number;
}) {
  const color = CATEGORY_MAP[category].chipFg;
  switch (category) {
    case 'Water':
      return <Droplets size={size} color={color} aria-hidden="true" />;
    case 'Electricity':
      return <Zap size={size} color={color} aria-hidden="true" />;
    case 'Waste':
      return <Trash2 size={size} color={color} aria-hidden="true" />;
    case 'Road & Transport':
      return <Bus size={size} color={color} aria-hidden="true" />;
    case 'Healthcare':
      return <HeartPulse size={size} color={color} aria-hidden="true" />;
    case 'Food':
      return <Utensils size={size} color={color} aria-hidden="true" />;
  }
}

export function CategoryChip({
  category,
  showDot = false,
}: {
  category: CategoryCode;
  showDot?: boolean;
}) {
  const meta = CATEGORY_MAP[category];
  return (
    <span
      className="cat-chip"
      style={{
        backgroundColor: meta.chipBg,
        color: meta.chipFg,
      }}
    >
      {showDot && (
        <span
          aria-hidden="true"
          style={{
            width: 7,
            height: 7,
            borderRadius: '50%',
            backgroundColor: meta.dotColor,
          }}
        />
      )}
      {meta.nameEn}
    </span>
  );
}
