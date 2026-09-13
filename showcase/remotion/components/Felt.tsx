import { C } from '../theme';

/** The game's table: a radial felt with a faint diagonal weave. `dark` is the night-table variant. */
export const Felt: React.FC<{ dark?: boolean }> = ({ dark }) => {
  const a = dark ? C.feltDark : C.felt;
  const b = dark ? C.feltDark2 : C.felt2;
  return (
    <div style={{ position: 'absolute', inset: 0, background: `radial-gradient(100% 80% at 50% 30%, ${a} 0%, ${b} 100%)` }}>
      <div style={{
        position: 'absolute', inset: 0, opacity: dark ? 0.12 : 0.16,
        backgroundImage: 'repeating-linear-gradient(45deg, rgba(0,0,0,.35) 0 1px, transparent 1px 5px), repeating-linear-gradient(-45deg, rgba(255,255,255,.35) 0 1px, transparent 1px 5px)',
      }} />
      <div style={{ position: 'absolute', inset: 0, boxShadow: 'inset 0 0 0 2px rgba(0,0,0,.18), inset 0 6px 60px rgba(0,0,0,.28)' }} />
    </div>
  );
};
