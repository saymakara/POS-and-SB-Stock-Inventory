import { MotionConfig } from 'motion/react';
import App from './App.tsx';

// (03 Nov 2026, speed) MotionConfig moved here from main.tsx: the sign-in screen uses no Motion animation, so the
// Motion library (~125 kB, 41 kB compressed) is no longer downloaded and parsed before the sign-in fields appear. It now
// arrives with the dashboard code, which is warmed in the background while the password is typed.
// reducedMotion="user": with "reduce motion" on in the phone/PC settings, Motion skips movement (opacity fades stay).
export default function AppWithMotion(props: Parameters<typeof App>[0]) {
  return (
    <MotionConfig reducedMotion="user">
      <App {...props} />
    </MotionConfig>
  );
}
