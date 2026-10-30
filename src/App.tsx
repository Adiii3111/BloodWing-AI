import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Nav } from './components/Nav';
import { useRoute, type Route } from './lib/router';
import Landing from './pages/Landing';
import Mission from './pages/Mission';
import Sentinel from './pages/Sentinel';
import Pulse from './pages/Pulse';
import Orbit from './pages/Orbit';
import Dispatch from './pages/Dispatch';
import Inventory from './pages/Inventory';
import Fleet from './pages/Fleet';
import Lab from './pages/Lab';
import Research from './pages/Research';
import Impact from './pages/Impact';
import About from './pages/About';
import Pitch from './pages/Pitch';
import Demo from './pages/Demo';

const PAGES: Record<Route, () => JSX.Element> = {
  home: Landing,
  mission: Mission,
  sentinel: Sentinel,
  pulse: Pulse,
  orbit: Orbit,
  dispatch: Dispatch,
  inventory: Inventory,
  fleet: Fleet,
  lab: Lab,
  research: Research,
  impact: Impact,
  about: About,
  pitch: Pitch,
  demo: Demo,
};

export default function App() {
  const route = useRoute();
  const reduce = useReducedMotion();
  const Page = PAGES[route];
  const immersive = route === 'pitch';
  return (
    <div className="min-h-screen">
      {!immersive && <Nav route={route} />}
      <AnimatePresence mode="wait">
        <motion.main
          key={route}
          initial={reduce ? false : { opacity: 0, y: 12, filter: 'blur(6px)' }}
          animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
          exit={reduce ? undefined : { opacity: 0, y: -8, filter: 'blur(4px)' }}
          transition={{ duration: 0.35, ease: [0.2, 0.7, 0.2, 1] }}
        >
          <Page />
        </motion.main>
      </AnimatePresence>
      {!immersive && (
        <footer className="border-t border-line px-4 py-6 sm:px-8">
          <div className="mx-auto flex max-w-[1500px] flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <p className="disclaimer">
              Research simulation using synthetic data. Not for clinical decision-making. All hospital demand, inventory, vehicle specifications, routes and performance metrics are simulated; this
              prototype is not connected to real healthcare or aviation systems.
            </p>
            <p className="disclaimer shrink-0 text-dim">BLOODWING AI · Builder Blitz prototype · 2026</p>
          </div>
        </footer>
      )}
    </div>
  );
}
